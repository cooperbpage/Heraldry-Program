"""Hand-placed outline points -> smooth closed Bézier path.
Points are [x, y] or [x, y, 1] (1 = sharp corner: a tip or a notch). Between corners the curve is a
centripetal Catmull-Rom spline (no overshoot, no cusps), converted to cubic Béziers."""
import json, sys, math

def path(points):
    P = [(p[0], p[1]) for p in points]
    C = [len(p) > 2 and p[2] == 1 for p in points]
    n = len(P)
    segs = []
    for i in range(n):
        p1, p2 = P[i], P[(i + 1) % n]
        # neighbours; at a corner, mirror instead of using the far point (keeps the corner sharp)
        p0 = P[i - 1] if not C[i] else (2 * p1[0] - p2[0], 2 * p1[1] - p2[1])
        p3 = P[(i + 2) % n] if not C[(i + 1) % n] else (2 * p2[0] - p1[0], 2 * p2[1] - p1[1])
        d = lambda a, b: max(1e-6, math.hypot(a[0] - b[0], a[1] - b[1]) ** 0.5)
        t0, t1, t2 = d(p0, p1), d(p1, p2), d(p2, p3)
        m1 = [ (p2[k] - p1[k]) / t1 * 0 for k in range(2)]
        # centripetal CR tangents
        tan1 = [((p1[k] - p0[k]) / t0 - (p2[k] - p0[k]) / (t0 + t1) + (p2[k] - p1[k]) / t1) * t1 for k in range(2)]
        tan2 = [((p2[k] - p1[k]) / t1 - (p3[k] - p1[k]) / (t1 + t2) + (p3[k] - p2[k]) / t2) * t1 for k in range(2)]
        c1 = (p1[0] + tan1[0] / 3, p1[1] + tan1[1] / 3)
        c2 = (p2[0] - tan2[0] / 3, p2[1] - tan2[1] / 3)
        segs.append((c1, c2, p2))
    f = lambda v: f'{v[0]:.2f},{v[1]:.2f}'
    return 'M' + f(P[0]) + ''.join(f' C{f(a)} {f(b)} {f(c)}' for a, b, c in segs) + ' Z'

if __name__ == '__main__':
    src = json.load(open(sys.argv[1]))
    out = [{'id': s['id'], 'name': s.get('name', ''), 'd': path(s['pts'])} for s in src]
    json.dump(out, open(sys.argv[2], 'w'), indent=1)
