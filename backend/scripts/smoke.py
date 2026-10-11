"""Smoke test of a deployed ParkDet site (run by .github/workflows/smoke.yml, or by hand):

    python3 backend/scripts/smoke.py https://parkspot-5bo4.onrender.com

Checks the pages, photo-analysis timing, and the whole real-lot flow without any stored photo:
it restores a private (never published) test lot with a known PIN, checks that nothing is offered
before the camera has sent a picture, sends one camera frame, then checks privacy (PIN needed),
booking, sandbox payment, in-lot directions, cancellation and a walk-in visit (first hour paid
automatically, chosen spot held, nothing more to pay when leaving within the hour). Standard library only.
"""
import hashlib
import json
import secrets
import struct
import sys
import time
import urllib.error
import urllib.request
import uuid
import zlib
from datetime import datetime, timezone

BASE = sys.argv[1].rstrip("/")


def png(w, h):
    """Grey asphalt with white lane lines and no cars, as a PNG (so every spot reads free)."""
    lane_every, line_every = h // 6, w // 8
    plain = bytes(v for x in range(w) for v in ((235,) * 3 if x % line_every < 3 else (96,) * 3))
    lane = bytes((235,) * 3 * w)
    raw = b"".join(b"\x00" + (lane if y % lane_every < 3 else plain) for y in range(h))

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 6)) + chunk(b"IEND", b""))


def form(fields, files):
    """multipart/form-data body: fields {name: value}, files {name: (filename, bytes, type)}."""
    b = uuid.uuid4().hex
    out = bytearray()
    for k, v in fields.items():
        out += f'--{b}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode()
    for k, (name, data, ctype) in files.items():
        out += (f'--{b}\r\nContent-Disposition: form-data; name="{k}"; filename="{name}"\r\n'
                f"Content-Type: {ctype}\r\n\r\n").encode() + data + b"\r\n"
    out += f"--{b}--\r\n".encode()
    return bytes(out), f"multipart/form-data; boundary={b}"


def req(method, path, body=None, headers=None, expect=200):
    data, h = None, dict(headers or {})
    if isinstance(body, dict):
        data, h["content-type"] = json.dumps(body).encode(), "application/json"
    elif isinstance(body, tuple):
        data, h["content-type"] = body
    t0 = time.time()
    try:
        with urllib.request.urlopen(urllib.request.Request(BASE + path, data=data, method=method, headers=h),
                                    timeout=180) as r:
            code, raw = r.status, r.read()
    except urllib.error.HTTPError as e:
        code, raw = e.code, e.read()
    if code != expect:
        sys.exit(f"FAIL {method} {path}: HTTP {code}, wanted {expect}: {raw[:300]!r}")
    return (json.loads(raw) if raw[:1] in (b"{", b"[") else raw), time.time() - t0


def check(cond, msg):
    if not cond:
        sys.exit("FAIL " + msg)
    print("ok  ", msg)


health, _ = req("GET", "/api/health")
print("health", health)
home, _ = req("GET", "/")
check(b"<title>ParkDet</title>" in home, "home page")
spa, _ = req("GET", "/operator")
check(b"<title>ParkDet</title>" in spa, "app route /operator")
published, _ = req("GET", "/api/lots")
print("lots on the drivers' map:", [(x["name"], x["counts"], x["camera_online"]) for x in published])

small, big = png(640, 360), png(4000, 2250)
a, dt = req("POST", "/api/analyze", form({}, {"image": ("s.png", small, "image/png")}))
print(f"analyze 640x360: {a['timing']['total_ms']:.0f} ms on the server, {dt:.1f} s wall, {a['summary']}")
a, dt = req("POST", "/api/analyze", form({}, {"image": ("b.png", big, "image/png")}))
print(f"analyze 4000x2250: {a['timing']['total_ms']:.0f} ms on the server, {dt:.1f} s wall incl. upload")

# a private test lot (never published), restored from a config with a PIN we know
pin, salt = f"{secrets.randbelow(10**6):06d}", secrets.token_hex(8)
lot_id = "lot_smoke_" + secrets.token_hex(4)


def rect(x1, y1, x2, y2):
    return [[x1, y1], [x2, y1], [x2, y2], [x1, y2]]


spots = [{"id": f"{r}{i + 1}", "row": r, "polygon": rect(40 + 70 * i, y, 100 + 70 * i, y + 100), "source": "smoke"}
         for r, y in (("A", 60), ("B", 200)) for i in range(8)]
cfg = {"id": lot_id, "kind": "real", "name": "Smoke test (private)", "address": "", "price_per_hour": 5000,
       "currency": "UZS", "location": None, "published": False, "confirmed": True,
       "pin_hash": f"{salt}:{hashlib.sha256((salt + pin).encode()).hexdigest()}",
       "camera": {"type": "push", "label": "smoke test", "width": 640, "height": 360},
       "aisles": [{"id": "a1", "name": "Aisle 1", "start": [10, 180], "end": [630, 180], "rows": ["A", "B"]}],
       "spots": spots}
wrong = "111111" if pin != "111111" else "222222"
req("POST", "/api/lots/import", {**cfg, "id": lot_id + "x"}, {"X-Lot-Pin": wrong}, expect=403)
check(True, "restore with a wrong PIN refused")
r, _ = req("POST", "/api/lots/import", cfg, {"X-Lot-Pin": pin})
check(r.get("restored"), "test lot restored with its PIN")

st, _ = req("GET", f"/api/lots/{lot_id}/state")
check(set(st["statuses"].values()) == {"unknown"} and not st["camera"]["online"],
      "before the first camera picture every spot is 'unknown', never 'free'")
now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
req("POST", f"/api/lots/{lot_id}/bookings", {"spot_id": "A1", "arrive_at": now, "duration_min": 60}, expect=409)
check(True, "booking refused while the camera has sent nothing")
for p in ("frame.jpg", "raw.jpg", "events", "export"):
    req("GET", f"/api/lots/{lot_id}/{p}", expect=403)
check(True, "camera image, raw image, events and export need the PIN")

f, dt = req("POST", f"/api/lots/{lot_id}/frame", form({"live": "true"}, {"image": ("f.png", small, "image/png")}),
            {"X-Lot-Pin": pin})
print(f"camera frame: {f['summary']}, {f['timing']['total_ms']:.0f} ms on the server, {dt:.1f} s wall")
st, _ = req("GET", f"/api/lots/{lot_id}/state")
check(st["camera"]["online"] and st["counts"]["free"] == len(spots), "camera online, empty lot reads all free")
published, _ = req("GET", "/api/lots")
check(all(x["id"] != lot_id for x in published), "unpublished lot is not on the drivers' map")

n, _ = req("GET", f"/api/lots/{lot_id}/nearest")
check(n["spot_id"] in {s["id"] for s in spots} and n["directions"], f"find me a spot: {n['spot_id']}")
b, _ = req("POST", f"/api/lots/{lot_id}/bookings", {"spot_id": "B5", "arrive_at": now, "duration_min": 60})
check(b["hold"]["kind"] == "pay", "new booking carries its pay-by time")
check(b["amount"] == 5000, "1 hour costs 5 000 so'm")
b2, _ = req("POST", f"/api/lots/{lot_id}/bookings", {"spot_id": "B6", "arrive_at": now, "duration_min": 150})
check(b2["amount"] == 5000 + 2 * 2000, "2.5 hours cost 5 000 + 2 x 2 000 so'm")
req("POST", f"/api/bookings/{b2['id']}/cancel")
p, _ = req("POST", f"/api/bookings/{b['id']}/pay")
check(p["status"] == "confirmed" and p["hold"]["kind"] == "arrive", f"booked and paid (sandbox): {p['directions']['short']}")
st, _ = req("GET", f"/api/lots/{lot_id}/state")
check(st["statuses"]["B5"] == "reserved", "the booked spot shows as reserved")
c, _ = req("POST", f"/api/bookings/{b['id']}/cancel")
check(c["status"] == "cancelled", "booking cancelled (cleanup)")
# walk-in: scan the gate QR -> the first hour is paid automatically (sandbox) -> optionally choose a spot
w, _ = req("POST", f"/api/lots/{lot_id}/sessions")
check(w["status"] == "active" and w["paid_amount"] == 5000 and w["card_last4"] == "4242" and not w["spot_id"],
      "walk-in: first hour (5 000 so'm) paid automatically on entry (sandbox test card)")
w, _ = req("POST", f"/api/sessions/{w['id']}/spot", {"spot_id": "A3"})
check(w["spot_id"] == "A3" and w["hold_until"] and w["directions"], "walk-in: the chosen spot is held, with directions")
st, _ = req("GET", f"/api/lots/{lot_id}/state")
check(st["statuses"]["A3"] == "reserved", "walk-in: the chosen spot shows as reserved")
req("POST", f"/api/sessions/{w['id']}/parked", {"spot_id": "A4"}, expect=409)
check(True, "walk-in: a spot with no car in it cannot be marked as 'I parked here'")
x, _ = req("POST", f"/api/sessions/{w['id']}/exit")
check(x["status"] == "exited" and x["amount_due"] == 0 and x["paid_amount"] == 5000,
      "walk-in: leaving within the first hour charges nothing more")
img, _ = req("GET", f"/api/lots/{lot_id}/frame.jpg?pin={pin}")
check(img[:2] == b"\xff\xd8", "operator gets the pixelated camera image with the PIN")
print("ALL CHECKS PASSED")
