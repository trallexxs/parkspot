import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { labelStore } from "../labelStore.js";

const MAX_SIDE = 1600;

function loadAndResize(file) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * s);
      c.height = Math.round(img.height * s);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      const dataUrl = c.toDataURL("image/jpeg", 0.9);
      c.toBlob((b) => res({ dataUrl, blob: b, width: c.width, height: c.height }), "image/jpeg", 0.9);
    };
    img.onerror = rej;
    img.src = URL.createObjectURL(file);
  });
}

const rect = (x1, y1, x2, y2) => [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];

/** Model-assisted labelling of the test set: the model proposes spots, a person checks every one
 *  (tap = occupied/free, delete wrong spots, draw missed ones). Stats of the corrections are kept. */
export default function Label() {
  const [photo, setPhoto] = useState(null);
  const [spots, setSpots] = useState([]);
  const [proposed, setProposed] = useState(0);
  const [stats, setStats] = useState({ toggled: 0, deleted: 0, added: 0 });
  const [mode, setMode] = useState("toggle");
  const [cond, setCond] = useState({ lighting: "day", weather: "clear", view: "high-oblique", place: "" });
  const [zoom, setZoom] = useState(1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState([]);
  const [drag, setDrag] = useState(null);
  const svg = useRef(null);

  const refresh = () => labelStore.all().then(setSaved).catch((e) => setErr("Browser storage unavailable: " + e.message));
  useEffect(() => { refresh(); }, []);

  async function pick(file) {
    setErr(""); setBusy(true); setSpots([]);
    try {
      const p = await loadAndResize(file);
      setPhoto({ ...p, name: file.name });
      const r = await api.analyze(new File([p.blob], file.name, { type: "image/jpeg" }));
      const s = r.spots.map((x) => ({ polygon: x.polygon, occupied: x.occupied, origin: "model" }));
      setSpots(s); setProposed(s.length); setStats({ toggled: 0, deleted: 0, added: 0 });
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  function point(e) {
    const pt = svg.current.createSVGPoint();
    const src = e.touches ? e.touches[0] : e;
    pt.x = src.clientX; pt.y = src.clientY;
    const p = pt.matrixTransform(svg.current.getScreenCTM().inverse());
    return [Math.round(p.x), Math.round(p.y)];
  }

  function clickSpot(i) {
    if (mode === "toggle") {
      setSpots((s) => s.map((x, k) => (k === i ? { ...x, occupied: !x.occupied } : x)));
      setStats((s) => ({ ...s, toggled: s.toggled + 1 }));
    } else if (mode === "delete") {
      setSpots((s) => s.filter((_, k) => k !== i));
      setStats((s) => ({ ...s, deleted: s.deleted + 1 }));
    }
  }

  function down(e) { if (mode === "add") { e.preventDefault(); const p = point(e); setDrag({ a: p, b: p }); } }
  function move(e) { if (drag) { e.preventDefault(); setDrag({ ...drag, b: point(e) }); } }
  function up() {
    if (!drag) return;
    const [x1, y1] = drag.a, [x2, y2] = drag.b;
    if (Math.abs(x2 - x1) > 6 && Math.abs(y2 - y1) > 6) {
      setSpots((s) => [...s, { polygon: rect(Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)), occupied: false, origin: "human" }]);
      setStats((s) => ({ ...s, added: s.added + 1 }));
    }
    setDrag(null);
  }

  async function save() {
    const item = {
      id: `${Date.now()}`, name: photo.name, image: photo.dataUrl, width: photo.width, height: photo.height,
      condition: cond, spots, labelled_at: new Date().toISOString(),
      assistance: { model_proposed: proposed, ...stats },
    };
    try { await labelStore.put(item); setPhoto(null); setSpots([]); refresh(); } catch (e) { setErr(e.message); }
  }

  function exportAll() {
    const bundle = { version: 1, exported_at: new Date().toISOString(), items: saved };
    const blob = new Blob([JSON.stringify(bundle)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `parkspot-testset-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.json`;
    a.click();
  }

  const occ = spots.filter((s) => s.occupied).length;
  return (
    <div className="page">
      <header className="page-head">
        <Link to="/vision" className="muted small">← Vision</Link>
        <h1>Build the test set</h1>
        <p className="muted small">
          Photograph a real lot, let the model propose spots, then check <b>every</b> spot yourself.
          Labels stay in this browser until you export them.
        </p>
      </header>

      <div className="card">
        <label className="btn primary wide file-btn">
          {busy ? "Model is proposing spots…" : photo ? "Use another photo" : "Take / upload a photo"}
          <input type="file" accept="image/*" capture="environment" onChange={(e) => e.target.files[0] && pick(e.target.files[0])} />
        </label>
        {err && <div className="error small">{err}</div>}
      </div>

      {photo && (
        <div className="card">
          <div className="chips">
            {[["toggle", "Tap = occupied / free"], ["delete", "Delete wrong spot"], ["add", "Draw missed spot"]].map(([m, t]) => (
              <button key={m} className={"chip" + (mode === m ? " on" : "")} onClick={() => setMode(m)}>{t}</button>
            ))}
            <button className="chip" onClick={() => setZoom((z) => (z >= 3 ? 1 : z + 1))}>Zoom {zoom}×</button>
          </div>
          <div className="label-wrap">
            <div style={{ width: `${zoom * 100}%`, position: "relative" }}>
              <img src={photo.dataUrl} alt="to label" style={{ width: "100%", display: "block" }} />
              <svg ref={svg} viewBox={`0 0 ${photo.width} ${photo.height}`} className="label-svg"
                onMouseDown={down} onMouseMove={move} onMouseUp={up} onTouchStart={down} onTouchMove={move} onTouchEnd={up}>
                {spots.map((s, i) => (
                  <polygon key={i} points={s.polygon.map((p) => p.join(",")).join(" ")}
                    className={"lbl " + (s.occupied ? "occ" : "free") + (s.origin === "human" ? " human" : "")}
                    onClick={() => clickSpot(i)} />
                ))}
                {drag && <polygon points={rect(drag.a[0], drag.a[1], drag.b[0], drag.b[1]).map((p) => p.join(",")).join(" ")} className="lbl drawing" />}
              </svg>
            </div>
          </div>
          <div className="small muted">
            {spots.length} spots · {occ} occupied · {spots.length - occ} free · corrections: {stats.toggled} toggled, {stats.deleted} deleted, {stats.added} added
          </div>
          <div className="cond-grid">
            {[["lighting", ["day", "dusk", "night"]], ["weather", ["clear", "rain", "snow", "fog"]], ["view", ["top-down", "high-oblique", "low-oblique"]]].map(([k, opts]) => (
              <label key={k} className="field">{k}
                <select value={cond[k]} onChange={(e) => setCond({ ...cond, [k]: e.target.value })}>
                  {opts.map((o) => <option key={o}>{o}</option>)}
                </select>
              </label>
            ))}
            <label className="field">place
              <input placeholder="e.g. Mega Planet parking, Tashkent" value={cond.place} onChange={(e) => setCond({ ...cond, place: e.target.value })} />
            </label>
          </div>
          <button className="btn primary wide" disabled={!spots.length} onClick={save}>I checked every spot — save</button>
        </div>
      )}

      <div className="card">
        <h3>Labelled in this browser: {saved.length} photos, {saved.reduce((n, s) => n + s.spots.length, 0)} spots</h3>
        {saved.map((s) => (
          <div key={s.id} className="kv">
            <span>{s.name} · {s.condition.lighting}/{s.condition.weather}/{s.condition.view}</span>
            <b>{s.spots.length} spots <button className="chip" onClick={() => labelStore.remove(s.id).then(refresh)}>×</button></b>
          </div>
        ))}
        <button className="btn primary wide" disabled={!saved.length} onClick={exportAll}>Export test set (.json)</button>
        <p className="muted small">Then upload the file to the GitHub repo folder <span className="mono">eval/testset/</span> (Add file → Upload files).</p>
      </div>
    </div>
  );
}
