import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api.js";
import { operatorStore } from "../operatorStore.js";
import MapView from "../components/MapView.jsx";
import PinGate from "../components/PinGate.jsx";

const rect = (x1, y1, x2, y2) => [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];
const pts = (poly) => poly.map((p) => p.join(",")).join(" ");

/** The operator's one-time check of a real lot: (1) spots the model proposed — delete wrong ones,
 *  draw missed ones; (2) the driving aisle, entrance end first; (3) name, price, entrance on the map,
 *  publish. Until this is done the lot is not shown to drivers. */
export default function Setup() {
  const { id } = useParams();
  const nav = useNavigate();
  const [pin, setPin] = useState(operatorStore.pin(id));
  const [lot, setLot] = useState(null);
  const [step, setStep] = useState(1);
  const [spots, setSpots] = useState([]);
  const [aisles, setAisles] = useState([]);
  const [info, setInfo] = useState({ name: "", address: "", price_per_hour: 5000, location: null, published: false });
  const [mode, setMode] = useState("delete");
  const [drag, setDrag] = useState(null);
  const [aisleStart, setAisleStart] = useState(null);
  const [imgT, setImgT] = useState(Date.now());
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [gps, setGps] = useState("");
  const svg = useRef(null);

  useEffect(() => {
    api.lot(id).then((l) => {
      setLot(l);
      setSpots(l.spots.map((s) => ({ id: s.id, row: s.row, polygon: s.polygon })));
      setAisles(l.aisles.map((a) => ({ start: a.start, end: a.end, name: a.name })));
      setInfo({ name: l.name, address: l.address || "", price_per_hour: l.price_per_hour ?? 5000,
        location: l.location, published: !!l.published });
    }).catch((e) => setErr(e.message));
  }, [id]);

  if (!lot) return <div className="page"><div className="card">{err || "Loading…"}</div></div>;
  if (lot.kind !== "real") return <div className="page"><div className="card">The sample lot cannot be edited.</div></div>;
  if (!pin) return <div className="page"><PinGate lotId={id} lotName={lot.name} onOk={setPin} /></div>;
  const W = lot.camera.width, H = lot.camera.height;

  function point(e) {
    const p = svg.current.createSVGPoint();
    const src = e.touches ? e.touches[0] : e;
    p.x = src.clientX; p.y = src.clientY;
    const q = p.matrixTransform(svg.current.getScreenCTM().inverse());
    return [Math.round(Math.min(Math.max(q.x, 0), W - 1)), Math.round(Math.min(Math.max(q.y, 0), H - 1))];
  }
  function down(e) {
    if (step === 1 && mode === "add") { e.preventDefault(); const p = point(e); setDrag({ a: p, b: p }); }
    if (step === 2) {
      const p = point(e);
      if (!aisleStart) setAisleStart(p);
      else { setAisles((a) => [...a, { start: aisleStart, end: p, name: `Aisle ${a.length + 1}` }]); setAisleStart(null); }
    }
  }
  function move(e) { if (drag) { e.preventDefault(); setDrag({ ...drag, b: point(e) }); } }
  function up() {
    if (!drag) return;
    const [x1, y1] = drag.a, [x2, y2] = drag.b;
    if (Math.abs(x2 - x1) > 8 && Math.abs(y2 - y1) > 8)
      setSpots((s) => [...s, { polygon: rect(Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)) }]);
    setDrag(null);
  }
  function useGps() {
    setGps("Getting your position…");
    navigator.geolocation?.getCurrentPosition(
      (p) => { setInfo((i) => ({ ...i, location: { lat: p.coords.latitude, lng: p.coords.longitude } })); setGps(`Set from GPS (±${Math.round(p.coords.accuracy)} m). Drag the pin to fine-tune.`); },
      (e) => setGps(e.code === 1 ? "Location permission denied — tap the map instead." : "Location unavailable — tap the map instead."),
      { enableHighAccuracy: true, timeout: 20000 });
  }
  async function save() {
    setBusy(true); setErr("");
    try {
      const l = await api.setup(id, pin, { spots, aisles, info });
      api.exportLot(id, pin).then((c) => operatorStore.saveCfg(id, c)).catch(() => {});
      operatorStore.setPin(id, pin, l.name);
      nav(`/operator/${id}`);
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  return (
    <div className="page">
      <header className="page-head">
        <Link to={`/operator/${id}`} className="muted small">← operator</Link>
        <h1>Check the lot</h1>
        <div className="steps">
          {["1 · Spots", "2 · Aisle", "3 · Map & publish"].map((t, i) => (
            <span key={t} className={step === i + 1 ? "on" : ""} onClick={() => setStep(i + 1)}>{t}</span>
          ))}
        </div>
      </header>

      {step < 3 && (
        <div className="card">
          {step === 1 && <>
            <p className="small">The model proposed <b>{lot.spots.length}</b> spots. Remove anything that is not a real parking spot (exits, lanes, kerbs) and draw any spot it missed.</p>
            <div className="chips">
              <button className={"chip" + (mode === "delete" ? " on" : "")} onClick={() => setMode("delete")}>Tap = delete spot</button>
              <button className={"chip" + (mode === "add" ? " on" : "")} onClick={() => setMode("add")}>Drag = add spot</button>
              <button className="chip" onClick={() => setImgT(Date.now())}>Refresh image</button>
            </div>
          </>}
          {step === 2 && <>
            <p className="small">Tap where cars <b>enter</b> the driving aisle, then where it <b>ends</b>. Add one line per aisle. This gives drivers “straight 20 m, spot on your right”.</p>
            <div className="chips">
              <button className="chip" onClick={() => { setAisles([]); setAisleStart(null); }}>Clear aisles</button>
            </div>
            {/* same height in both states, so the image never moves between the two taps */}
            <div className="tap-hint">{aisleStart ? "Now tap where the aisle ends" : `Tap where cars enter aisle ${aisles.length + 1}`}</div>
          </>}
          <div className="label-wrap">
            <div style={{ position: "relative", width: "100%" }}>
              <img src={`/api/lots/${id}/raw.jpg?pin=${encodeURIComponent(pin)}&t=${imgT}`} alt="pixelated camera view of the lot"
                style={{ width: "100%", display: "block", aspectRatio: `${W} / ${H}`, background: "#2a3446" }} />
              <svg ref={svg} viewBox={`0 0 ${W} ${H}`} className="label-svg"
                onMouseDown={down} onMouseMove={move} onMouseUp={up} onTouchStart={down} onTouchMove={move} onTouchEnd={up}>
                <defs>
                  <marker id="arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                    <path d="M0,0 L10,5 L0,10 z" fill="#1f5fe0" />
                  </marker>
                </defs>
                {spots.map((s, i) => (
                  <polygon key={i} points={pts(s.polygon)} className={"lbl " + (s.id ? "free" : "free human")}
                    onClick={() => step === 1 && mode === "delete" && setSpots((all) => all.filter((_, k) => k !== i))} />
                ))}
                {drag && <polygon points={pts(rect(drag.a[0], drag.a[1], drag.b[0], drag.b[1]))} className="lbl drawing" />}
                {aisles.map((a, i) => (
                  <line key={i} x1={a.start[0]} y1={a.start[1]} x2={a.end[0]} y2={a.end[1]} stroke="#1f5fe0"
                    strokeWidth="6" vectorEffect="non-scaling-stroke" markerEnd="url(#arr)" />
                ))}
                {aisleStart && <circle cx={aisleStart[0]} cy={aisleStart[1]} r={Math.max(W, H) / 120} fill="#1f5fe0" />}
              </svg>
            </div>
          </div>
          <div className="muted small">{spots.length} spots · {aisles.length} aisle(s) · image pixelated for privacy. Spot numbers are re-assigned when you save.</div>
          <button className="btn primary wide" onClick={() => setStep(step + 1)}>Next</button>
        </div>
      )}

      {step === 3 && (
        <div className="card">
          <label className="field">Name<input value={info.name} onChange={(e) => setInfo({ ...info, name: e.target.value })} /></label>
          <label className="field">Address (shown to drivers)<input value={info.address} onChange={(e) => setInfo({ ...info, address: e.target.value })} /></label>
          <label className="field">Price per hour (so'm)<input inputMode="numeric" value={info.price_per_hour}
            onChange={(e) => setInfo({ ...info, price_per_hour: e.target.value.replace(/\D/g, "") })} /></label>
          <div className="field">Entrance on the map — drivers' navigation goes here
            <button className="btn ghost" onClick={useGps}>Use my GPS (stand at the entrance)</button>
            {gps && <span className="small">{gps}</span>}
            <MapView pin={info.location} onPinMove={(loc) => setInfo((i) => ({ ...i, location: loc }))} height={260} />
            <span className="small">{info.location ? `${info.location.lat.toFixed(6)}, ${info.location.lng.toFixed(6)}` : "Tap the map or use GPS to place the entrance."}</span>
          </div>
          <label className="inline small"><input type="checkbox" style={{ width: "auto" }} checked={info.published}
            onChange={(e) => setInfo({ ...info, published: e.target.checked })} /> Publish on the drivers' map</label>
          {err && <div className="error small">{err}</div>}
          <button className="btn primary wide" disabled={busy} onClick={save}>Save{info.published ? " and publish" : ""}</button>
        </div>
      )}
    </div>
  );
}
