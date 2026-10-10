---
title: ParkSpot
sdk: docker
app_port: 7860
---

# ParkSpot — camera-based smart parking (working name)

Track: Computer Vision · Mode: **Startup** *(to be confirmed by the team)*

Parking lots already have CCTV. ParkSpot turns those camera frames into a live map of free spots,
lets drivers **book a spot ahead** or **just drive in via a QR code and pay before leaving**, and
guides them to the spot ("B5: straight 23 m, then right") — on the phone and on a big entrance screen.

**What is ours (not a call to someone else's model):**

1. **Zero-config spot discovery** (`backend/app/cv/layout.py`). No one draws spot polygons by hand:
   rows of parked cars are found with sequential RANSAC, the spot pitch is estimated in units of
   car width (robust to perspective), and empty spots are inferred from gaps between cars. Cars
   driving in the aisle are rejected. On video, only vehicles that stay put are used.
   → works on a camera we have never seen, and on the jury's own photo.
2. **View-agnostic detector ensemble** (`detector.py`): an aerial-view YOLO and a ground-view COCO
   YOLO run together and are merged with NMS; large frames are also tiled for distant cars.
3. **Quality gate** (`quality.py`): night / low light / blur / glare / low contrast are measured on
   every frame; dark frames are enhanced (CLAHE + gamma) before detection and warnings are reported.
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
| `/` | driver | lots with live free counts |
| `/lot/:id` | driver | live spot map, book a spot (sandbox pay), directions |
| `/booking/:id` | driver | ticket with QR, check-in at the gate, live status |
| `/enter/:id` | driver | walk-in: QR at the gate → suggested spot → pay before exit |
| `/display/:id` | entrance screen | free count, nearest spot with big arrows, QR to enter |
| `/camera` | operator | **turn any phone into the lot camera**: create a lot from the live view (auto spot discovery), then stream a frame every 3 s |
| `/operator/:id` | operator | annotated live camera, counts, event log (spot taken → booking moved, etc.) |
| `/vision` | anyone / jury | upload any lot photo → vehicles, discovered spots, occupancy, timing |

## Architecture

```
camera frame ─► quality gate ─► (enhance) ─► YOLO aerial ┐
                                            YOLO ground  ┴► NMS ─► vehicles
                                                                     │
                     auto-layout (onboarding / jury photo) ◄─────────┤
                     calibrated lot spots ─► spot occupancy ◄────────┘
                                               │  EMA + hysteresis
                                               ▼
        bookings / walk-in sessions (SQLite) ─► spot status: free / occupied / reserved / conflict
                                               │
                     REST API (FastAPI) ─► React app: map, booking, ticket QR, walk-in, entrance screen, Vision
```

Inference runs **on a server CPU** (no GPU needed); cameras (an IP camera, or simply a phone on a
tripod via `/camera`) only send JPEG frames. Server memory with both models loaded: ~680 MB. One server handles many cameras because a
parking spot changes state on a scale of minutes: one frame every few seconds per camera is enough.

## Measured speed (prototype hardware)

4-core Intel Xeon @ 2.1 GHz, CPU only, PyTorch, 20 runs on a 640×360 frame:

| stage | mean | p95 |
|---|---|---|
| detection (2 models) | 78 ms | 88 ms |
| layout + occupancy | 21 ms | 24 ms |
| total | 102 ms | 115 ms |

1920×1080 frame with tiling: 812 ms mean (5 runs).

## Quality

**Not measured yet on a proper test set.** Planned: our own labelled photos/videos of Tashkent lots
(day / night / rain), per-spot accuracy, precision/recall of free spots, and auto-layout spot recall
vs hand-drawn spots. Numbers will be added to `eval/results/metrics.json` and shown in the app
only after they are measured. Sanity check so far (one demo frame, checked by eye): 3 rows found,
the 3 visible empty spots inferred, the 2 moving vehicles ignored.

## Known failure cases (current prototype)

- Views where cars do not form clear rows (very oblique cameras, chaotic informal parking).
- Rows with fewer than 3 visible cars are not discovered automatically.
- Empty spots at the very ends of a row are not inferred (no neighbour to measure the gap).
- Heavy occlusion by trees or poles; night without lighting (not yet measured).
- Directions are computed only for aisles that the operator marked (one line per aisle in the lot JSON).

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

Or as one container: `docker build -t parkspot . && docker run -p 7860:7860 parkspot`.

Onboard a new camera from footage:
`cd backend && python -m scripts.onboard_lot --source path/to/video.mp4 --id mylot --name "My lot"`

## Deployment

Every push to `main` is deployed to a Hugging Face Docker Space by
`.github/workflows/deploy.yml` (deployment history recorded in GitHub Actions).

## Payments

**Sandbox only.** No real money moves; the UI labels every payment step as test mode. A production
version would integrate a local provider (Payme / Click / Uzum) — out of scope for the prototype.

## Business-rule assumptions (configurable in `backend/app/config.py`)

Price 5 000 so'm per started hour (demo value) · booked spot held from 30 min before arrival until
15 min after · unpaid booking holds the spot 10 min · suggested walk-in spot held 5 min.

## Data sources, models and licences

| item | source | licence / note |
|---|---|---|
| `data/demo/parking_demo.mp4` | Ultralytics CI asset `solution_ci_parking_demo.mp4` (github.com/ultralytics/assets) | AGPL-3.0 (Ultralytics). Used only as a stand-in camera feed. |
| `data/demo/ultralytics_spots_reference.json` | Ultralytics CI asset `solution_ci_parking_areas.json` | AGPL-3.0. Hand-drawn spots, used only as a reference to evaluate auto-layout. |
| `backend/weights/aerial_vehicles.pt` | Ultralytics CI asset `solutions_ci_parking_model.pt` | AGPL-3.0. Class list matches VisDrone (pedestrian … motor); if trained on VisDrone, that dataset is for non-commercial research — **must be replaced by our own fine-tuned model before any commercial use**. |
| `backend/weights/yolo11n.pt` | Ultralytics YOLO11n (COCO), taken from our elimination-stage repo github.com/trallexxs/trafficcv | AGPL-3.0 |
| Ultralytics, FastAPI, OpenCV, React, Vite, react-router, qrcode | public libraries | AGPL-3.0 / MIT / Apache-2.0 / MIT / MIT / MIT / MIT |

Reused from our elimination stage (declared): YOLO11n weights file only.
