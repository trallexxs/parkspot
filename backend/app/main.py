"""HTTP API + static frontend."""
import json
import os
from datetime import timedelta

from fastapi import Body, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from . import config, lots, store
from .cv import pipeline
from .guidance import aisle_map, directions

app = FastAPI(title="ParkDet API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.on_event("startup")
def startup():
    store.conn()
    lots.load_all()


def get_lot(lot_id):
    lot = lots.LOTS.get(lot_id)
    if not lot:
        raise HTTPException(404, "lot not found")
    return lot


@app.get("/api/health")
def health():
    # RENDER_GIT_COMMIT is set by Render: shows exactly which commit of the repo is running
    return {"ok": True, "lots": len(lots.LOTS), "commit": os.environ.get("RENDER_GIT_COMMIT", "")[:7]}


# ------------------------------------------------------------------ lots

def require_operator(lot, pin):
    """The camera image, events, camera frames and setup need the lot's PIN."""
    if not lots.check_pin(lot.cfg, pin):
        raise HTTPException(403, "operator PIN required")


def lot_summary(lot):
    st = lots.state(lot)
    c = lot.cfg
    return {"id": lot.id, "name": c["name"], "address": c.get("address", ""), "kind": lot.kind,
            "location": c.get("location"), "published": c.get("published", False),
            "confirmed": c.get("confirmed", False),
            "price_per_hour": c.get("price_per_hour"),
            "price_extra_hour": c.get("price_extra_hour", config.EXTRA_HOUR_PRICE), "currency": c.get("currency"),
            "counts": st["counts"], "total": st["total"],
            "camera_online": st["camera"]["online"], "updated_at": st["camera"]["updated_at"]}


@app.get("/api/lots")
def list_lots():
    """The drivers' map: lots an operator has checked, placed on the map and published."""
    return [lot_summary(lot) for lot in lots.LOTS.values() if lot.cfg.get("published")]


@app.get("/api/lots/{lot_id}")
def lot_detail(lot_id: str):
    lot = get_lot(lot_id)
    c = lot.cfg
    cam = {k: v for k, v in c.get("camera", {}).items() if k in ("type", "label", "width", "height")}
    return {**lot_summary(lot), "camera": cam, "map": aisle_map(c), "spots": c["spots"],
            "aisles": c.get("aisles", [])}


@app.get("/api/lots/{lot_id}/state")
def lot_state(lot_id: str):
    return lots.state(get_lot(lot_id))


@app.get("/api/lots/{lot_id}/frame.jpg")
def lot_frame(lot_id: str, pin: str = "", x_lot_pin: str | None = Header(None)):
    """Camera image with the spot overlay. Real lots: operator only, image pixelated."""
    lot = get_lot(lot_id)
    require_operator(lot, x_lot_pin or pin)
    st = lots.state(lot)
    jpg = lots.annotated_jpeg(lot, st["statuses"])
    if jpg is None:
        raise HTTPException(404, "no frame yet")
    return Response(jpg, media_type="image/jpeg", headers={"Cache-Control": "no-store"})


@app.get("/api/lots/{lot_id}/raw.jpg")
def lot_raw(lot_id: str, pin: str = "", x_lot_pin: str | None = Header(None)):
    """Camera image without overlay, for the operator's spot editor (pixelated for real lots)."""
    lot = get_lot(lot_id)
    require_operator(lot, x_lot_pin or pin)
    jpg = lots.raw_jpeg(lot)
    if jpg is None:
        raise HTTPException(404, "no frame yet: start the camera phone first")
    return Response(jpg, media_type="image/jpeg", headers={"Cache-Control": "no-store"})


@app.get("/api/lots/{lot_id}/nearest")
def lot_nearest(lot_id: str):
    """"Find me a spot": the free spot suggested at the entrance now (same rule everywhere), not held."""
    lot = get_lot(lot_id)
    st = lots.state(lot)
    if not st["camera"]["online"]:
        return {"spot_id": None, "reason": "offline"}
    spot = lots.nearest_free(lot, st["statuses"])
    if not spot:
        return {"spot_id": None, "reason": "full"}
    return {"spot_id": spot, "directions": directions(lot.cfg, spot)}


@app.get("/api/lots/{lot_id}/directions/{spot_id}")
def lot_directions(lot_id: str, spot_id: str):
    d = directions(get_lot(lot_id).cfg, spot_id)
    if d is None:
        raise HTTPException(404, "spot not found")
    return d


@app.get("/api/lots/{lot_id}/events")
def lot_events(lot_id: str, x_lot_pin: str | None = Header(None)):
    lot = get_lot(lot_id)
    require_operator(lot, x_lot_pin)
    return store.events(lot_id)


class PinIn(BaseModel):
    pin: str


@app.post("/api/lots/{lot_id}/auth")
def lot_auth(lot_id: str, body: PinIn):
    lot = get_lot(lot_id)
    if lot.kind != "real" or not lots.check_pin(lot.cfg, body.pin):
        raise HTTPException(403, "wrong PIN")
    return {"ok": True}


class SetupIn(BaseModel):
    spots: list[dict] | None = None
    aisles: list[dict] | None = None
    info: dict | None = None


@app.put("/api/lots/{lot_id}/setup")
def lot_setup(lot_id: str, body: SetupIn, x_lot_pin: str | None = Header(None)):
    """Operator's one-time check: corrected spots, aisles (entrance first), name, address, price,
    GPS location, publish to the drivers' map."""
    lot = get_lot(lot_id)
    require_operator(lot, x_lot_pin)
    try:
        lots.apply_setup(lot, body.spots, body.aisles, body.info)
    except (ValueError, KeyError, TypeError, IndexError) as e:
        raise HTTPException(400, str(e))
    return lot_detail(lot_id)


@app.get("/api/lots/{lot_id}/export")
def lot_export(lot_id: str, x_lot_pin: str | None = Header(None)):
    """The lot's full config, kept by the operator's devices to restore it after a server restart."""
    lot = get_lot(lot_id)
    require_operator(lot, x_lot_pin)
    return lot.cfg


@app.post("/api/lots/import")
def lot_import(cfg: dict = Body(...), x_lot_pin: str | None = Header(None)):
    if cfg.get("id") in lots.LOTS:
        return {"id": cfg["id"], "restored": False}
    if not lots.check_pin(cfg, x_lot_pin):
        raise HTTPException(403, "PIN does not match this lot")
    try:
        lot = lots.restore(cfg)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"id": lot.id, "restored": True}


@app.post("/api/lots/{lot_id}/frame")
async def push_frame(lot_id: str, image: UploadFile = File(...), live: bool = Form(False),
                     x_lot_pin: str | None = Header(None)):
    """The lot's camera (a phone at the lot) sends a new frame (live=true smooths over frames)."""
    lot = get_lot(lot_id)
    require_operator(lot, x_lot_pin)
    data = await image.read()

    def work():  # CPU-bound: off the event loop
        try:
            return lot.process(_read_image(data), smooth=live)
        except ValueError as e:
            raise HTTPException(409, str(e))
    res = await run_in_threadpool(work)
    return {"timing": res["timing"], "summary": res["summary"]}


@app.post("/api/lots")
async def create_lot(image: UploadFile = File(...), name: str = Form("My lot")):
    """Zero-config onboarding: one camera view of a lot -> discovered spots -> an unpublished real lot.
    The operator gets a PIN once, checks the spots, places the lot on the map and publishes it."""
    data = await image.read()

    def work():
        img = pipeline.limit_size(_read_image(data))
        return img, pipeline.analyze(img)
    img, res = await run_in_threadpool(work)
    if len(res["spots"]) < 3:
        raise HTTPException(422, "Could not find parking rows in this view (need 3+ parked cars in a row).")
    lot, pin = lots.create_from_analysis(name, img, res)
    return {"id": lot.id, "spots": len(lot.spots), "pin": pin}


# ------------------------------------------------------------------ vision console

@app.post("/api/analyze")
async def analyze(image: UploadFile = File(...), lot_id: str = Form("")):
    data = await image.read()
    spots = get_lot(lot_id).spots if lot_id else None

    def work():
        res = pipeline.analyze(_read_image(data), spots=spots)
        annotated = pipeline.draw(res.pop("_img"), res["spots"], res["detections"])
        res["annotated"] = pipeline.to_b64(pipeline.limit_size(annotated, 1280))  # light for phones
        return res
    return await run_in_threadpool(work)


def _read_image(data):
    try:
        return pipeline.decode_image(data)
    except ValueError:
        raise HTTPException(400, "not an image")


# ------------------------------------------------------------------ bookings

class BookingIn(BaseModel):
    spot_id: str
    arrive_at: str
    duration_min: int = Field(ge=15, le=24 * 60)
    name: str = ""


def _booking_out(b):
    lot = lots.LOTS.get(b["lot_id"])
    b = dict(b)
    if lot:
        statuses = lots.state(lot)["statuses"]  # may expire, release or move this booking: re-read it
        cur = store.q("SELECT * FROM bookings WHERE id=?", (b["id"],), one=True)
        b = dict(cur) if cur else b
        b["spot_status"] = statuses.get(b["spot_id"])
    b["lot_name"] = lot.cfg["name"] if lot else ""
    b["directions"] = directions(lot.cfg, b["spot_id"]) if lot else None
    b["hold"] = _booking_hold(b)
    return b


def _booking_hold(b):
    """How long the spot stays the driver's, from the same rules lots.state() enforces
    (config.py): for the countdown on the ticket."""
    arrive = store.parse(b["arrive_at"])
    if b["status"] == "pending_payment":
        return {"kind": "pay", "until": store.iso(store.parse(b["created_at"])
                                                  + timedelta(minutes=config.PENDING_PAYMENT_HOLD_MIN))}
    if b["status"] == "confirmed":
        return {"kind": "arrive", "from": store.iso(arrive - timedelta(minutes=config.BOOKING_HOLD_BEFORE_MIN)),
                "until": store.iso(arrive + timedelta(minutes=config.BOOKING_GRACE_MIN))}
    if b["status"] == "checked_in":
        return {"kind": "stay", "until": store.iso(arrive + timedelta(minutes=b["duration_min"]))}
    return None


@app.post("/api/lots/{lot_id}/bookings")
def create_booking(lot_id: str, body: BookingIn):
    lot = get_lot(lot_id)
    if body.spot_id not in {s["id"] for s in lot.spots}:
        raise HTTPException(404, "spot not found")
    arrive = store.parse(body.arrive_at)
    now = store.now()
    if arrive < now - timedelta(minutes=5):
        raise HTTPException(400, "arrival time is in the past")
    end = arrive + timedelta(minutes=body.duration_min)
    for b in store.q("SELECT * FROM bookings WHERE lot_id=? AND spot_id=? AND status IN "
                     "('pending_payment','confirmed','checked_in','parked')", (lot_id, body.spot_id)):
        b0 = store.parse(b["arrive_at"])
        if b0 < end and arrive < b0 + timedelta(minutes=b["duration_min"]):
            raise HTTPException(409, "spot already booked for that time")
    st_all = lots.state(lot)
    st = st_all["statuses"].get(body.spot_id)
    if st == "unknown" or not st_all["camera"]["online"]:
        raise HTTPException(409, "this lot's camera is offline: free spots cannot be confirmed right now")
    soon = arrive - now < timedelta(minutes=config.BOOKING_HOLD_BEFORE_MIN)
    if soon and st != "free":
        raise HTTPException(409, f"spot is {st} right now, pick a free one")
    bid = store.new_id("bk")
    store.q("INSERT INTO bookings (id, lot_id, spot_id, original_spot_id, name, arrive_at, duration_min, "
            "amount, currency, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (bid, lot_id, body.spot_id, body.spot_id, body.name, store.iso(arrive), body.duration_min,
             lots.price(lot, body.duration_min), lot.cfg.get("currency", "UZS"), "pending_payment",
             store.iso(now)))
    store.log(lot_id, "booking_created", body.spot_id, booking=bid)
    return _booking_out(store.q("SELECT * FROM bookings WHERE id=?", (bid,), one=True))


def _get_booking(bid):
    b = store.q("SELECT * FROM bookings WHERE id=?", (bid,), one=True)
    if not b:
        raise HTTPException(404, "booking not found")
    return b


@app.get("/api/bookings/{bid}")
def get_booking(bid: str):
    b = _get_booking(bid)
    lot = lots.LOTS.get(b["lot_id"])
    if lot:
        lots.state(lot)  # applies reassignment / no-show rules before we answer
    return _booking_out(_get_booking(bid))


@app.post("/api/bookings/{bid}/pay")
def pay_booking(bid: str):
    """SANDBOX payment: no money moves. Replace with Payme/Click/Uzum in production."""
    b = _get_booking(bid)
    if b["status"] != "pending_payment":
        raise HTTPException(400, f"booking is {b['status']}")
    ref = store.new_id("sandbox")
    store.q("UPDATE bookings SET status='confirmed', paid=1, payment_ref=? WHERE id=?", (ref, bid))
    store.log(b["lot_id"], "booking_paid_sandbox", b["spot_id"], booking=bid, amount=b["amount"])
    return _booking_out(_get_booking(bid))


@app.post("/api/bookings/{bid}/checkin")
def checkin_booking(bid: str):
    """Driver scans the QR code at the gate with the booking open."""
    b = _get_booking(bid)
    if b["status"] != "confirmed":
        raise HTTPException(400, f"booking is {b['status']}")
    lot = get_lot(b["lot_id"])
    st = lots.state(lot)
    b = _get_booking(bid)
    if st["statuses"].get(b["spot_id"]) in ("occupied", "conflict"):
        spot = next(s for s in lot.spots if s["id"] == b["spot_id"])
        new = lots.nearest_free(lot, st["statuses"], prefer_row=spot["row"])
        if not new:
            raise HTTPException(409, "lot is full")
        store.q("UPDATE bookings SET spot_id=? WHERE id=?", (new, bid))
        store.log(lot.id, "booking_reassigned", b["spot_id"], booking=bid, to=new,
                  reason="booked spot occupied at check-in (camera)")
    now = store.now()
    arrive = store.parse(b["arrive_at"])
    new_arrive = min(arrive, now)
    store.q("UPDATE bookings SET status='checked_in', checked_in_at=?, arrive_at=? WHERE id=?",
            (store.iso(now), store.iso(new_arrive), bid))
    store.log(lot.id, "booking_checked_in", b["spot_id"], booking=bid)
    return _booking_out(_get_booking(bid))


@app.post("/api/bookings/{bid}/cancel")
def cancel_booking(bid: str):
    b = _get_booking(bid)
    if b["status"] not in ("pending_payment", "confirmed"):
        raise HTTPException(400, f"booking is {b['status']}")
    store.q("UPDATE bookings SET status='cancelled' WHERE id=?", (bid,))
    store.log(b["lot_id"], "booking_cancelled", b["spot_id"], booking=bid)
    return _booking_out(_get_booking(bid))


# ------------------------------------------------------------------ walk-in sessions (QR at the gate)
# Scan the gate QR -> the first hour is charged at once (SANDBOX: a test card, no real money) -> the
# driver may choose a free spot (held WALKIN_HOLD_MIN) or just park and tap his spot -> on leaving, each
# further started hour is charged automatically.

def _session_out(s):
    lot = lots.LOTS.get(s["lot_id"])
    taken_since_entry = []
    if lot and s["status"] == "active":
        st = lots.state(lot)          # may mark the session as parked (the camera saw the car arrive)
        s = _get_session(s["id"])
        if not s["parked_spot"]:
            # spots that were free when the driver entered and have a car now: one of them is probably his
            taken_since_entry = [k for k in json.loads(s["free_at_start"] or "[]")
                                 if st["statuses"].get(k) in ("occupied", "conflict")]
    s = dict(s)
    start = store.parse(s["started_at"])
    end = store.parse(s["ended_at"]) if s["ended_at"] else store.now()
    minutes = (end - start).total_seconds() / 60
    s["minutes"] = round(minutes, 1)
    s["amount_total"] = lots.price(lot, minutes) if lot else 0
    s["amount_due"] = max(0, s["amount_total"] - (s["paid_amount"] or 0))
    s["first_hour_price"] = lots.price(lot, 60) if lot else 0
    s["extra_hour_price"] = int(lot.cfg.get("price_extra_hour", config.EXTRA_HOUR_PRICE)) if lot else 0
    s["lot_name"] = lot.cfg["name"] if lot else ""
    s["currency"] = lot.cfg.get("currency", "UZS") if lot else ""
    s["taken_since_entry"] = taken_since_entry
    held = s["status"] == "active" and s["spot_id"] and not s["parked_spot"]
    s["directions"] = directions(lot.cfg, s["spot_id"]) if lot and held else None
    # a chosen spot is held for the walk-in driver for WALKIN_HOLD_MIN from the choice (lots._walkin_holds)
    since = store.parse(s["spot_at"] or s["started_at"])
    s["hold_start"] = store.iso(since) if held else None
    s["hold_until"] = store.iso(since + timedelta(minutes=config.WALKIN_HOLD_MIN)) if held else None
    s.pop("free_at_start", None)
    return s


def _get_session(sid):
    s = store.q("SELECT * FROM sessions WHERE id=?", (sid,), one=True)
    if not s:
        raise HTTPException(404, "session not found")
    return s


def _active_session(sid):
    s = _get_session(sid)
    if s["status"] != "active":
        raise HTTPException(400, f"session is {s['status']}")
    return s


@app.post("/api/lots/{lot_id}/sessions")
def start_session(lot_id: str):
    lot = get_lot(lot_id)
    st = lots.state(lot)
    free = [k for k, v in st["statuses"].items() if v == "free"]
    first = lots.price(lot, 60)
    sid = store.new_id("ss")
    store.q("INSERT INTO sessions (id, lot_id, spot_id, started_at, status, card_last4, paid_amount, payment_ref,"
            " free_at_start) VALUES (?,?,?,?,?,?,?,?,?)",
            (sid, lot_id, None, store.iso(store.now()), "active", "4242", first, store.new_id("sandbox_card"),
             json.dumps(free)))
    store.log(lot_id, "walkin_entered", None, session=sid)
    store.log(lot_id, "walkin_autocharged_sandbox", None, session=sid, amount=first, paid_for="first hour")
    return _session_out(_get_session(sid))


@app.get("/api/sessions/{sid}")
def get_session(sid: str):
    return _session_out(_get_session(sid))


class SpotIn(BaseModel):
    spot_id: str


@app.post("/api/sessions/{sid}/spot")
def choose_session_spot(sid: str, body: SpotIn):
    """Optional: the walk-in driver chooses a free spot; it is held for him for WALKIN_HOLD_MIN."""
    s = _active_session(sid)
    if s["parked_spot"]:
        raise HTTPException(400, "you have already parked")
    lot = get_lot(s["lot_id"])
    st = lots.state(lot)
    if not st["camera"]["online"]:
        raise HTTPException(409, "The camera is offline, so no spot can be confirmed right now.")
    if st["statuses"].get(body.spot_id) != "free" and body.spot_id != s["spot_id"]:
        raise HTTPException(409, f"{body.spot_id} is not free any more. Please choose another spot.")
    store.q("UPDATE sessions SET spot_id=?, spot_at=? WHERE id=?", (body.spot_id, store.iso(store.now()), sid))
    store.log(s["lot_id"], "walkin_spot_chosen", body.spot_id, session=sid)
    return _session_out(_get_session(sid))


@app.post("/api/sessions/{sid}/parked")
def mark_session_parked(sid: str, body: SpotIn):
    """The driver taps the spot he parked in. The camera must see a car there (it cannot tell whose car)."""
    s = _active_session(sid)
    lot = get_lot(s["lot_id"])
    st = lots.state(lot)
    if st["statuses"].get(body.spot_id) not in ("occupied", "conflict"):
        raise HTTPException(409, f"The camera does not see a car in {body.spot_id} yet. "
                                 "Wait a few seconds after parking, then tap it again.")
    store.q("UPDATE sessions SET spot_id=?, parked_spot=?, parked_at=?, parked_by='driver' WHERE id=?",
            (body.spot_id, body.spot_id, store.iso(store.now()), sid))
    store.log(s["lot_id"], "walkin_parked_marked", body.spot_id, session=sid)
    return _session_out(_get_session(sid))


@app.post("/api/sessions/{sid}/exit")
def exit_session(sid: str):
    """Leaving: each further started hour is charged automatically with the visit's card (SANDBOX)."""
    s = _session_out(_active_session(sid))
    if s["amount_due"] > 0:
        store.q("UPDATE sessions SET paid_amount=?, payment_ref=? WHERE id=?",
                (s["amount_total"], store.new_id("sandbox_card"), sid))
        store.log(s["lot_id"], "walkin_autocharged_sandbox", s["spot_id"], session=sid, amount=s["amount_due"],
                  paid_for="extra hours")
    store.q("UPDATE sessions SET status='exited', ended_at=? WHERE id=?", (store.iso(store.now()), sid))
    store.log(s["lot_id"], "walkin_exited", s["spot_id"], session=sid)
    return _session_out(_get_session(sid))


# ------------------------------------------------------------------ metrics

@app.get("/api/metrics")
def metrics():
    if not config.METRICS_PATH.exists():
        return {"available": False}
    return {"available": True, **json.loads(config.METRICS_PATH.read_text())}


# ------------------------------------------------------------------ frontend (built React app)

if config.FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=config.FRONTEND_DIST / "assets"), name="assets")

    @app.get("/{path:path}")
    def spa(path: str):
        f = config.FRONTEND_DIST / path
        if path and f.is_file():
            return FileResponse(f)
        return FileResponse(config.FRONTEND_DIST / "index.html")
