"""All tunable settings in one place."""
import os
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
ROOT_DIR = BACKEND_DIR.parent
WEIGHTS_DIR = BACKEND_DIR / "weights"
LOTS_DIR = BACKEND_DIR / "lots"
DATA_DIR = ROOT_DIR / "data"
FRONTEND_DIST = ROOT_DIR / "frontend" / "dist"
DB_PATH = Path(os.environ.get("PARK_DB", BACKEND_DIR / "parking.sqlite3"))
METRICS_PATH = ROOT_DIR / "eval" / "results" / "metrics.json"

# Detector ensemble
AERIAL_WEIGHTS = WEIGHTS_DIR / "aerial_vehicles.onnx"   # top-down / drone views (VisDrone classes)
GROUND_WEIGHTS = WEIGHTS_DIR / "yolo11n.onnx"           # pole / wall cameras (COCO classes)
ORT_THREADS = int(os.environ.get("ORT_THREADS", "2"))
DET_IMGSZ = 640
DET_CONF = 0.25
NMS_IOU = 0.5
TILE_ABOVE_PX = 1400        # images larger than this are also processed in overlapping tiles

# Image quality
NIGHT_BRIGHTNESS = 70       # mean V (0..255) below this => night
LOW_LIGHT_BRIGHTNESS = 100
BLUR_VAR_MIN = 60.0         # Laplacian variance at 640 px below this => blurry

# Occupancy
SPOT_COVER_MIN = 0.30       # intersection / spot area
DET_INSIDE_MIN = 0.50       # intersection / detection area (when the box centre is inside the spot)
EMA_ALPHA = 0.5             # temporal smoothing for live camera feeds
EMA_ON, EMA_OFF = 0.6, 0.4  # hysteresis thresholds

# Auto-layout
ROW_MIN_CARS = 3
LAYOUT_MIN_CONF = 0.35

# Live camera worker
CAMERA_INTERVAL_S = float(os.environ.get("CAMERA_INTERVAL_S", "1.5"))
CAMERA_IDLE_AFTER_S = 60      # replay camera pauses when no one has looked at the lot for this long

# Business rules (assumptions, stated in the README)
BOOKING_GRACE_MIN = 15      # booked spot is held this long after the arrival time
WALKIN_HOLD_MIN = 5         # suggested spot is held for a walk-in driver this long
BOOKING_HOLD_BEFORE_MIN = 30  # booked spot is held (shown reserved) from this long before arrival
PENDING_PAYMENT_HOLD_MIN = 10 # unpaid booking holds the spot this long
