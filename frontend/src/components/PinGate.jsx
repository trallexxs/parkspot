import { useState } from "react";
import { api } from "../api.js";
import { operatorStore } from "../operatorStore.js";

/** Asks for the lot's operator PIN once per device, checks it with the server, remembers it. */
export default function PinGate({ lotId, lotName, onOk }) {
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true); setErr("");
    try {
      await api.auth(lotId, pin.trim());
      operatorStore.setPin(lotId, pin.trim(), lotName);
      onOk(pin.trim());
    } catch (e) { setErr(e.status === 403 ? "Wrong PIN" : e.message); }
    setBusy(false);
  }
  return (
    <div className="card">
      <h3>Operator PIN for {lotName || lotId}</h3>
      <p className="muted small">The 6-digit PIN was shown when the lot was created on the camera phone.</p>
      <div className="inline">
        <input inputMode="numeric" autoComplete="one-time-code" placeholder="PIN" value={pin}
          onChange={(e) => setPin(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go()} />
        <button className="btn primary" disabled={busy || pin.trim().length < 4} onClick={go}>Open</button>
      </div>
      {err && <div className="error small">{err}</div>}
    </div>
  );
}
