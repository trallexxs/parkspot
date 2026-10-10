import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ago, api, distanceKm, money } from "../api.js";
import { operatorStore } from "../operatorStore.js";
import { useLocation } from "../useLocation.js";
import NavButtons from "../components/NavButtons.jsx";
import { usePoll } from "../usePoll.js";
import { addTicket } from "../storage.js";
import SpotMap, { Legend } from "../components/SpotMap.jsx";
import LiveBadge from "../components/LiveBadge.jsx";
import Directions from "../components/Directions.jsx";

function defaultArrival() {
  const d = new Date(Date.now() + 15 * 60000);
  d.setSeconds(0, 0);
  d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function Lot() {
  const { id } = useParams();
  const nav = useNavigate();
  const [lot, setLot] = useState(null);
  const [state] = usePoll(() => api.state(id), 2000, [id]);
  const [selected, setSelected] = useState(null);
  const [dir, setDir] = useState(null);
  const [arrive, setArrive] = useState(defaultArrival());
  const [hours, setHours] = useState(1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [showCam, setShowCam] = useState(false);
  const [tick, setTick] = useState(0);
  const [me] = useLocation(true);
  const opPin = operatorStore.pin(id);

  useEffect(() => { api.lot(id).then(setLot).catch((e) => setErr(e.message)); }, [id]);
  useEffect(() => {
    if (!selected) return setDir(null);
    api.directions(id, selected).then(setDir).catch(() => setDir(null));
  }, [id, selected]);
  useEffect(() => { if (showCam) setTick(Date.now()); }, [state, showCam]);
  useEffect(() => { // a spot that was taken while the sheet was open
    if (selected && state && state.statuses[selected] !== "free") setSelected(null);
  }, [state, selected]);

  const price = useMemo(() => (lot ? hours * lot.price_per_hour : 0), [lot, hours]);

  async function book() {
    setBusy(true); setErr("");
    try {
      const b = await api.book(id, { spot_id: selected, arrive_at: new Date(arrive).toISOString(), duration_min: hours * 60 });
      addTicket({ id: b.id, kind: "booking", lot: lot.name });
      nav(`/booking/${b.id}`);
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  if (!lot) return <div className="page"><div className="card">{err || "Loading…"}</div></div>;
  const c = state?.counts;
  const online = state ? state.camera.online : lot.camera_online;
  const sample = lot.kind === "sample";
  const canSeeCamera = sample || !!opPin;
  const km = distanceKm(me, lot.location);
  return (
    <div className="page">
      <header className="page-head">
        <h1>{lot.name}</h1>
        <div className="muted small">{lot.address}</div>
        {sample && <div className="notice small">Sample lot: a replay of recorded public footage, processed live by our pipeline. Not a real place you can drive to.</div>}
        {!sample && km != null && <div className="small">{km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`} from you (straight line)</div>}
        {!sample && <NavButtons location={lot.location} />}
        {!online && (
          <div className="offline-banner">
            The camera at this lot is offline (last frame {ago(state?.camera?.updated_at || lot.updated_at)}). Spot data cannot be confirmed, so booking is paused.
          </div>
        )}
        <div className="stats">
          <div><b className="free-c">{online ? c?.free ?? "–" : "?"}</b><span>free</span></div>
          <div><b>{online ? c?.occupied ?? "–" : "?"}</b><span>occupied</span></div>
          <div><b className="res-c">{(c?.reserved ?? 0) + (c?.conflict ?? 0)}</b><span>booked</span></div>
        </div>
        <LiveBadge camera={state?.camera} />
        <div className="row-btns">
          {canSeeCamera && <button className="btn ghost" onClick={() => setShowCam((v) => !v)}>{showCam ? "Hide camera" : "Show camera view"}</button>}
          <a className="btn ghost" href={`/enter/${id}`}>Walk-in (QR) flow</a>
          <a className="btn ghost" href={`/display/${id}`} target="_blank" rel="noreferrer">Entrance screen</a>
          {(sample || opPin) && <a className="btn ghost" href={`/operator/${id}`}>Operator view</a>}
        </div>
        {showCam && canSeeCamera && (
          <figure className="camera">
            <img src={`/api/lots/${id}/frame.jpg?t=${tick}${opPin ? `&pin=${encodeURIComponent(opPin)}` : ""}`} alt="camera view with detected spots" />
            <figcaption className="muted small">{sample ? state?.camera?.label : "Operator view · image pixelated for privacy (plates and faces unreadable)"}</figcaption>
          </figure>
        )}
      </header>

      <div className="card map-card">
        <Legend />
        {c && c.free === 0 && <div className="notice">The lot is full right now. You can still book for a later time — your spot is guaranteed: if someone takes it, we move you to the nearest free one.</div>}
        <SpotMap map={lot.map} statuses={state?.statuses} selected={selected} onSelect={setSelected} />
      </div>

      {selected && (
        <div className="sheet">
          <div className="sheet-head">
            <div><div className="muted small">Selected spot</div><div className="sheet-spot">{selected}</div></div>
            <button className="x" onClick={() => setSelected(null)} aria-label="close">×</button>
          </div>
          <Directions d={dir} />
          <label className="field">Arrival
            <input type="datetime-local" value={arrive} onChange={(e) => setArrive(e.target.value)} />
          </label>
          <label className="field">Duration
            <div className="chips">
              {[1, 2, 3, 4, 8].map((h) => (
                <button key={h} className={"chip" + (h === hours ? " on" : "")} onClick={() => setHours(h)}>{h} h</button>
              ))}
            </div>
          </label>
          {err && <div className="error small">{err}</div>}
          <button className="btn primary wide" disabled={busy || !online} onClick={book}>{online ? `Book ${selected} · ${money(price, lot.currency)}` : "Booking paused: camera offline"}</button>
        </div>
      )}
    </div>
  );
}
