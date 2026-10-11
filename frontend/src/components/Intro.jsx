import { useEffect, useRef, useState } from "react";

const KEY = "parkdet.intro.seen";
const SPOT_W = 40, SPOT_H = 58, GAP = 6, X0 = 28;
const spotX = (i) => X0 + i * (SPOT_W + GAP);
const GOAL = 3; // the free spot in the top row the car parks in
const goalCx = spotX(GOAL) + SPOT_W / 2;

function shouldShow() {
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return false;
  try { return !sessionStorage.getItem(KEY); } catch { return true; }
}

function ParkedCar({ cx, cy }) {
  return (
    <g transform={`translate(${cx - 13} ${cy - 22})`}>
      <rect width="26" height="44" rx="8" fill="#53627c" />
      <rect x="4" y="9" width="18" height="9" rx="3" fill="#c9d6ea" opacity=".45" />
      <rect x="4" y="29" width="18" height="7" rx="3" fill="#c9d6ea" opacity=".3" />
    </g>
  );
}

/** Opening animation, once per visit: a car drives into the lot and parks in the one free spot. */
export default function Intro() {
  const [show, setShow] = useState(shouldShow);
  const [leaving, setLeaving] = useState(false);
  const svg = useRef(null);

  useEffect(() => {
    if (!show) return undefined;
    try { sessionStorage.setItem(KEY, "1"); } catch { /* private mode: shows once per page load */ }
    svg.current?.setCurrentTime?.(0); // start the drive when the overlay appears
    const done = setTimeout(() => setShow(false), 3900); // after the CSS fade-out (3.3 s + 0.5 s)
    const key = (e) => { if (["Escape", "Enter", " "].includes(e.key)) skip(); };
    window.addEventListener("keydown", key);
    return () => { clearTimeout(done); window.removeEventListener("keydown", key); };
  }, [show]);

  function skip() {
    setLeaving(true);
    setTimeout(() => setShow(false), 350);
  }

  if (!show) return null;
  const top = Array.from({ length: 6 }, (_, i) => i);
  return (
    <div className={"intro" + (leaving ? " leaving" : "")} onClick={skip} role="dialog" aria-label="ParkDet — Parking Detector">
      <button className="intro-skip" onClick={(e) => { e.stopPropagation(); skip(); }}>Skip</button>
      <div className="intro-inner">
        <svg ref={svg} className="intro-scene" viewBox="0 0 320 210" aria-hidden="true">
          <rect x="10" y="10" width="300" height="190" rx="18" fill="#111c31" stroke="rgba(255,255,255,.08)" />
          {top.map((i) => (
            <rect key={`t${i}`} x={spotX(i)} y="20" width={SPOT_W} height={SPOT_H} rx="5" fill="none" stroke="rgba(255,255,255,.18)" />
          ))}
          {top.map((i) => (
            <rect key={`b${i}`} x={spotX(i)} y="132" width={SPOT_W} height={SPOT_H} rx="5" fill="none" stroke="rgba(255,255,255,.18)" />
          ))}
          <line x1="20" y1="105" x2="300" y2="105" stroke="rgba(255,255,255,.22)" strokeWidth="2" strokeDasharray="10 9" />
          {top.filter((i) => i !== GOAL).map((i) => <ParkedCar key={`pt${i}`} cx={spotX(i) + SPOT_W / 2} cy={49} />)}
          {top.map((i) => <ParkedCar key={`pb${i}`} cx={spotX(i) + SPOT_W / 2} cy={161} />)}
          {/* the free spot the camera found */}
          <rect className="goal" x={spotX(GOAL)} y="20" width={SPOT_W} height={SPOT_H} rx="5" fill="rgba(52,199,123,.14)" stroke="#34c77b" strokeWidth="2.5" />
          {/* the driver's car: drives in along the aisle and turns into the spot */}
          <g>
            <rect x="-22" y="-13" width="44" height="26" rx="8" fill="#3b7bff" />
            <rect x="5" y="-10" width="9" height="20" rx="3" fill="#dbe7ff" opacity=".85" />
            <rect x="-17" y="-9" width="7" height="18" rx="2.5" fill="#dbe7ff" opacity=".5" />
            <rect x="19" y="-11" width="3" height="5" rx="1.5" fill="#ffe08a" />
            <rect x="19" y="6" width="3" height="5" rx="1.5" fill="#ffe08a" />
            <animateMotion dur="2.1s" begin="0s" fill="freeze" rotate="auto" calcMode="spline"
              keyPoints="0;1" keyTimes="0;1" keySplines="0.45 0 0.25 1"
              path={`M -40 105 L ${goalCx - 46} 105 C ${goalCx - 14} 105 ${goalCx} 96 ${goalCx} 74 L ${goalCx} 49`} />
          </g>
          <g className="goal-done">
            <circle cx={spotX(GOAL) + SPOT_W - 2} cy="22" r="9" fill="#34c77b" />
            <path d={`M ${spotX(GOAL) + SPOT_W - 6} 22 l 3 3 l 5 -6`} fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </g>
        </svg>
        <div className="intro-title">
          <div className="name">ParkDet</div>
          <div className="full"><b>Park</b>ing <b>Det</b>ector</div>
          <div className="tag">Free parking spots, seen live</div>
        </div>
      </div>
    </div>
  );
}
