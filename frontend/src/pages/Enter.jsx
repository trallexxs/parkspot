import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, money } from "../api.js";
import { addTicket, getTickets } from "../storage.js";
import { usePoll } from "../usePoll.js";
import SpotMap, { Legend } from "../components/SpotMap.jsx";
import Directions from "../components/Directions.jsx";
import Countdown from "../components/Countdown.jsx";

const ACTIVE_BOOKING = ["pending_payment", "confirmed", "checked_in", "parked"];
const fmtTime = (min) => (min < 60 ? `${Math.floor(min)} min` : `${Math.floor(min / 60)} h ${Math.floor(min % 60)} min`);

/** Walk-in (no booking): the driver scans the QR code at the entrance -> /enter/:lotId. The visit starts at
 *  once and the first hour is paid automatically (test mode). He may then choose a free spot, or just park
 *  and tap his spot; each extra hour is paid automatically when he leaves. */
export default function Enter() {
  const { id, sid } = useParams();
  return sid ? <Visit sid={sid} /> : <Entrance id={id} />;
}

function Entrance({ id }) {
  const nav = useNavigate();
  const [lotName, setLotName] = useState("");
  const [booked, setBooked] = useState(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  async function enter() {
    setBusy(true); setMsg("");
    try {
      const v = await api.startSession(id);
      addTicket({ id: v.id, kind: "session", lot: v.lot_name, lot_id: id });
      nav(`/session/${v.id}`, { replace: true });
    } catch (e) { setMsg(e.message); setBusy(false); }
  }

  useEffect(() => {
    api.lot(id).then((l) => setLotName(l.name)).catch(() => {});
    if (started.current) return;
    started.current = true;
    (async () => {
      // already inside this lot on this phone (scanning again at the exit)? open that visit.
      // A booking here? Booked drivers need no scan: show their ticket instead of charging again.
      const mine = await Promise.all(getTickets().map((t) => (t.kind === "booking" ? api.booking(t.id) : api.session(t.id))
        .then((d) => ({ t, d })).catch(() => null)));
      const here = mine.filter((x) => x && x.d.lot_id === id);
      const visit = here.find(({ t, d }) => t.kind === "session" && d.status === "active");
      if (visit) return nav(`/session/${visit.t.id}`, { replace: true });
      const booking = here.find(({ t, d }) => t.kind === "booking" && ACTIVE_BOOKING.includes(d.status));
      if (booking) return setBooked(booking);
      enter();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (booked) {
    return (
      <div className="page">
        <header className="page-head"><div className="muted small">{lotName}</div><h1>You have a booking here</h1></header>
        <div className="card">
          <p>Spot <b>{booked.d.spot_id}</b> is booked for you. No need to scan or pay again: open your ticket and press the button when you arrive.</p>
          <Link className="btn primary lg wide" to={`/booking/${booked.t.id}`} replace>Open my ticket</Link>
          <button className="btn ghost wide" disabled={busy} aria-busy={busy} onClick={enter}>Enter without the booking</button>
          {msg && <div className="error small">{msg}</div>}
        </div>
      </div>
    );
  }
  return (
    <div className="page">
      <header className="page-head"><div className="muted small">{lotName}</div><h1>Welcome</h1></header>
      <div className="card center">
        {msg ? (
          <>
            <div className="error">{msg}</div>
            <button className="btn primary lg wide" disabled={busy} aria-busy={busy} onClick={enter}>Try again</button>
          </>
        ) : (
          <>
            <div className="spinner-lg" aria-hidden="true" />
            <b>Paying the first hour automatically…</b>
            <div className="muted small">Test mode: no real money is charged.</div>
          </>
        )}
      </div>
    </div>
  );
}

function Visit({ sid }) {
  const [s, setS] = useState(null);
  const [lot, setLot] = useState(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState("");
  const [askMark, setAskMark] = useState(null);
  const [remark, setRemark] = useState(false);
  const [nearest, setNearest] = useState(null);

  useEffect(() => {
    let alive = true;
    const load = () => api.session(sid).then((v) => alive && setS(v)).catch((e) => alive && setMsg(e.message));
    load();
    const t = setInterval(load, 4000);
    return () => { alive = false; clearInterval(t); };
  }, [sid]);
  const lotId = s?.lot_id;
  useEffect(() => { if (lotId) api.lot(lotId).then(setLot).catch(() => {}); }, [lotId]);
  const active = s?.status === "active";
  const parked = !!s?.parked_spot && !remark;
  const [st] = usePoll(() => (lotId && active ? api.state(lotId) : Promise.resolve(null)), 3000, [lotId, active]);
  useEffect(() => { // the spot suggested at the entrance (same rule as the entrance screen), not held
    if (lotId && active && !s?.spot_id) api.nearest(lotId).then((r) => setNearest(r.spot_id)).catch(() => setNearest(null));
  }, [lotId, active, s?.spot_id, st?.counts?.free]);

  const act = async (name, fn) => {
    setBusy(name); setMsg("");
    try { setS(await fn()); return true; } catch (e) { setMsg(e.message); return false; }
    finally { setBusy(""); }
  };
  const choose = (spot) => act("spot", () => api.chooseSpot(sid, spot));
  const mark = async (spot) => { if (await act("mark", () => api.markParked(sid, spot))) { setAskMark(null); setRemark(false); } };

  if (!s) return <div className="page"><div className="card">{msg || "Loading…"}</div></div>;
  const cur = s.currency;
  if (!active) {
    return (
      <div className="page">
        <header className="page-head"><div className="muted small">{s.lot_name}</div><h1>Have a good trip!</h1></header>
        <div className="card">
          <div className="kv"><span>Time parked</span><b>{fmtTime(s.minutes)}</b></div>
          {s.parked_spot && <div className="kv"><span>Spot</span><b>{s.parked_spot}</b></div>}
          <div className="kv"><span>Paid in total (test)</span><b>{money(s.paid_amount, cur)}</b></div>
          <div className="muted small">{money(s.first_hour_price, cur)} for the first hour + {money(s.extra_hour_price, cur)} for each extra hour, paid automatically. Test mode: no real money.</div>
        </div>
      </div>
    );
  }
  const taken = Object.entries(st?.statuses || {}).filter(([, v]) => v === "occupied" || v === "conflict").map(([k]) => k);
  const held = !parked && s.spot_id && s.hold_until;
  return (
    <div className="page">
      <header className="page-head">
        <div className="muted small">{s.lot_name}</div>
        <h1>{parked ? `Parked at ${s.parked_spot}` : "You're in"}</h1>
      </header>

      <div className="card paid">
        <div className="paid-head">
          <span className="paid-tick" aria-hidden="true">✓</span>
          <div>
            <b>{money(s.first_hour_price, cur)} paid automatically</b>
            <div className="muted small">First hour · test mode, no real money · test card •••• {s.card_last4}</div>
          </div>
        </div>
        <div className="kv"><span>Time parked</span><b>{fmtTime(s.minutes)}</b></div>
        <div className="kv"><span>Total so far</span><b>{money(s.amount_total, cur)}</b></div>
        <div className="muted small">Each extra hour is {money(s.extra_hour_price, cur)}, paid automatically when you leave.</div>
      </div>

      {parked && (
        <div className="card">
          <div className="parked-line">You parked at <b>{s.parked_spot}</b>{s.parked_by === "camera" ? " — confirmed by the camera" : " — marked by you"}</div>
          <Legend />
          <SpotMap map={lot?.map} statuses={st?.statuses} mine={s.parked_spot} />
          <button className="btn ghost" onClick={() => setRemark(true)}>Not your spot? Mark the right one</button>
        </div>
      )}

      {held && (
        <div className="card">
          <div className="muted small">Your spot</div>
          <div className="sheet-spot">{s.spot_id}</div>
          <Countdown start={s.hold_start} until={s.hold_until} label="Held for you for" overLabel="Hold time is up — the spot may be taken by someone else" />
          <Directions d={s.directions} big />
        </div>
      )}

      {!parked && (
        <div className="card map-card">
          <h3>{remark ? "Tap the spot you parked in" : s.spot_id ? "Change your spot, or park and tap it" : "Choose a free spot, or just park"}</h3>
          <p className="muted small">
            {remark ? "Spots with a car are red." : "Tap a green spot to hold it for you for 5 minutes. Or drive in and park in any green spot: when the camera sees your car, the spot turns red — tap it to mark it as yours."}
          </p>
          {!remark && nearest && !s.spot_id && (
            <button className="btn primary wide" disabled={!!busy} aria-busy={busy === "spot"} onClick={() => choose(nearest)}>Take the nearest free spot: {nearest}</button>
          )}
          {st && !st.camera.online && <div className="notice">The camera at this lot is offline, so free spots cannot be confirmed right now. You can still park and mark your spot once it is back.</div>}
          <Legend />
          <SpotMap map={lot?.map} statuses={st?.statuses} selected={s.spot_id} onSelect={remark ? undefined : choose}
            pickable={taken} hint={s.taken_since_entry} onPick={(spot) => setAskMark(spot)} />
          {remark && <button className="btn ghost" onClick={() => setRemark(false)}>Cancel</button>}
        </div>
      )}

      {msg && <div className="card error" role="alert">{msg}</div>}

      <button className="btn primary lg wide" disabled={!!busy} aria-busy={busy === "exit"} onClick={() => act("exit", () => api.exitSession(sid))}>I'm leaving — open the exit</button>
      <div className="muted small center">Extra hours are paid automatically when you leave (test mode).</div>

      {askMark && (
        <div className="sheet" role="dialog" aria-label={`Mark ${askMark}`}>
          <div className="sheet-head">
            <div><div className="muted small">Did you park here?</div><div className="sheet-spot">{askMark}</div></div>
            <button className="x" onClick={() => setAskMark(null)} aria-label="close">×</button>
          </div>
          <p className="muted small">The camera sees a car in {askMark}. It cannot tell whose car it is, so please confirm it is yours.</p>
          <button className="btn primary lg wide" disabled={!!busy} aria-busy={busy === "mark"} onClick={() => mark(askMark)}>Yes, {askMark} is my spot</button>
        </div>
      )}
    </div>
  );
}
