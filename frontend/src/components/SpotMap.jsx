import { CarTop } from "./Icons.jsx";

function Spot({ id, status, selected, onSelect, mine }) {
  const cls = ["spot", status || "unknown", selected ? "selected" : "", mine ? "mine" : ""].join(" ");
  const clickable = status === "free" && onSelect;
  return (
    <button className={cls} disabled={!clickable} onClick={() => clickable && onSelect(id)} aria-label={`${id} ${status}`}>
      {status === "occupied" || status === "conflict" ? <CarTop /> : null}
      <span className="spot-id">{id}</span>
    </button>
  );
}

/** Seat-map style view. Aisles are drawn as a road with the driver's left/right columns;
 *  the entrance is at the bottom so "left" on screen = driver's left. */
export default function SpotMap({ map, statuses, selected, onSelect, mine }) {
  if (!map) return null;
  const st = statuses || {};
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
                <div className="side">
                  {a.left[i] && <Spot id={a.left[i]} status={st[a.left[i]]} selected={selected === a.left[i]} mine={mine === a.left[i]} onSelect={onSelect} />}
                </div>
                <div className="road"><span /></div>
                <div className="side">
                  {a.right[i] && <Spot id={a.right[i]} status={st[a.right[i]]} selected={selected === a.right[i]} mine={mine === a.right[i]} onSelect={onSelect} />}
                </div>
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
              <div className="plain-row-spots">
                {r.spots.map((id) => (
                  <Spot key={id} id={id} status={st[id]} selected={selected === id} mine={mine === id} onSelect={onSelect} />
                ))}
              </div>
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
      <span><i className="dot occupied" />Occupied</span>
      <span><i className="dot reserved" />Reserved</span>
      <span><i className="dot selected" />Selected</span>
    </div>
  );
}
