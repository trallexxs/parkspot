# ParkDet — camera-based smart parking

**ParkDet** = **Park**ing **Det**ector: free parking spots, seen live.

**Live site:** https://parkspot-5bo4.onrender.com (free tier: open it a minute before use, it sleeps when idle) · `GET /api/health` shows the running commit

Track: Computer Vision · Mode: **Startup**

Parking lots already have cameras, or can get one: a phone mounted above the lot. ParkDet turns
those camera frames into a live map of free spots,
lets drivers **book a spot ahead** or **just drive in via a QR code and pay before leaving**, and
guides them to the spot ("B5: straight 23 m, then right") — on the phone and on a big entrance screen.

**What is ours (not a call to someone else's model):**

1. **Zero-config spot discovery** (`backend/app/cv/layout.py`). No one draws spot polygons by hand:
   rows of parked cars are found with sequential RANSAC, the spot pitch is estimated in units of
   car width (robust to perspective), and empty spots are inferred from gaps between cars. Cars
   driving in the aisle are rejected.
   → works on a camera we have never seen, and on the jury's own photo.
2. **View-agnostic detector ensemble** (`detector.py`): a top-down YOLO (camera looking down on the
   lot) and a street-level COCO YOLO run together and are merged with NMS; large frames are also
   tiled for distant cars.
3. **Quality gate** (`quality.py`): night / low light / blur / glare / low contrast are measured on
   every frame; dark frames get a second, contrast-stretched view, the detections of both views
   are merged, and warnings are reported.
4. **Temporal smoothing** for live feeds (EMA + hysteresis) so one missed detection does not free a spot.
5. **Camera ↔ booking enforcement** (`lots.py`): a booked spot is held from 30 min before arrival.
   If the camera sees another car take it, the booking is moved to the nearest free spot
   automatically; after check-in, the camera confirms the driver actually parked. No licence plates
   are read or stored.
6. **Directions from camera geometry** (`guidance.py`): distance along the aisle and left/right side
   come from the spot positions in the image; pixels → metres via the measured spot pitch.

## Pages

| URL | who | what |
|---|---|---|
| `/` | driver | **map** (OpenStreetMap) of real, published lots with live free counts from each lot's camera; distance from the driver; *Navigate* opens Google Maps or Yandex to the lot entrance |
| `/lot/:id` | driver | spot map, booking (sandbox pay), in-lot directions ("B5: straight 25 m, then right"); booking pauses if the camera is offline |
| `/booking/:id` | driver | ticket with QR, check-in at the gate, live status |
| `/enter/:id` | driver | walk-in: QR at the gate → suggested spot → pay before exit |
| `/display/:id` | entrance screen | free count, nearest spot with big arrows, QR to enter |
| `/operator` | operator | set up a new lot with a camera phone, or open a lot this device manages |
| `/camera`, `/camera/:id` | operator | **the phone at the lot**: creates the lot (spots found automatically, PIN shown once), then sends a picture every 3–10 s |
| `/operator/:id/setup` | operator | one-time check: delete wrong spots, draw missed ones, draw the aisle (entrance first), place the entrance on the map (GPS or drag), publish |
| `/operator/:id` | operator (PIN) | pixelated camera with spot overlay, counts, events, gate QR to print, backup |
| `/vision` | anyone / jury | any lot photo → vehicles, discovered spots, occupancy, timing |
| `/label`, `/quality` | team | build the test set from our own photos; measured quality |

## Real lots: what is real, and how a lot goes live

1. A phone is mounted above the lot (window or pole, charging) and opens `/camera`. Its first
   picture is analysed: rows and spots are discovered automatically. The operator gets a PIN.
2. The operator checks the spots once (`/operator/:id/setup`): removes anything that is not a
   parking spot, draws missed ones, draws the driving aisle from the entrance, places the entrance
   on the map with the phone's GPS, and publishes. Only then does the lot appear on the drivers' map.
3. From then on every status a driver sees comes from that camera: occupied/free from the latest
   picture (smoothed over pictures), booked only from real bookings made in the app.
   **No camera picture yet, or none for 2 minutes → the lot shows "camera offline", spots show
   "no data", and booking pauses.** Nothing is guessed.
4. Privacy: camera pictures are processed in memory and never written to disk; the operator sees
   them pixelated (plates and faces unreadable); drivers never see camera images. The camera
   image, events, frames and setup need the lot's PIN.
5. Free hosting forgets runtime data on restart. The camera phone keeps a copy of its lot's setup
   and restores it automatically (`/api/lots/import`, PIN-checked); bookings made before a restart
   are lost (a pilot would use a managed database).

Occupancy is deliberately cautious: a spot is "occupied" if any sign of a car touches it (box
covers 30% of the spot, the car's centre or its ground point — the bottom of its box, which matters
for cameras that see cars at an angle — lies in the spot). A hidden free spot costs a driver a few
metres; a "free" spot that is taken sends them to the wrong place.

## Architecture

```
camera frame ─► quality gate ─► (2nd view) ─► YOLO top-down ┐
                                             YOLO street   ┴► NMS ─► vehicles
                                                                     │
                     auto-layout (onboarding / jury photo) ◄─────────┤
                     calibrated lot spots ─► spot occupancy ◄────────┘
                                               │  EMA + hysteresis
                                               ▼
        bookings / walk-in sessions (SQLite) ─► spot status: free / occupied / reserved / conflict
                                               │
                     REST API (FastAPI) ─► React app: map, booking, ticket QR, walk-in, entrance screen, Vision
```

Inference runs **on a server CPU** (no GPU needed); cameras (a phone mounted at the lot via
`/camera`, or an IP camera) only send JPEG frames. One server handles many cameras because a
parking spot changes state on a scale of minutes: one frame every few seconds per camera is enough.

## Measured speed

Run time: **onnxruntime on CPU, no PyTorch**. Measured with synthetic frames without cars, so the
cascade never skips the second detector (worst case); speed hardly depends on what is in the frame.

| machine | 1280×720 camera frame | notes |
|---|---|---|
| 4-core Intel Xeon 2.1 GHz, 2 threads | 141 ms mean, 159 ms p95 (20 runs) | 640×360: 139 ms; both detectors every frame |
| Render free web service (0.1 vCPU), the live site | ~2.7 s (640×360 frame; `smoke` run on commit 89c3633) | a photo: ~3 s; so the camera phone sends one picture every 5–10 s there |

The camera page sends at most 1280 px, so camera frames are never tiled. A large photo
(4000×2250) in which the first pass finds no car is searched in tiles: ~2.5 s on the 4-core machine,
but 43 s on the free server. So when the tiles would take longer than 8 s (`TILE_BUDGET_S`), the
tiled search is skipped and the result warns that distant cars may be missed.
When the top-down model alone already finds 8+ confident vehicles, the street-level model is
skipped (`CASCADE=0` turns this off). Server memory: under 300 MB peak in the smoke test with a
4000×2250 upload, under 400 MB in all our tests. The ONNX models give the same vehicles as the
PyTorch weights (`scripts/export_onnx.py` converts them).

Capacity: one picture every 3 s per camera ÷ ~0.15 s per picture → about 20 cameras per 2-thread
worker at full load; we plan for 8 (40% load).

## Quality

Test set = our own photos, labelled in `/label` (the model proposes spots, a person checks every
one; corrections are counted), exported to `eval/testset/`. Run
`cd backend && python ../eval/evaluate.py --robustness` (adds synthetic night / rain / fog / blur,
method declared in the script). Results appear on `/quality`.

**No accuracy numbers yet:** the earlier development set came from a recorded public clip that we
removed from the project; numbers will come from our own Tashkent photos.

## Known failure cases (current prototype)

- Views where cars do not form clear rows (very oblique cameras, chaotic informal parking).
- Very distant cars (about 10 px wide in the analysed image) are partly missed even with tiling;
  on the free demo server the tiled search is skipped (time budget) and the result says so.
- Rows with fewer than 3 visible cars are not discovered automatically — the operator draws them
  once in the spot check.
- Empty spots at the very ends of a row are not inferred (no neighbour to measure the gap).
- Night: dark cars can be missed, so an occupied spot can look free; not yet measured on real
  night photos.
- Heavy occlusion by trees or poles (not yet measured).
- The detector cascade (skip the street-level model when the top-down one is confident) is not yet
  measured on our own photos.
- Directions are computed only for aisles that the operator drew.

## Run locally

```bash
# backend (Python 3.11+)
cd backend
pip install -r requirements.txt
uvicorn app.main:app --port 8000

# frontend (Node 20+), in another terminal
cd frontend
npm install
npm run dev          # http://localhost:5173 (proxies /api to :8000)
```

Or as one container: `docker build -t parkdet . && docker run -p 10000:10000 parkdet`.

Smoke test of a running site: `python3 backend/scripts/smoke.py http://localhost:8000` (also run by
GitHub Actions → smoke against the live site).

## Deployment

Hosted on **Render** (free web service, Docker) straight from this repository: `render.yaml`
describes the service and every push to `main` redeploys it (history in the Render dashboard).
Free-tier notes: the service sleeps after 15 min without traffic (first request takes ~1 min),
the CPU is small (expect a few seconds per photo), and the SQLite file is reset on every restart —
fine for a demo, a pilot would use managed Postgres.

Defence deck: `docs/ParkDet-defence.pptx` (editable in PowerPoint, Google Slides or Canva);
plan and timing: `docs/pitch-plan.md`.

## Payments

**Sandbox only.** No real money moves; the UI labels every payment step as test mode. A production
version would integrate a local provider (Payme / Click / Uzum) — out of scope for the prototype.

## Business-rule assumptions (configurable in `backend/app/config.py`)

Price 5 000 so'm per started hour (demo value) · booked spot held from 30 min before arrival until
15 min after · unpaid booking holds the spot 10 min · suggested walk-in spot held 5 min.

## Data sources, models and licences

| item | source | licence / note |
|---|---|---|
| `backend/weights/aerial_vehicles.pt` / `.onnx` (top-down detector) | Ultralytics CI asset `solutions_ci_parking_model.pt` (github.com/ultralytics/assets) | AGPL-3.0. Its class list matches the VisDrone dataset (pedestrian … motor); if trained on it, that dataset is for non-commercial research — **must be replaced by our own fine-tuned model before any commercial use**. |
| `backend/weights/yolo11n.pt` / `.onnx` | Ultralytics YOLO11n (COCO), taken from our elimination-stage repo github.com/trallexxs/trafficcv | AGPL-3.0 |
| Leaflet (map, BSD-2-Clause); map tiles © OpenStreetMap contributors (ODbL), attribution shown on the map | public library / data | |
| onnxruntime, FastAPI, OpenCV, NumPy, React, Vite, react-router, qrcode (run time); Ultralytics (export only) | public libraries | MIT / MIT / Apache-2.0 / BSD / MIT / MIT / MIT / MIT; AGPL-3.0 |

Reused from our elimination stage (declared): YOLO11n weights file only.
