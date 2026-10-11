import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";

const pct = (x) => (x == null ? "–" : `${(x * 100).toFixed(1)}%`);

function Row({ name, r }) {
  return (
    <tr>
      <td>{name}</td><td>{r.spots}</td><td>{pct(r.accuracy)}</td><td>{pct(r.free_precision)}</td><td>{pct(r.free_recall)}</td>
    </tr>
  );
}

/** Measured quality on the team's own labelled test set (eval/evaluate.py). Nothing here is typed in by hand. */
export default function Quality() {
  const [m, setM] = useState(null);
  useEffect(() => { api.metrics().then(setM).catch(() => setM({ available: false })); }, []);
  if (!m) return <div className="page"><div className="card">Loading…</div></div>;
  if (!m.available)
    return (
      <div className="page">
        <header className="page-head"><Link to="/operator" className="muted small">← Operators</Link><h1>Measured quality</h1></header>
        <div className="card">No evaluation has been run yet. Build the test set on the <Link to="/label">labelling page</Link>, then run <span className="mono">eval/evaluate.py</span>.</div>
      </div>
    );
  const c = m.clean;
  return (
    <div className="page">
      <header className="page-head">
        <Link to="/operator" className="muted small">← Operators</Link>
        <h1>Measured quality</h1>
        <div className="muted small">Test set: {m.test_set.images} photos, {m.test_set.spots} hand-checked spots · evaluated {m.evaluated_at}</div>
      </header>
      <div className="stats">
        <div><b>{pct(c.occupancy_known_spots.accuracy)}</b><span>spot accuracy</span></div>
        <div><b className="free-c">{pct(c.occupancy_known_spots.free_precision)}</b><span>"free" is really free</span></div>
        <div><b>{pct(c.layout_discovery.recall)}</b><span>spots found with zero setup</span></div>
      </div>
      <div className="card">
        <h3>Occupancy, onboarded camera (known spots)</h3>
        <table className="tbl"><thead><tr><th></th><th>spots</th><th>accuracy</th><th>free prec.</th><th>free recall</th></tr></thead>
          <tbody>
            <Row name="all" r={c.occupancy_known_spots} />
            {Object.entries(c.occupancy_by_condition).map(([k, r]) => <Row key={k} name={k} r={r} />)}
          </tbody>
        </table>
      </div>
      <div className="card">
        <h3>Zero-config (jury photo mode)</h3>
        <div className="kv"><span>Spot discovery recall / precision</span><b>{pct(c.layout_discovery.recall)} / {pct(c.layout_discovery.precision)}</b></div>
        <div className="kv"><span>End-to-end free precision / recall</span><b>{pct(c.end_to_end_zero_config.free_precision)} / {pct(c.end_to_end_zero_config.free_recall)}</b></div>
        <div className="kv"><span>Latency per photo (mean / p95)</span><b>{c.latency_ms.mean} / {c.latency_ms.p95} ms</b></div>
      </div>
      {m.synthetic_degradation && (
        <div className="card">
          <h3>Robustness (synthetic, same photos)</h3>
          <table className="tbl"><thead><tr><th></th><th>spots</th><th>accuracy</th><th>free prec.</th><th>free recall</th></tr></thead>
            <tbody>{Object.entries(m.synthetic_degradation).map(([k, r]) => <Row key={k} name={k} r={r.occupancy_known_spots} />)}</tbody>
          </table>
          <p className="muted small">{m.synthetic_method}</p>
        </div>
      )}
    </div>
  );
}
