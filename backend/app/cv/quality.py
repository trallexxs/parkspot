"""Image quality gate: lighting, blur, glare. Dark frames are enhanced before detection."""
import cv2
import numpy as np

from .. import config


def assess(img):
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    v = hsv[..., 2]
    brightness = float(v.mean())
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    scale = 640.0 / max(gray.shape)
    small = cv2.resize(gray, None, fx=scale, fy=scale) if scale < 1 else gray
    blur = float(cv2.Laplacian(small, cv2.CV_64F).var())
    contrast = float(gray.std())
    glare = float((v > 250).mean())

    if brightness < config.NIGHT_BRIGHTNESS:
        lighting = "night"
    elif brightness < config.LOW_LIGHT_BRIGHTNESS:
        lighting = "low_light"
    else:
        lighting = "day"

    warnings = []
    if lighting != "day":
        warnings.append(f"{lighting.replace('_', ' ')}: frame enhanced before detection")
    if blur < config.BLUR_VAR_MIN:
        warnings.append("image is blurry: small or distant cars may be missed")
    if glare > 0.15:
        warnings.append("strong glare / overexposure")
    if contrast < 25:
        warnings.append("low contrast (fog, rain or dirty lens?)")

    return {"brightness": round(brightness, 1), "blur": round(blur, 1), "contrast": round(contrast, 1),
            "glare": round(glare, 3), "lighting": lighting, "warnings": warnings}


def enhance(img, quality):
    """Dark / low-contrast frames: percentile contrast stretch (1st..99.5th) -> second view for the
    detector. Measured on synthetic night: CLAHE+gamma lost vehicles (37 -> 30 of 41), a plain
    stretch keeps them, and detecting on raw + stretched and merging finds 39 of 41.
    Returns (image, enhanced?)."""
    if quality["lighting"] == "day" and quality["contrast"] >= 25:
        return img, False
    lo, hi = np.percentile(img, 1), np.percentile(img, 99.5)
    out = np.clip((img.astype(np.float32) - lo) * 255.0 / max(1.0, hi - lo), 0, 255).astype(np.uint8)
    return out, True
