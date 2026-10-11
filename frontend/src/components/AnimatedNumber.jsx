import { useEffect, useRef, useState } from "react";

const reduceMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** A live count that glides to its new value (and bumps once) instead of jumping. */
export default function AnimatedNumber({ value }) {
  const [shown, setShown] = useState(value);
  const [bump, setBump] = useState(0);
  const prev = useRef(value);

  useEffect(() => {
    const from = prev.current;
    prev.current = value;
    if (typeof from !== "number" || typeof value !== "number" || from === value || reduceMotion()) {
      setShown(value);
      return undefined;
    }
    setBump((n) => n + 1);
    const t0 = performance.now();
    let raf;
    const step = (t) => {
      const k = Math.min(1, (t - t0) / 500);
      setShown(Math.round(from + (value - from) * (1 - (1 - k) ** 3)));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);

  // the key restarts the bump animation on every change
  return <span key={bump} className={"num" + (bump ? " bump" : "")}>{shown}</span>;
}
