import { useEffect, useRef, useState } from "react";

export function usePoll(fn, ms, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const saved = useRef(fn);
  saved.current = fn;
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const d = await saved.current();
        if (alive) { setData(d); setError(null); }
      } catch (e) {
        if (alive) setError(e);
      }
    };
    tick();
    const t = setInterval(tick, ms);
    return () => { alive = false; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return [data, error, setData];
}
