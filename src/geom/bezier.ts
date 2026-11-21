import { V, add, sub, mul, dot, cross, norm, dist, len, perp } from './vec';

/** A spine is a list of points P0 C1 C2 P1 C1 C2 P2 ... (3n+1 points, n cubic segments). */
export type Spine = V[];

export function segCount(sp: Spine) {
  return Math.max(0, Math.floor((sp.length - 1) / 3));
}
export function seg(sp: Spine, i: number): [V, V, V, V] {
  return [sp[3 * i], sp[3 * i + 1], sp[3 * i + 2], sp[3 * i + 3]];
}

export function bez(c: [V, V, V, V], t: number): V {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, d = 3 * u * t * t, e = t * t * t;
  return [a * c[0][0] + b * c[1][0] + d * c[2][0] + e * c[3][0], a * c[0][1] + b * c[1][1] + d * c[2][1] + e * c[3][1]];
}
export function bez1(c: [V, V, V, V], t: number): V {
  const u = 1 - t;
  return [
    3 * (u * u * (c[1][0] - c[0][0]) + 2 * u * t * (c[2][0] - c[1][0]) + t * t * (c[3][0] - c[2][0])),
    3 * (u * u * (c[1][1] - c[0][1]) + 2 * u * t * (c[2][1] - c[1][1]) + t * t * (c[3][1] - c[2][1])),
  ];
}
export function bez2(c: [V, V, V, V], t: number): V {
  const u = 1 - t;
  return [
    6 * (u * (c[2][0] - 2 * c[1][0] + c[0][0]) + t * (c[3][0] - 2 * c[2][0] + c[1][0])),
    6 * (u * (c[2][1] - 2 * c[1][1] + c[0][1]) + t * (c[3][1] - 2 * c[2][1] + c[1][1])),
  ];
}
/** Signed curvature (positive turns toward the left normal perp(tangent)). */
export function bezK(c: [V, V, V, V], t: number) {
  const d1 = bez1(c, t), d2 = bez2(c, t);
  const l = len(d1);
  return l < 1e-9 ? 0 : cross(d1, d2) / (l * l * l);
}

// ---------------------------------------------------------------------------
// Gesture filtering and Schneider-style least-squares fitting
// ---------------------------------------------------------------------------

/** Remove jitter: drop near-duplicate samples, then a few passes of moving-average smoothing (ends pinned). */
export function filterGesture(raw: V[], passes: number, minStep = 2): V[] {
  const pts: V[] = [];
  for (const p of raw) if (!pts.length || dist(pts[pts.length - 1], p) >= minStep) pts.push([p[0], p[1]]);
  if (raw.length && pts.length && dist(pts[pts.length - 1], raw[raw.length - 1]) > 0.01) pts.push(raw[raw.length - 1]);
  let cur = pts;
  for (let k = 0; k < passes; k++) {
    if (cur.length < 3) break;
    const nx: V[] = [cur[0]];
    for (let i = 1; i < cur.length - 1; i++)
      nx.push([(cur[i - 1][0] + 2 * cur[i][0] + cur[i + 1][0]) / 4, (cur[i - 1][1] + 2 * cur[i][1] + cur[i + 1][1]) / 4]);
    nx.push(cur[cur.length - 1]);
    cur = nx;
  }
  return cur;
}

function chordParams(pts: V[], a: number, b: number) {
  const u = [0];
  for (let i = a + 1; i <= b; i++) u.push(u[u.length - 1] + dist(pts[i], pts[i - 1]));
  const L = u[u.length - 1] || 1;
  return u.map((x) => x / L);
}

function generate(pts: V[], a: number, b: number, u: number[], t1: V, t2: V): [V, V, V, V] {
  const p0 = pts[a], p3 = pts[b];
  let c00 = 0, c01 = 0, c11 = 0, x0 = 0, x1 = 0;
  for (let i = 0; i < u.length; i++) {
    const t = u[i], s = 1 - t;
    const b0 = s * s * s, b1 = 3 * s * s * t, b2 = 3 * s * t * t, b3 = t * t * t;
    const A1 = mul(t1, b1), A2 = mul(t2, b2);
    c00 += dot(A1, A1);
    c01 += dot(A1, A2);
    c11 += dot(A2, A2);
    const tmp = sub(pts[a + i], add(mul(p0, b0 + b1), mul(p3, b2 + b3)));
    x0 += dot(A1, tmp);
    x1 += dot(A2, tmp);
  }
  const det = c00 * c11 - c01 * c01;
  const segLen = dist(p0, p3);
  let al = 0, ar = 0;
  if (Math.abs(det) > 1e-12) {
    al = (x0 * c11 - x1 * c01) / det;
    ar = (c00 * x1 - c01 * x0) / det;
  }
  const eps = 1e-6 * segLen;
  if (al < eps || ar < eps || al > segLen * 2 || ar > segLen * 2) al = ar = segLen / 3;
  return [p0, add(p0, mul(t1, al)), add(p3, mul(t2, ar)), p3];
}

function maxError(pts: V[], a: number, b: number, c: [V, V, V, V], u: number[]) {
  let mx = 0, at = Math.floor((a + b) / 2);
  for (let i = a + 1; i < b; i++) {
    const d = dist(bez(c, u[i - a]), pts[i]);
    if (d > mx) {
      mx = d;
      at = i;
    }
  }
  return { mx, at };
}

function reparam(pts: V[], a: number, c: [V, V, V, V], u: number[]) {
  return u.map((t, i) => {
    const p = pts[a + i];
    const q = bez(c, t), q1 = bez1(c, t), q2 = bez2(c, t);
    const num = dot(sub(q, p), q1);
    const den = dot(q1, q1) + dot(sub(q, p), q2);
    if (Math.abs(den) < 1e-12) return t;
    return Math.min(1, Math.max(0, t - num / den));
  });
}

function fitRec(pts: V[], a: number, b: number, t1: V, t2: V, err: number, out: [V, V, V, V][]) {
  if (b - a < 2) {
    const d = dist(pts[a], pts[b]) / 3;
    out.push([pts[a], add(pts[a], mul(t1, d)), add(pts[b], mul(t2, d)), pts[b]]);
    return;
  }
  let u = chordParams(pts, a, b);
  let c = generate(pts, a, b, u, t1, t2);
  let { mx, at } = maxError(pts, a, b, c, u);
  if (mx < err) {
    out.push(c);
    return;
  }
  if (mx < err * 4) {
    for (let k = 0; k < 6; k++) {
      u = reparam(pts, a, c, u);
      c = generate(pts, a, b, u, t1, t2);
      ({ mx, at } = maxError(pts, a, b, c, u));
      if (mx < err) {
        out.push(c);
        return;
      }
    }
  }
  at = Math.max(a + 1, Math.min(b - 1, at));
  const tc = norm(sub(pts[at - 1], pts[at + 1]));
  fitRec(pts, a, at, t1, tc, err, out);
  fitRec(pts, at, b, mul(tc, -1), t2, err, out);
}

/** Robust end tangent: average direction over the first ~8% of the polyline. */
function endTangent(pts: V[], fromStart: boolean): V {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += dist(pts[i], pts[i - 1]);
  const want = Math.max(4, L * 0.06);
  if (fromStart) {
    let acc = 0, i = 1;
    for (; i < pts.length - 1 && acc < want; i++) acc += dist(pts[i], pts[i - 1]);
    return norm(sub(pts[i], pts[0]));
  }
  let acc = 0, i = pts.length - 2;
  for (; i > 0 && acc < want; i--) acc += dist(pts[i], pts[i + 1]);
  return norm(sub(pts[i], pts[pts.length - 1]));
}

/** Fit the fewest cubic segments within `err`, then enforce G2 at internal joins. */
export function fitSpine(pts: V[], err: number): Spine {
  if (pts.length < 2) return [];
  if (pts.length === 2) {
    const d = sub(pts[1], pts[0]);
    return [pts[0], add(pts[0], mul(d, 1 / 3)), add(pts[0], mul(d, 2 / 3)), pts[1]];
  }
  const out: [V, V, V, V][] = [];
  fitRec(pts, 0, pts.length - 1, endTangent(pts, true), endTangent(pts, false), err, out);
  const sp: Spine = [out[0][0]];
  for (const c of out) sp.push(c[1], c[2], c[3]);
  enforceG2(sp);
  return sp;
}

/**
 * Make internal joins G2: handles are collinear (G1 already), and the curvature on both
 * sides is matched by moving the neighbouring inner control points perpendicular to the
 * join tangent. Where the two sides would bend opposite ways (an inflection at the join),
 * both curvatures are set to zero.
 */
export function enforceG2(sp: Spine) {
  const n = segCount(sp);
  for (let pass = 0; pass < 3; pass++) {
    for (let j = 1; j < n; j++) {
      const P = sp[3 * j];
      const inH = sp[3 * j - 1], outH = sp[3 * j + 1];
      // re-align handles to a common tangent (G1)
      let T = norm(sub(outH, inH));
      if (!isFinite(T[0])) continue;
      const a = Math.max(1e-3, dist(P, inH)), b = Math.max(1e-3, dist(P, outH));
      sp[3 * j - 1] = sub(P, mul(T, a));
      sp[3 * j + 1] = add(P, mul(T, b));
      const N = perp(T);
      const A = sp[3 * j - 2]; // seg j-1's first control (C1)
      const B = sp[3 * j + 2]; // seg j's second control (C2)
      // curvature at end of seg j-1: k1 = (2/3) * h1 / a^2, h1 = signed offset of A from tangent line (measured on N)
      const h1 = dot(sub(A, P), N);
      const h2 = dot(sub(B, P), N);
      const k1 = (2 / 3) * h1 / (a * a);
      const k2 = (2 / 3) * h2 / (b * b);
      const k = Math.sign(k1) === Math.sign(k2) ? (k1 + k2) / 2 : 0;
      const nh1 = (1.5 * k * a * a), nh2 = (1.5 * k * b * b);
      sp[3 * j - 2] = add(A, mul(N, nh1 - h1));
      sp[3 * j + 2] = add(B, mul(N, nh2 - h2));
    }
  }
}

/** Evaluate a spine at a global parameter in [0, n]. */
export function spinePoint(sp: Spine, g: number): V {
  const n = segCount(sp);
  const i = Math.min(n - 1, Math.max(0, Math.floor(g)));
  return bez(seg(sp, i), g - i);
}

/** Mirror a spine about x = cx. */
export function mirrorSpine(sp: Spine, cx: number): Spine {
  return sp.map((p) => [2 * cx - p[0], p[1]] as V);
}

/** A smooth single-segment spine from p0 leaving along dir0 to p1 (used for new forks). */
export function easySpine(p0: V, dir0: V, p1: V, bend = 0.35): Spine {
  const d = dist(p0, p1);
  const c1 = add(p0, mul(norm(dir0), d * 0.4));
  const mid = mul(add(c1, p1), 0.5);
  const off = mul(perp(norm(sub(p1, p0))), d * bend * 0.2);
  const c2 = add(mid, off);
  return [p0, c1, c2, p1];
}

export { len };
