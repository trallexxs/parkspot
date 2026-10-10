import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api.js";
import { usePoll } from "../usePoll.js";
import QR from "../components/QR.jsx";
import { Arrow } from "../components/Icons.jsx";

/** Big screen at the lot entrance: free count, the nearest free spot with an arrow, QR to enter. */
export default function Display() {
  const { id } = useParams();
  const [lot, setLot] = useState(null);
  const [state] = usePoll(() => api.state(id), 2000, [id]);
  const [dir, setDir] = useState(null);

  useEffect(() => { api.lot(id).then(setLot).catch(() => {}); }, [id]);
  const nearest = (() => {
    if (!lot || !state) return null;
    for (const a of lot.map.aisles) {
      const order = [];
      const n = Math.max(a.left.length, a.right.length);
      for (let i = 0; i < n; i++) { if (a.left[i]) order.push(a.left[i]); if (a.right[i]) order.push(a.right[i]); }
      const f = order.find((s) => state.statuses[s] === "free");
      if (f) return f;
    }
    for (const r of lot.map.rows) { const f = r.spots.find((s) => state.statuses[s] === "free"); if (f) return f; }
    return null;
  })();
  useEffect(() => { if (nearest) api.directions(id, nearest).then(setDir).catch(() => {}); else setDir(null); }, [id, nearest]);

  const free = state?.counts.free ?? "–";
  return (
    <div className="display">
      <div className="display-top">
        <div>
          <div className="display-name">{lot?.name}</div>
          <div className={"display-free" + (free === 0 ? " full" : "")}>{free === 0 ? "FULL" : <>{free} <small>free</small></>}</div>
        </div>
        <div className="display-qr">
          <QR value={`${window.location.origin}/enter/${id}`} size={200} />
          <div>Scan to enter<br />pay before you leave</div>
        </div>
      </div>
      {dir && (
        <div className="display-dir">
          <div className="display-spot">{nearest}</div>
          {dir.distance_m != null ? (
            <>
              <div className="display-steps">
                <span><Arrow dir="straight" size={90} /></span>
                <span className="display-m">{dir.distance_m} m</span>
                <span><Arrow dir={dir.side} size={90} /></span>
              </div>
              <div className="display-text">Straight {dir.distance_m} m, spot on your {dir.side}</div>
            </>
          ) : (
            <div className="display-text">{dir.steps[0].text}</div>
          )}
        </div>
      )}
    </div>
  );
}
