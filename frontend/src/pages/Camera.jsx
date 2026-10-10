import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api.js";

const INTERVAL_MS = 3000;

function grab(video) {
  const scale = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight));
  const c = document.createElement("canvas");
  c.width = Math.round(video.videoWidth * scale);
  c.height = Math.round(video.videoHeight * scale);
  c.getContext("2d").drawImage(video, 0, 0, c.width, c.height);
  return new Promise((res) => c.toBlob((b) => res(new File([b], "frame.jpg", { type: "image/jpeg" })), "image/jpeg", 0.85));
}

/** Turns any phone into the lot's camera.
 *  /camera      -> point at a lot, create a new lot from the first frame (auto spot discovery)
 *  /camera/:id  -> stream one frame every 3 s to that lot */
export default function Camera() {
  const { id } = useParams();
  const nav = useNavigate();
  const video = useRef(null);
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState("");
  const [name, setName] = useState("My lot");
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [last, setLast] = useState(null);
  const [sent, setSent] = useState(0);

  useEffect(() => {
    let stream;
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1920 } }, audio: false })
      .then((s) => { stream = s; video.current.srcObject = s; return video.current.play(); })
      .then(() => setReady(true))
      .catch((e) => setErr("Camera not available: " + e.message + " (the site must be opened over https)"));
    return () => stream && stream.getTracks().forEach((t) => t.stop());
  }, []);

  useEffect(() => {
    if (!running || !id) return;
    let alive = true;
    let lock = null;
    navigator.wakeLock?.request("screen").then((l) => { lock = l; }).catch(() => {});
    const loop = async () => {
      while (alive) {
        const t0 = Date.now();
        try {
          const r = await api.pushFrame(id, await grab(video.current), true);
          if (alive) { setLast(r); setSent((n) => n + 1); setErr(""); }
        } catch (e) { if (alive) setErr(e.message); }
        await new Promise((res) => setTimeout(res, Math.max(0, INTERVAL_MS - (Date.now() - t0))));
      }
    };
    loop();
    return () => { alive = false; lock?.release?.(); };
  }, [running, id]);

  async function createLot() {
    setBusy(true); setErr("");
    try {
      const r = await api.createLot(await grab(video.current), name);
      nav(`/camera/${r.id}`, { replace: true });
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  return (
    <div className="page">
      <header className="page-head">
        <h1>{id ? "Live lot camera" : "Set up a lot with this phone"}</h1>
        <p className="muted small">
          {id
            ? "Keep this phone fixed, facing the lot. It sends one frame every 3 seconds; the lot map updates for every driver."
            : "Mount the phone high, facing the parked cars (3+ cars per row). The model finds the rows and spots by itself."}
        </p>
      </header>
      <div className="card">
        <video ref={video} playsInline muted className="cam-video" />
        {err && <div className="error small">{err}</div>}
        {!id && (
          <div className="inline">
            <input value={name} onChange={(e) => setName(e.target.value)} />
            <button className="btn primary" disabled={!ready || busy} onClick={createLot}>{busy ? "Finding spots…" : "Create lot"}</button>
          </div>
        )}
        {id && (
          <>
            <button className={"btn wide " + (running ? "" : "primary")} disabled={!ready} onClick={() => setRunning((v) => !v)}>
              {running ? "Stop streaming" : "Start streaming"}
            </button>
            {last && (
              <div className="small muted">
                Frames sent: {sent} · free {last.summary.free} / {last.summary.spots} · {Math.round(last.timing.total_ms)} ms on server
              </div>
            )}
            <div className="row-btns">
              <Link className="btn ghost" to={`/lot/${id}`}>Driver map</Link>
              <Link className="btn ghost" to={`/operator/${id}`}>Operator view</Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
