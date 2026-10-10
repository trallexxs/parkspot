"""Lot registry, live camera workers and the merge of camera occupancy with bookings."""
import json
import math
import threading
import time
from contextlib import contextmanager
from datetime import timedelta

import cv2

from . import config, store
from .cv import pipeline
from .cv.detector import get_detector
from .cv.occupancy import SpotSmoother, spot_scores
from .guidance import directions


class Lot:
    def __init__(self, cfg, path=None):
        self.cfg = cfg
        self.path = path
        self.id = cfg["id"]
        self.smoother = SpotSmoother()
        self.lock = threading.RLock()
        self.cv = {}            # spot_id -> {"occupied": bool, "p": float}
        self.frame = None       # last processed frame (BGR, after enhancement)
        self.dets = []
        self.timing = {}
        self.quality = {}
        self.updated_at = None
        self.frames_processed = 0
        self.last_viewed = time.time()  # the replay camera only runs while someone is looking

    @property
    def spots(self):
        return self.cfg["spots"]

    def process(self, img, smooth=True):
        return self.apply(pipeline.analyze(img, spots=self.spots), smooth)

    def apply(self, res, smooth=True):
        """Take an analysis of this lot's camera frame (same spot ids) as the current state."""
        scores = [{"id": s["id"], "occupied": s["occupied"]} for s in res["spots"]]
        with self.lock:
            if smooth:
                self.cv = self.smoother.update(scores)
            else:
                self.cv = {s["id"]: {"occupied": s["occupied"], "p": 1.0 if s["occupied"] else 0.0}
                           for s in scores}
            self.frame = res["_img"]
            self.dets = res["detections"]
            self.timing = res["timing"]
            self.quality = res["quality"]
            self.updated_at = store.iso(store.now())
            self.frames_processed += 1
        return res


class CameraWorker(threading.Thread):
    """Replays a recorded video through the full pipeline, as if it were a live camera."""

    def __init__(self, lot):
        super().__init__(daemon=True)
        self.lot = lot

    def run(self):
        path = config.ROOT_DIR / self.lot.cfg["camera"]["path"]
        stride = self.lot.cfg["camera"].get("stride", 2)
        while True:
            cap = cv2.VideoCapture(str(path))
            i = 0
            while True:
                ok, f = cap.read()
                if not ok:
                    break
                if i % stride == 0:
                    while (self.lot.frame is not None
                           and time.time() - self.lot.last_viewed > config.CAMERA_IDLE_AFTER_S):
                        time.sleep(1.0)  # nobody is watching: save CPU on small servers
                    while _interactive > 0:
                        time.sleep(0.2)  # someone is waiting for an answer: let them go first
                    t0 = time.time()
                    try:
                        self.lot.process(f)
                    except Exception as e:  # keep the camera alive
                        print("camera error", self.lot.id, e)
                    took = time.time() - t0
                    time.sleep(max(config.CAMERA_INTERVAL_S, 2 * took))  # never use more than ~1/3 of a CPU
                i += 1
            cap.release()


LOTS: dict[str, Lot] = {}

# A person waiting for an answer (photo analysis, a phone camera frame, a new lot) goes first:
# the replay camera pauses while any such request is running. Matters on small servers.
_interactive = 0
_interactive_lock = threading.Lock()


@contextmanager
def interactive():
    global _interactive
    with _interactive_lock:
        _interactive += 1
    try:
        yield
    finally:
        with _interactive_lock:
            _interactive -= 1


def load_all():
    get_detector()
    for p in sorted(config.LOTS_DIR.glob("*.json")) + sorted((config.LOTS_DIR / "user").glob("*.json")):
        cfg = json.loads(p.read_text())
        lot = Lot(cfg, p)
        LOTS[lot.id] = lot
        cam = cfg.get("camera", {})
        if cam.get("type") == "video":
            CameraWorker(lot).start()
        elif cam.get("type") in ("image", "push") and cam.get("path"):
            img = cv2.imread(str(config.ROOT_DIR / cam["path"]))
            if img is not None:
                lot.process(img, smooth=False)


def create_from_analysis(name, img, res):
    lot_id = store.new_id("lot")
    (config.LOTS_DIR / "user").mkdir(parents=True, exist_ok=True)
    img_dir = config.DATA_DIR / "user_lots"
    img_dir.mkdir(parents=True, exist_ok=True)
    img_path = img_dir / f"{lot_id}.jpg"
    cv2.imwrite(str(img_path), img)
    spots = [{k: s[k] for k in ("id", "row", "polygon", "source")} for s in res["spots"]]
    cfg = {"id": lot_id, "name": name or "My lot", "address": "Created from a photo",
           "price_per_hour": 5000, "currency": "UZS",
           "camera": {"type": "push", "path": str(img_path.relative_to(config.ROOT_DIR)),
                      "label": "Photo / phone camera (send new frames to update)",
                      "width": res["image"]["width"], "height": res["image"]["height"]},
           "aisles": [], "spots": spots, "user_created": True}
    path = config.LOTS_DIR / "user" / f"{lot_id}.json"
    path.write_text(json.dumps(cfg, indent=1))
    lot = Lot(cfg, path)
    LOTS[lot_id] = lot
    lot.apply(res, smooth=False)  # the analysis that found the spots is also the first frame
    store.log(lot_id, "lot_created", spots=len(spots))
    return lot


# ---------------------------------------------------------------- bookings x camera

def _held_bookings(lot_id, now):
    rows = store.q("SELECT * FROM bookings WHERE lot_id=? AND status IN "
                   "('pending_payment','confirmed','checked_in')", (lot_id,))
    held = {}
    for b in rows:
        arrive = store.parse(b["arrive_at"])
        created = store.parse(b["created_at"])
        if b["status"] == "pending_payment":
            if now - created > timedelta(minutes=config.PENDING_PAYMENT_HOLD_MIN):
                store.q("UPDATE bookings SET status='expired' WHERE id=?", (b["id"],))
                continue
            if now < arrive - timedelta(minutes=config.BOOKING_HOLD_BEFORE_MIN):
                continue
        elif b["status"] == "confirmed":
            if now > arrive + timedelta(minutes=config.BOOKING_GRACE_MIN):
                store.q("UPDATE bookings SET status='no_show' WHERE id=?", (b["id"],))
                store.log(lot_id, "no_show_released", b["spot_id"], booking=b["id"])
                continue
            if now < arrive - timedelta(minutes=config.BOOKING_HOLD_BEFORE_MIN):
                continue
        elif b["status"] == "checked_in":
            if now > arrive + timedelta(minutes=b["duration_min"]):
                store.q("UPDATE bookings SET status='completed' WHERE id=?", (b["id"],))
                continue
        held[b["spot_id"]] = b
    return held


def _walkin_holds(lot_id, now):
    rows = store.q("SELECT * FROM sessions WHERE lot_id=? AND status='active'", (lot_id,))
    out = {}
    for s in rows:
        if s["spot_id"] and now - store.parse(s["started_at"]) < timedelta(minutes=config.WALKIN_HOLD_MIN):
            out[s["spot_id"]] = s
    return out


def nearest_free(lot, statuses, prefer_row=None, exclude=()):
    free = [s for s in lot.spots if statuses.get(s["id"]) == "free" and s["id"] not in exclude]
    if not free:
        return None

    def key(s):
        d = directions(lot.cfg, s["id"])
        dist = d["distance_m"] if d and d.get("distance_m") is not None else 0
        return (0 if s["row"] == prefer_row else 1, dist)
    return min(free, key=key)["id"]


def state(lot):
    """Final status per spot: free / occupied / reserved / conflict. Also enforces bookings."""
    now = store.now()
    lot.last_viewed = time.time()
    with lot.lock:
        cv = dict(lot.cv)
    held = _held_bookings(lot.id, now)
    walk = _walkin_holds(lot.id, now)

    raw = {s["id"]: ("occupied" if cv.get(s["id"], {}).get("occupied") else "free") for s in lot.spots}
    statuses = dict(raw)
    for sid in walk:
        if raw.get(sid) == "free":
            statuses[sid] = "reserved"
    for sid, b in held.items():
        if b["status"] in ("confirmed", "pending_payment"):
            statuses[sid] = "conflict" if raw.get(sid) == "occupied" else "reserved"
        elif b["status"] == "checked_in":
            if raw.get(sid) == "occupied":
                # the camera sees a car arrive in the booked spot after check-in
                store.q("UPDATE bookings SET status='parked' WHERE id=?", (b["id"],))
                store.log(lot.id, "parked_confirmed", sid, booking=b["id"])
                statuses[sid] = "occupied"
            else:
                statuses[sid] = "reserved"

    # Enforcement: a booked spot taken by someone else -> move the booking to the nearest free spot
    for sid, b in list(held.items()):
        if statuses.get(sid) == "conflict" and b["status"] == "confirmed":
            spot = next(s for s in lot.spots if s["id"] == sid)
            new = nearest_free(lot, statuses, prefer_row=spot["row"])
            if new:
                store.q("UPDATE bookings SET spot_id=? WHERE id=?", (new, b["id"]))
                store.log(lot.id, "booking_reassigned", sid, booking=b["id"], to=new,
                          reason="booked spot occupied by another vehicle (camera)")
                statuses[new] = "reserved"
                statuses[sid] = "occupied"

    counts = {k: sum(1 for v in statuses.values() if v == k) for k in ("free", "occupied", "reserved", "conflict")}
    return {"lot_id": lot.id, "statuses": statuses, "counts": counts, "total": len(lot.spots),
            "camera": {"updated_at": lot.updated_at, "frames_processed": lot.frames_processed,
                       "timing": lot.timing, "quality": lot.quality,
                       "label": lot.cfg.get("camera", {}).get("label", "")},
            "server_time": store.iso(now)}


def annotated_jpeg(lot, statuses):
    with lot.lock:
        if lot.frame is None:
            return None
        img = pipeline.draw(lot.frame, lot.spots, lot.dets, status=statuses)
    return pipeline.to_jpeg(img)


def price(lot, minutes):
    return int(math.ceil(max(minutes, 1) / 60.0)) * int(lot.cfg.get("price_per_hour", 5000))
