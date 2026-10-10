import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api.js";

/** CV console: any photo of a parking lot -> vehicles, discovered spots, occupancy, timing.
 *  This is where the jury's own image goes. */
export default function Vision() {
  const nav = useNavigate();
  const [file, setFile] = useState(null);
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [name, setName] = useState("My lot");
  const [metrics, setMetrics] = useState(null);

  useEffect(() => { api.metrics().then(setMetrics).catch(() => {}); }, []);

  async function run(f) {
    setFile(f); setRes(null); setErr(""); setBusy(true);
    try { setRes(await api.analyze(f)); } catch (e) { setErr(e.message); }
    setBusy(false);
  }
  async function makeLot() {
    setBusy(true);
    try { const r = await api.createLot(file, name); nav(`/lot/${r.id}`); } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  return (
    <div className="page">
      <header className="page-head">
        <h1>Vision</h1>
        <p className="muted">Take or upload a photo of any parking lot. The model finds the cars, works out where the spots are (including empty ones) and which are free.</p>
      </header>
      <div className="card">
        <label className="btn primary wide file-btn">
          {busy ? "Analysing…" : "Take / upload a photo"}
          <input type="file" accept="image/*" capture="environment" onChange={(e) => e.target.files[0] && run(e.target.files[0])} />
        </label>
        <button className="btn ghost wide" disabled={busy} onClick={async () => {
          const blob = await (await fetch("/api/lots/demo/frame.jpg")).blob();
          run(new File([blob], "demo.jpg", { type: "image/jpeg" }));
        }}>Try with the demo camera frame</button>
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
          {res.spots.length >= 3 && (
            <div className="card">
              <h3>Turn this photo into a bookable lot</h3>
              <div className="inline">
                <input value={name} onChange={(e) => setName(e.target.value)} />
                <button className="btn primary" disabled={busy} onClick={makeLot}>Create lot</button>
              </div>
            </div>
          )}
        </>
      )}

      <div className="card">
        <div className="row-btns">
          <Link className="btn ghost" to="/quality">Measured quality{metrics?.available ? ` (${metrics.summary.images} photos)` : ""}</Link>
          <Link className="btn ghost" to="/label">Build the test set</Link>
          <Link className="btn ghost" to="/camera">Phone as lot camera</Link>
        </div>
      </div>
    </div>
  );
}
