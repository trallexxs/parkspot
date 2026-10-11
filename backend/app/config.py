"""All tunable settings in one place."""
import os
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
ROOT_DIR = BACKEND_DIR.parent
WEIGHTS_DIR = BACKEND_DIR / "weights"
LOTS_DIR = BACKEND_DIR / "lots"
FRONTEND_DIST = ROOT_DIR / "frontend" / "dist"
DB_PATH = Path(os.environ.get("PARK_DB", BACKEND_DIR / "parking.sqlite3"))
METRICS_PATH = ROOT_DIR / "eval" / "results" / "metrics.json"

# Detector ensemble
AERIAL_WEIGHTS = WEIGHTS_DIR / "aerial_vehicles.onnx"   # top-down views (camera looking down on the lot)
GROUND_WEIGHTS = WEIGHTS_DIR / "yolo11n.onnx"           # pole / wall cameras (COCO classes)
ORT_THREADS = int(os.environ.get("ORT_THREADS", "2"))
DET_IMGSZ = 640
DET_CONF = 0.25
NMS_IOU = 0.5
CASCADE = os.environ.get("CASCADE", "1") == "1"  # skip the ground model when the aerial one is decisive
CASCADE_MIN_CARS = 8        # ...it found at least this many vehicles
CASCADE_MIN_CONF = 0.6      # ...with at least this median confidence
TILE_ABOVE_PX = 1400        # images larger than this MAY also be processed in overlapping tiles...
TILE_SMALL_PX = 18          # ...when boxes are this small at network scale (short side, px)
TILE_SMALL_FRAC = 0.3       # ...for at least this share of the boxes (or nothing was found)
TILE_BUDGET_S = float(os.environ.get("TILE_BUDGET_S", "8"))  # skip the tiles if they would take longer
                            # than this (a small free server); the result then says so. 0 = always tile

# Image quality
NIGHT_BRIGHTNESS = 70       # mean V (0..255) below this => night
LOW_LIGHT_BRIGHTNESS = 100
BLUR_VAR_MIN = 60.0         # Laplacian variance at 640 px below this => blurry

# Occupancy
SPOT_COVER_MIN = 0.30       # intersection / spot area
DET_INSIDE_MIN = 0.50       # intersection / detection area (when the box centre is inside the spot)
FOOT_FRAC = 0.2             # a car's ground point: 20% of its box height above the box bottom
EMA_ALPHA = 0.5             # temporal smoothing for live camera feeds
EMA_ON, EMA_OFF = 0.6, 0.4  # hysteresis thresholds

# Auto-layout
ROW_MIN_CARS = 3
LAYOUT_MIN_CONF = 0.35
ROW_ALIGN_TOL = 0.4           # a car is on a row line if its centre is within 0.4 x its depth
LAYOUT_INFERRED_PENALTY = 0.5 # score of a reading = cars explained - 0.5 x spots invented

# Real lots (phone camera)
CAMERA_OFFLINE_S = 120        # no frame for this long => the lot is shown as "camera offline"
PIXELATE_VIEW_W = 240         # operator view: camera image pixelated to this width (privacy)
PIXELATE_EDIT_W = 320         # spot editor: a little more detail to see the lane markings

# Business rules (stated in the README)
FIRST_HOUR_PRICE = 5000     # so'm for the first (started) hour; the operator can change it per lot
EXTRA_HOUR_PRICE = 2000     # so'm for each further started hour
BOOKING_GRACE_MIN = 15      # booked spot is held this long after the arrival time
WALKIN_HOLD_MIN = 5         # suggested spot is held for a walk-in driver this long
BOOKING_HOLD_BEFORE_MIN = 30  # booked spot is held (shown reserved) from this long before arrival
PENDING_PAYMENT_HOLD_MIN = 10 # unpaid booking holds the spot this long
