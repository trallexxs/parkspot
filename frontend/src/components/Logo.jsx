/** ParkDet mark: a "P" with an amber dot (a detected free spot). */
export function LogoMark({ size = 38 }) {
  return (
    <svg viewBox="0 0 40 40" width={size} height={size} className="brand-p" aria-hidden="true">
      <rect width="40" height="40" rx="11" fill="var(--brand)" />
      <path d="M14 30V10h7.5a6 6 0 0 1 0 12H14" fill="none" stroke="#fff" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="29.5" cy="29.5" r="4.2" fill="var(--accent)" />
    </svg>
  );
}

export default function Logo() {
  return (
    <div>
      <div className="brand"><LogoMark /> ParkDet</div>
      <div className="brand-sub"><span className="hl">Park</span>ing <span className="hl">Det</span>ector · free parking spots, seen live</div>
    </div>
  );
}
