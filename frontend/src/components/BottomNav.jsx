import { NavLink } from "react-router-dom";
import { CameraIcon, HomeIcon, TicketIcon } from "./Icons.jsx";

export default function BottomNav() {
  const item = (to, Icon, label) => (
    <NavLink to={to} end={to === "/"} className={({ isActive }) => "nav-item" + (isActive ? " active" : "")}>
      <Icon />
      <span>{label}</span>
    </NavLink>
  );
  return (
    <nav className="bottom-nav">
      {item("/", HomeIcon, "Home")}
      {item("/tickets", TicketIcon, "My tickets")}
      {item("/vision", CameraIcon, "Vision")}
    </nav>
  );
}
