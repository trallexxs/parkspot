"""HTTP API + static frontend."""
import json
from datetime import timedelta

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import config, lots, store
from .cv import pipeline
from .guidance import aisle_map, directions

app = FastAPI(title="Smart Parking API")
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
    return {"ok": True, "lots": len(lots.LOTS)}


# ------------------------------------------------------------------ lots

@app.get("/api/lots")
def list_lots():
    out = []
    for lot in lots.LOTS.values():
        st = lots.state(lot)
        out.append({"id": lot.id, "name": lot.cfg["name"], "address": lot.cfg.get("address", ""),
                    "price_per_hour": lot.cfg.get("price_per_hour"), "currency": lot.cfg.get("currency"),
                    "counts": st["counts"], "total": st["total"],
                    "user_created": lot.cfg.get("user_created", False)})
    return out


@app.get("/api/lots/{lot_id}")
def lot_detail(lot_id: str):
    lot = get_lot(lot_id)
    c = lot.cfg
    return {"id": lot.id, "name": c["name"], "address": c.get("address", ""),
            "price_per_hour": c.get("price_per_hour"), "currency": c.get("currency"),
            "camera": c.get("camera", {}), "map": aisle_map(c),
            "spots": c["spots"], "aisles": c.get("aisles", [])}


@app.get("/api/lots/{lot_id}/state")
def lot_state(lot_id: str):
    return lots.state(get_lot(lot_id))


@app.get("/api/lots/{lot_id}/frame.jpg")
def lot_frame(lot_id: str):
    lot = get_lot(lot_id)
    st = lots.state(lot)
    jpg = lots.annotated_jpeg(lot, st["statuses"])
    if jpg is None:
        raise HTTPException(404, "no frame yet")
    return Response(jpg, media_type="image/jpeg", headers={"Cache-Control": "no-store"})


@app.get("/api/lots/{lot_id}/directions/{spot_id}")
def lot_directions(lot_id: str, spot_id: str):
    d = directions(get_lot(lot_id).cfg, spot_id)
    if d is None:
        raise HTTPException(404, "spot not found")
    return d


@app.get("/api/lots/{lot_id}/events")
def lot_events(lot_id: str):
    get_lot(lot_id)
    return store.events(lot_id)


@app.post("/api/lots/{lot_id}/frame")
async def push_frame(lot_id: str, image: UploadFile = File(...), live: bool = Form(False)):
    """A phone or IP camera sends a new frame for this lot (live=true smooths over frames)."""
    lot = get_lot(lot_id)
    if lot.cfg.get("camera", {}).get("type") == "video":
        raise HTTPException(400, "this lot is fed by a recorded camera; create your own lot to stream frames")
    img = _read_image(await image.read())
    res = lot.process(img, smooth=live)
    if lot.cfg.get("camera", {}).get("type") == "push":
        lot.cfg["camera"]["label"] = "Live phone camera" if live else lot.cfg["camera"].get("label", "")
    return {"timing": res["timing"], "summary": res["summary"]}


@app.post("/api/lots")
async def create_lot(image: UploadFile = File(...), name: str = Form("My lot")):
    """Zero-config onboarding: one photo of a lot -> discovered spots -> bookable lot."""
    img = pipeline.limit_size(_read_image(await image.read()))
    res = pipeline.analyze(img)
    if len(res["spots"]) < 3:
        raise HTTPException(422, "Could not find parking rows in this photo (need 3+ parked cars in a row).")
    lot = lots.create_from_analysis(name, img, res)
    return {"id": lot.id, "spots": len(lot.spots)}


# ------------------------------------------------------------------ vision console

@app.post("/api/analyze")
async def analyze(image: UploadFile = File(...), lot_id: str = Form("")):
    img = _read_image(await image.read())
    spots = get_lot(lot_id).spots if lot_id else None
    res = pipeline.analyze(img, spots=spots)
    annotated = pipeline.draw(res.pop("_img"), res["spots"], res["detections"])
    res["annotated"] = pipeline.to_b64(annotated)
    return res


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
    b["lot_name"] = lot.cfg["name"] if lot else ""
    b["directions"] = directions(lot.cfg, b["spot_id"]) if lot else None
    if lot:
        b["spot_status"] = lots.state(lot)["statuses"].get(b["spot_id"])
    return b


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
    st = lots.state(lot)["statuses"].get(body.spot_id)
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

def _session_out(s):
    lot = lots.LOTS.get(s["lot_id"])
    s = dict(s)
    start = store.parse(s["started_at"])
    end = store.parse(s["ended_at"]) if s["ended_at"] else store.now()
    minutes = (end - start).total_seconds() / 60
    s["minutes"] = round(minutes, 1)
    s["amount_total"] = lots.price(lot, minutes) if lot else 0
    s["amount_due"] = max(0, s["amount_total"] - (s["paid_amount"] or 0))
    s["lot_name"] = lot.cfg["name"] if lot else ""
    s["currency"] = lot.cfg.get("currency", "UZS") if lot else ""
    s["directions"] = directions(lot.cfg, s["spot_id"]) if lot and s["spot_id"] else None
    return s


def _get_session(sid):
    s = store.q("SELECT * FROM sessions WHERE id=?", (sid,), one=True)
    if not s:
        raise HTTPException(404, "session not found")
    return s


@app.post("/api/lots/{lot_id}/sessions")
def start_session(lot_id: str):
    lot = get_lot(lot_id)
    st = lots.state(lot)
    spot = lots.nearest_free(lot, st["statuses"])
    sid = store.new_id("ss")
    store.q("INSERT INTO sessions (id, lot_id, spot_id, started_at, status) VALUES (?,?,?,?,?)",
            (sid, lot_id, spot, store.iso(store.now()), "active"))
    store.log(lot_id, "walkin_entered", spot, session=sid)
    return _session_out(_get_session(sid))


@app.get("/api/sessions/{sid}")
def get_session(sid: str):
    return _session_out(_get_session(sid))


class CardIn(BaseModel):
    number: str


@app.post("/api/sessions/{sid}/card")
def attach_card(sid: str, body: CardIn):
    """SANDBOX: only test cards, only the last 4 digits are stored."""
    digits = "".join(ch for ch in body.number if ch.isdigit())
    if len(digits) < 12:
        raise HTTPException(400, "card number too short")
    store.q("UPDATE sessions SET card_last4=? WHERE id=?", (digits[-4:], sid))
    return _session_out(_get_session(sid))


@app.post("/api/sessions/{sid}/pay")
def pay_session(sid: str):
    s = _session_out(_get_session(sid))
    if s["amount_due"] <= 0:
        return s
    store.q("UPDATE sessions SET paid_amount=?, payment_ref=? WHERE id=?",
            (s["amount_total"], store.new_id("sandbox"), sid))
    store.log(s["lot_id"], "walkin_paid_sandbox", s["spot_id"], session=sid, amount=s["amount_due"])
    return _session_out(_get_session(sid))


@app.post("/api/sessions/{sid}/exit")
def exit_session(sid: str):
    s = _session_out(_get_session(sid))
    if s["status"] != "active":
        raise HTTPException(400, f"session is {s['status']}")
    if s["amount_due"] > 0:
        if not s["card_last4"]:
            raise HTTPException(402, json.dumps({"amount_due": s["amount_due"],
                                                 "message": "Please pay before leaving"}))
        store.q("UPDATE sessions SET paid_amount=?, payment_ref=? WHERE id=?",
                (s["amount_total"], store.new_id("sandbox_card"), sid))
        store.log(s["lot_id"], "walkin_autocharged_sandbox", s["spot_id"], session=sid, amount=s["amount_due"])
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
