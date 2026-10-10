"""Turn-by-turn directions from the entrance to a spot, computed from the camera geometry.

Each aisle is a line from where the driver enters it (start) to its end. A spot's position along
the aisle gives the driving distance, the sign of the cross product gives left/right, and the
spot pitch (median spot width in pixels ~ metres_per_spot) converts pixels to metres.
"""
import numpy as np


def _centre(spot):
    return np.asarray(spot["polygon"], float).mean(axis=0)


def _spot_pitch_px(spots):
    widths = []
    for s in spots:
        p = np.asarray(s["polygon"], float)
        widths.append(min(np.ptp(p[:, 0]), np.ptp(p[:, 1])))
    return float(np.median(widths)) if widths else 1.0


def directions(lot, spot_id):
    spots = lot["spots"]
    spot = next((s for s in spots if s["id"] == spot_id), None)
    if spot is None:
        return None
    aisle = next((a for a in lot.get("aisles", []) if spot["row"] in a.get("rows", [])), None)
    if aisle is None:
        return {"spot": spot_id, "steps": [
            {"icon": "straight", "text": f"Enter and follow the signs to row {spot['row']}"},
            {"icon": "pin", "text": f"Spot {spot_id}"}], "distance_m": None}

    a0, a1 = np.asarray(aisle["start"], float), np.asarray(aisle["end"], float)
    d = (a1 - a0) / (np.linalg.norm(a1 - a0) + 1e-9)
    m_per_px = lot.get("metres_per_spot", 2.5) / _spot_pitch_px(spots)

    def place(s):
        v = _centre(s) - a0
        along = float(v @ d)
        cross = d[0] * v[1] - d[1] * v[0]   # image y points down => positive cross = right-hand side
        return along, "right" if cross > 0 else "left"

    along, side = place(spot)
    same_side = sorted(place(s)[0] for s in spots
                       if s["row"] in aisle["rows"] and place(s)[1] == side)
    nth = 1 + sum(1 for x in same_side if x < along - 1e-6)
    dist = max(0, round(along * m_per_px))
    steps = []
    if aisle.get("enter"):
        steps.append({"icon": aisle["enter"]["turn"],
                      "text": f"Go {aisle['enter']['after_m']} m, then turn {aisle['enter']['turn']} "
                              f"into {aisle['name']}"})
    else:
        steps.append({"icon": "straight", "text": f"Enter and drive straight along the {aisle['name'].lower()}"})
    steps.append({"icon": "straight", "text": f"Continue about {dist} m"})
    steps.append({"icon": side, "text": f"Spot {spot_id} is on your {side} — "
                                          f"{_ordinal(nth)} spot on the {side}"})
    return {"spot": spot_id, "side": side, "distance_m": dist, "nth_on_side": nth, "steps": steps,
            "short": f"{spot_id}: straight {dist} m, then {side}"}


def aisle_map(lot):
    """App map: for each aisle, the spots on the driver's left and right, ordered from the entrance.
    Rows without an aisle are returned as plain rows."""
    spots = lot["spots"]
    out, used = [], set()
    for a in lot.get("aisles", []):
        a0, a1 = np.asarray(a["start"], float), np.asarray(a["end"], float)
        d = (a1 - a0) / (np.linalg.norm(a1 - a0) + 1e-9)
        sides = {"left": [], "right": []}
        for s in spots:
            if s["row"] not in a.get("rows", []):
                continue
            v = _centre(s) - a0
            cross = d[0] * v[1] - d[1] * v[0]
            sides["right" if cross > 0 else "left"].append((float(v @ d), s["id"]))
            used.add(s["id"])
        out.append({"id": a["id"], "name": a["name"],
                    "left": [i for _, i in sorted(sides["left"])],
                    "right": [i for _, i in sorted(sides["right"])]})
    rows = {}
    for s in spots:
        if s["id"] not in used:
            rows.setdefault(s["row"], []).append((_centre(s)[0], s["id"]))
    plain = [{"row": r, "spots": [i for _, i in sorted(v)]} for r, v in sorted(rows.items())]
    return {"aisles": out, "rows": plain}


def _ordinal(n):
    suf = "th" if 10 <= n % 100 <= 20 else {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suf}"
