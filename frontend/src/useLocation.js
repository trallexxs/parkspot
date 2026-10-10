import { useEffect, useState } from "react";

/** The device's GPS position (asks the user once). error is a readable string or "". */
export function useLocation(watch = true) {
  const [pos, setPos] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!navigator.geolocation) { setError("This browser has no location access"); return undefined; }
    const ok = (p) => { setPos({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }); setError(""); };
    const bad = (e) => setError(e.code === 1 ? "Location permission denied" : "Location unavailable");
    const opts = { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 };
    if (!watch) { navigator.geolocation.getCurrentPosition(ok, bad, opts); return undefined; }
    const id = navigator.geolocation.watchPosition(ok, bad, opts);
    return () => navigator.geolocation.clearWatch(id);
  }, [watch]);
  return [pos, error];
}
