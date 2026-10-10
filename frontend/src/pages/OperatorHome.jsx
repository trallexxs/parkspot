import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { operatorStore } from "../operatorStore.js";

/** Entry point for parking operators: set up a new lot, or open one this device manages. */
export default function OperatorHome() {
  const nav = useNavigate();
  const [code, setCode] = useState("");
  const managed = operatorStore.managed();
  return (
    <div className="page">
      <header className="page-head">
        <h1>For parking operators</h1>
        <p className="muted small">A lot goes live in four steps: mount a phone above the lot, let the model find the spots,
          check them once, place the entrance on the map and publish.</p>
      </header>
      <Link to="/camera" className="card cta">
        <b>Set up a new lot with this phone →</b>
        <div className="muted small">Use the phone that will stay at the lot as its camera (on a window or pole, charging).</div>
      </Link>
      {managed.length > 0 && (
        <div className="card">
          <h3>Lots on this device</h3>
          {managed.map((m) => (
            <Link key={m.id} to={`/operator/${m.id}`} className="kv"><span>{m.name}</span><b>Open →</b></Link>
          ))}
        </div>
      )}
      <div className="card">
        <h3>Open a lot on another device</h3>
        <div className="inline">
          <input placeholder="Lot code, e.g. lot_1a2b3c4d" value={code} onChange={(e) => setCode(e.target.value.trim())} />
          <button className="btn" disabled={!code} onClick={() => nav(`/operator/${code}`)}>Open</button>
        </div>
      </div>
    </div>
  );
}
