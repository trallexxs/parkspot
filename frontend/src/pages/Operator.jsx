import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api.js";
import { usePoll } from "../usePoll.js";
import LiveBadge from "../components/LiveBadge.jsx";

const TEXT = {
  booking_created: "Booking created", booking_paid_sandbox: "Booking paid (sandbox)",
  booking_checked_in: "Driver checked in at the gate", booking_cancelled: "Booking cancelled",
  booking_reassigned: "Spot taken by another car → booking moved", parked_confirmed: "Camera confirmed: booked car parked",
  no_show_released: "No-show → spot released", walkin_entered: "Walk-in entered",
  walkin_paid_sandbox: "Walk-in paid (sandbox)", walkin_autocharged_sandbox: "Walk-in card charged at exit (sandbox)",
  walkin_exited: "Walk-in left", lot_created: "Lot created from camera photo",
};

/** Lot operator: live annotated camera, counts and the event log. */
export default function Operator() {
  const { id } = useParams();
  const [lot, setLot] = useState(null);
  const [state] = usePoll(() => api.state(id), 2000, [id]);
  const [events] = usePoll(() => api.events(id), 3000, [id]);
  const [t, setT] = useState(0);
  useEffect(() => { api.lot(id).then(setLot).catch(() => {}); }, [id]);
  useEffect(() => setT(Date.now()), [state]);
  const c = state?.counts;
  return (
    <div className="page wide-page">
      <header className="page-head">
        <Link to={`/lot/${id}`} className="muted small">← driver map</Link>
        <h1>Operator · {lot?.name}</h1>
        <LiveBadge camera={state?.camera} />
      </header>
      <div className="operator-grid">
        <div className="card">
          <img className="result-img" src={`/api/lots/${id}/frame.jpg?t=${t}`} alt="annotated camera frame" />
          <div className="stats">
            <div><b className="free-c">{c?.free ?? "–"}</b><span>free</span></div>
            <div><b>{c?.occupied ?? "–"}</b><span>occupied</span></div>
            <div><b className="res-c">{c?.reserved ?? "–"}</b><span>reserved</span></div>
            <div><b style={{ color: "var(--red)" }}>{c?.conflict ?? "–"}</b><span>conflict</span></div>
          </div>
          {state?.camera?.quality?.warnings?.map((w) => <div key={w} className="notice small">{w}</div>)}
        </div>
        <div className="card">
          <h3>Events</h3>
          {!events?.length && <div className="muted small">No events yet.</div>}
          {events?.map((e) => (
            <div key={e.id} className="event">
              <span className="muted small">{new Date(e.at).toLocaleTimeString()}</span>
              <span>{TEXT[e.kind] || e.kind}{e.spot_id ? ` · ${e.spot_id}` : ""}{e.detail?.to ? ` → ${e.detail.to}` : ""}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
