import { navLinks } from "../api.js";

/** Outside the lot the driver's own navigation app drives them to the entrance. */
export default function NavButtons({ location, compact }) {
  if (!location) return null;
  const l = navLinks(location);
  return (
    <div className="row-btns">
      <a className={"btn " + (compact ? "ghost" : "primary")} href={l.google} target="_blank" rel="noreferrer">Navigate · Google Maps</a>
      <a className="btn ghost" href={l.yandex} target="_blank" rel="noreferrer">Yandex</a>
    </div>
  );
}
