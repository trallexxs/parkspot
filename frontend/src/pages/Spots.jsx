import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, distanceKm } from "../api.js";
import { usePoll } from "../usePoll.js";
import { useLocation } from "../useLocation.js";
import Lot from "./Lot.jsx";

const KEY = "parkdet.spots.lot";

/** "Spots" section of the menu: the live spot map of the nearest lot (or the one the driver picked),
 *  laid out like a seat map. Tap a green spot to book it. */
export default function Spots() {
  const [lots, error] = usePoll(() => api.lots(), 10000);
  const [me] = useLocation(true);
  const [pick, setPick] = useState(() => { try { return localStorage.getItem(KEY) || ""; } catch { return ""; } });

  const sorted = useMemo(() => (lots || []).map((l) => ({ ...l, km: distanceKm(me, l.location) }))
    .sort((a, b) => (a.km ?? 1e9) - (b.km ?? 1e9)), [lots, me]);
  const current = sorted.find((l) => l.id === pick) || sorted[0];
  const choose = (id) => {
    setPick(id);
    try { localStorage.setItem(KEY, id); } catch { /* storage unavailable */ }
  };

  if (!lots) return <div className="page"><div className="card">{error ? `Cannot reach the server: ${error.message}` : "Loading…"}</div></div>;
  if (!current) {
    return (
      <div className="page">
        <header className="page-head"><h1>Spots</h1></header>
        <div className="card empty">
          <b>No live parking lots yet</b>
          <div className="muted small">The spot map appears here once a lot's operator has mounted a camera phone and published the lot. At a lot, scan the QR code at the entrance.</div>
          <Link to="/scan" className="btn primary">Scan the parking QR code</Link>
        </div>
      </div>
    );
  }
  return (
    <>
      {sorted.length > 1 && (
        <div className="lot-switch" aria-label="Parking lots">
          {sorted.map((l) => (
            <button key={l.id} className={"chip" + (l.id === current.id ? " on" : "")} onClick={() => choose(l.id)}>{l.name}</button>
          ))}
        </div>
      )}
      <Lot key={current.id} id={current.id} />
    </>
  );
}
