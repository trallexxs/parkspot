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
    """Night / low light: CLAHE on luminance + gamma lift. Day frames are returned unchanged."""
    if quality["lighting"] == "day" and quality["contrast"] >= 25:
        return img, False
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    l = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8)).apply(l)
    out = cv2.cvtColor(cv2.merge([l, a, b]), cv2.COLOR_LAB2BGR)
    if quality["lighting"] == "night":
        lut = np.array([((i / 255.0) ** 0.6) * 255 for i in range(256)], np.uint8)
        out = cv2.LUT(out, lut)
    return out, True
