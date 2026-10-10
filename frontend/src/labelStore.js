// Test-set labels live in this browser (IndexedDB) until exported: the free server's disk is wiped
// on every restart, so nothing the team labels depends on it.
const DB = "parkspot-label";
const STORE = "items";

function open() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: "id" });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(STORE, mode);
    const out = fn(t.objectStore(STORE));
    t.oncomplete = () => res(out && "result" in out ? out.result : undefined);
    t.onerror = () => rej(t.error);
  });
}

export const labelStore = {
  put: (item) => tx("readwrite", (s) => s.put(item)),
  all: () => tx("readonly", (s) => s.getAll()),
  remove: (id) => tx("readwrite", (s) => s.delete(id)),
  clear: () => tx("readwrite", (s) => s.clear()),
};
