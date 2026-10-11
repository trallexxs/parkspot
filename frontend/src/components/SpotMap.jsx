import { useEffect, useRef, useState } from "react";
import { CarTop } from "./Icons.jsx";

function Spot({ id, status, selected, onSelect, mine, changed, pickable, hint, onPick }) {
  const cls = ["spot", status || "unknown", selected ? "selected" : "", mine ? "mine" : "", changed ? "changed" : "",
    hint ? "hint" : ""].join(" ");
  const free = status === "free" && onSelect;
  const pick = pickable && onPick; // e.g. a walk-in driver tapping the (taken) spot he parked in
  return (
    <button className={cls} data-spot={id} disabled={!free && !pick} onClick={() => (free ? onSelect(id) : pick && onPick(id))}
      aria-label={`${id} ${status || "unknown"}${mine ? ", yours" : ""}`}>
      {status === "occupied" || status === "conflict" ? <CarTop /> : null}
      <span className="spot-id">{id}</span>
    </button>
  );
}

/** Spots whose status just changed (for a short highlight while their colour fades). */
function useChanged(statuses) {
  const prev = useRef(null);
  const timers = useRef([]);
  const [changed, setChanged] = useState({});
  useEffect(() => {
    if (!statuses) return;
    const p = prev.current;
    prev.current = statuses;
    if (!p) return;
    const ids = Object.keys(statuses).filter((k) => p[k] !== undefined && p[k] !== statuses[k]);
    if (!ids.length) return;
    setChanged((c) => ({ ...c, ...Object.fromEntries(ids.map((k) => [k, true])) }));
    timers.current.push(setTimeout(() => setChanged((c) => {
      const n = { ...c };
      ids.forEach((k) => delete n[k]);
      return n;
    }), 1300));
  }, [statuses]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  return changed;
}

/** Seat-map style view. Aisles are drawn as a road with the driver's left/right columns;
 *  the entrance is at the bottom so "left" on screen = driver's left. */
export default function SpotMap({ map, statuses, selected, onSelect, mine, pickable, hint, onPick }) {
  const changed = useChanged(statuses);
  if (!map) return null;
  const st = statuses || {};
  const spot = (id) => (
    <Spot key={id} id={id} status={st[id]} selected={selected === id} mine={mine === id} changed={changed[id]} onSelect={onSelect}
      pickable={pickable?.includes(id)} hint={hint?.includes(id)} onPick={onPick} />
  );
  return (
    <div className="spot-map">
      {map.aisles.map((a) => {
        const n = Math.max(a.left.length, a.right.length);
        const rows = Array.from({ length: n }, (_, i) => n - 1 - i); // far end on top
        return (
          <div key={a.id} className="aisle-block">
            <div className="aisle-end">End of {a.name.toLowerCase()}</div>
            {rows.map((i) => (
              <div className="map-row" key={i}>
                <div className="row-no">{i + 1}</div>
                <div className="side">{a.left[i] && spot(a.left[i])}</div>
                <div className="road"><span /></div>
                <div className="side">{a.right[i] && spot(a.right[i])}</div>
              </div>
            ))}
            <div className="entrance">▲ Entrance</div>
          </div>
        );
      })}
      {map.rows.length > 0 && (
        <div className="plain-rows">
          {map.rows.map((r) => (
            <div key={r.row} className="plain-row">
              <div className="plain-row-title">Row {r.row}</div>
              <div className="plain-row-spots">{r.spots.map(spot)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Legend() {
  return (
    <div className="legend">
      <span><i className="dot free" />Free</span>
      <span><i className="dot reserved" />Reserved</span>
      <span><i className="dot occupied" />Taken (car parked)</span>
      <span><i className="dot selected" />Selected</span>
      <span><i className="dot unknown" />No data</span>
    </div>
  );
}
