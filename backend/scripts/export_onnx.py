"""Dev-only: convert the .pt detector weights to ONNX (run time needs only onnxruntime).

    pip install ultralytics onnx && python -m scripts.export_onnx
"""
from pathlib import Path

from ultralytics import YOLO

WEIGHTS = Path(__file__).resolve().parent.parent / "weights"

for name in ("yolo11n.pt", "aerial_vehicles.pt"):
    print(YOLO(str(WEIGHTS / name)).export(format="onnx", imgsz=640, opset=17, simplify=False, dynamic=False))
