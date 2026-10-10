import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { getTickets } from "../storage.js";

export default function Tickets() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    const ts = getTickets();
    Promise.all(ts.map((t) => (t.kind === "booking" ? api.booking(t.id) : api.session(t.id))
      .then((d) => ({ ...t, d })).catch(() => null)))
      .then((r) => setItems(r.filter(Boolean)));
  }, []);
  return (
    <div className="page">
      <header className="page-head"><h1>My tickets</h1></header>
      {items.length === 0 && <div className="card muted">No tickets yet. Book a spot or scan the QR code at a lot entrance.</div>}
      {items.map(({ id, kind, d }) => (
        <Link key={id} to={kind === "booking" ? `/booking/${id}` : `/session/${id}`} className="card ticket">
          <div>
            <div className="lot-name">{d.lot_name}</div>
            <div className="muted small">{kind === "booking" ? `Booking · ${new Date(d.arrive_at).toLocaleString()}` : `Drive-in · ${new Date(d.started_at).toLocaleString()}`}</div>
          </div>
          <div className="ticket-right">
            <b>{d.spot_id || "—"}</b>
            <span className={"status-pill " + d.status}>{d.status.replace("_", " ")}</span>
          </div>
        </Link>
      ))}
    </div>
  );
}
