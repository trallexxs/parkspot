"""Onboard a camera: discover the spot layout from footage and write a lot config.

    python -m scripts.onboard_lot --source ../data/demo/parking_demo.mp4 --id demo --name "Demo lot"

Every Nth frame is run through the detector; vehicles that stay in place are treated as parked
and fed to the auto-layout. Aisles/entrance are added afterwards by the operator (one line in the
JSON), everything else is automatic.
"""
import argparse
import json
import sys
from pathlib import Path

import cv2

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app import config  # noqa: E402
from app.cv.detector import get_detector  # noqa: E402
from app.cv.layout import auto_layout, stable_boxes  # noqa: E402


def frames(source, every):
    cap = cv2.VideoCapture(str(source))
    i = 0
    while True:
        ok, f = cap.read()
        if not ok:
            break
        if i % every == 0:
            yield f
        i += 1


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", required=True)
    ap.add_argument("--id", required=True)
    ap.add_argument("--name", required=True)
    ap.add_argument("--every", type=int, default=5)
    ap.add_argument("--rows", default="", help="comma-separated rows to keep, e.g. B,C (default all)")
    ap.add_argument("--price", type=int, default=5000)
    args = ap.parse_args()

    det = get_detector()
    all_dets, shape = [], None
    src = Path(args.source)
    imgs = [cv2.imread(str(src))] if src.suffix.lower() in {".jpg", ".jpeg", ".png"} else frames(src, args.every)
    for f in imgs:
        shape = f.shape
        d, _ = det.detect(f)
        all_dets.append(d)
    parked = stable_boxes(all_dets) if len(all_dets) > 1 else all_dets[0]
    lay = auto_layout(parked, image_size=(shape[1], shape[0]))
    spots = lay["spots"]
    if args.rows:
        keep = set(args.rows.split(","))
        spots = [s for s in spots if s["row"] in keep]
    cfg = {
        "id": args.id, "name": args.name, "price_per_hour": args.price, "currency": "UZS",
        "camera": {"type": "video" if len(all_dets) > 1 else "image", "path": str(src),
                   "width": shape[1], "height": shape[0]},
        "aisles": [], "spots": spots,
        "onboarding": {"frames": len(all_dets), "parked_vehicles": len(parked),
                       "rows": lay["rows"], "spots": len(spots)},
    }
    out = config.LOTS_DIR / f"{args.id}.json"
    out.write_text(json.dumps(cfg, indent=1))
    print(f"wrote {out}: {len(spots)} spots from {len(all_dets)} frames, {len(parked)} parked vehicles")


if __name__ == "__main__":
    main()
