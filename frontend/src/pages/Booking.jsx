import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, money } from "../api.js";
import { usePoll } from "../usePoll.js";
import QR from "../components/QR.jsx";
import Directions from "../components/Directions.jsx";

const LABEL = {
  pending_payment: "Waiting for payment", confirmed: "Booked", checked_in: "Checked in — drive to your spot",
  parked: "Parked (confirmed by camera)", completed: "Completed", cancelled: "Cancelled",
  no_show: "Released — you did not arrive in time", expired: "Expired (not paid)",
};

export default function Booking() {
  const { bid } = useParams();
  const [b, err, setB] = usePoll(() => api.booking(bid), 3000, [bid]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const act = async (fn) => {
    setBusy(true); setMsg("");
    try { setB(await fn(bid)); } catch (e) { setMsg(e.message); }
    setBusy(false);
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
          <div className="sandbox">SANDBOX PAYMENT — test mode, no real money is charged</div>
          <button className="btn primary wide" disabled={busy} onClick={() => act(api.payBooking)}>Pay {money(b.amount, b.currency)}</button>
          <button className="btn ghost wide" disabled={busy} onClick={() => act(api.cancel)}>Cancel</button>
        </div>
      )}

      {b.status === "confirmed" && (
        <div className="card center">
          <QR value={`${window.location.origin}/booking/${b.id}`} />
          <p className="muted small">Show this at the gate, or press the button when you arrive.</p>
          <button className="btn primary wide" disabled={busy} onClick={() => act(api.checkin)}>I'm at the entrance — check in</button>
          <button className="btn ghost wide" disabled={busy} onClick={() => act(api.cancel)}>Cancel booking</button>
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
