import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ago, api, distanceKm, money } from "../api.js";
import { usePoll } from "../usePoll.js";
import { useLocation } from "../useLocation.js";
import MapView from "../components/MapView.jsx";
import NavButtons from "../components/NavButtons.jsx";
import Logo from "../components/Logo.jsx";
import AnimatedNumber from "../components/AnimatedNumber.jsx";

const fmtKm = (km) => (km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`);

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
      <header className="page-head hero">
        <Logo />
        <p className="muted small">Free spots counted by each lot's own camera, live. Nothing on this map is simulated.</p>
      </header>
      <div className="home-grid">
      <div className="card map-card-home home-map">
        <MapView lots={sorted} user={me} onLotClick={(l) => setSelected(l.id)} height={320} />
        {locError && <div className="muted small" style={{ padding: "0 6px 4px" }}>{locError} — distances are hidden.</div>}
      </div>
      <div className="home-list">
      {error && <div className="card error">Cannot reach the server: {error.message}</div>}
      {lots && sorted.length === 0 && (
        <div className="card empty">
          <svg viewBox="0 0 120 80" aria-hidden="true">
            <rect x="4" y="6" width="112" height="68" rx="12" fill="var(--surface-2)" />
            {[0, 1, 2, 3].map((i) => <rect key={i} x={14 + i * 25} y="14" width="20" height="26" rx="4" fill="none" stroke="var(--line)" strokeWidth="2" />)}
            <line x1="12" y1="52" x2="108" y2="52" stroke="var(--line)" strokeWidth="2" strokeDasharray="6 5" />
            <circle cx="96" cy="60" r="10" fill="var(--brand)" />
            <text x="96" y="64.5" textAnchor="middle" fontSize="12" fontWeight="800" fill="#fff">P</text>
          </svg>
          <b>No live parking lots yet</b>
          <div className="muted small">A lot appears here once its operator has mounted a camera phone, checked the spots and published it.</div>
          <Link to="/operator" className="btn ghost">I run a parking lot →</Link>
        </div>
      )}
      {sorted.map((l) => (
        <div key={l.id} className={"card lot-card-map" + (selected === l.id ? " selected" : "")} onClick={() => setSelected(l.id)}>
          <div className="lot-card-top">
            <div>
              <div className="lot-name">{l.name}</div>
              {l.address && <div className="muted small">{l.address}</div>}
              <div className="lot-meta">
                {l.km != null && <span className="meta-chip">{fmtKm(l.km)} away (straight line)</span>}
                <span className="meta-chip">{money(l.price_per_hour, l.currency)} first hour · +{money(l.price_extra_hour, l.currency)} each extra hour</span>
              </div>
            </div>
            <div className={"free-big" + (!l.camera_online ? " off" : l.counts.free === 0 ? " none" : "")}>
              <b>{l.camera_online ? <AnimatedNumber value={l.counts.free} /> : "?"}</b>
              <span>{l.camera_online ? `free of ${l.total}` : "camera offline"}</span>
            </div>
          </div>
          <div className="live-badge"><i className={l.camera_online ? "pulse" : "pulse off"} />
            {l.camera_online ? `Live · updated ${ago(l.updated_at)}` : `No live data · last frame ${ago(l.updated_at)}`}
          </div>
          <button className="btn primary wide" onClick={(e) => { e.stopPropagation(); nav(`/lot/${l.id}`); }}>Free spots & booking</button>
          <div onClick={(e) => e.stopPropagation()}><NavButtons location={l.location} compact /></div>
        </div>
      ))}
      <div className="muted small center">
        <Link to="/operator">For parking operators</Link>
      </div>
      </div>
      </div>
    </div>
  );
}
