"""Lot registry, camera frames from each lot's phone, and the merge of camera occupancy with bookings."""
import hashlib
import json
import math
import secrets
import string
import threading
from datetime import timedelta

import cv2
import numpy as np

from . import config, store
from .cv import pipeline
from .cv.detector import get_detector
from .cv.occupancy import SpotSmoother, spot_scores
from .guidance import assign_aisle_rows, directions


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

    @property
    def spots(self):
        return self.cfg["spots"]

    @property
    def kind(self):
        return lot_kind(self.cfg)

    def process(self, img, smooth=True):
        return self.apply(pipeline.analyze(self.fit_frame(img), spots=self.spots), smooth)

    def fit_frame(self, img):
        """Spots are drawn in the frame size the lot was set up with: bring new frames to that size."""
        cam = self.cfg.get("camera", {})
        w, h = cam.get("width"), cam.get("height")
        if not w or not h or (img.shape[1], img.shape[0]) == (w, h):
            return img
        if abs(img.shape[1] / img.shape[0] - w / h) > 0.03:
            raise ValueError(f"frame is {img.shape[1]}x{img.shape[0]} but this lot was set up on a "
                             f"{w}x{h} view: keep the camera phone in the same orientation")
        return cv2.resize(img, (w, h), interpolation=cv2.INTER_AREA)

    def save(self):
        """Real lots: write the config (spots, aisles, location, PIN hash). On free hosting this disk is
        wiped on restart, so the camera phone keeps a copy and restores it (see /import)."""
        if self.kind != "real":
            return
        d = config.LOTS_DIR / "user"
        d.mkdir(parents=True, exist_ok=True)
        self.path = d / f"{self.id}.json"
        self.path.write_text(json.dumps(self.cfg, indent=1))

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


LOTS: dict[str, Lot] = {}


def load_all():
    get_detector()
    for p in sorted((config.LOTS_DIR / "user").glob("*.json")):
        lot = Lot(json.loads(p.read_text()), p)
        LOTS[lot.id] = lot
        # each lot waits for its camera phone to send frames: frames are never written to disk


def lot_kind(cfg):
    return cfg.get("kind") or "real"


def hash_pin(pin, salt=None):
    salt = salt or secrets.token_hex(8)
    return f"{salt}:{hashlib.sha256((salt + str(pin)).encode()).hexdigest()}"


def check_pin(cfg, pin):
    h = cfg.get("pin_hash")
    if not h or not pin:
        return False
    salt = h.split(":", 1)[0]
    return secrets.compare_digest(hash_pin(str(pin).strip(), salt), h)


def new_pin():
    return f"{secrets.randbelow(10**6):06d}"


def camera_online(lot):
    if not lot.updated_at:
        return False
    return (store.now() - store.parse(lot.updated_at)).total_seconds() < config.CAMERA_OFFLINE_S


def create_from_analysis(name, img, res):
    """A real lot from one camera view. Returns (lot, pin): the PIN is shown once to the operator.
    The photo itself is not stored; the lot waits for its camera's frames."""
    lot_id = store.new_id("lot")
    pin = new_pin()
    spots = [{k: s[k] for k in ("id", "row", "polygon", "source")} for s in res["spots"]]
    cfg = {"id": lot_id, "kind": "real", "name": name or "My lot", "address": "",
           "price_per_hour": config.FIRST_HOUR_PRICE, "price_extra_hour": config.EXTRA_HOUR_PRICE,
           "currency": "UZS", "location": None,
           "published": False, "confirmed": False, "pin_hash": hash_pin(pin),
           "camera": {"type": "push", "label": "Phone camera at the lot",
                      "width": res["image"]["width"], "height": res["image"]["height"]},
           "aisles": [], "spots": spots, "created_at": store.iso(store.now())}
    lot = Lot(cfg)
    LOTS[lot_id] = lot
    lot.save()
    lot.apply(res, smooth=False)  # the analysis that found the spots is also the first frame
    store.log(lot_id, "lot_created", spots=len(spots))
    return lot, pin


def restore(cfg):
    """Re-create a real lot from its exported config (after a server restart wiped it)."""
    if lot_kind(cfg) != "real" or not cfg.get("pin_hash") or not cfg.get("id"):
        raise ValueError("not an exported real lot")
    lot = Lot(cfg)
    LOTS[lot.id] = lot
    lot.save()
    store.log(lot.id, "lot_restored")
    return lot


def _centre(poly):
    return np.asarray(poly, float).mean(axis=0)


def renumber_spots(new_spots, old_spots):
    """Operator-edited spots -> rows and ids. Kept spots keep their row; an added spot joins the
    row of the nearest spot if it is close, else starts a new row. Ids are re-assigned in order
    along each row (A1, A2, ...)."""
    rows_known = {s["id"]: s["row"] for s in old_spots}
    placed = []
    for s in new_spots:
        poly = [[float(x), float(y)] for x, y in s["polygon"]]
        row = s.get("row") or rows_known.get(s.get("id"))
        placed.append({"polygon": poly, "row": row, "source": s.get("source", "operator")})
    used = {p["row"] for p in placed if p["row"]}
    letters = (c for c in string.ascii_uppercase if c not in used)
    for p in placed:
        if p["row"]:
            continue
        c = _centre(p["polygon"])
        size = np.ptp(np.asarray(p["polygon"], float), axis=0).max()
        best, best_d = None, 1.5 * size
        for q in placed:
            if q is p or not q["row"]:
                continue
            d = float(np.linalg.norm(_centre(q["polygon"]) - c))
            if d < best_d:
                best, best_d = q["row"], d
        p["row"] = best or next(letters, "Z")
    out = []
    for row in sorted({p["row"] for p in placed}):
        members = [p for p in placed if p["row"] == row]
        cs = np.array([_centre(p["polygon"]) for p in members])
        axis = 0 if np.ptp(cs[:, 0]) >= np.ptp(cs[:, 1]) else 1
        for n, p in enumerate(sorted(members, key=lambda p: _centre(p["polygon"])[axis]), 1):
            out.append({"id": f"{row}{n}", "row": row, "polygon": p["polygon"], "source": p["source"]})
    return out


def apply_setup(lot, spots=None, aisles=None, info=None):
    """Operator's one-time check of a real lot: spots, aisles (entrance side first), name, place."""
    cfg = lot.cfg
    if spots is not None:
        if len(spots) < 1:
            raise ValueError("a lot needs at least one spot")
        cfg["spots"] = renumber_spots(spots, cfg["spots"])
        cfg["confirmed"] = True
        cfg["confirmed_at"] = store.iso(store.now())
        with lot.lock:  # re-score the last frame against the corrected spots, restart smoothing
            lot.smoother = SpotSmoother()
            sc = spot_scores(cfg["spots"], lot.dets)
            lot.cv = {x["id"]: {"occupied": x["occupied"], "p": 1.0 if x["occupied"] else 0.0} for x in sc}
    if aisles is not None:
        cfg["aisles"] = [{"id": f"a{i + 1}", "name": a.get("name") or f"Aisle {i + 1}",
                          "start": [float(v) for v in a["start"]], "end": [float(v) for v in a["end"]]}
                         for i, a in enumerate(aisles)]
    if spots is not None or aisles is not None:
        assign_aisle_rows(cfg)
    if info:
        for k in ("name", "address"):
            if k in info and info[k] is not None:
                cfg[k] = str(info[k])[:120]
        if info.get("price_per_hour") is not None:
            cfg["price_per_hour"] = max(0, int(info["price_per_hour"]))
        if info.get("location"):
            lat, lng = float(info["location"]["lat"]), float(info["location"]["lng"])
            if not (-90 <= lat <= 90 and -180 <= lng <= 180):
                raise ValueError("location out of range")
            cfg["location"] = {"lat": lat, "lng": lng}
        if "published" in info:
            if info["published"] and not (cfg.get("location") and cfg.get("confirmed")):
                raise ValueError("set the location and check the spots before publishing")
            cfg["published"] = bool(info["published"])
    lot.save()
    store.log(lot.id, "lot_setup_saved", spots=len(cfg["spots"]), aisles=len(cfg.get("aisles", [])),
              published=cfg.get("published", False))
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
    """Spots that walk-in drivers chose and have not parked in yet: held WALKIN_HOLD_MIN from the choice."""
    rows = store.q("SELECT * FROM sessions WHERE lot_id=? AND status='active' AND spot_id IS NOT NULL "
                   "AND parked_spot IS NULL", (lot_id,))
    out = {}
    for s in rows:
        if now - store.parse(s["spot_at"] or s["started_at"]) < timedelta(minutes=config.WALKIN_HOLD_MIN):
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
    with lot.lock:
        cv = dict(lot.cv)
    held = _held_bookings(lot.id, now)
    walk = _walkin_holds(lot.id, now)

    if not camera_online(lot):
        # no camera frame yet (new server, camera phone not started), or none for CAMERA_OFFLINE_S
        # (camera offline): we do not know, so we do not guess. Unknown spots are never offered as
        # free, booked or suggested; real bookings still show as reserved.
        raw = {s["id"]: "unknown" for s in lot.spots}
    else:
        raw = {s["id"]: ("occupied" if cv.get(s["id"], {}).get("occupied") else "free") for s in lot.spots}
    statuses = dict(raw)
    for sid, s in walk.items():
        if raw.get(sid) == "free":
            statuses[sid] = "reserved"
        elif raw.get(sid) == "occupied":
            # the camera sees a car arrive in the spot this walk-in driver chose: he has parked
            store.q("UPDATE sessions SET parked_spot=?, parked_at=?, parked_by='camera' "
                    "WHERE id=? AND parked_spot IS NULL", (sid, store.iso(now), s["id"]))
            store.log(lot.id, "walkin_parked_confirmed", sid, session=s["id"])
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

    counts = {k: sum(1 for v in statuses.values() if v == k)
              for k in ("free", "occupied", "reserved", "conflict", "unknown")}
    return {"lot_id": lot.id, "statuses": statuses, "counts": counts, "total": len(lot.spots),
            "camera": {"updated_at": lot.updated_at, "frames_processed": lot.frames_processed,
                       "timing": lot.timing, "quality": lot.quality, "online": camera_online(lot),
                       "label": lot.cfg.get("camera", {}).get("label", "")},
            "server_time": store.iso(now)}


def pixelate(img, width):
    """Plates and faces unreadable, cars and lane markings still visible."""
    h, w = img.shape[:2]
    if w <= width:
        return img
    small = cv2.resize(img, (width, max(1, round(h * width / w))), interpolation=cv2.INTER_AREA)
    return cv2.resize(small, (w, h), interpolation=cv2.INTER_NEAREST)


def annotated_jpeg(lot, statuses):
    """Spot overlay on the camera image, pixelated first (privacy)."""
    with lot.lock:
        if lot.frame is None:
            return None
        frame = pixelate(lot.frame, config.PIXELATE_VIEW_W)
        img = pipeline.draw(frame, lot.spots, lot.dets, status=statuses)
    return pipeline.to_jpeg(img)


def raw_jpeg(lot):
    """Camera image without overlay for the operator's spot editor (pixelated)."""
    with lot.lock:
        if lot.frame is None:
            return None
        frame = pixelate(lot.frame, config.PIXELATE_EDIT_W)
    return pipeline.to_jpeg(frame)


def price(lot, minutes):
    """First started hour at the lot's price (price_per_hour), each further started hour at price_extra_hour."""
    hours = int(math.ceil(max(minutes, 1) / 60.0))
    first = int(lot.cfg.get("price_per_hour", config.FIRST_HOUR_PRICE))
    extra = int(lot.cfg.get("price_extra_hour", config.EXTRA_HOUR_PRICE))
    return first + (hours - 1) * extra
