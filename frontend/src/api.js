async function call(method, url, body, isForm) {
  const opts = { method, headers: {} };
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

export const api = {
  lots: () => call("GET", "/api/lots"),
  lot: (id) => call("GET", `/api/lots/${id}`),
  state: (id) => call("GET", `/api/lots/${id}/state`),
  events: (id) => call("GET", `/api/lots/${id}/events`),
  directions: (id, spot) => call("GET", `/api/lots/${id}/directions/${spot}`),
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
  pushFrame: (id, file, live = true) => {
    const f = new FormData();
    f.append("image", file);
    f.append("live", live ? "true" : "false");
    return call("POST", `/api/lots/${id}/frame`, f, true);
  },
  metrics: () => call("GET", "/api/metrics"),
};

export const money = (n, cur = "UZS") =>
  `${Number(n || 0).toLocaleString("ru-RU").replace(/,/g, " ")} ${cur === "UZS" ? "so'm" : cur}`;
