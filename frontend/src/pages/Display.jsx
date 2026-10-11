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
  // the same spot a walk-in driver scanning the QR would be given (server rule), refreshed with the state
  const [near] = usePoll(() => api.nearest(id), 2000, [id]);
  const nearest = near?.spot_id || null;
  useEffect(() => { setDir(near?.directions || null); }, [near]);

  const online = state ? state.camera.online : true;
  const free = !online ? "–" : state?.counts.free ?? "–";
  return (
    <div className="display">
      <div className="display-top">
        <div>
          <div className="display-name">{lot?.name}</div>
          <div className={"display-free" + (free === 0 ? " full" : "")}>{!online ? <small>No live data</small> : free === 0 ? "FULL" : <>{free} <small>free</small></>}</div>
        </div>
        <div className="display-qr">
          <QR value={`${window.location.origin}/enter/${id}`} size={200} />
          <div>Scan to enter<br />pay before you leave</div>
        </div>
      </div>
      {dir && online && (
        <div className="display-dir">
          <div className="display-spot">{nearest}</div>
          {dir.distance_m != null ? (
            <>
              <div className="display-steps">
                <span><Arrow dir="straight" size={90} /></span>
                <span className="display-m">≈ {dir.distance_m} m</span>
                <span><Arrow dir={dir.side} size={90} /></span>
              </div>
              <div className="display-text">Straight about {dir.distance_m} m, spot on your {dir.side}</div>
              <div className="display-note">Distance is an estimate from the camera picture</div>
            </>
          ) : (
            <div className="display-text">{dir.steps[0].text}</div>
          )}
        </div>
      )}
    </div>
  );
}
