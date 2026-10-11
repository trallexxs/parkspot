import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ago, api } from "../api.js";
import { usePoll } from "../usePoll.js";
import { operatorStore } from "../operatorStore.js";
import LiveBadge from "../components/LiveBadge.jsx";
import PinGate from "../components/PinGate.jsx";
import QR from "../components/QR.jsx";

const TEXT = {
  booking_created: "Booking created", booking_paid_sandbox: "Booking paid (sandbox)",
  booking_checked_in: "Driver checked in at the gate", booking_cancelled: "Booking cancelled",
  booking_reassigned: "Spot taken by another car → booking moved", parked_confirmed: "Camera confirmed: booked car parked",
  no_show_released: "No-show → spot released", walkin_entered: "Walk-in entered",
  walkin_paid_sandbox: "Walk-in paid (sandbox)", walkin_autocharged_sandbox: "Walk-in card charged at exit (sandbox)",
  walkin_exited: "Walk-in left", lot_created: "Lot created from the camera view", lot_restored: "Lot restored after a server restart",
  lot_setup_saved: "Spots / aisle / location saved",
};

function download(name, obj) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 1)], { type: "application/json" }));
  a.download = name;
  a.click();
}

/** Lot operator: live camera (pixelated for real lots), counts, setup status, events, backup. */
export default function Operator() {
  const { id } = useParams();
  const [lot, setLot] = useState(null);
  const [missing, setMissing] = useState(false);
  const [pin, setPin] = useState(operatorStore.pin(id));
  const [msg, setMsg] = useState("");
  const [state] = usePoll(() => api.state(id), 3000, [id]);
  const [events] = usePoll(() => (lot && pin ? api.events(id, pin) : Promise.resolve(null)), 4000, [id, pin, !!lot]);
  const [t, setT] = useState(0);

  const load = () => api.lot(id).then((l) => { setLot(l); setMissing(false); }).catch((e) => { if (e.status === 404) setMissing(true); });
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setT(Date.now()), [state]);
  useEffect(() => { // keep a fresh copy of the config on this device, to restore after a server restart
    if (lot?.kind === "real" && pin) api.exportLot(id, pin).then((c) => operatorStore.saveCfg(id, c)).catch(() => {});
  }, [lot, pin, id]);

  async function restore() {
    try { await api.importLot(operatorStore.cfg(id), pin); setMsg("Lot restored on the server."); load(); }
    catch (e) { setMsg(e.message); }
  }

  if (missing) {
    const cached = operatorStore.cfg(id);
    return (
      <div className="page">
        <header className="page-head"><h1>Lot not on the server</h1></header>
        <div className="card">
          {cached ? <>
            <p>The server restarted and forgot this lot. This device has a copy of its setup.</p>
            {!pin && <PinGate lotId={id} lotName={cached.name} onOk={setPin} />}
            {pin && <button className="btn primary wide" onClick={restore}>Restore “{cached.name}”</button>}
          </> : <p>No copy of this lot on this device. Set it up again from the camera phone.</p>}
          {msg && <div className="small">{msg}</div>}
        </div>
      </div>
    );
  }
  if (!lot) return <div className="page"><div className="card">Loading…</div></div>;
  const real = lot.kind === "real";
  if (real && !pin) return <div className="page"><PinGate lotId={id} lotName={lot.name} onOk={setPin} /></div>;
  const c = state?.counts;
  const frame = `/api/lots/${id}/frame.jpg?t=${t}${pin ? `&pin=${encodeURIComponent(pin)}` : ""}`;
  return (
    <div className="page wide-page">
      <header className="page-head">
        <Link to={real ? "/operator" : `/lot/${id}`} className="muted small">← {real ? "operator home" : "driver map"}</Link>
        <h1>Operator · {lot.name}</h1>
        <LiveBadge camera={state?.camera} />
        {real && (
          <div className="row-btns">
            <span className={"status-pill " + (lot.published ? "active" : "pending_payment")}>{lot.published ? "On the drivers' map" : "Not published"}</span>
            <span className={"status-pill " + (lot.confirmed ? "active" : "pending_payment")}>{lot.confirmed ? "Spots checked" : "Spots not checked"}</span>
            <span className={"status-pill " + (lot.location ? "active" : "pending_payment")}>{lot.location ? "Location set" : "No location"}</span>
          </div>
        )}
      </header>
      <div className="operator-grid">
        <div className="card">
          <img className="result-img" src={frame} alt="camera view with spot overlay" onError={(e) => { e.currentTarget.style.display = "none"; }} onLoad={(e) => { e.currentTarget.style.display = "block"; }} />
          {real && <div className="muted small">Camera image pixelated on the server: plates and faces are never shown. Last frame {ago(state?.camera?.updated_at)}.</div>}
          <div className="stats">
            <div><b className="free-c">{c?.free ?? "–"}</b><span>free</span></div>
            <div><b className="res-c">{c?.reserved ?? "–"}</b><span>reserved</span></div>
            <div><b className="taken-c">{c ? c.occupied + c.conflict : "–"}</b><span>taken</span></div>
            <div><b>{c?.unknown ?? 0}</b><span>no data</span></div>
          </div>
          {state?.camera?.quality?.warnings?.map((w) => <div key={w} className="notice small">{w}</div>)}
          {real && (
            <div className="row-btns">
              <Link className="btn primary" to={`/operator/${id}/setup`}>Check spots, aisle & map location</Link>
              <Link className="btn ghost" to={`/camera/${id}`}>This phone = the camera</Link>
              <Link className="btn ghost" to={`/lot/${id}`}>Driver page</Link>
              <a className="btn ghost" href={`/display/${id}`} target="_blank" rel="noreferrer">Entrance screen</a>
              <a className="btn ghost" href={`/enter/${id}`} target="_blank" rel="noreferrer">Walk-in page (gate QR)</a>
              <button className="btn ghost" onClick={() => api.exportLot(id, pin).then((cfg) => download(`${id}.json`, cfg))}>Download backup</button>
            </div>
          )}
        </div>
        <div className="card">
          {real && (
            <div className="center">
              <h3>Gate QR (print and stick at the entrance)</h3>
              <QR value={`${window.location.origin}/enter/${id}`} size={160} />
              <div className="muted small">Drivers without a booking scan it to enter and pay before leaving.</div>
            </div>
          )}
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
