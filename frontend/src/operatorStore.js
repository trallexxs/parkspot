// What an operator's device remembers per lot: the PIN, and a copy of the lot's config so the lot
// can be restored if the free server restarts and forgets it. Nothing here is sent anywhere else.
const PINS = "parkspot.pins";
const CFG = "parkspot.lotcfg.";

const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } };

export const operatorStore = {
  pin: (id) => read(PINS, {})[id]?.pin || "",
  setPin: (id, pin, name) => write(PINS, { ...read(PINS, {}), [id]: { pin, name: name || read(PINS, {})[id]?.name || id } }),
  forget: (id) => { const all = read(PINS, {}); delete all[id]; write(PINS, all); },
  managed: () => Object.entries(read(PINS, {})).map(([id, v]) => ({ id, name: v.name })),
  saveCfg: (id, cfg) => write(CFG + id, cfg),
  cfg: (id) => read(CFG + id, null),
};
