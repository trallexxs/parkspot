"""Vehicle detection: an ensemble of two YOLO11 models.

* aerial model  - for top-down views (a camera looking down on the lot); source and licence in the README.
* ground model  - COCO YOLO11n; strong on pole/wall cameras that see cars from the side.

Both run on every image (or tile) and their boxes are merged with class-agnostic NMS,
so the same code works whatever the camera angle is.
"""
import threading
import time

import cv2
import numpy as np
import onnxruntime as ort

from .. import config

AERIAL_MAP = {3: "car", 4: "van", 5: "truck", 8: "bus", 9: "motorcycle"}
GROUND_MAP = {2: "car", 3: "motorcycle", 5: "bus", 7: "truck"}


class OnnxYolo:
    """YOLO11 exported to ONNX (output 1 x (4+classes) x 8400), run with onnxruntime on CPU.
    No PyTorch at run time: ~4x less memory, fits small free servers."""

    def __init__(self, path, size):
        opts = ort.SessionOptions()
        opts.intra_op_num_threads = config.ORT_THREADS
        opts.enable_cpu_mem_arena = False  # lower peak memory on small servers
        self.sess = ort.InferenceSession(str(path), opts, providers=["CPUExecutionProvider"])
        self.input = self.sess.get_inputs()[0].name
        self.size = size

    def predict(self, img, conf, classes):
        h, w = img.shape[:2]
        r = min(self.size / h, self.size / w)
        nh, nw = round(h * r), round(w * r)
        top, left = (self.size - nh) // 2, (self.size - nw) // 2
        canvas = np.full((self.size, self.size, 3), 114, np.uint8)
        canvas[top:top + nh, left:left + nw] = cv2.resize(img, (nw, nh), interpolation=cv2.INTER_LINEAR)
        x = cv2.cvtColor(canvas, cv2.COLOR_BGR2RGB).transpose(2, 0, 1)[None].astype(np.float32) / 255.0
        out = self.sess.run(None, {self.input: x})[0][0].T          # 8400 x (4 + nc)
        scores = out[:, 4:]
        cls = scores.argmax(1)
        best = scores[np.arange(len(cls)), cls]
        keep = (best >= conf) & np.isin(cls, list(classes))
        out, cls, best = out[keep], cls[keep], best[keep]
        if not len(out):
            return np.zeros((0, 4)), np.zeros(0), np.zeros(0, int)
        cx, cy, bw, bh = out[:, 0], out[:, 1], out[:, 2], out[:, 3]
        boxes = np.stack([cx - bw / 2 - left, cy - bh / 2 - top, cx + bw / 2 - left, cy + bh / 2 - top], 1) / r
        boxes[:, [0, 2]] = boxes[:, [0, 2]].clip(0, w)
        boxes[:, [1, 3]] = boxes[:, [1, 3]].clip(0, h)
        # per-class NMS (offset trick), IoU 0.7 like the training-time default
        off = boxes + cls[:, None] * 4096.0
        xywh = np.concatenate([off[:, :2], off[:, 2:] - off[:, :2]], 1).tolist()
        idx = np.array(cv2.dnn.NMSBoxes(xywh, best.tolist(), conf, 0.7)).flatten().astype(int)
        return boxes[idx], best[idx], cls[idx]


class Detector:
    def __init__(self):
        self.models = [
            ("aerial", OnnxYolo(config.AERIAL_WEIGHTS, config.DET_IMGSZ), AERIAL_MAP),
            ("ground", OnnxYolo(config.GROUND_WEIGHTS, config.DET_IMGSZ), GROUND_MAP),
        ]
        self.lock = threading.Lock()
        self.warmup()

    def warmup(self):
        dummy = np.zeros((360, 640, 3), np.uint8)
        self.detect(dummy)

    def _run(self, img, offset=(0, 0)):
        out = []
        for name, model, cmap in self.models:
            if out and name == "ground" and _decisive(out):
                break  # the aerial model already explains a top-down view: skip the ground model
            with self.lock:
                xyxy, conf, cls = model.predict(img, config.DET_CONF, cmap)
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

    @staticmethod
    def _needs_tiles(dets, h, w):
        """Tiles cost 6+ extra passes, so a large image is tiled only when the full-image pass
        suggests distant cars: none found, or many boxes tiny at the network's input scale."""
        if max(h, w) <= config.TILE_ABOVE_PX:
            return False
        if not dets:
            return True
        scale = config.DET_IMGSZ / max(h, w)
        small = [min(d["box"][2] - d["box"][0], d["box"][3] - d["box"][1]) * scale < config.TILE_SMALL_PX
                 for d in dets]
        return sum(small) / len(small) >= config.TILE_SMALL_FRAC

    def detect(self, img):
        """Returns (detections, info). Each detection: box [x1,y1,x2,y2], conf, cls, model."""
        t0 = time.perf_counter()
        h, w = img.shape[:2]
        dets = self._run(img)
        tiled = self._needs_tiles(dets, h, w)
        if tiled:
            size = int(min(h, w, max(h, w) / 2))
            for x, y in self._tiles(h, w, size):
                dets += self._run(img[y:y + size, x:x + size], (x, y))
        merged = nms(dets, config.NMS_IOU)
        return merged, {"tiled": tiled, "raw": len(dets),
                        "ms": round((time.perf_counter() - t0) * 1000, 1)}


def _decisive(dets):
    """Enough confident aerial-model vehicles that the ground model would add nothing."""
    if not config.CASCADE:
        return False
    conf = sorted(d["conf"] for d in dets)
    return len(conf) >= config.CASCADE_MIN_CARS and conf[len(conf) // 2] >= config.CASCADE_MIN_CONF


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
