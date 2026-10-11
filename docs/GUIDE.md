# ParkDet code guide (plain English)

This guide is for the team. It shows where everything is in the code, so you can answer "where is X / how does Y work" straight away.
Every path is a link to the file. Technical words are explained in the [Glossary](#6-glossary) at the end.
Numbers are copied from the code or from the [README](../README.md); nothing here is estimated.

Tip: open a file on GitHub, press Ctrl+F (Cmd+F on a Mac) and search for a name such as `price(`.

## 1. What ParkDet is

ParkDet (**Park**ing **Det**ector, "Free parking spots, seen live") turns one phone camera above a parking lot into a live map of free spots.
The server finds the cars in each picture with two open-source vehicle detectors, and our own code finds the parking spots and decides which are free.
Drivers see this on a map and can book a spot (test payment, no real money) or drive in by scanning the QR code at the gate and pay before leaving; an entrance screen shows the free count, and operators set up a lot with a phone and a PIN.

Live site: <https://parkspot-5bo4.onrender.com>. It runs on free hosting, so open it a minute early (it sleeps when nobody uses it). The address `/api/health` shows which commit is running.

## 2. How it works, start to finish

```
phone camera ─► server ─► picture check ─► 2 vehicle detectors ─► spots + free/taken ─► + bookings
                                                                                          │
        driver app (map, booking, walk-in)  ·  entrance screen  ·  operator view  ◄───────┘
```

1. **A phone at the lot sends pictures.** The operator mounts a phone above the lot (window or pole, charging) and opens `/camera`. The first picture creates the lot (it needs at least 3 parked cars in a row) and a 6-digit PIN, shown once. After that the phone sends one picture every 3, 5 or 10 seconds. → [frontend/src/pages/Camera.jsx](../frontend/src/pages/Camera.jsx)
2. **The server receives each picture.** [backend/app/main.py](../backend/app/main.py) checks the PIN and gives the picture to the lot in [backend/app/lots.py](../backend/app/lots.py), which runs the analysis in [backend/app/cv/pipeline.py](../backend/app/cv/pipeline.py). Pictures stay in memory and are never saved to disk.
3. **Picture check, then car detection.** [cv/quality.py](../backend/app/cv/quality.py) measures light, blur, glare and contrast; a dark picture also gets a brightened copy. [cv/detector.py](../backend/app/cv/detector.py) runs two pretrained YOLO11 detectors (files in [backend/weights/](../backend/weights/)) on the server's CPU and merges their boxes into one list of vehicles.
4. **Spots, and free or taken.** When a lot is created, [cv/layout.py](../backend/app/cv/layout.py) finds the rows of parked cars and the spots, including empty spots in the gaps. After that the lot's saved spots are used (the operator checks them once). [cv/occupancy.py](../backend/app/cv/occupancy.py) decides for each spot whether a car is in it and smooths this over several pictures. Then `state()` in [lots.py](../backend/app/lots.py) adds bookings and walk-in holds, so every spot gets a status: free, occupied (taken), reserved, conflict (booked, but another car is there) or unknown (no data).
5. **The driver app.** The website in [frontend/](../frontend/) asks the server for fresh data every few seconds ("polling", [usePoll.js](../frontend/src/usePoll.js)). [Home.jsx](../frontend/src/pages/Home.jsx) shows the published lots on a map with live free counts. [Lot.jsx](../frontend/src/pages/Lot.jsx) shows the spot map, "Find me a spot" and in-lot directions (made by [guidance.py](../backend/app/guidance.py)). Spot colours ([SpotMap.jsx](../frontend/src/components/SpotMap.jsx)): **green** = free, **yellow** = reserved (booked in advance, or held for a few minutes for a driver who just drove in), **red** = taken (a car is parked there), **grey** = no data (the camera has sent no picture for 2 minutes, or none since the server started: nothing is guessed), **blue** = the spot you selected.
6. **Booking, walk-in, test payment.** Booking: choose a free spot, arrival time and hours, pay (test), then get a ticket with a QR code, a check-in button and a countdown ([Booking.jsx](../frontend/src/pages/Booking.jsx)). Walk-in: scan the QR code at the gate, enter, get a suggested spot, pay before leaving ([Enter.jsx](../frontend/src/pages/Enter.jsx)). The rules are in [main.py](../backend/app/main.py) and [lots.py](../backend/app/lots.py), prices and hold times in [config.py](../backend/app/config.py), and the records in a small database ([store.py](../backend/app/store.py)). No real money moves.
7. **The entrance screen.** [Display.jsx](../frontend/src/pages/Display.jsx) shows the free count (or FULL), the nearest free spot with big arrows, and the QR code to enter. It refreshes every 2 seconds.
8. **Operator tools.** [OperatorHome.jsx](../frontend/src/pages/OperatorHome.jsx) is the start page. [Setup.jsx](../frontend/src/pages/Setup.jsx) is the one-time check: delete wrong spots, draw missed ones, draw the driving aisle, place the entrance on the map, publish. [Operator.jsx](../frontend/src/pages/Operator.jsx) shows the pixelated camera picture with the spots, live counts, the event log, the gate QR code to print and a backup button. Setup and Operator need the lot's PIN ([PinGate.jsx](../frontend/src/components/PinGate.jsx)).

## 3. The folders, one by one

All 71 files stored in git (plus this guide), folder by folder. Things made by installing, building or running the app (`node_modules`, `frontend/dist`, `backend/lots/user`, the database file) are not stored in git.

### Top level — project description and hosting set-up

| File | What it does and why it exists |
|---|---|
| [README.md](../README.md) | The technical reference: what is ours, pages, how a lot goes live, privacy, measured speed, known failure cases, how to run, prices, licences. |
| [Dockerfile](../Dockerfile) | Recipe for one container. It builds the website with Node 22, installs the Python 3.11 server, copies both in, and starts the server. Render uses it for the live site. |
| [render.yaml](../render.yaml) | Tells Render how to run the service: Docker, free plan, health check at `/api/health`, redeploy on every push, `ORT_THREADS=1` (one CPU thread for the detectors). |
| [.dockerignore](../.dockerignore) | Files kept out of the container: installed packages, the built website, temporary files, the `.pt` weight files, database files, saved lots and the git history. Keeps it small. |
| [.gitignore](../.gitignore) | Files git does not store: installed packages, the built website, Python's temporary files and local install folders, database files, lots saved at run time. |

### [.github/workflows/](../.github/workflows/) — jobs that GitHub runs for us

| File | What it does and why it exists |
|---|---|
| [smoke.yml](../.github/workflows/smoke.yml) | The "smoke" job, started by hand (Actions → smoke → Run workflow). It waits up to about 15 minutes until the live site runs the commit being tested, then runs `smoke.py` against it. |

### [backend/](../backend/) — the server (Python)

| File | What it does and why it exists |
|---|---|
| [requirements.txt](../backend/requirements.txt) | The Python libraries the server needs: FastAPI, Uvicorn, python-multipart (for file uploads), onnxruntime, OpenCV, NumPy. No PyTorch. |

### [backend/app/](../backend/app/) — the server's main code

| File | What it does and why it exists |
|---|---|
| [main.py](../backend/app/main.py) | All web addresses of the server (the API): lots, camera pictures, the Vision analysis, bookings, walk-in visits, test payments, metrics, health. It checks the PIN where needed (`require_operator`) and also serves the built website. |
| [lots.py](../backend/app/lots.py) | Everything about a lot: creating it from the first picture, the PIN, saving and restoring its setup, the operator's corrections, merging camera results with bookings (`state()`), moving a booking when its spot is taken, the nearest free spot (`nearest_free()`), pixelation, and the price rule (`price()`). |
| [config.py](../backend/app/config.py) | Every adjustable number in one place: detector settings, picture-quality limits, the free/taken rule, camera-offline time, pixelation size, prices and hold times. |
| [store.py](../backend/app/store.py) | The small SQLite database with three tables: bookings, walk-in visits ("sessions") and the event log. |
| [guidance.py](../backend/app/guidance.py) | In-lot directions ("B5: straight about 25 m, then right") from the aisle the operator drew and the spot positions in the picture. Also builds the left/right spot layout that the app draws. |
| [`__init__.py`](../backend/app/__init__.py) | Empty file. It marks the folder as a Python package so the files can use each other. |

### [backend/app/cv/](../backend/app/cv/) — computer vision: the picture analysis

| File | What it does and why it exists |
|---|---|
| [pipeline.py](../backend/app/cv/pipeline.py) | Runs the steps for one picture in order: shrink to at most 1920 px, quality check, detection, spots, free/taken, timings. Also draws the coloured spots on the picture (operator view, Vision page). |
| [quality.py](../backend/app/cv/quality.py) | Measures brightness, blur, glare and contrast; calls the picture day, low light or night; makes a contrast-stretched copy of dark or low-contrast pictures; writes warnings. |
| [detector.py](../backend/app/cv/detector.py) | Loads and runs the two YOLO11 detectors with onnxruntime on the CPU and merges overlapping boxes (NMS). Skips the second model when the first already found 8+ vehicles with a median confidence of at least 0.6. Very large photos may also be searched in tiles for distant cars, unless that would take over 8 seconds. |
| [layout.py](../backend/app/cv/layout.py) | Our automatic spot discovery: finds rows of 3 or more parked cars (sequential RANSAC), measures the spot spacing in car widths, adds empty spots in the gaps, ignores cars driving in the aisle, names spots A1, A2, B1… |
| [occupancy.py](../backend/app/cv/occupancy.py) | Our free/taken rule for each spot (`spot_scores`), plus smoothing over pictures (`SpotSmoother`, EMA + hysteresis) so one missed detection does not free a spot. |
| [`__init__.py`](../backend/app/cv/__init__.py) | Empty file that marks the folder as a Python package. |

### [backend/scripts/](../backend/scripts/) — helper programs, not part of the running server

| File | What it does and why it exists |
|---|---|
| [smoke.py](../backend/scripts/smoke.py) | Checks a running site from start to finish: pages, photo-analysis time, and the whole real-lot flow on a private test lot (PIN, privacy, no data before the first picture, booking, prices, test payment, directions, cancel). Uses only Python's built-in tools. |
| [export_onnx.py](../backend/scripts/export_onnx.py) | One-time developer tool: converts the `.pt` weight files into `.onnx` files with Ultralytics. The live server does not use it. |
| [`__init__.py`](../backend/scripts/__init__.py) | Empty file that marks the folder as a Python package. |

### [backend/weights/](../backend/weights/) — the pretrained detectors (not made by us)

| File | What it does and why it exists |
|---|---|
| [aerial_vehicles.onnx](../backend/weights/aerial_vehicles.onnx) | Top-down vehicle detector (camera looking down on the lot), used by the server. Source: an Ultralytics test file (`solutions_ci_parking_model.pt`). AGPL-3.0. |
| [aerial_vehicles.pt](../backend/weights/aerial_vehicles.pt) | The same model in the original PyTorch format. Kept only to make the `.onnx` file; not copied into the container. |
| [yolo11n.onnx](../backend/weights/yolo11n.onnx) | Street-level detector: the standard YOLO11n trained on COCO, for cameras that see cars from the side. Used by the server. AGPL-3.0. |
| [yolo11n.pt](../backend/weights/yolo11n.pt) | The same model in PyTorch format, taken from our elimination-stage repo. Kept for conversion only; not copied into the container. |

### [docs/](./) — defence material

| File | What it does and why it exists |
|---|---|
| [ParkDet-defence.pptx](ParkDet-defence.pptx) | The defence deck: 8 slides, with the speaker script and timing in each slide's notes. Editable in PowerPoint, Google Slides or Canva. |
| [pitch-plan.md](pitch-plan.md) | Slide-by-slide plan with speakers and timing, the demo plan, competitor sources and likely questions. |
| GUIDE.md | This guide. |

### [eval/](../eval/) — measuring accuracy on our own photos

| File | What it does and why it exists |
|---|---|
| [evaluate.py](../eval/evaluate.py) | Scores the system on our labelled test set: free/taken accuracy, how reliable "free" is, how many spots the no-setup mode finds, time per photo. `--robustness` adds synthetic (computer-made) night, rain, fog and blur. Writes `eval/results/metrics.json`, which the `/quality` page shows. |
| [results/.gitkeep](../eval/results/.gitkeep) | Empty placeholder so the `eval/results/` folder exists in git. `evaluate.py` writes its results there; the Dockerfile copies this folder to the server. |
| [testset/.gitkeep](../eval/testset/.gitkeep) | Empty placeholder so the `eval/testset/` folder exists. Test-set files exported from `/label` go here; there are none yet. |

### [frontend/](../frontend/) — the website (React), project files

| File | What it does and why it exists |
|---|---|
| [index.html](../frontend/index.html) | The one HTML page the app starts from: title "ParkDet", icon, light and dark colours. |
| [package.json](../frontend/package.json) | The website's libraries (React, react-router for page addresses, Leaflet for the map, qrcode for QR pictures, Vite) and its commands (`dev`, `build`). |
| [package-lock.json](../frontend/package-lock.json) | Exact versions of every installed package, written automatically by npm. Never edited by hand. |
| [vite.config.js](../frontend/vite.config.js) | Vite settings: React support; during development it forwards `/api` requests to the server running on the same computer. |

### [frontend/src/](../frontend/src/) — app start-up and shared helpers

| File | What it does and why it exists |
|---|---|
| [main.jsx](../frontend/src/main.jsx) | Starts the React app with page routing and the stylesheet. |
| [App.jsx](../frontend/src/App.jsx) | The list of pages (routes, see section 5). Shows the bottom menu (not on the entrance screen) and the opening animation. |
| [api.js](../frontend/src/api.js) | Every call from the website to the server, in one place. Also formats money ("5 000 so'm"), builds the Google Maps / Yandex links and computes straight-line distance. |
| [usePoll.js](../frontend/src/usePoll.js) | Repeats a server request every few seconds (polling). This is what makes the counts "live". |
| [useLocation.js](../frontend/src/useLocation.js) | Gets the phone's GPS position (asks permission once). Used in the browser to show distances. |
| [storage.js](../frontend/src/storage.js) | Keeps the driver's tickets (up to 30) on this phone. There are no user accounts. |
| [operatorStore.js](../frontend/src/operatorStore.js) | Remembers, on the operator's device, the PIN of each lot and a copy of the lot's setup (to restore the lot after a server restart). |
| [labelStore.js](../frontend/src/labelStore.js) | Keeps test-set labels in the browser's own database (IndexedDB) until they are exported. |
| [imageUtil.js](../frontend/src/imageUtil.js) | Shrinks a photo in the browser to at most 1600 px before upload (phone photos are big). |
| [styles.css](../frontend/src/styles.css) | The whole look: colours (including the spot colours), light and dark mode, layout for phones and laptops, animations. |

### [frontend/src/pages/](../frontend/src/pages/) — one file per screen (who uses which: section 5)

| File | What it does and why it exists |
|---|---|
| [Home.jsx](../frontend/src/pages/Home.jsx) | Drivers' map and list of published lots: live free count, distance, price, Navigate buttons. |
| [Lot.jsx](../frontend/src/pages/Lot.jsx) | One lot: live counts, spot map, "Find me a spot", directions, booking form. Booking is switched off while the camera is offline. |
| [Booking.jsx](../frontend/src/pages/Booking.jsx) | The booking ticket: status, test payment, QR code, check-in button, hold countdown, directions, and a notice if the booking was moved. |
| [Tickets.jsx](../frontend/src/pages/Tickets.jsx) | "My tickets": the bookings and walk-in visits saved on this phone. |
| [Enter.jsx](../frontend/src/pages/Enter.jsx) | Walk-in: enter the lot, suggested spot with a countdown, time and price so far, test card, pay, "I'm leaving". |
| [Display.jsx](../frontend/src/pages/Display.jsx) | Entrance screen: big free count (or FULL / No live data), nearest free spot with arrows, QR code to enter. |
| [Vision.jsx](../frontend/src/pages/Vision.jsx) | Upload any parking-lot photo and see the cars, the discovered spots, free/taken and the time taken. Made for the jury's own photo. |
| [Camera.jsx](../frontend/src/pages/Camera.jsx) | Turns a phone into the lot's camera: creates the lot (PIN shown once), then sends pictures, keeps the screen on, and restores the lot if the server forgot it. |
| [OperatorHome.jsx](../frontend/src/pages/OperatorHome.jsx) | Operators' start page: set up a new lot, open a lot this device manages, team tools. |
| [Operator.jsx](../frontend/src/pages/Operator.jsx) | One lot for its operator (PIN): pixelated camera with spots, counts, picture warnings, event log, gate QR to print, links, backup download, restore. |
| [Setup.jsx](../frontend/src/pages/Setup.jsx) | The one-time check in 3 steps: (1) delete wrong spots, draw missed ones; (2) draw the aisle, entrance end first; (3) name, address, first-hour price, entrance on the map, publish. |
| [Label.jsx](../frontend/src/pages/Label.jsx) | Team tool to build the test set: the model proposes spots on a photo, a person checks every one, then exports a file. |
| [Quality.jsx](../frontend/src/pages/Quality.jsx) | Shows the results measured by `evaluate.py`, or says that no evaluation has been run yet. |

### [frontend/src/components/](../frontend/src/components/) — reusable parts of screens

| File | What it does and why it exists |
|---|---|
| [SpotMap.jsx](../frontend/src/components/SpotMap.jsx) | Draws the lot like a seat map: each aisle as a road with spots on the driver's left and right, entrance at the bottom. Only free spots can be tapped. Also the colour legend. |
| [MapView.jsx](../frontend/src/components/MapView.jsx) | The OpenStreetMap map (Leaflet): lot pins with the free count ("?" when offline), the driver's position, the operator's draggable entrance pin. |
| [Directions.jsx](../frontend/src/components/Directions.jsx) | Shows the direction steps with arrows, and a note that distances are estimates. |
| [Countdown.jsx](../frontend/src/components/Countdown.jsx) | A ring and a clock: how long a held spot stays yours. The times come from the server. |
| [PinGate.jsx](../frontend/src/components/PinGate.jsx) | Asks for the lot's PIN, checks it with the server, remembers it on this device. |
| [QR.jsx](../frontend/src/components/QR.jsx) | Turns a link into a QR code picture. |
| [NavButtons.jsx](../frontend/src/components/NavButtons.jsx) | "Navigate · Google Maps" and "Yandex" buttons that lead to the lot entrance. |
| [LiveBadge.jsx](../frontend/src/components/LiveBadge.jsx) | "Camera live" or "Camera offline", seconds since the last picture, server time per picture. |
| [AnimatedNumber.jsx](../frontend/src/components/AnimatedNumber.jsx) | Makes a live count glide to its new value instead of jumping. |
| [BottomNav.jsx](../frontend/src/components/BottomNav.jsx) | The floating "liquid glass" menu at the bottom (Map, My tickets, Vision): a glass bubble stretches and slides to the tapped item, and the new page slides in from that side. |
| [Intro.jsx](../frontend/src/components/Intro.jsx) | Short opening animation (a car parks in the free spot), once per visit; skipped when the phone asks for reduced motion. |
| [Logo.jsx](../frontend/src/components/Logo.jsx) | The ParkDet logo: a "P" with an amber dot. |
| [Icons.jsx](../frontend/src/components/Icons.jsx) | Small drawn icons: home, ticket, camera, arrows, pin, car. |

## 4. Judge asks… → answer + where

#### 1. Where is the AI? Which models?
Two pretrained vehicle detectors, both YOLO11: a top-down model for cameras looking down on the lot, and the standard YOLO11n (trained on COCO) for cameras that see cars from the side. They run together on the server's CPU with onnxruntime and only draw boxes around vehicles; everything after that is our own code.

**Where:** [backend/app/cv/detector.py](../backend/app/cv/detector.py), weight files in [backend/weights/](../backend/weights/), settings in [config.py](../backend/app/config.py).

#### 2. What is ours and what is pretrained?
Pretrained: only the two detector weight files, used as they are (we have not trained or fine-tuned them). Ours: how the two detectors are combined (shortcut, tiles, merging), the picture-quality check, automatic spot discovery, the free/taken rule and smoothing, bookings checked by the camera, directions, the server and the whole app, and the test tools. From our elimination stage we reused only the YOLO11n weights file.

**Where:** [README](../README.md) "What is ours"; [layout.py](../backend/app/cv/layout.py), [occupancy.py](../backend/app/cv/occupancy.py), [quality.py](../backend/app/cv/quality.py), [lots.py](../backend/app/lots.py), [guidance.py](../backend/app/guidance.py).

#### 3. How do you find the spots without drawing them by hand?
Parked cars form rows. The code looks for straight lines through the centres of at least 3 parked cars, measures the usual gap between neighbours in car widths (so it still works when distant cars look smaller), and adds an empty spot wherever a gap fits one or more cars. Cars that belong to no row (driving in the aisle) are ignored, and the operator checks the result once.

**Where:** [backend/app/cv/layout.py](../backend/app/cv/layout.py); the check in [Setup.jsx](../frontend/src/pages/Setup.jsx).

#### 4. How do you decide a spot is free?
A spot is taken if any sign of a car touches it: the car's ground point (near the bottom of its box) is inside the spot, or the box covers at least 30% of the spot, or the box centre is inside and at least half of the box lies in the spot. Otherwise it is free. For a live camera the answer is smoothed: a steady spot only changes after two pictures in a row disagree, so one missed detection does not free it. We are cautious on purpose: a "free" spot that is really taken sends a driver to the wrong place.

**Where:** `spot_scores` and `SpotSmoother` in [occupancy.py](../backend/app/cv/occupancy.py); the numbers (`SPOT_COVER_MIN`, `DET_INSIDE_MIN`, `FOOT_FRAC`, `EMA_…`) in [config.py](../backend/app/config.py); bookings added in `state()` in [lots.py](../backend/app/lots.py).

#### 5. What if another car parks in a booked spot?
While a paid booking holds a spot, if the camera sees another car there, the server moves the booking to the nearest free spot (same row first) and logs it; the driver's ticket explains the move. The same check runs again at check-in. After check-in, when the camera sees a car in the booked spot, the booking becomes "Parked (confirmed by camera)".

**Where:** `state()` and `nearest_free()` in [lots.py](../backend/app/lots.py); `checkin_booking` in [main.py](../backend/app/main.py); the notice in [Booking.jsx](../frontend/src/pages/Booking.jsx).

#### 6. Where is the price rule? How do you earn money?
5 000 so'm for the first started hour plus 2 000 so'm for each further started hour: 2.5 hours = 3 started hours = 9 000 so'm (the smoke test checks this). An operator can change the first-hour price of their lot on the setup page. The split (50% to the parking lot, 50% to ParkDet) is our business model in the README and on deck slide 7; the code does not calculate or pay out the split, because all payments are test payments.

**Where:** `FIRST_HOUR_PRICE`, `EXTRA_HOUR_PRICE` in [config.py](../backend/app/config.py); `price()` in [lots.py](../backend/app/lots.py); [README "Business-rule assumptions"](../README.md#business-rule-assumptions-configurable-in-backendappconfigpy).

#### 7. How long is a spot held for a booking or a walk-in?
An unpaid booking must be paid within 10 minutes or it expires (`PENDING_PAYMENT_HOLD_MIN`). A paid booking holds the spot from 30 minutes before the arrival time (`BOOKING_HOLD_BEFORE_MIN`) until 15 minutes after it (`BOOKING_GRACE_MIN`); no check-in by then means "no-show" and the spot is released. After check-in the spot is held until the booked time ends. A walk-in driver's suggested spot is held for 5 minutes (`WALKIN_HOLD_MIN`).

**Where:** [config.py](../backend/app/config.py); enforced in `_held_bookings` and `_walkin_holds` in [lots.py](../backend/app/lots.py); shown by [Countdown.jsx](../frontend/src/components/Countdown.jsx).

#### 8. What happens when the camera is offline?
A lot counts as offline when no picture has arrived for 2 minutes (`CAMERA_OFFLINE_S = 120`). Then the app shows "?" instead of the free count and an offline message, "Find me a spot" and booking are switched off (the server also refuses new bookings), a walk-in driver gets no suggested spot, and the entrance screen says "No live data". The spot map then shows every spot as "no data" (grey) instead of its last colour; only real bookings stay yellow (reserved). The same happens before the first picture after a server start. Nothing is guessed.

**Where:** `camera_online()` and `state()` in [lots.py](../backend/app/lots.py); `create_booking`, `start_session`, `lot_nearest` in [main.py](../backend/app/main.py); [Lot.jsx](../frontend/src/pages/Lot.jsx), [Display.jsx](../frontend/src/pages/Display.jsx).

#### 9. Privacy: are pictures saved? Plates? Faces?
Camera pictures are analysed in memory and never written to disk; only the latest picture of each lot is kept in memory. The operator sees it pixelated by the server (240 px wide, 320 px in the spot editor) so plates and faces cannot be read, and only with the lot's PIN; drivers never see camera images. No licence plates are read or stored: the detectors only find vehicle boxes. For walk-in test cards only the last 4 digits are kept, and the driver's GPS position is used only on their phone (it is not sent to our server).

**Where:** `pixelate()`, `annotated_jpeg()`, `raw_jpeg()` in [lots.py](../backend/app/lots.py); `PIXELATE_VIEW_W`, `PIXELATE_EDIT_W` in [config.py](../backend/app/config.py); `require_operator` in [main.py](../backend/app/main.py).

#### 10. How is the operator PIN protected?
When a lot is created, the server makes a random 6-digit PIN and shows it once. The server stores only a salted SHA-256 hash of the PIN, never the PIN itself. The PIN is needed to send camera pictures, see the camera picture, read the event log, change the setup, and back up or restore the lot; the operator's device remembers it. Not done yet: there is no limit on wrong PIN attempts.

**Where:** `new_pin`, `hash_pin`, `check_pin` in [lots.py](../backend/app/lots.py); `require_operator` in [main.py](../backend/app/main.py); [PinGate.jsx](../frontend/src/components/PinGate.jsx), [operatorStore.js](../frontend/src/operatorStore.js).

#### 11. Is the payment real?
No. Every payment is in test (sandbox) mode, and the screens say so. "Pay" only marks the booking as paid with a test reference. Walk-in drivers can save a test card (4242 4242 4242 4242); only its last 4 digits are kept, and the "charge" at exit is also a test. A real version would connect a local provider (Payme, Click or Uzum); that is outside the prototype.

**Where:** `pay_booking`, `attach_card`, `pay_session`, `exit_session` in [main.py](../backend/app/main.py); [Booking.jsx](../frontend/src/pages/Booking.jsx), [Enter.jsx](../frontend/src/pages/Enter.jsx).

#### 12. How fast is it, how much memory, how many cameras per server?
From the README: on a 4-core Intel Xeon 2.1 GHz using 2 threads, one 1280×720 camera frame takes 141 ms on average (159 ms p95, 20 runs), with no GPU. On the live free server (0.1 vCPU) a 640×360 frame takes about 2.7 s and a photo about 3 s, so the camera phone sends one picture every 5–10 s there. Memory: under 300 MB peak in the smoke test with a 4000×2250 upload, under 400 MB in all our tests. Capacity: one picture every 3 s per camera ÷ about 0.15 s per picture = about 20 cameras per 2-thread worker at full load; we plan for 8.

**Where:** [README "Measured speed"](../README.md#measured-speed); `CASCADE`, `TILE_BUDGET_S`, `ORT_THREADS` in [config.py](../backend/app/config.py).

#### 13. Does it work at night or in rain?
Every picture is checked for darkness, blur, glare and low contrast, and warnings are shown. Dark or low-contrast pictures get a second, contrast-stretched copy, and the cars found in both copies are merged. It is not yet measured on real night photos; `evaluate.py --robustness` can test synthetic night, rain, fog and blur on our labelled photos.

**Where:** [quality.py](../backend/app/cv/quality.py), [pipeline.py](../backend/app/cv/pipeline.py), [eval/evaluate.py](../eval/evaluate.py).

#### 14. How accurate is it?
We have no accuracy numbers yet (README): the earlier development set came from a public video clip that we removed, and the numbers will come from our own Tashkent photos. The tools are ready: build the test set on `/label`, measure with `eval/evaluate.py`, show the results on `/quality`.

**Where:** [Label.jsx](../frontend/src/pages/Label.jsx), [eval/evaluate.py](../eval/evaluate.py), [Quality.jsx](../frontend/src/pages/Quality.jsx).

#### 15. How do the in-lot directions work?
The operator draws each driving aisle on the camera picture, entrance end first. For a spot, the code measures how far along that line it is and on which side, and turns pixels into metres by taking one spot as 2.5 m wide. So "B5: straight about 25 m, then right" is an estimate, and the app says so. To reach the lot itself, the Navigate buttons open Google Maps or Yandex at the entrance the operator placed on the map.

**Where:** `directions()` in [guidance.py](../backend/app/guidance.py); [Setup.jsx](../frontend/src/pages/Setup.jsx); [NavButtons.jsx](../frontend/src/components/NavButtons.jsx).

#### 16. Where is the data stored? What happens on a restart?
Bookings, walk-in visits and the event log are in a SQLite database file; each lot's setup (spots, aisles, location, PIN hash) is a JSON file. The free server forgets both when it restarts. The camera phone keeps a copy of its lot's setup and restores it automatically (PIN-checked), but bookings made before a restart are lost; a pilot would use a managed database (README).

**Where:** [store.py](../backend/app/store.py); `save()` and `restore()` in [lots.py](../backend/app/lots.py); [Camera.jsx](../frontend/src/pages/Camera.jsx), [operatorStore.js](../frontend/src/operatorStore.js).

#### 17. How is it deployed?
The Dockerfile builds one container: the website is built with Node, and the Python server then serves both the API and the website. render.yaml runs it on Render's free plan, and every push to `main` redeploys it. On the free tier it sleeps after 15 minutes without visitors (the first request then takes about 1 minute) and the CPU is small.

**Where:** [Dockerfile](../Dockerfile), [render.yaml](../render.yaml), [README "Deployment"](../README.md#deployment).

#### 18. How is it tested?
`smoke.py` checks a running site from start to finish: pages, analysis time, PIN protection, "no data" before the first picture, booking, prices, test payment, directions. The GitHub Actions job "smoke" runs it against the live site when someone starts it from the Actions tab. Accuracy is measured with `eval/evaluate.py`. There are no other automated tests in the repository.

**Where:** [backend/scripts/smoke.py](../backend/scripts/smoke.py), [.github/workflows/smoke.yml](../.github/workflows/smoke.yml), [eval/](../eval/).

#### 19. What are the licences of the pretrained weights?
Both detectors are AGPL-3.0 (Ultralytics). The top-down model's list of object types matches the VisDrone dataset; if it was trained on VisDrone, that data is for non-commercial research only, so we must replace it with our own fine-tuned model before any commercial use. The map uses Leaflet (BSD-2-Clause) and OpenStreetMap data (ODbL), credited on the map.

**Where:** [README "Data sources, models and licences"](../README.md#data-sources-models-and-licences).

#### 20. What can't it do yet?
From the README: views where cars do not form clear rows (very oblique cameras, chaotic parking); very distant cars (about 10 px wide); rows with fewer than 3 visible cars (the operator draws them); empty spots at the very ends of a row; dark cars at night (not yet measured on real night photos); heavy blocking by trees or poles (not measured); the detector shortcut (skipping the second model) is not yet measured on our photos; directions only for aisles the operator drew. Also: no accuracy numbers yet, test payments only, and the free server forgets bookings on restart.

**Where:** [README "Known failure cases"](../README.md#known-failure-cases-current-prototype).

## 5. Pages of the website

The list is in [App.jsx](../frontend/src/App.jsx); the screens are in [frontend/src/pages/](../frontend/src/pages/). In the addresses, `:id` is the lot's code, `:bid` a booking code and `:sid` a walk-in visit code.

| Address | Who uses it | What it is for |
|---|---|---|
| `/` | Driver | Map and list of live lots: free count, distance, price, Navigate. |
| `/lot/:id` | Driver | One lot: spot map, "Find me a spot", directions, booking. |
| `/booking/:bid` | Driver | Booking ticket: test payment, QR code, check-in, countdown. |
| `/tickets` | Driver | "My tickets": bookings and walk-ins saved on this phone. |
| `/enter/:id` | Driver (walk-in) | Opened by the QR code at the gate: enter without a booking. |
| `/session/:sid` | Driver (walk-in) | The running visit: suggested spot, time, price, pay, leave. |
| `/display/:id` | Entrance screen (opened by the operator) | Big free count, nearest free spot with arrows, QR code to enter. |
| `/vision` | Anyone, jury | Analyse any parking-lot photo. |
| `/camera` | Operator | Create a lot with the phone that will stay at the lot. |
| `/camera/:id` | Operator (phone at the lot, PIN) | Send a picture every 3, 5 or 10 seconds. |
| `/operator` | Operator, team | Start page for operators, with links to the team tools. |
| `/operator/:id` | Operator (PIN) | Pixelated camera, counts, events, gate QR, backup. |
| `/operator/:id/setup` | Operator (PIN) | One-time check of spots, aisle and entrance location; publish. |
| `/label` | Team | Build the test set from our own photos. |
| `/quality` | Team | Measured quality from `evaluate.py`. |

## 6. Glossary

- **API, endpoint** — the API is the set of web addresses the website uses to ask the server for data or actions; one address, such as `/api/lots`, is an endpoint.
- **Bounding box (box)** — the rectangle a detector draws around each vehicle it finds.
- **Browser storage (localStorage, IndexedDB)** — small storage inside the phone's browser; the data stays on that device.
- **Cascade (detector shortcut)** — if the top-down model already found 8 or more confident vehicles, the second model is skipped to save time.
- **COCO** — a large public photo collection of everyday objects (including cars, buses, trucks, motorcycles) used to train YOLO11n.
- **Commit, push, `main`** — a commit is one saved change in git; push sends commits to GitHub; `main` is the main line of the code that the live site uses.
- **Confidence** — a number from 0 to 1 that the detector gives each box: how sure it is that a vehicle is there.
- **Contrast stretch** — spreading a dark picture's brightness over the full range so that details become visible.
- **CPU, GPU, vCPU** — the CPU is a computer's normal processor; a GPU is a graphics card often used for AI (we do not need one); a vCPU is a share of a CPU on a hosting service.
- **Database, SQLite** — a database stores records in an organised way; SQLite keeps the whole database in one file.
- **Deploy** — put a new version of the code on the live site.
- **Docker, container, Dockerfile** — Docker packs the app and everything it needs into one container that runs the same everywhere; the Dockerfile is the recipe.
- **EMA, hysteresis** — EMA (exponential moving average) blends each new answer with the earlier ones; hysteresis means a spot flips only on a clear change (above 0.6 or below 0.4), so it does not flicker.
- **FastAPI, Uvicorn** — FastAPI is the Python library our server is built with; Uvicorn is the program that runs it.
- **Fine-tune** — train an existing model a bit more on your own photos.
- **Frontend, backend (server)** — the frontend is the website running in the user's browser (`frontend/`); the backend is the program on the hosting computer (`backend/`).
- **Git, GitHub, repository** — git records every version of the code; GitHub stores our repository (all project files and their history) online.
- **GitHub Actions, workflow** — GitHub's service that runs scripted jobs (workflows) on its own computers; ours runs the smoke test.
- **GPS** — the phone's satellite position.
- **Hash, salt, SHA-256 (PIN hash)** — a hash is a one-way scramble (SHA-256 is the method); a salt is random text mixed in first; the server can check a PIN but cannot get the PIN back from what it stores.
- **Health check** — Render opens `/api/health` to check that the server is up, for example during a deploy.
- **HTML, CSS** — HTML is the language of web pages; CSS sets their look (colours, sizes, layout).
- **HTTPS** — an encrypted connection to a website; phones allow camera access only on HTTPS pages.
- **JavaScript, JSX, React** — JavaScript is the browser's programming language; React builds screens from reusable parts; `.jsx` files are React code.
- **JSON** — a simple text format for data, used for API answers, lot setups and test-set files.
- **Leaflet, OpenStreetMap** — Leaflet is the map library; OpenStreetMap provides the free map data, credited on the map.
- **Licences (AGPL-3.0, BSD-2-Clause, ODbL)** — the rules for using other people's work. AGPL-3.0: you may use the software, but if you run a changed version as an online service you must publish your changes under the same licence. BSD-2-Clause: free use if you keep the copyright notice. ODbL: the OpenStreetMap data licence, which requires credit.
- **Model, weights, pretrained** — a model is a trained neural network; its weights are the learned numbers saved in a file (`.pt`, `.onnx`); pretrained means someone else trained it.
- **ms, p95** — ms is a millisecond (1/1000 of a second); p95 means 95% of runs were at least this fast.
- **NMS (non-maximum suppression)** — when several boxes cover the same vehicle, keep the most confident one and drop the others.
- **Node.js, npm** — Node runs JavaScript outside the browser; npm installs the website's packages and builds it.
- **NumPy, OpenCV** — Python libraries for fast calculations (NumPy) and image processing (OpenCV).
- **ONNX, onnxruntime** — ONNX is a standard file format for AI models; onnxruntime runs such files on a CPU without PyTorch, which uses less memory.
- **Open source** — software or model files published for anyone to use under a licence.
- **Pixelation** — shrinking a picture to a few hundred pixels wide and enlarging it again, so details such as plates and faces turn into blocks.
- **Polling** — the app asks the server for fresh data again and again (every 2 to 10 seconds, depending on the page).
- **Precision, recall** — precision: of the spots shown as free, how many really are free; recall: of the spots that really are free, how many we show as free.
- **Python, Python package** — Python is the language of the server and scripts; a package is a folder of Python files that can use each other.
- **PyTorch (`.pt`)** — a popular AI library; `.pt` is its weight-file format. The server does not use PyTorch.
- **QR code** — a square barcode that a phone camera turns into a link.
- **RANSAC (sequential)** — a method that finds the line supported by the most points while ignoring stray points; "sequential" means: find one row, remove it, search again.
- **Render** — the hosting company that runs our live site on its free plan.
- **Route** — a page address in the app, such as `/lot/:id`.
- **Sandbox (test mode)** — a pretend payment: the steps work as in real life, but no money moves.
- **Smoke test** — a quick end-to-end check that the main features of a running site work.
- **Spot status** — the server's word for each spot: free, occupied (shown as "taken"), reserved, conflict (booked, but another car is there) or unknown (no data).
- **Test set, labelling** — our own photos where a person marked every spot as free or taken; used to measure accuracy.
- **Thread, worker** — a thread is one line of work inside a program (more threads use more CPU cores at once); a worker is one running copy of the server.
- **Tiling** — cutting a very large photo into overlapping pieces so that small, distant cars become big enough to detect.
- **Ultralytics** — the company that makes YOLO; we use its library only to convert weight files.
- **Vite** — the tool that runs the website during development and builds the final website files.
- **VisDrone** — a public collection of drone photos; the top-down model's list of object types matches it.
- **YOLO, YOLO11, YOLO11n** — YOLO ("You Only Look Once") is a family of fast object detectors; YOLO11 is a recent version by Ultralytics, and YOLO11n its smallest ("nano") size.
