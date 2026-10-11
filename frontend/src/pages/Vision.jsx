import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { loadAndResize } from "../imageUtil.js";

/** CV console: any photo of a parking lot -> vehicles, discovered spots, occupancy, timing.
 *  This is where the jury's own image goes. */
export default function Vision() {
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function run(f) {
    setRes(null); setErr(""); setBusy(true);
    try {
      const small = (await loadAndResize(f)).file;
      setRes(await api.analyze(small));
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  return (
    <div className="page">
      <header className="page-head">
        <h1>Vision</h1>
        <p className="muted">Take or upload a photo of any parking lot. The model finds the cars, works out where the spots are (including empty ones) and which are free.</p>
      </header>
      <div className="card">
        <label className={"btn primary lg wide file-btn" + (busy ? " disabled" : "")} aria-busy={busy}>
          {busy ? "Analysing…" : "Take / upload a photo"}
          <input type="file" accept="image/*" capture="environment" disabled={busy} onChange={(e) => e.target.files[0] && run(e.target.files[0])} />
        </label>
        {err && <div className="error small">{err}</div>}
      </div>

      {res && (
        <>
          <div className="card">
            <img className="result-img" src={res.annotated} alt="analysis result" />
            <div className="stats">
              <div><b className="free-c">{res.summary.free}</b><span>free spots</span></div>
              <div><b>{res.summary.occupied}</b><span>occupied</span></div>
              <div><b>{res.summary.vehicles}</b><span>vehicles</span></div>
            </div>
            <div className="kv"><span>Rows found</span><b>{res.layout.rows}</b></div>
            <div className="kv"><span>Empty spots inferred from gaps</span><b>{res.layout.inferred_empty}</b></div>
            <div className="kv"><span>Vehicles not in a row (driving / aisle)</span><b>{res.layout.unassigned_vehicles}</b></div>
            <div className="kv"><span>Lighting</span><b>{res.quality.lighting}{res.enhanced ? " (enhanced)" : ""}</b></div>
            <div className="kv"><span>Processing time (CPU)</span><b>{Math.round(res.timing.total_ms)} ms</b></div>
            <div className="kv"><span>Detector</span><b>{Math.round(res.detector.ms)} ms{res.detector.tiled ? ", tiled" : ""}</b></div>
            {res.quality.warnings.map((w) => <div key={w} className="notice small">{w}</div>)}
          </div>
          <div className="card">
            <h3>Make this a live lot</h3>
            <div className="muted small">A live lot needs a camera that stays there: set it up from the phone you will mount at the lot.</div>
            <Link className="btn primary" to="/operator">Set up a live lot →</Link>
          </div>
        </>
      )}

      <div className="muted small center">
        <Link to="/operator">For parking operators</Link>
      </div>
    </div>
  );
}
