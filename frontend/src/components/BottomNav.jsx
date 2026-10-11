import { useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { CameraIcon, HomeIcon, TicketIcon } from "./Icons.jsx";

const TABS = [
  { to: "/", Icon: HomeIcon, label: "Map" },
  { to: "/tickets", Icon: TicketIcon, label: "My tickets" },
  { to: "/vision", Icon: CameraIcon, label: "Vision" },
];
const tabIndex = (path) => TABS.findIndex((t) => t.to === path);
const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Floating "liquid glass" menu: a glass bubble stretches and slides to the tapped section,
 *  and the page slides in from the side the section is on (View Transitions where the browser has them). */
export default function BottomNav() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const navRef = useRef(null);
  const itemRefs = useRef([]);
  const [lens, setLens] = useState(null); // { l, r, dir } in px from the menu's edges
  const active = tabIndex(pathname);

  useLayoutEffect(() => {
    // animate = a tap moved the bubble; a resize, the first placement or coming back from a page
    // without a menu item just puts it in place
    const place = (animate) => {
      const nav = navRef.current, el = itemRefs.current[active];
      if (!nav || !el) return setLens((p) => (p ? { ...p, hidden: true } : p));
      const l = el.offsetLeft, r = nav.clientWidth - (el.offsetLeft + el.offsetWidth);
      setLens((p) => {
        const jump = !animate || !p || p.hidden;
        return { l, r, hidden: false, jump, dir: jump ? 0 : Math.sign(l - p.l) };
      });
    };
    place(true);
    const onResize = () => place(false);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [active]);

  function go(e, to) {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (to === pathname || !document.startViewTransition || reducedMotion()) return; // plain navigation
    e.preventDefault();
    const root = document.documentElement;
    root.dataset.vt = tabIndex(to) >= active ? "fwd" : "back";
    const t = document.startViewTransition(() => flushSync(() => navigate(to)));
    t.finished.finally(() => { delete root.dataset.vt; });
  }

  // the edge that leads the move travels faster than the trailing one, so the bubble stretches like a drop
  const fast = ".3s cubic-bezier(.2, 1.25, .4, 1)", slow = ".52s cubic-bezier(.3, 1.2, .45, 1)";
  const lensStyle = lens && {
    left: lens.l, right: lens.r, opacity: lens.hidden ? 0 : 1,
    transition: lens.jump ? "opacity .2s" : lens.dir > 0 ? `right ${fast}, left ${slow}, opacity .2s` : `left ${fast}, right ${slow}, opacity .2s`,
  };
  return (
    <nav className="bottom-nav" ref={navRef}>
      {lens && <span className="nav-lens" style={lensStyle} aria-hidden="true" />}
      {TABS.map(({ to, Icon, label }, i) => (
        <NavLink key={to} to={to} end={to === "/"} ref={(el) => { itemRefs.current[i] = el; }} onClick={(e) => go(e, to)}
          className={({ isActive }) => "nav-item" + (isActive ? " active" : "")}>
          <Icon />
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
