import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

/** A decoder for QR codes in a video frame or a photo: the browser's own reader where it has one
 *  (Chrome on Android), otherwise jsQR in JavaScript (iPhone Safari, Firefox, desktop browsers). */
async function makeDecoder() {
  if ("BarcodeDetector" in window) {
    try {
      const formats = await window.BarcodeDetector.getSupportedFormats();
      if (formats.includes("qr_code")) {
        const d = new window.BarcodeDetector({ formats: ["qr_code"] });
        return async (source) => (await d.detect(source))[0]?.rawValue || null;
      }
    } catch { /* use jsQR */ }
  }
  const { default: jsQR } = await import("jsqr");
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  return async (source) => {
    const w0 = source.videoWidth || source.naturalWidth || source.width;
    const h0 = source.videoHeight || source.naturalHeight || source.height;
    if (!w0 || !h0) return null;
    const k = Math.min(1, 900 / Math.max(w0, h0));
    const w = Math.round(w0 * k), h = Math.round(h0 * k);
    canvas.width = w; canvas.height = h;
    ctx.drawImage(source, 0, 0, w, h);
    return jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: "attemptBoth" })?.data || null;
  };
}

/** Our codes: the gate QR (/enter/:lot) and, if someone scans a ticket, the ticket itself. */
function appPath(text) {
  try {
    const u = new URL(text, window.location.origin);
    return /^\/(enter|lot|booking|session)\/[\w-]+$/.test(u.pathname) ? u.pathname : null;
  } catch {
    return null;
  }
}

/** In-app QR scanner: the round button in the middle of the menu. Scanning the code at a lot's
 *  entrance opens the walk-in page; if the camera cannot be opened, a photo of the code works too. */
export default function Scan() {
  const nav = useNavigate();
  const video = useRef(null);
  const decoder = useRef(null);
  const done = useRef(false);
  const [status, setStatus] = useState("starting"); // starting | scanning | nocamera
  const [msg, setMsg] = useState("");

  const open = (text) => {
    const path = appPath(text);
    if (!path) {
      setMsg("This is not a ParkDet code. Scan the QR code at the parking entrance.");
      return false;
    }
    done.current = true;
    navigator.vibrate?.(60);
    nav(path, { replace: true });
    return true;
  };

  useEffect(() => {
    let stream = null, timer = null, stopped = false;
    (async () => {
      decoder.current = await makeDecoder().catch(() => null);
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus("nocamera");
        setMsg("This browser cannot open the camera here.");
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false,
        });
      } catch (e) {
        setStatus("nocamera");
        setMsg(e && e.name === "NotAllowedError" ? "Camera permission was refused." : "The camera could not be opened.");
        return;
      }
      if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
      const v = video.current;
      v.srcObject = stream;
      try { await v.play(); } catch { /* muted inline video plays on its own */ }
      setStatus("scanning");
      const tick = async () => {
        if (stopped || done.current) return;
        if (v.readyState >= 2 && decoder.current) {
          try {
            const text = await decoder.current(v);
            if (text && open(text)) return;
          } catch { /* keep scanning */ }
        }
        timer = setTimeout(tick, 220);
      };
      tick();
    })();
    return () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fromPhoto(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setMsg("");
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      decoder.current = decoder.current || (await makeDecoder());
      const text = await decoder.current(img);
      if (!text) setMsg("No QR code found in that photo. Try again closer, with the whole code in the picture.");
      else open(text);
    } catch {
      setMsg("That photo could not be read. Please try again.");
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  const close = () => (window.history.length > 1 ? nav(-1) : nav("/"));
  return (
    <div className="scan">
      <video ref={video} className="scan-video" playsInline muted autoPlay aria-hidden="true" />
      <div className="scan-top">
        <button className="scan-x" onClick={close} aria-label="Close the scanner">×</button>
        <div className="scan-title">Scan the parking QR code</div>
      </div>
      <div className={"scan-frame" + (status === "scanning" ? " live" : "")} aria-hidden="true"><i /><i /><i /><i /><b /></div>
      <div className="scan-panel">
        <p>{status === "nocamera" ? msg : status === "starting" ? "Opening the camera…" : "Point the camera at the QR code at the parking entrance."}</p>
        {msg && status !== "nocamera" && <p className="scan-msg" role="alert">{msg}</p>}
        <label className="btn scan-photo">
          Take a photo of the code instead
          <input type="file" accept="image/*" capture="environment" onChange={fromPhoto} />
        </label>
        <p className="scan-note">Booked a spot? You don't need to scan: your ticket is in Tickets.</p>
      </div>
    </div>
  );
}
