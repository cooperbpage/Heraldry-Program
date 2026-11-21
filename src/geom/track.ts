import { V, norm } from './vec';
import { Spine, segCount, seg, bez, bez1, bezK } from './bezier';

/** A raw sample along a curve. */
export interface Sample {
  x: number;
  y: number;
  tx: number;
  ty: number;
  k: number;
}

/**
 * A curve resampled uniformly in arc length. Index i sits at arc length s[i] = i * step
 * (the last station may be closer). Everything that renders cloth is built on tracks, so
 * every surface has a true along-coordinate (s) and a cross-coordinate (v).
 */
export class Track {
  n: number;
  x: Float64Array;
  y: Float64Array;
  tx: Float64Array;
  ty: Float64Array;
  k: Float64Array;
  s: Float64Array;
  L: number;
  constructor(n: number) {
    this.n = n;
    this.x = new Float64Array(n);
    this.y = new Float64Array(n);
    this.tx = new Float64Array(n);
    this.ty = new Float64Array(n);
    this.k = new Float64Array(n);
    this.s = new Float64Array(n);
    this.L = 0;
  }
  /** Fractional index for an arc length. */
  idx(s: number) {
    if (s <= 0) return 0;
    if (s >= this.L) return this.n - 1;
    // stations are uniform except possibly the last gap
    const step = this.n > 1 ? this.s[1] : 1;
    let i = Math.min(this.n - 2, Math.floor(s / step));
    while (i < this.n - 2 && this.s[i + 1] < s) i++;
    while (i > 0 && this.s[i] > s) i--;
    const d = this.s[i + 1] - this.s[i];
    return i + (d > 0 ? (s - this.s[i]) / d : 0);
  }
  at(s: number): Sample {
    const f = this.idx(s);
    const i = Math.min(this.n - 2, Math.floor(f));
    const t = f - i;
    if (this.n < 2) return { x: this.x[0], y: this.y[0], tx: this.tx[0], ty: this.ty[0], k: this.k[0] };
    const tx = this.tx[i] + (this.tx[i + 1] - this.tx[i]) * t;
    const ty = this.ty[i] + (this.ty[i + 1] - this.ty[i]) * t;
    const l = Math.hypot(tx, ty) || 1;
    return {
      x: this.x[i] + (this.x[i + 1] - this.x[i]) * t,
      y: this.y[i] + (this.y[i + 1] - this.y[i]) * t,
      tx: tx / l,
      ty: ty / l,
      k: this.k[i] + (this.k[i + 1] - this.k[i]) * t,
    };
  }
  point(s: number): V {
    const a = this.at(s);
    return [a.x, a.y];
  }
}

/** Dense analytic samples of a Bézier spine with cumulative arc length. */
export function spineSamples(sp: Spine, perSegMin = 24): { pts: Sample[]; cum: number[] } {
  const pts: Sample[] = [];
  const cum: number[] = [];
  const n = segCount(sp);
  let acc = 0;
  let prev: V | null = null;
  for (let i = 0; i < n; i++) {
    const c = seg(sp, i);
    const chord = Math.hypot(c[3][0] - c[0][0], c[3][1] - c[0][1]) + Math.hypot(c[1][0] - c[0][0], c[1][1] - c[0][1]) + Math.hypot(c[3][0] - c[2][0], c[3][1] - c[2][1]);
    const m = Math.max(perSegMin, Math.ceil(chord / 1.5));
    for (let j = i === 0 ? 0 : 1; j <= m; j++) {
      const t = j / m;
      const p = bez(c, t);
      let d = bez1(c, t);
      if (Math.hypot(d[0], d[1]) < 1e-9) d = bez1(c, Math.min(1, Math.max(0, t + (t < 0.5 ? 1e-3 : -1e-3))));
      const T = norm(d);
      if (prev) acc += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
      prev = p;
      pts.push({ x: p[0], y: p[1], tx: T[0], ty: T[1], k: bezK(c, t) });
      cum.push(acc);
    }
  }
  return { pts, cum };
}

/** Resample dense samples uniformly in arc length. */
export function resample(pts: Sample[], cum: number[], step = 1.5): Track {
  const L = cum[cum.length - 1] || 0;
  const n = Math.max(2, Math.ceil(L / step) + 1);
  const tr = new Track(n);
  tr.L = L;
  let j = 0;
  for (let i = 0; i < n; i++) {
    const s = Math.min(L, i * step);
    while (j < cum.length - 2 && cum[j + 1] < s) j++;
    const d = cum[j + 1] - cum[j];
    const t = d > 0 ? Math.min(1, Math.max(0, (s - cum[j]) / d)) : 0;
    const a = pts[j], b = pts[Math.min(pts.length - 1, j + 1)];
    tr.x[i] = a.x + (b.x - a.x) * t;
    tr.y[i] = a.y + (b.y - a.y) * t;
    let tx = a.tx + (b.tx - a.tx) * t, ty = a.ty + (b.ty - a.ty) * t;
    const l = Math.hypot(tx, ty) || 1;
    tr.tx[i] = tx / l;
    tr.ty[i] = ty / l;
    tr.k[i] = a.k + (b.k - a.k) * t;
    tr.s[i] = s;
  }
  return tr;
}

export function trackFromSpine(sp: Spine, step = 1.5) {
  const { pts, cum } = spineSamples(sp);
  return resample(pts, cum, step);
}

/** Build a track from a sequence of samples whose arc lengths are implied by positions. */
export function trackFromSamples(pts: Sample[], step = 1.5) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  return resample(pts, cum, step);
}

/** Integrate a curve from a start point and heading with a curvature function of arc length. */
export function integrate(p: V, heading: number, L: number, kf: (s: number) => number, steps = 60): Sample[] {
  const out: Sample[] = [];
  let x = p[0], y = p[1], a = heading;
  const h = L / steps;
  for (let i = 0; i <= steps; i++) {
    const s = i * h;
    const k = kf(s);
    out.push({ x, y, tx: Math.cos(a), ty: Math.sin(a), k });
    // midpoint rule on heading
    const am = a + 0.5 * h * k;
    x += Math.cos(am) * h;
    y += Math.sin(am) * h;
    a += h * (0.5 * (k + kf(Math.min(L, s + h))));
  }
  return out;
}
