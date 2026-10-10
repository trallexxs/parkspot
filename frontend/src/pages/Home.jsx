import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ago, api, distanceKm, money } from "../api.js";
import { usePoll } from "../usePoll.js";
import { useLocation } from "../useLocation.js";
import MapView from "../components/MapView.jsx";
import NavButtons from "../components/NavButtons.jsx";

/** Drivers' home: real lots on a map, live free counts from each lot's camera, nearest first. */
export default function Home() {
  const nav = useNavigate();
  const [lots, error] = usePoll(() => api.lots(), 5000);
  const [me, locError] = useLocation(true);
  const [selected, setSelected] = useState(null);

  const sorted = useMemo(() => {
    const ls = (lots || []).map((l) => ({ ...l, km: distanceKm(me, l.location) }));
    return ls.sort((a, b) => (a.km ?? 1e9) - (b.km ?? 1e9));
  }, [lots, me]);

  return (
    <div className="page">
      <header className="page-head">
        <div className="brand"><span className="brand-p">P</span> ParkDet</div>
        <p className="muted small">Free spots counted by each lot's own camera, live. Nothing on this map is simulated.</p>
      </header>
      <div className="card map-card-home">
        <MapView lots={sorted} user={me} onLotClick={(l) => setSelected(l.id)} height={340} />
        {locError && <div className="muted small">{locError} — distances are hidden.</div>}
      </div>
      {error && <div className="card error">Cannot reach the server: {error.message}</div>}
      {lots && sorted.length === 0 && (
        <div className="card">
          <b>No live parking lots yet.</b>
          <div className="muted small">A lot appears here once its operator has mounted a camera phone, checked the spots and published it.</div>
          <Link to="/operator" className="btn ghost">I run a parking lot →</Link>
        </div>
      )}
      {sorted.map((l) => (
        <div key={l.id} className={"card lot-card-map" + (selected === l.id ? " selected" : "")} onClick={() => setSelected(l.id)}>
          <div className="lot-card-top">
            <div>
              <div className="lot-name">{l.name}</div>
              <div className="muted small">{l.address}</div>
              <div className="small">
                {l.km != null && <span>{l.km < 1 ? `${Math.round(l.km * 1000)} m` : `${l.km.toFixed(1)} km`} away (straight line) · </span>}
                {money(l.price_per_hour, l.currency)} / hour
              </div>
            </div>
            <div className={"free-big" + (!l.camera_online ? " off" : l.counts.free === 0 ? " none" : "")}>
              <b>{l.camera_online ? l.counts.free : "?"}</b>
              <span>{l.camera_online ? `free of ${l.total}` : "camera offline"}</span>
            </div>
          </div>
          <div className="live-badge"><i className={l.camera_online ? "pulse" : "pulse off"} />
            {l.camera_online ? `Live · updated ${ago(l.updated_at)}` : `No live data · last frame ${ago(l.updated_at)}`}
          </div>
          <div className="row-btns">
            <button className="btn primary" onClick={(e) => { e.stopPropagation(); nav(`/lot/${l.id}`); }}>Free spots & booking</button>
          </div>
          <NavButtons location={l.location} compact />
        </div>
      ))}
      <div className="muted small center">
        <Link to="/operator">For parking operators</Link>
      </div>
    </div>
  );
}
