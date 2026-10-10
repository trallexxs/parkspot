import { Link } from "react-router-dom";
import { api, money } from "../api.js";
import { usePoll } from "../usePoll.js";

export default function Home() {
  const [lots, error] = usePoll(api.lots, 3000);
  return (
    <div className="page">
      <header className="page-head">
        <div className="brand"><span className="brand-p">P</span> ParkSpot</div>
        <p className="muted">Free spots seen by the lot's own cameras. Book ahead or just drive in.</p>
      </header>
      {error && <div className="card error">Cannot reach the server: {error.message}</div>}
      {!lots && !error && <div className="card">Loading…</div>}
      {lots?.map((l) => (
        <Link key={l.id} to={`/lot/${l.id}`} className="card lot-card">
          <div>
            <div className="lot-name">{l.name}</div>
            <div className="muted small">{l.address}</div>
            <div className="small">{money(l.price_per_hour, l.currency)} / hour</div>
          </div>
          <div className={"free-big" + (l.counts.free === 0 ? " none" : "")}>
            <b>{l.counts.free}</b>
            <span>free of {l.total}</span>
          </div>
        </Link>
      ))}
      <Link to="/camera" className="card cta">
        <b>Set up a real lot with your phone camera →</b>
        <div className="muted small">Mount a phone facing the lot: spots are found automatically and the map goes live.</div>
      </Link>
      <Link to="/vision" className="card cta">
        <b>Add a parking lot from one photo →</b>
        <div className="muted small">Our model finds the rows and spots by itself — no manual setup.</div>
      </Link>
    </div>
  );
}
