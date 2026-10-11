async function call(method, url, body, isForm, headers = {}) {
  const opts = { method, headers: { ...headers } };
  if (body && isForm) opts.body = body;
  else if (body) {
    opts.headers["content-type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const r = await fetch(url, opts);
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!r.ok) {
    let detail = data && data.detail ? data.detail : text;
    try { detail = JSON.parse(detail); } catch { /* plain string */ }
    const err = new Error(typeof detail === "string" ? detail : detail.message || "Request failed");
    err.status = r.status;
    err.detail = detail;
    throw err;
  }
  return data;
}

const pinHeader = (pin) => (pin ? { "X-Lot-Pin": pin } : {});

export const api = {
  lots: () => call("GET", "/api/lots"),
  lot: (id) => call("GET", `/api/lots/${id}`),
  state: (id) => call("GET", `/api/lots/${id}/state`),
  events: (id, pin) => call("GET", `/api/lots/${id}/events`, null, false, pinHeader(pin)),
  auth: (id, pin) => call("POST", `/api/lots/${id}/auth`, { pin }),
  setup: (id, pin, body) => call("PUT", `/api/lots/${id}/setup`, body, false, pinHeader(pin)),
  exportLot: (id, pin) => call("GET", `/api/lots/${id}/export`, null, false, pinHeader(pin)),
  importLot: (cfg, pin) => call("POST", "/api/lots/import", cfg, false, pinHeader(pin)),
  directions: (id, spot) => call("GET", `/api/lots/${id}/directions/${spot}`),
  nearest: (id) => call("GET", `/api/lots/${id}/nearest`),
  book: (id, body) => call("POST", `/api/lots/${id}/bookings`, body),
  booking: (bid) => call("GET", `/api/bookings/${bid}`),
  payBooking: (bid) => call("POST", `/api/bookings/${bid}/pay`),
  checkin: (bid) => call("POST", `/api/bookings/${bid}/checkin`),
  cancel: (bid) => call("POST", `/api/bookings/${bid}/cancel`),
  startSession: (id) => call("POST", `/api/lots/${id}/sessions`),
  session: (sid) => call("GET", `/api/sessions/${sid}`),
  attachCard: (sid, number) => call("POST", `/api/sessions/${sid}/card`, { number }),
  paySession: (sid) => call("POST", `/api/sessions/${sid}/pay`),
  exitSession: (sid) => call("POST", `/api/sessions/${sid}/exit`),
  analyze: (file, lotId) => {
    const f = new FormData();
    f.append("image", file);
    if (lotId) f.append("lot_id", lotId);
    return call("POST", "/api/analyze", f, true);
  },
  createLot: (file, name) => {
    const f = new FormData();
    f.append("image", file);
    f.append("name", name);
    return call("POST", "/api/lots", f, true);
  },
  pushFrame: (id, file, pin, live = true) => {
    const f = new FormData();
    f.append("image", file);
    f.append("live", live ? "true" : "false");
    return call("POST", `/api/lots/${id}/frame`, f, true, pinHeader(pin));
  },
  metrics: () => call("GET", "/api/metrics"),
};

export const money = (n, cur = "UZS") =>
  `${Number(n || 0).toLocaleString("ru-RU").replace(/,/g, " ")} ${cur === "UZS" ? "so'm" : cur}`;

// Driving directions outside the lot: hand over to the driver's own navigation app (no API key).
export const navLinks = (loc) => ({
  google: `https://www.google.com/maps/dir/?api=1&destination=${loc.lat},${loc.lng}&travelmode=driving`,
  yandex: `https://yandex.uz/maps/?rtext=~${loc.lat},${loc.lng}&rtt=auto`,
});

export function distanceKm(a, b) {
  if (!a || !b) return null;
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function ago(iso) {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)} h ago`;
}
