import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, money } from "../api.js";
import { addTicket } from "../storage.js";
import Directions from "../components/Directions.jsx";

/** Walk-in flow: the driver scans the QR code at the gate -> /enter/:lotId -> a session starts. */
export default function Enter() {
  const { id, sid } = useParams();
  const nav = useNavigate();
  const [s, setS] = useState(null);
  const [lotName, setLotName] = useState("");
  const [card, setCard] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (id) api.lot(id).then((l) => setLotName(l.name)).catch(() => {}); }, [id]);
  useEffect(() => {
    if (!sid) return;
    const load = () => api.session(sid).then(setS).catch((e) => setMsg(e.message));
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [sid]);

  const act = async (fn) => {
    setBusy(true); setMsg("");
    try { setS(await fn()); } catch (e) { setMsg(e.status === 402 ? `Please pay ${money(e.detail.amount_due)} before leaving.` : e.message); }
    setBusy(false);
  };

  async function start() {
    setBusy(true);
    try {
      const r = await api.startSession(id);
      addTicket({ id: r.id, kind: "session", lot: r.lot_name });
      nav(`/session/${r.id}`, { replace: true });
    } catch (e) { setMsg(e.message); }
    setBusy(false);
  }

  if (!sid) {
    return (
      <div className="page">
        <header className="page-head"><h1>Welcome to {lotName || "the lot"}</h1></header>
        <div className="card">
          <p>No booking needed. Enter now and pay any time before you leave — in the app, or automatically with a saved card.</p>
          <button className="btn primary wide" disabled={busy} onClick={start}>Enter the lot</button>
          {msg && <div className="error small">{msg}</div>}
        </div>
      </div>
    );
  }
  if (!s) return <div className="page"><div className="card">{msg || "Loading…"}</div></div>;
  const active = s.status === "active";
  return (
    <div className="page">
      <header className="page-head">
        <div className="muted small">{s.lot_name}</div>
        <h1>{active ? "You're in" : "Have a good trip!"}</h1>
      </header>
      {active && (
        <div className="card">
          {s.spot_id ? (
            <>
              <div className="muted small">Suggested free spot (held for you for 5 min)</div>
              <div className="sheet-spot">{s.spot_id}</div>
              <Directions d={s.directions} big />
            </>
          ) : (
            <div className="notice">No confirmed free spot right now (the lot is full, or its camera is offline). Please wait at the entrance or try a nearby lot on the map.</div>
          )}
        </div>
      )}
      <div className="card">
        <div className="kv"><span>Time parked</span><b>{Math.floor(s.minutes)} min</b></div>
        <div className="kv"><span>Total</span><b>{money(s.amount_total, s.currency)}</b></div>
        <div className="kv"><span>To pay</span><b>{money(s.amount_due, s.currency)}</b></div>
        <div className="kv"><span>Card</span><b>{s.card_last4 ? `•••• ${s.card_last4}` : "not attached"}</b></div>
      </div>
      {active && (
        <div className="card">
          <div className="sandbox">SANDBOX PAYMENT — test mode, use 4242 4242 4242 4242</div>
          {!s.card_last4 && (
            <div className="inline">
              <input placeholder="Card number" inputMode="numeric" value={card} onChange={(e) => setCard(e.target.value)} />
              <button className="btn" disabled={busy} onClick={() => act(() => api.attachCard(sid, card))}>Save card</button>
            </div>
          )}
          {s.amount_due > 0 && <button className="btn ghost wide" disabled={busy} onClick={() => act(() => api.paySession(sid))}>Pay now {money(s.amount_due, s.currency)}</button>}
          <button className="btn primary wide" disabled={busy} onClick={() => act(() => api.exitSession(sid))}>I'm leaving — open the exit</button>
          {msg && <div className="error small">{msg}</div>}
        </div>
      )}
    </div>
  );
}
