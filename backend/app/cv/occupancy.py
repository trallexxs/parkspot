"""Per-spot occupancy from vehicle boxes, plus temporal smoothing for live feeds."""
import cv2
import numpy as np

from .. import config


def _poly(points):
    return np.asarray(points, np.float32).reshape(-1, 2)


def _box_poly(b):
    return _poly([[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]])


def spot_scores(spots, detections):
    """For each spot: probability-like score that a vehicle occupies it, and the matching detection."""
    out = []
    det_polys = [_box_poly(d["box"]) for d in detections]
    for s in spots:
        sp = _poly(s["polygon"])
        s_area = max(1e-6, float(cv2.contourArea(sp)))
        best, best_k = 0.0, None
        for k, (d, dp) in enumerate(zip(detections, det_polys)):
            inter, _ = cv2.intersectConvexConvex(sp, dp)
            if inter <= 0:
                continue
            d_area = max(1e-6, float(cv2.contourArea(dp)))
            x1, y1, x2, y2 = d["box"]
            cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
            # where the car stands: near the bottom of its box. From a pole or a window a car's box
            # also covers the spot behind it; its ground point does not.
            fx, fy = cx, y2 - config.FOOT_FRAC * (y2 - y1)
            on_spot = cv2.pointPolygonTest(sp, (float(fx), float(fy)), False) >= 0
            inside = cv2.pointPolygonTest(sp, (float(cx), float(cy)), False) >= 0
            cover = inter / s_area
            fill = inter / d_area
            # cautious on purpose: any sign of a car makes the spot occupied. A hidden free spot costs
            # a driver a few metres; a "free" spot that is taken sends them to the wrong place.
            if on_spot or cover >= config.SPOT_COVER_MIN or (inside and fill >= config.DET_INSIDE_MIN):
                score = min(1.0, 0.5 + 0.5 * max(cover, fill)) * (0.5 + 0.5 * d["conf"])
                if score > best:
                    best, best_k = score, k
        out.append({"id": s["id"], "score": round(best, 3), "occupied": best_k is not None,
                    "det": best_k})
    return out


class SpotSmoother:
    """EMA + hysteresis so one missed detection does not flip a spot to free."""

    def __init__(self):
        self.p = {}
        self.state = {}

    def update(self, scores):
        for s in scores:
            x = 1.0 if s["occupied"] else 0.0
            p = self.p.get(s["id"], x)
            p = config.EMA_ALPHA * x + (1 - config.EMA_ALPHA) * p
            self.p[s["id"]] = p
            prev = self.state.get(s["id"], x >= 0.5)
            if prev and p < config.EMA_OFF:
                prev = False
            elif not prev and p > config.EMA_ON:
                prev = True
            self.state[s["id"]] = prev
        return {k: {"occupied": v, "p": round(self.p[k], 2)} for k, v in self.state.items()}
