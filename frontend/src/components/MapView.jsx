import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// City-level default view when neither the driver's position nor any lot is known yet.
const DEFAULT_VIEW = [41.31, 69.27];

/** OpenStreetMap via Leaflet. Shows the driver, the lots (free count / offline), and optionally a
 *  draggable pin for the operator to place a lot entrance. */
export default function MapView({ lots = [], user, onLotClick, pin, onPinMove, height = 360 }) {
  const box = useRef(null);
  const map = useRef(null);
  const layers = useRef({ lots: null, user: null, pin: null });
  const fitted = useRef("");
  const clickRef = useRef(onLotClick);
  const moveRef = useRef(onPinMove);
  clickRef.current = onLotClick;
  moveRef.current = onPinMove;

  useEffect(() => {
    const start = pin || user || lots.find((l) => l.location)?.location;
    const m = L.map(box.current, { zoomControl: true, attributionControl: true })
      .setView(start ? [start.lat, start.lng] : DEFAULT_VIEW, start ? 16 : 12);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(m);
    layers.current.lots = L.layerGroup().addTo(m);
    if (moveRef.current) m.on("click", (e) => moveRef.current({ lat: e.latlng.lat, lng: e.latlng.lng }));
    map.current = m;
    const sizeFix = setTimeout(() => m.invalidateSize(), 0); // container gets its final size after mount
    return () => { clearTimeout(sizeFix); m.remove(); map.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { // lots
    const g = layers.current.lots;
    if (!g) return;
    g.clearLayers();
    lots.filter((l) => l.location).forEach((l) => {
      const cls = !l.camera_online ? "offline" : l.counts.free > 0 ? "free" : "full";
      const label = !l.camera_online ? "?" : String(l.counts.free);
      const icon = L.divIcon({ className: "", html: `<div class="lot-pin ${cls}"><b>${label}</b><span>P</span></div>`,
        iconSize: [44, 52], iconAnchor: [22, 50] });
      L.marker([l.location.lat, l.location.lng], { icon, title: l.name })
        .on("click", () => clickRef.current && clickRef.current(l)).addTo(g);
    });
  }, [lots]);

  useEffect(() => { // the driver
    const m = map.current;
    if (!m) return;
    if (layers.current.user) layers.current.user.remove();
    layers.current.user = user
      ? L.circleMarker([user.lat, user.lng], { radius: 8, color: "#ffffff", weight: 3, fillColor: "#1f5fe0", fillOpacity: 1 })
        .bindTooltip("You").addTo(m)
      : null;
  }, [user]);

  useEffect(() => { // operator's draggable entrance pin
    const m = map.current;
    if (!m) return;
    if (layers.current.pin) layers.current.pin.remove();
    layers.current.pin = null;
    if (!pin) return;
    const icon = L.divIcon({ className: "", html: '<div class="lot-pin pick"><b>P</b><span>entrance</span></div>',
      iconSize: [44, 52], iconAnchor: [22, 50] });
    const mk = L.marker([pin.lat, pin.lng], { icon, draggable: !!moveRef.current }).addTo(m);
    mk.on("dragend", () => { const p = mk.getLatLng(); moveRef.current && moveRef.current({ lat: p.lat, lng: p.lng }); });
    layers.current.pin = mk;
    m.setView([pin.lat, pin.lng], Math.max(m.getZoom(), 17), { animate: false });
  }, [pin]);

  useEffect(() => { // show the driver and the lots together; refit only when that set changes
    const m = map.current;
    if (!m || pin) return;
    const placed = lots.filter((l) => l.location);
    const key = `${placed.map((l) => l.id).join(",")}|${user ? "me" : ""}`;
    if (!key.replace("|", "") || fitted.current === key || fitted.current.endsWith("|me") && !user) return;
    fitted.current = key;
    const pts = placed.map((l) => [l.location.lat, l.location.lng]);
    if (user) pts.push([user.lat, user.lng]);
    m.invalidateSize();
    // no animation: a fit that starts while the previous zoom animation runs would be overwritten by it
    if (pts.length === 1) m.setView(pts[0], 16, { animate: false });
    else m.fitBounds(pts, { padding: [40, 40], maxZoom: 16, animate: false });
  }, [lots, user, pin]);

  return <div ref={box} className="map-box" style={{ height }} />;
}
