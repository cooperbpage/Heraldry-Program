"""
Trace the mantling of a reference into smooth vector outlines.

1. Colour-segment the image at 4x (red outer face, pale lining), restricted to the mantling area.
2. Clean the masks (close paint gaps, drop specks, fill ermine spots and small paint holes).
3. Extract outlines (with holes), find true corners (lobe tips and notches), smooth each run between
   corners, and fit the fewest cubic Béziers within a tolerance (Schneider), so curves are smooth
   while tips stay sharp.
4. Write an SVG: black outlines, red and white fills, plus JSON of each region for annotation.

usage: python3 trace.py <config.json> <out-dir>
"""
import sys, json, math
import numpy as np, cv2
from PIL import Image

cfg = json.load(open(sys.argv[1]))
out = sys.argv[2]
S = 4
im = np.asarray(Image.open(cfg['image']).convert('RGB'))
H0, W0 = im.shape[:2]
big = cv2.resize(im, None, fx=S, fy=S, interpolation=cv2.INTER_CUBIC)
big = cv2.bilateralFilter(big, 9, 30, 9)
hsv = cv2.cvtColor(big, cv2.COLOR_RGB2HSV).astype(int)
Hh, Sa, V = hsv[..., 0], hsv[..., 1], hsv[..., 2]

roi = np.zeros(big.shape[:2], np.uint8)
cv2.fillPoly(roi, [np.array(cfg['roi'], np.int32) * S], 1)
for poly in cfg.get('exclude', []):
    cv2.fillPoly(roi, [np.array(poly, np.int32) * S], 0)
for c in cfg.get('exclude_circles', []):
    cv2.circle(roi, (int(c[0] * S), int(c[1] * S)), int(c[2] * S), 0, -1)

rc = cfg['red']
red = (((Hh <= rc['hmax']) | (Hh >= rc['hmin'])) & (Sa >= rc['smin']) & (V >= rc['vmin'])).astype(np.uint8) & roi
layers = [('red', red)]
if 'lining' in cfg:
    lc = cfg['lining']
    paper = (V >= lc['paper_v']) & (Sa <= lc['paper_s'])
    blue = (Hh >= 85) & (Hh <= 130) & (Sa >= 55)
    gold = (Hh >= 11) & (Hh <= 35) & (Sa >= 95)
    lin = ((~paper) & (~blue) & (~gold) & (V >= lc['vmin'])).astype(np.uint8) & roi
    lin[red == 1] = 0
    layers.append(('lining', lin))


def clean(m, close_k, open_k, min_area, hole_area):
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (close_k, close_k))
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, k)
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (open_k, open_k))
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, k)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(m, 8)
    keep = np.zeros_like(m)
    for i in range(1, n):
        if stats[i, cv2.CC_STAT_AREA] >= min_area:
            keep[lab == i] = 1
    # fill small holes (ermine spots, paint flecks); keep real openings such as scroll eyes
    inv = (1 - keep).astype(np.uint8)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(inv, 4)
    for i in range(1, n):
        if stats[i, cv2.CC_STAT_AREA] < hole_area:
            keep[lab == i] = 1
    return keep


# ink lines: pixels clearly darker than their neighbourhood (black-hat), thin and elongated
gray = cv2.cvtColor(big, cv2.COLOR_RGB2GRAY)
bh = cv2.morphologyEx(gray, cv2.MORPH_BLACKHAT, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (17, 17)))
ink = (bh >= cfg.get('ink_thresh', 28)).astype(np.uint8)
# drop blob-like dark marks (ermine spots): keep components that are long and thin
n, lab, stats, _ = cv2.connectedComponentsWithStats(ink, 8)
inkl = np.zeros_like(ink)
for i in range(1, n):
    w, h, a = stats[i, cv2.CC_STAT_WIDTH], stats[i, cv2.CC_STAT_HEIGHT], stats[i, cv2.CC_STAT_AREA]
    if max(w, h) >= cfg.get('ink_min_len', 28) and a / max(1, w * h) < 0.5:
        inkl[lab == i] = 1
inkl = cv2.dilate(inkl, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)))
np.save(f'{out}/ink.npy', inkl)
cl = cfg['clean']
masks = {}
for name, m in layers:
    masks[name] = clean(m, cl['close'], cl['open'], cl['min_area'] * S * S, cl['hole_area'] * S * S)
    if cfg.get('split'):
        masks[name][inkl == 1] = 0
        k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
        masks[name] = cv2.morphologyEx(masks[name], cv2.MORPH_OPEN, k)
if 'lining' in masks:
    # the two faces never overlap; red wins where they touch
    masks['lining'][masks['red'] == 1] = 0
    masks['lining'] = clean(masks['lining'], 3, cl['open'], cl['min_area'] * S * S, cl['hole_area'] * S * S)
    masks['lining'][masks['red'] == 1] = 0
    if cfg.get('split'):
        masks['lining'][inkl == 1] = 0


# ---------------------------------------------------------------- curve fitting
def resample(pts, step):
    d = np.r_[0, np.cumsum(np.hypot(*np.diff(np.vstack([pts, pts[:1]]), axis=0).T))]
    L = d[-1]
    n = max(8, int(L / step))
    t = np.linspace(0, L, n, endpoint=False)
    closed = np.vstack([pts, pts[:1]])
    x = np.interp(t, d, closed[:, 0])
    y = np.interp(t, d, closed[:, 1])
    return np.stack([x, y], 1)


def corners(p, k, max_angle):
    n = len(p)
    ang = np.zeros(n)
    for i in range(n):
        a, b, c = p[(i - k) % n], p[i], p[(i + k) % n]
        v1, v2 = a - b, c - b
        cs = np.dot(v1, v2) / (np.linalg.norm(v1) * np.linalg.norm(v2) + 1e-9)
        ang[i] = math.degrees(math.acos(np.clip(cs, -1, 1)))
    idx = []
    for i in range(n):
        if ang[i] < max_angle and all(ang[i] <= ang[(i + j) % n] for j in range(-k, k + 1)):
            if not idx or i - idx[-1] > k:
                idx.append(i)
    return idx


def smooth_open(seg, sigma):
    if len(seg) < 5 or sigma <= 0:
        return seg
    r = int(3 * sigma)
    w = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2)
    pad = np.vstack([np.repeat(seg[:1], r, 0), seg, np.repeat(seg[-1:], r, 0)])
    x = np.convolve(pad[:, 0], w / w.sum(), 'valid')
    y = np.convolve(pad[:, 1], w / w.sum(), 'valid')
    outp = np.stack([x, y], 1)
    outp[0], outp[-1] = seg[0], seg[-1]
    return outp


def smooth_closed(p, sigma):
    r = int(3 * sigma)
    w = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2)
    w /= w.sum()
    pad = np.vstack([p[-r:], p, p[:r]])
    return np.stack([np.convolve(pad[:, 0], w, 'valid'), np.convolve(pad[:, 1], w, 'valid')], 1)


def bez(c, t):
    u = 1 - t
    return (u ** 3)[:, None] * c[0] + (3 * u * u * t)[:, None] * c[1] + (3 * u * t * t)[:, None] * c[2] + (t ** 3)[:, None] * c[3]


def fit_cubic(pts, t1, t2, err, out_list, depth=0):
    n = len(pts)
    if n == 2:
        d = np.linalg.norm(pts[1] - pts[0]) / 3
        out_list.append([pts[0], pts[0] + t1 * d, pts[1] + t2 * d, pts[1]])
        return
    u = np.r_[0, np.cumsum(np.linalg.norm(np.diff(pts, axis=0), axis=1))]
    u = u / u[-1]
    for it in range(4):
        b0, b1, b2, b3 = (1 - u) ** 3, 3 * (1 - u) ** 2 * u, 3 * (1 - u) * u ** 2, u ** 3
        A1, A2 = b1[:, None] * t1, b2[:, None] * t2
        C = np.array([[np.sum(A1 * A1), np.sum(A1 * A2)], [np.sum(A1 * A2), np.sum(A2 * A2)]])
        tmp = pts - (b0 + b1)[:, None] * pts[0] - (b2 + b3)[:, None] * pts[-1]
        X = np.array([np.sum(A1 * tmp), np.sum(A2 * tmp)])
        seglen = np.linalg.norm(pts[-1] - pts[0])
        try:
            a1, a2 = np.linalg.solve(C, X)
        except np.linalg.LinAlgError:
            a1 = a2 = seglen / 3
        if a1 < 1e-3 * seglen or a2 < 1e-3 * seglen:
            a1 = a2 = seglen / 3
        c = [pts[0], pts[0] + t1 * a1, pts[-1] + t2 * a2, pts[-1]]
        q = bez(c, u)
        e = np.linalg.norm(q - pts, axis=1)
        if e.max() < err:
            out_list.append(c)
            return
        # Newton reparameterisation
        uu = u[:, None]
        d1 = 3 * ((1 - uu) ** 2 * (c[1] - c[0]) + 2 * (1 - uu) * uu * (c[2] - c[1]) + uu ** 2 * (c[3] - c[2]))
        d2 = 6 * ((1 - uu) * (c[2] - 2 * c[1] + c[0]) + uu * (c[3] - 2 * c[2] + c[1]))
        num = np.sum((q - pts) * d1, 1)
        den = np.sum(d1 * d1, 1) + np.sum((q - pts) * d2, 1)
        u = np.clip(u - np.where(np.abs(den) > 1e-9, num / den, 0), 0, 1)
        u[0], u[-1] = 0, 1
        u = np.maximum.accumulate(u)
    split = int(np.argmax(e[1:-1])) + 1 if n > 2 else 1
    split = min(max(split, 1), n - 2)
    tc = pts[split - 1] - pts[split + 1]
    tc = tc / (np.linalg.norm(tc) + 1e-9)
    fit_cubic(pts[: split + 1], t1, tc, err, out_list, depth + 1)
    fit_cubic(pts[split:], -tc, t2, err, out_list, depth + 1)


def unit(v):
    return v / (np.linalg.norm(v) + 1e-9)


def contour_path(cnt, pr):
    p = resample(cnt[:, 0, :].astype(float), pr['step'])
    if len(p) < 12:
        return None, []
    k = pr['corner_k']
    cidx = corners(p, k, pr['corner_angle'])
    segs = []
    if not cidx:
        q = smooth_closed(p, pr['sigma'])
        q = np.vstack([q, q[:1]])
        t1 = unit(q[1] - q[-2])
        cubic = []
        fit_cubic(q, t1, -t1, pr['err'], cubic)
        segs = cubic
        corner_pts = []
    else:
        corner_pts = [p[i] for i in cidx]
        for a, b in zip(cidx, cidx[1:] + [cidx[0] + len(p)]):
            idx = np.arange(a, b + 1) % len(p)
            seg = smooth_open(p[idx], pr['sigma'])
            if len(seg) < 3:
                segs.append([seg[0], seg[0], seg[-1], seg[-1]])
                continue
            m = min(4, len(seg) - 1)
            t1 = unit(seg[m] - seg[0])
            t2 = unit(seg[-1 - m] - seg[-1])
            fit_cubic(seg, t1, t2, pr['err'], segs)
    f = lambda v: f'{v[0] / S:.2f} {v[1] / S:.2f}'
    d = 'M' + f(segs[0][0]) + ''.join('C' + f(c[1]) + ' ' + f(c[2]) + ' ' + f(c[3]) for c in segs) + 'Z'
    return d, [(float(c[0] / S), float(c[1] / S)) for c in corner_pts]


pr = cfg['fit']
regions = []
for name in ['lining', 'red']:
    if name not in masks:
        continue
    cnts, hier = cv2.findContours(masks[name], cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    if hier is None:
        continue
    hier = hier[0]
    for i, c in enumerate(cnts):
        if hier[i][3] != -1:
            continue  # holes are emitted with their parent
        d, cps = contour_path(c, pr)
        if not d:
            continue
        j = hier[i][2]
        holes = 0
        while j != -1:
            hd, _ = contour_path(cnts[j], pr)
            if hd:
                d += hd
                holes += 1
            j = hier[j][0]
        x, y, w, h = cv2.boundingRect(c)
        area = cv2.contourArea(c) / (S * S)
        regions.append({'face': name, 'd': d, 'bbox': [x / S, y / S, w / S, h / S], 'area': area, 'holes': holes, 'corners': cps})

for face, min_len in cfg.get('interior_lines', {}).items():
    if face not in masks:
        continue
    inner = cv2.erode(masks[face], cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)))
    m = (inkl & inner).astype(np.uint8)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(m, 8)
    keep = np.zeros_like(m)
    for i in range(1, n):
        if max(stats[i, cv2.CC_STAT_WIDTH], stats[i, cv2.CC_STAT_HEIGHT]) >= min_len * S:
            keep[lab == i] = 1
    cnts, _ = cv2.findContours(keep, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    lp = dict(pr, corner_angle=60, sigma=1.5, err=1.2, step=1.5)
    for c in cnts:
        d, _ = contour_path(c, lp)
        if d:
            x, y, w, h = cv2.boundingRect(c)
            regions.append({'face': 'ink', 'on': face, 'd': d, 'bbox': [x / S, y / S, w / S, h / S], 'area': cv2.contourArea(c) / (S * S), 'holes': 0, 'corners': []})

regions.sort(key=lambda r: ({'lining': 0, 'red': 1, 'ink': 2}[r['face']], -r['area']))
for i, r in enumerate(regions):
    r['id'] = i
json.dump({'size': [W0, H0], 'regions': regions}, open(f'{out}/regions.json', 'w'))
fill = {'red': cfg.get('red_fill', '#d42b2b'), 'lining': '#ffffff', 'ink': '#111'}
paths = ''.join(f'<path d="{r["d"]}" fill="{fill[r["face"]]}" fill-rule="evenodd"' + ('' if r['face'] == 'ink' else f' stroke="#111" stroke-width="{cfg.get("stroke", 0.9)}" stroke-linejoin="round"') + f' data-id="{r["id"]}"/>' for r in regions)
bg = cfg.get('background', '#f1ebdd')
svg = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W0} {H0}" width="100%" height="100%"><rect width="{W0}" height="{H0}" fill="{bg}"/>{paths}</svg>'
open(f'{out}/trace.svg', 'w').write(svg)
# overlay check: trace outlines over the faded reference
import base64, io
buf = io.BytesIO(); Image.fromarray(im).save(buf, 'PNG')
b64 = base64.b64encode(buf.getvalue()).decode()
ov = ''.join(f'<path d="{r["d"]}" fill="none" fill-rule="evenodd" stroke="{"#0050ff" if r["face"] == "lining" else "#000"}" stroke-width="0.7"/>' for r in regions)
open(f'{out}/overlay.svg', 'w').write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W0} {H0}" width="100%" height="100%"><image href="data:image/png;base64,{b64}" width="{W0}" height="{H0}" opacity="0.55"/>{ov}</svg>')
print(len(regions), 'regions;', sum(r['d'].count('C') for r in regions), 'Bézier segments')
