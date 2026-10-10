import { Arrow } from "./Icons.jsx";

export default function Directions({ d, big }) {
  if (!d) return null;
  return (
    <ol className={"directions" + (big ? " big" : "")}>
      {d.steps.map((s, i) => (
        <li key={i}>
          <span className="dir-icon"><Arrow dir={s.icon} size={big ? 40 : 26} /></span>
          <span>{s.text}</span>
        </li>
      ))}
    </ol>
  );
}
