import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api.js";
import { operatorStore } from "../operatorStore.js";
import PinGate from "../components/PinGate.jsx";

function grab(video) {
  const scale = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight));
  const c = document.createElement("canvas");
  c.width = Math.round(video.videoWidth * scale);
  c.height = Math.round(video.videoHeight * scale);
  c.getContext("2d").drawImage(video, 0, 0, c.width, c.height);
  return new Promise((res) => c.toBlob((b) => res(new File([b], "frame.jpg", { type: "image/jpeg" })), "image/jpeg", 0.8));
}

/** Turns a phone into the lot's camera.
 *  /camera      -> point it at the lot and create the lot (spots found automatically; PIN shown once)
 *  /camera/:id  -> send one frame every few seconds. If the free server restarted and forgot the
 *                  lot, the phone restores it from its own copy and carries on. */
export default function Camera() {
  const { id } = useParams();
  const nav = useNavigate();
  const video = useRef(null);
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [last, setLast] = useState(null);
  const [sent, setSent] = useState(0);
  const [pin, setPin] = useState(id ? operatorStore.pin(id) : "");
  const [newPin, setNewPin] = useState("");
  const [every, setEvery] = useState(5);
  const gated = !!id && !pin; // PIN form shown instead of the video until the PIN is entered

  useEffect(() => {
    if (gated) return undefined; // start the camera once the <video> is on the page
    let stream;
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1920 } }, audio: false })
      .then((s) => { stream = s; video.current.srcObject = s; return video.current.play(); })
      .then(() => setReady(true))
      .catch((e) => setErr("Camera not available: " + e.message + " (the site must be opened over https)"));
    return () => stream && stream.getTracks().forEach((t) => t.stop());
  }, [gated]);

  useEffect(() => { // keep this phone's copy of the lot fresh
    if (!id || !pin) return undefined;
    const save = () => api.exportLot(id, pin).then((c) => operatorStore.saveCfg(id, c)).catch(() => {});
    save();
    const t = setInterval(save, 60000);
    return () => clearInterval(t);
  }, [id, pin]);

  useEffect(() => {
    if (!running || !id || !pin) return undefined;
    let alive = true;
    let lock = null;
    navigator.wakeLock?.request("screen").then((l) => { lock = l; }).catch(() => {});
    const loop = async () => {
      while (alive) {
        const t0 = Date.now();
        try {
          const r = await api.pushFrame(id, await grab(video.current), pin, true);
          if (alive) { setLast(r); setSent((n) => n + 1); setErr(""); }
        } catch (e) {
          if (!alive) break;
          if (e.status === 404 && operatorStore.cfg(id)) { // server restarted: put the lot back
            try { await api.importLot(operatorStore.cfg(id), pin); setErr("Server had restarted — lot restored, continuing."); }
            catch (e2) { setErr("Restore failed: " + e2.message); }
          } else setErr(e.status === 403 ? "Wrong PIN for this lot" : e.message);
        }
        await new Promise((res) => setTimeout(res, Math.max(0, every * 1000 - (Date.now() - t0))));
      }
    };
    loop();
    return () => { alive = false; lock?.release?.(); };
  }, [running, id, pin, every]);

  async function createLot() {
    setBusy(true); setErr("");
    try {
      const r = await api.createLot(await grab(video.current), name || "My lot");
      operatorStore.setPin(r.id, r.pin, name || "My lot");
      setNewPin(r.pin);
      nav(`/camera/${r.id}`, { replace: true });
      setPin(r.pin);
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  if (gated) return <div className="page"><PinGate lotId={id} onOk={setPin} /></div>;
  return (
    <div className="page">
      <header className="page-head">
        <h1>{id ? "Lot camera" : "Set up a lot with this phone"}</h1>
        <p className="muted small">
          {id
            ? "Leave this phone fixed above the lot, charging, with this page open. It sends one picture every few seconds; the drivers' map updates from it."
            : "Mount the phone high (window or pole), pointing at the parked cars — at least 3 cars per row. Keep it in the same orientation afterwards."}
        </p>
      </header>
      {newPin && (
        <div className="card">
          <b>Your operator PIN — write it down:</b>
          <div className="pin-big">{newPin}</div>
          <div className="muted small">You need it to check the spots, publish the lot and open the camera view on another device.</div>
          <Link className="btn primary" to={`/operator/${id}/setup`}>Next: check the spots and place the lot on the map</Link>
        </div>
      )}
      <div className="card">
        <video ref={video} playsInline muted className="cam-video" />
        {err && <div className="error small">{err}</div>}
        {!id && (
          <div className="inline">
            <input placeholder="Lot name, e.g. WIUT main parking" value={name} onChange={(e) => setName(e.target.value)} />
            <button className="btn primary" disabled={!ready || busy} onClick={createLot}>{busy ? "Finding spots…" : "Create lot"}</button>
          </div>
        )}
        {id && (
          <>
            <div className="chips">
              {[3, 5, 10].map((s) => (
                <button key={s} className={"chip" + (every === s ? " on" : "")} onClick={() => setEvery(s)}>every {s} s</button>
              ))}
            </div>
            <button className={"btn wide " + (running ? "" : "primary")} disabled={!ready} onClick={() => setRunning((v) => !v)}>
              {running ? "Stop camera" : "Start camera"}
            </button>
            {last && (
              <div className="small muted">
                Pictures sent: {sent} · free {last.summary.free} / {last.summary.spots} · {Math.round(last.timing.total_ms)} ms on the server
              </div>
            )}
            <div className="row-btns">
              <Link className="btn ghost" to={`/operator/${id}`}>Operator view</Link>
              <Link className="btn ghost" to={`/operator/${id}/setup`}>Check spots</Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
