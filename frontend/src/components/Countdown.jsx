import { useEffect, useState } from "react";

const fmt = (sec) => {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const p = (n) => String(n).padStart(2, "0");
  return h ? `${h}:${p(m)}:${p(r)}` : `${m}:${p(r)}`;
};

/** How long a held spot stays the driver's. `until` / `start` come from the server's own rules. */
export default function Countdown({ start, until, label, overLabel }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const end = Date.parse(until);
  const begin = start ? Date.parse(start) : null;
  const left = (end - now) / 1000;
  const total = begin ? Math.max(1, (end - begin) / 1000) : null;
  const frac = total ? Math.max(0, Math.min(1, left / total)) : 1;
  const over = left <= 0;
  const warn = !over && (left < 60 || (total && frac < 0.2));
  const R = 18, C = 2 * Math.PI * R;
  return (
    <div className={"countdown" + (over ? " over" : warn ? " warn" : "")} role="timer">
      <svg className="countdown-ring" viewBox="0 0 44 44" aria-hidden="true">
        <circle className="track" cx="22" cy="22" r={R} />
        <circle className="bar" cx="22" cy="22" r={R} strokeDasharray={C} strokeDashoffset={C * (1 - frac)} />
      </svg>
      <div>
        <div className="small muted">{over ? overLabel : label}</div>
        {!over && <div className="countdown-time">{fmt(left)}</div>}
      </div>
    </div>
  );
}
