// Per-device list of the driver's tickets (no accounts in the prototype).
const KEY = "parkspot.tickets";

export function getTickets() {
  try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; }
}

export function addTicket(t) {
  try {
    const all = getTickets().filter((x) => x.id !== t.id);
    localStorage.setItem(KEY, JSON.stringify([t, ...all].slice(0, 30)));
  } catch { /* storage unavailable */ }
}
