const P = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" };

export const HomeIcon = () => (
  <svg viewBox="0 0 24 24" width="26" height="26" {...P}><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" /></svg>
);
export const TicketIcon = () => (
  <svg viewBox="0 0 24 24" width="26" height="26" {...P}><path d="M3 8a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2v-2a2 2 0 0 0 0-4z" /><path d="M10 9v1M10 14v1" /></svg>
);
export const CameraIcon = () => (
  <svg viewBox="0 0 24 24" width="26" height="26" {...P}><path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" /><circle cx="12" cy="13.5" r="3.5" /></svg>
);
export const SpotsIcon = () => (
  <svg viewBox="0 0 24 24" width="26" height="26" {...P}><rect x="3" y="3" width="18" height="18" rx="4.5" /><path d="M9.5 16.5v-9h3.3a2.8 2.8 0 0 1 0 5.6H9.5" /></svg>
);
export const QrIcon = ({ size = 26 }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} {...P}>
    <path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" />
    <rect x="8" y="8" width="3" height="3" rx=".6" /><rect x="13" y="8" width="3" height="3" rx=".6" /><rect x="8" y="13" width="3" height="3" rx=".6" />
    <path d="M13 13h3v3h-3z" fill="currentColor" stroke="none" opacity=".9" />
  </svg>
);
export const Arrow = ({ dir = "straight", size = 28 }) => {
  const rot = { straight: 0, right: 90, left: -90, pin: 0 }[dir] ?? 0;
  if (dir === "pin")
    return <svg viewBox="0 0 24 24" width={size} height={size} {...P}><path d="M12 21s-7-6.5-7-12a7 7 0 0 1 14 0c0 5.5-7 12-7 12z" /><circle cx="12" cy="9" r="2.5" /></svg>;
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} {...P} style={{ transform: `rotate(${rot}deg)` }}>
      <path d="M12 20V5M6 11l6-6 6 6" />
    </svg>
  );
};
export const CarTop = () => (
  <svg viewBox="0 0 40 64" className="car-svg" aria-hidden="true">
    <rect x="4" y="2" width="32" height="60" rx="11" fill="currentColor" />
    <rect x="8" y="14" width="24" height="11" rx="3" fill="#fff" opacity=".45" />
    <rect x="8" y="42" width="24" height="9" rx="3" fill="#fff" opacity=".35" />
  </svg>
);
