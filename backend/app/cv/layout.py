"""Automatic parking-spot layout discovery (zero-config camera onboarding).

Idea: parked cars form rows. We find rows of vehicle boxes with sequential RANSAC line fitting,
estimate the spot pitch inside each row (in units of car width, so it survives perspective),
and insert empty spots wherever the gap between two parked cars is wide enough for one or more
cars. Cars that do not belong to any row (driving in the aisle) are ignored.

* Single image  -> rows + gaps (what the jury's photo gets).
* Video / several frames -> only boxes that stay put are used, so passing traffic is ignored and
  the layout fills in over time as different spots get used.
"""
import string

import numpy as np

from .. import config


def _to_row_frame(boxes, vertical):
    """Row frame: u runs along the row, v across it."""
    b = np.asarray(boxes, float).reshape(-1, 4)
    return b[:, [1, 0, 3, 2]] if vertical else b


def _from_row_frame(u1, v1, u2, v2, vertical):
    if vertical:
        u1, v1, u2, v2 = v1, u1, v2, u2
    return [[u1, v1], [u2, v1], [u2, v2], [u1, v2]]


def _best_line(pool, cu, cv, sv, chunk=4096):
    """Of all lines through two box centres (|slope| <= 0.35), the one with the most centres
    within ROW_ALIGN_TOL x box depth. Vectorised over all pairs (first maximum wins, pairs in
    itertools.combinations order); returns its inliers in pool order."""
    P = np.asarray(pool)
    cuP, cvP, tol = cu[P], cv[P], config.ROW_ALIGN_TOL * sv[P]
    I, J = np.triu_indices(len(P), 1)
    best, best_n = [], 0
    for s in range(0, len(I), chunk):
        i, j = I[s:s + chunk], J[s:s + chunk]
        du = cuP[j] - cuP[i]
        ok = np.abs(du) >= 1e-6
        slope = np.where(ok, (cvP[j] - cvP[i]) / np.where(ok, du, 1.0), 0.0)
        ok &= np.abs(slope) <= 0.35
        if not ok.any():
            continue
        i, slope = i[ok], slope[ok]
        res = np.abs(cvP[None, :] - (cvP[i][:, None] + slope[:, None] * (cuP[None, :] - cuP[i][:, None])))
        inl = res < tol[None, :]
        counts = inl.sum(1)
        k = int(counts.argmax())
        if counts[k] > best_n:
            best_n, best = int(counts[k]), [int(p) for p in P[inl[k]]]
    return best


def _find_rows(b, idx_pool):
    """Sequential RANSAC over box centres. b: (N,4) boxes in row frame."""
    cu = (b[:, 0] + b[:, 2]) / 2
    cv = (b[:, 1] + b[:, 3]) / 2
    su = b[:, 2] - b[:, 0]
    sv = b[:, 3] - b[:, 1]
    pool = list(idx_pool)
    rows = []
    while len(pool) >= config.ROW_MIN_CARS:
        best = _best_line(pool, cu, cv, sv)
        if len(best) < config.ROW_MIN_CARS:
            break
        # size consistency: drop boxes much bigger/smaller across the row than the median
        med_sv = np.median(sv[best])
        best = [p for p in best if 0.6 * med_sv <= sv[p] <= 1.6 * med_sv]
        # continuity: split where neighbours are far apart, keep the longest run
        best.sort(key=lambda p: cu[p])
        med_su = np.median(su[best]) if best else 0
        runs, cur = [], [best[0]] if best else []
        for a, c in zip(best, best[1:]):
            if cu[c] - cu[a] > 6 * med_su:
                runs.append(cur)
                cur = []
            cur.append(c)
        if cur:
            runs.append(cur)
        run = max(runs, key=len) if runs else []
        if len(run) < config.ROW_MIN_CARS:
            # this line was not a real row: drop its seed points so the loop moves on
            for p in best:
                pool.remove(p)
            continue
        rows.append(run)
        pool = [p for p in pool if p not in run]
    return rows


def _row_spots(b, members):
    """Turn one row of parked cars into spots, inserting empty spots in the gaps."""
    cu = (b[:, 0] + b[:, 2]) / 2
    cv = (b[:, 1] + b[:, 3]) / 2
    su = b[:, 2] - b[:, 0]
    sv = b[:, 3] - b[:, 1]
    m = sorted(members, key=lambda p: cu[p])
    U, V, SU, SV = cu[m], cv[m], su[m], sv[m]
    # linear fits along the row: centre line, car width and depth (handles perspective)
    line = np.polyfit(U, V, 1)
    fw = np.polyfit(U, SU, 1) if len(m) >= 4 else np.array([0.0, np.median(SU)])
    fd = np.polyfit(U, SV, 1) if len(m) >= 4 else np.array([0.0, np.median(SV)])
    width = lambda u: max(np.polyval(fw, u), 0.5 * np.median(SU))
    depth = lambda u: max(np.polyval(fd, u), 0.5 * np.median(SV))

    gaps = np.diff(U)
    local_w = np.array([(width(U[k]) + width(U[k + 1])) / 2 for k in range(len(gaps))])
    ratio = gaps / local_w
    tight = ratio[ratio < 1.6]
    pitch_ratio = float(np.median(tight)) if len(tight) else 1.15

    centres = [(U[0], True, m[0])]
    for k, g in enumerate(gaps):
        n_missing = int(round(ratio[k] / pitch_ratio)) - 1
        for s in range(1, n_missing + 1):
            centres.append((U[k] + g * s / (n_missing + 1), False, None))
        centres.append((U[k + 1], True, m[k + 1]))

    spots = []
    for u, observed, p in centres:
        w = width(u) * pitch_ratio * 0.95
        if observed:
            w = max(w, su[p])
        d = depth(u)
        v = np.polyval(line, u)
        spots.append({"u1": u - w / 2, "u2": u + w / 2, "v1": v - d / 2, "v2": v + d / 2,
                      "observed": observed})
    return spots, float(np.polyval(line, U.mean())), pitch_ratio


def _clip(poly, w, h):
    return [[min(max(x, 0.0), w - 1.0), min(max(y, 0.0), h - 1.0)] for x, y in poly]


def auto_layout(detections, min_conf=None, image_size=None):
    """detections: list of dicts with 'box'. Returns list of spots with polygons in image coords."""
    min_conf = config.LAYOUT_MIN_CONF if min_conf is None else min_conf
    dets = [d for d in detections if d.get("conf", 1.0) >= min_conf and d.get("cls") != "motorcycle"]
    if len(dets) < config.ROW_MIN_CARS:
        return {"spots": [], "rows": 0, "unassigned": len(dets)}
    boxes = np.array([d["box"] for d in dets], float)

    # Two readings of the same boxes: horizontal rows first, or vertical rows first (leftovers go
    # to the other orientation). A reading is scored by the cars it explains minus a penalty per
    # spot it has to invent: "rows" that jump across the driving aisle need invented spots there.
    best = None
    for order in ((False, True), (True, False)):
        pool = set(range(len(dets)))
        rows_built = []
        for k, vertical in enumerate(order):
            rb = _to_row_frame(boxes, vertical)
            for members in _find_rows(rb, sorted(pool)):
                spots, v_mean, pitch = _row_spots(rb, members)
                inferred = sum(1 for sp in spots if not sp["observed"])
                if k > 0 and inferred >= len(members):
                    continue  # a leftover "row" that is mostly invented: not a row
                rows_built.append((vertical, v_mean, spots, pitch, members))
                pool -= set(members)
        assigned = sum(len(r[4]) for r in rows_built)
        inferred = sum(1 for r in rows_built for sp in r[2] if not sp["observed"])
        score = assigned - config.LAYOUT_INFERRED_PENALTY * inferred
        if best is None or score > best[0]:
            best = (score, rows_built, assigned)

    rows_out = [r[:4] for r in best[1]]

    # name rows top-to-bottom (horizontal rows) then left-to-right (vertical rows)
    rows_out.sort(key=lambda r: (r[0], r[1]))
    letters = iter(string.ascii_uppercase)
    out = []
    for vertical, _, spots, pitch in rows_out:
        letter = next(letters, "Z")
        for n, s in enumerate(sorted(spots, key=lambda s: s["u1"]), 1):
            poly = _from_row_frame(s["u1"], s["v1"], s["u2"], s["v2"], vertical)
            if image_size:
                poly = _clip(poly, *image_size)
            out.append({"id": f"{letter}{n}", "row": letter,
                        "polygon": [[round(x, 1), round(y, 1)] for x, y in poly],
                        "source": "observed" if s["observed"] else "inferred"})
    return {"spots": out, "rows": len(rows_out), "unassigned": len(dets) - best[2]}

