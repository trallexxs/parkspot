"""Evaluate ParkDet on our own labelled test set.

    cd backend && python ../eval/evaluate.py            # all bundles in eval/testset/
    python ../eval/evaluate.py --robustness             # + synthetic night / rain / fog / blur

Test set = JSON bundles exported from the in-app labelling page (/label): every item holds the
photo (base64 JPEG), its conditions (lighting, weather, view, place) and the ground-truth spots
(polygon + occupied) checked by a person.

Reported:
1. Occupancy with known spots (the normal mode after a camera is onboarded):
   accuracy, and precision/recall of FREE spots (what the driver relies on).
2. Zero-config layout discovery (the jury-photo mode): spot recall/precision vs ground-truth
   spots, and end-to-end free-spot precision/recall.
3. Latency per image on this machine.
4. (optional) Robustness: same images with synthetic degradations (method below), so the
   drop at night / in rain can be shown before real night/rain photos exist.
Results -> eval/results/metrics.json, failure images -> eval/results/failures/.
"""
import argparse
import base64
import json
import sys
import time
from collections import defaultdict
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))
from app.cv import pipeline  # noqa: E402

TESTSET = ROOT / "eval" / "testset"
RESULTS = ROOT / "eval" / "results"


def load_items():
    items = []
    for f in sorted(TESTSET.glob("*.json")):
        data = json.loads(f.read_text())
        for i, it in enumerate(data.get("items", [])):
            raw = base64.b64decode(it["image"].split(",", 1)[-1])
            img = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
            items.append({**it, "img": img, "bundle": f.name, "key": f"{f.stem}#{i}"})
    return items


def bbox(poly):
    p = np.asarray(poly, float)
    return [p[:, 0].min(), p[:, 1].min(), p[:, 0].max(), p[:, 1].max()]


def iou(a, b):
    ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    u = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / u if u > 0 else 0.0


def match(pred, gt, thr=0.3):
    """Greedy one-to-one matching by IoU of spot bounding boxes."""
    pairs = sorted(((iou(bbox(p["polygon"]), bbox(g["polygon"])), i, j)
                    for i, p in enumerate(pred) for j, g in enumerate(gt)), reverse=True)
    used_p, used_g, out = set(), set(), []
    for v, i, j in pairs:
        if v < thr:
            break
        if i in used_p or j in used_g:
            continue
        used_p.add(i)
        used_g.add(j)
        out.append((i, j))
    return out


class Counter:
    def __init__(self):
        self.tp_free = self.fp_free = self.fn_free = self.correct = self.n = 0

    def add(self, pred_occ, gt_occ):
        self.n += 1
        self.correct += pred_occ == gt_occ
        if not pred_occ and not gt_occ:
            self.tp_free += 1
        elif not pred_occ and gt_occ:
            self.fp_free += 1
        elif pred_occ and not gt_occ:
            self.fn_free += 1

    def report(self):
        p = self.tp_free / max(1, self.tp_free + self.fp_free)
        r = self.tp_free / max(1, self.tp_free + self.fn_free)
        return {"spots": self.n, "accuracy": round(self.correct / max(1, self.n), 4),
                "free_precision": round(p, 4), "free_recall": round(r, 4),
                "free_f1": round(2 * p * r / max(1e-9, p + r), 4),
                "free_spots_gt": self.tp_free + self.fn_free}


# --- synthetic degradations (declared generation method) -----------------------------------
def night(img, rng):
    out = (img.astype(np.float32) * 0.22) ** 1.15
    out += rng.normal(0, 6, img.shape)
    return np.clip(out, 0, 255).astype(np.uint8)


def rain(img, rng):
    h, w = img.shape[:2]
    layer = np.zeros((h, w), np.float32)
    for _ in range(int(h * w / 600)):
        x, y = rng.integers(0, w), rng.integers(0, h)
        ln = rng.integers(8, 22)
        cv2.line(layer, (int(x), int(y)), (int(x + ln * 0.25), int(y + ln)), 200, 1)
    layer = cv2.GaussianBlur(layer, (3, 3), 0)
    out = cv2.GaussianBlur(img, (3, 3), 0).astype(np.float32) * 0.8 + layer[..., None] * 0.35
    return np.clip(out, 0, 255).astype(np.uint8)


def fog(img, rng):
    return np.clip(img.astype(np.float32) * 0.55 + 200 * 0.45, 0, 255).astype(np.uint8)


def blur(img, rng):
    return cv2.GaussianBlur(img, (0, 0), 2.5)


DEGRADE = {"night": night, "rain": rain, "fog": fog, "blur": blur}


def evaluate(items, transform=None, save_failures=False):
    occ_all, e2e_all = Counter(), Counter()
    occ_by = defaultdict(Counter)
    lay = {"gt": 0, "pred": 0, "matched": 0}
    times = []
    rng = np.random.default_rng(0)
    fail_dir = RESULTS / "failures"
    if save_failures:
        fail_dir.mkdir(parents=True, exist_ok=True)
        for f in fail_dir.glob("*.jpg"):
            f.unlink()
    per_image = []
    for it in items:
        img = transform(it["img"], rng) if transform else it["img"]
        gt = it["spots"]
        cond = it.get("condition", {})
        # 1) known spots
        t0 = time.perf_counter()
        res = pipeline.analyze(img, spots=[{"id": str(k), "polygon": g["polygon"], "row": "?"}
                                           for k, g in enumerate(gt)])
        times.append((time.perf_counter() - t0) * 1000)
        wrong = []
        for k, (p, g) in enumerate(zip(res["spots"], gt)):
            occ_all.add(p["occupied"], g["occupied"])
            for key in ("lighting", "weather", "view"):
                if cond.get(key):
                    occ_by[f"{key}={cond[key]}"].add(p["occupied"], g["occupied"])
            if p["occupied"] != g["occupied"]:
                wrong.append(k)
        # 2) zero-config layout
        auto = pipeline.analyze(img)
        if it.get("roi"):  # partially labelled photo: only judge predicted spots inside the labelled area
            x1, y1, x2, y2 = it["roi"]
            auto["spots"] = [s for s in auto["spots"]
                             if x1 <= np.mean([p[0] for p in s["polygon"]]) <= x2
                             and y1 <= np.mean([p[1] for p in s["polygon"]]) <= y2]
        m = match(auto["spots"], gt)
        lay["gt"] += len(gt)
        lay["pred"] += len(auto["spots"])
        lay["matched"] += len(m)
        mp = {j: i for i, j in m}
        for j, g in enumerate(gt):
            if j in mp:
                e2e_all.add(auto["spots"][mp[j]]["occupied"], g["occupied"])
            else:
                e2e_all.add(True, g["occupied"])  # a missed spot is never offered as free
        for i, p in enumerate(auto["spots"]):
            if i not in {a for a, _ in m} and not p["occupied"]:
                e2e_all.fp_free += 1  # an invented spot offered as free
        per_image.append({"key": it["key"], "spots": len(gt), "occupancy_errors": len(wrong),
                          "auto_spots": len(auto["spots"]), "auto_matched": len(m)})
        if save_failures and wrong:
            status = {str(k): ("conflict" if k in wrong else ("occupied" if g["occupied"] else "free"))
                      for k, g in enumerate(gt)}
            vis = pipeline.draw(res["_img"], [{"id": str(k), "polygon": g["polygon"]} for k, g in enumerate(gt)],
                                res["detections"], status=status)
            cv2.imwrite(str(fail_dir / f"{it['key'].replace('#', '_')}.jpg"), vis)
    t = np.array(times) if times else np.zeros(1)
    return {
        "occupancy_known_spots": occ_all.report(),
        "occupancy_by_condition": {k: v.report() for k, v in sorted(occ_by.items())},
        "layout_discovery": {"gt_spots": lay["gt"], "predicted_spots": lay["pred"], "matched": lay["matched"],
                             "recall": round(lay["matched"] / max(1, lay["gt"]), 4),
                             "precision": round(lay["matched"] / max(1, lay["pred"]), 4)},
        "end_to_end_zero_config": e2e_all.report(),
        "latency_ms": {"mean": round(float(t.mean()), 1), "p95": round(float(np.percentile(t, 95)), 1)},
        "per_image": per_image,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--robustness", action="store_true")
    args = ap.parse_args()
    items = load_items()
    pipeline.get_detector()  # load models before timing
    if not items:
        sys.exit(f"no labelled items in {TESTSET}")
    out = {"test_set": {"images": len(items), "spots": sum(len(i["spots"]) for i in items),
                        "bundles": sorted({i["bundle"] for i in items}),
                        "conditions": dict(sorted(_count(items).items()))},
           "clean": evaluate(items, save_failures=True)}
    if args.robustness:
        out["synthetic_degradation"] = {
            name: {k: v for k, v in evaluate(items, fn).items() if k != "per_image"}
            for name, fn in DEGRADE.items()}
        out["synthetic_method"] = ("night: pixel=(0.22*x)^1.15 for x in 0..255 (mean V ~44), + gaussian noise sigma 6; "
                                   "rain: random 8-22 px streaks (1 per 600 px^2) + 3x3 blur, 80% contrast; "
                                   "fog: 45% blend with grey 200; blur: gaussian sigma 2.5")
    c = out["clean"]
    out["summary"] = {
        "images": len(items), "spots": out["test_set"]["spots"],
        "occupancy_accuracy": c["occupancy_known_spots"]["accuracy"],
        "free_precision": c["occupancy_known_spots"]["free_precision"],
        "free_recall": c["occupancy_known_spots"]["free_recall"],
        "layout_recall": c["layout_discovery"]["recall"],
        "layout_precision": c["layout_discovery"]["precision"],
        "latency_ms_mean": c["latency_ms"]["mean"],
    }
    out["evaluated_at"] = time.strftime("%Y-%m-%d %H:%M:%S")
    RESULTS.mkdir(parents=True, exist_ok=True)
    (RESULTS / "metrics.json").write_text(json.dumps(out, indent=1))
    print(json.dumps(out["summary"], indent=1))
    if args.robustness:
        for k, v in out["synthetic_degradation"].items():
            print(k, v["occupancy_known_spots"])


def _count(items):
    c = defaultdict(int)
    for it in items:
        for k, v in it.get("condition", {}).items():
            if k in ("lighting", "weather", "view") and v:
                c[f"{k}={v}"] += 1
    return c


if __name__ == "__main__":
    main()
