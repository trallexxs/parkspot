"""Vehicle detection: an ensemble of two YOLO11 models.

* aerial model  - trained on drone imagery (VisDrone classes); strong on top-down views.
* ground model  - COCO YOLO11n; strong on pole/wall cameras that see cars from the side.

Both run on every image (or tile) and their boxes are merged with class-agnostic NMS,
so the same code works whatever the camera angle is.
"""
import threading
import time

import cv2
import numpy as np
from ultralytics import YOLO

from .. import config

AERIAL_MAP = {3: "car", 4: "van", 5: "truck", 8: "bus", 9: "motorcycle"}
GROUND_MAP = {2: "car", 3: "motorcycle", 5: "bus", 7: "truck"}


class Detector:
    def __init__(self):
        self.models = [
            ("aerial", YOLO(str(config.AERIAL_WEIGHTS)), AERIAL_MAP),
            ("ground", YOLO(str(config.GROUND_WEIGHTS)), GROUND_MAP),
        ]
        self.lock = threading.Lock()  # ultralytics predictors are not thread-safe
        self.warmup()

    def warmup(self):
        dummy = np.zeros((360, 640, 3), np.uint8)
        self.detect(dummy)

    def _run(self, img, offset=(0, 0)):
        out = []
        for name, model, cmap in self.models:
            res = model.predict(img, imgsz=config.DET_IMGSZ, conf=config.DET_CONF,
                                classes=list(cmap), verbose=False)[0]
            if res.boxes is None or len(res.boxes) == 0:
                continue
            xyxy = res.boxes.xyxy.cpu().numpy()
            conf = res.boxes.conf.cpu().numpy()
            cls = res.boxes.cls.cpu().numpy().astype(int)
            for b, c, k in zip(xyxy, conf, cls):
                out.append({
                    "box": [float(b[0] + offset[0]), float(b[1] + offset[1]),
                            float(b[2] + offset[0]), float(b[3] + offset[1])],
                    "conf": float(c), "cls": cmap[k], "model": name,
                })
        return out

    @staticmethod
    def _tiles(h, w, size, overlap=0.2):
        step = int(size * (1 - overlap))
        ys = list(range(0, max(h - size, 0) + 1, step)) or [0]
        xs = list(range(0, max(w - size, 0) + 1, step)) or [0]
        if ys[-1] + size < h:
            ys.append(h - size)
        if xs[-1] + size < w:
            xs.append(w - size)
        return [(x, y) for y in ys for x in xs]

    def detect(self, img):
        """Returns (detections, info). Each detection: box [x1,y1,x2,y2], conf, cls, model."""
        t0 = time.perf_counter()
        h, w = img.shape[:2]
        tiled = max(h, w) > config.TILE_ABOVE_PX
        with self.lock:
            dets = self._run(img)
            if tiled:
                size = int(min(h, w, max(h, w) / 2))
                for x, y in self._tiles(h, w, size):
                    dets += self._run(img[y:y + size, x:x + size], (x, y))
        merged = nms(dets, config.NMS_IOU)
        return merged, {"tiled": tiled, "raw": len(dets),
                        "ms": round((time.perf_counter() - t0) * 1000, 1)}


def nms(dets, iou_thr):
    if not dets:
        return []
    boxes = [[d["box"][0], d["box"][1], d["box"][2] - d["box"][0], d["box"][3] - d["box"][1]] for d in dets]
    scores = [d["conf"] for d in dets]
    keep = cv2.dnn.NMSBoxes(boxes, scores, 0.0, iou_thr)
    keep = np.array(keep).flatten().tolist()
    # second pass: drop boxes mostly contained in a kept, more confident box (tile seams, car-in-car)
    kept = sorted((dets[i] for i in keep), key=lambda d: -d["conf"])
    final = []
    for d in kept:
        if all(_contain(d["box"], f["box"]) < 0.8 for f in final):
            final.append(d)
    return final


def _contain(a, b):
    """Share of box a that lies inside box b."""
    ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    area = max(1e-6, (a[2] - a[0]) * (a[3] - a[1]))
    return ix * iy / area


_detector = None
_init_lock = threading.Lock()


def get_detector():
    global _detector
    with _init_lock:
        if _detector is None:
            _detector = Detector()
    return _detector
