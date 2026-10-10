"""End-to-end analysis of one image: quality gate -> enhance -> detect -> layout -> occupancy."""
import base64
import time

import cv2
import numpy as np

from . import quality as q
from .. import config
from .detector import get_detector, nms
from .layout import auto_layout
from .occupancy import spot_scores

COLORS = {  # BGR, drawing only
    "free": (80, 200, 60), "occupied": (60, 60, 230), "reserved": (0, 190, 255),
    "conflict": (200, 0, 200), "det": (255, 200, 0),
}


def decode_image(data: bytes):
    arr = np.frombuffer(data, np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("could not decode image")
    return img


def limit_size(img, max_side=1920):
    h, w = img.shape[:2]
    s = max_side / max(h, w)
    return cv2.resize(img, None, fx=s, fy=s, interpolation=cv2.INTER_AREA) if s < 1 else img


def analyze(img, spots=None):
    """spots=None => discover the layout automatically from this image."""
    t = {}
    t0 = time.perf_counter()
    img = limit_size(img)
    qual = q.assess(img)
    work, enhanced = q.enhance(img, qual)
    t["quality_ms"] = round((time.perf_counter() - t0) * 1000, 1)

    dets, dinfo = get_detector().detect(img)
    if enhanced:  # dark frame: also detect on the stretched copy and merge (night recall)
        more, info2 = get_detector().detect(work)
        dets = nms(dets + more, config.NMS_IOU)
        dinfo = {**dinfo, "ms": round(dinfo["ms"] + info2["ms"], 1), "views": 2,
                 "tiles_skipped": dinfo["tiles_skipped"] or info2["tiles_skipped"]}
    if dinfo["tiles_skipped"]:
        qual = {**qual, "warnings": qual["warnings"] + [
            "Distant cars may be missed: the detailed search in tiles was skipped to answer quickly on this small server."]}
    t["detect_ms"] = dinfo["ms"]

    t1 = time.perf_counter()
    layout_info = None
    if spots is None:
        lay = auto_layout(dets, image_size=(img.shape[1], img.shape[0]))
        spots = lay["spots"]
        layout_info = {"mode": "auto", "rows": lay["rows"], "unassigned_vehicles": lay["unassigned"],
                       "inferred_empty": sum(1 for s in spots if s["source"] == "inferred")}
    else:
        layout_info = {"mode": "calibrated"}
    scores = spot_scores(spots, dets)
    t["layout_occupancy_ms"] = round((time.perf_counter() - t1) * 1000, 1)
    t["total_ms"] = round((time.perf_counter() - t0) * 1000, 1)

    by_id = {s["id"]: s for s in scores}
    spots_out = [{**s, "occupied": by_id[s["id"]]["occupied"], "score": by_id[s["id"]]["score"]}
                 for s in spots]
    occ = sum(1 for s in spots_out if s["occupied"])
    return {
        "image": {"width": img.shape[1], "height": img.shape[0]},
        "quality": qual, "enhanced": enhanced,
        "detections": dets, "detector": dinfo,
        "layout": layout_info, "spots": spots_out,
        "summary": {"spots": len(spots_out), "occupied": occ, "free": len(spots_out) - occ,
                    "vehicles": len(dets)},
        "timing": t, "_img": work,
    }


def draw(img, spots, detections=None, status=None, show_dets=True):
    """status: optional {spot_id: 'free'|'occupied'|'reserved'|'conflict'} overriding occupancy."""
    out = img.copy()
    overlay = img.copy()
    lw = max(1, round(max(img.shape[:2]) / 640))
    if show_dets and detections:
        for d in detections:
            x1, y1, x2, y2 = map(int, d["box"])
            cv2.rectangle(out, (x1, y1), (x2, y2), COLORS["det"], lw)
    for s in spots:
        st = (status or {}).get(s["id"]) or ("occupied" if s.get("occupied") else "free")
        pts = np.array(s["polygon"], np.int32)
        cv2.fillPoly(overlay, [pts], COLORS.get(st, COLORS["free"]))
        cv2.polylines(out, [pts], True, COLORS.get(st, COLORS["free"]), lw)
    out = cv2.addWeighted(overlay, 0.28, out, 0.72, 0)
    fs = 0.35 * lw
    for s in spots:
        pts = np.array(s["polygon"], np.float32)
        cx, cy = pts.mean(axis=0)
        cv2.putText(out, s["id"], (int(cx - 10 * lw), int(cy + 4 * lw)), cv2.FONT_HERSHEY_SIMPLEX,
                    fs, (255, 255, 255), lw + 1, cv2.LINE_AA)
        cv2.putText(out, s["id"], (int(cx - 10 * lw), int(cy + 4 * lw)), cv2.FONT_HERSHEY_SIMPLEX,
                    fs, (20, 20, 20), max(1, lw // 2), cv2.LINE_AA)
    return out


def to_jpeg(img, quality=82):
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, quality])
    return buf.tobytes()


def to_b64(img):
    return "data:image/jpeg;base64," + base64.b64encode(to_jpeg(img)).decode()
