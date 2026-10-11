import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, money } from "../api.js";
import { usePoll } from "../usePoll.js";
import QR from "../components/QR.jsx";
import Directions from "../components/Directions.jsx";
import Countdown from "../components/Countdown.jsx";

const LABEL = {
  pending_payment: "Waiting for payment", confirmed: "Booked", checked_in: "Checked in — drive to your spot",
  parked: "Parked (confirmed by camera)", completed: "Completed", cancelled: "Cancelled",
  no_show: "Released — you did not arrive in time", expired: "Expired (not paid)",
};
const time = (iso) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** The hold on the spot, as the server enforces it (see `hold` in the booking). */
function Hold({ b }) {
  const h = b.hold;
  if (!h) return null;
  if (h.kind === "pay")
    return <Countdown start={b.created_at} until={h.until} label="Pay within" overLabel="Payment time is up — the spot is being released" />;
  if (h.kind === "arrive") {
    if (Date.now() < Date.parse(h.from))
      return <div className="countdown"><div className="small">Your spot is held for you from <b>{time(h.from)}</b> until <b>{time(h.until)}</b>.</div></div>;
    return <Countdown start={h.from} until={h.until} label="Your spot is held for" overLabel="Hold time is up — the spot is being released" />;
  }
  return <Countdown start={b.arrive_at} until={h.until} label="Parking time left" overLabel="Your booked time is over" />;
}

export default function Booking() {
  const { bid } = useParams();
  const [b, err, setB] = usePoll(() => api.booking(bid), 3000, [bid]);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");

  const act = async (name, fn) => {
    setBusy(name); setMsg("");
    try { setB(await fn(bid)); } catch (e) { setMsg(e.message); }
    setBusy("");
  };

  if (!b) return <div className="page"><div className="card">{err ? err.message : "Loading…"}</div></div>;
  const moved = b.spot_id !== b.original_spot_id;
  return (
    <div className="page">
      <header className="page-head">
        <Link to={`/lot/${b.lot_id}`} className="muted small">← {b.lot_name}</Link>
        <h1>Spot {b.spot_id}</h1>
        <div className={"status-pill " + b.status}>{LABEL[b.status] || b.status}</div>
      </header>
      <Hold b={b} />
      {moved && (
        <div className="card notice">
          Your original spot <b>{b.original_spot_id}</b> was taken by another car (seen by the camera). We moved your booking to <b>{b.spot_id}</b> — same price.
        </div>
      )}
      <div className="card">
        <div className="kv"><span>Arrival</span><b>{new Date(b.arrive_at).toLocaleString()}</b></div>
        <div className="kv"><span>Duration</span><b>{b.duration_min / 60} h</b></div>
        <div className="kv"><span>Price</span><b>{money(b.amount, b.currency)}</b></div>
        <div className="kv"><span>Booking code</span><b className="mono">{b.id}</b></div>
      </div>

      {b.status === "pending_payment" && (
        <div className="card">
          <div className="sandbox">Test payment — no real money is charged</div>
          <button className="btn primary lg wide" disabled={!!busy} aria-busy={busy === "pay"} onClick={() => act("pay", api.payBooking)}>Pay {money(b.amount, b.currency)} (test)</button>
          <button className="btn ghost wide" disabled={!!busy} aria-busy={busy === "cancel"} onClick={() => act("cancel", api.cancel)}>Cancel</button>
        </div>
      )}

      {b.status === "confirmed" && (
        <div className="card center">
          <QR value={`${window.location.origin}/booking/${b.id}`} />
          <p className="muted small">No need to scan anything: press the button when you arrive. Show this code only if staff ask.</p>
          <button className="btn primary lg wide" disabled={!!busy} aria-busy={busy === "checkin"} onClick={() => act("checkin", api.checkin)}>I'm at the entrance — check in</button>
          <button className="btn ghost wide" disabled={!!busy} aria-busy={busy === "cancel"} onClick={() => act("cancel", api.cancel)}>Cancel booking</button>
        </div>
      )}

      {["confirmed", "checked_in", "parked"].includes(b.status) && (
        <div className="card">
          <h3>How to get there</h3>
          <Directions d={b.directions} big={b.status === "checked_in"} />
        </div>
      )}
      {msg && <div className="card error">{msg}</div>}
    </div>
  );
}
