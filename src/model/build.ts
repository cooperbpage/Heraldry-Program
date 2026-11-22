/**
 * Doc -> two-faced 3D cloth ribbons.
 *
 * Every strip (and every lobe and leaflet) is a ribbon of cloth: a centreline in the picture plane
 * with a depth z(s), a half width h(s), and a twist θ(s) that turns the ribbon's width direction
 * about its own tangent. The outer face is toward the viewer when θ = 0; as θ passes ±90° the
 * ribbon goes edge-on and beyond that its lining shows. A turn-over is a gradual half twist spread
 * along a stretch of the band (usually where it bends), with the turned part lifted toward the
 * viewer so it passes in front. Lobes are ribbons that issue from beneath their parent's edge and
 * inherit its twist, so they show the same face as the cloth they grow from, and their tips can
 * themselves curl over to show the lining. The renderer meshes these surfaces in 3D, so colour,
 * outline and shading all follow from the one surface.
 */
import { V, add, mul, perp, rot, dot, sub, clamp, lerp, smooth, rng, hash, Rng, angleOf } from '../geom/vec';
import { Spine } from '../geom/bezier';
import { Track, Sample, spineSamples, trackFromSamples, integrate, resample } from '../geom/track';
import { makeSpiral } from '../geom/spiral';
import type { Doc, Strip, ClusterEvent, TurnoverEvent, VoluteEvent, RollEvent, Settings, Side } from './types';

export const STEP = 1.5;
/** depth gained by the part of a ribbon beyond a turn-over (it passes in front) */
const LIFT = 26;

export interface Frame {
  o: V;
  ex: V;
  ey: V;
}
export const IDENTITY: Frame = { o: [0, 0], ex: [1, 0], ey: [0, 1] };
export const toWorld = (f: Frame, p: V): V => [f.o[0] + f.ex[0] * p[0] + f.ey[0] * p[1], f.o[1] + f.ex[1] * p[0] + f.ey[1] * p[1]];
export const toLocal = (f: Frame, p: V): V => {
  const d = sub(p, f.o);
  return [dot(d, f.ex), dot(d, f.ey)];
};

export interface Gap {
  /** material side of the ribbon (+1 = the +u / 'L' edge) */
  side: 1 | -1;
  s0: number;
  s1: number;
}

/** One cloth ribbon ready to mesh. */
export interface Ribbon {
  id: string;
  kind: 'strip' | 'leaf';
  stripId: string;
  eventId?: string;
  level: number;
  /** centreline in the picture plane */
  track: Track;
  /** true half width per side (material +u side = L) */
  hU: Float64Array;
  hD: Float64Array;
  /** twist and depth along the ribbon */
  th: Float64Array;
  z: Float64Array;
  /** projected half widths (for hit tests and framing) */
  hL: Float64Array;
  hR: Float64Array;
  gaps: Gap[];
  strokeStart: boolean;
  strokeEnd: boolean;
  rootDist: number;
  /** how strongly the cloth cups across its width */
  cup: number;
  midrib: boolean;
  /** cast-shadow / occlusion strength near the root */
  occlude: boolean;
  /** fraction of each half width rolled over at its edge (shows a strip of lining) */
  rollU?: Float64Array;
  rollD?: Float64Array;
  /** forward lean of each edge (arc-length shift of the edge point), so edge lobes sweep toward the tip */
  leanU?: Float64Array;
  leanD?: Float64Array;
}

/** Kept for the editor: ribbons are the drawable pieces. */
export type Piece = Ribbon;

export interface StripGeo {
  strip: Strip;
  frame: Frame;
  track: Track;
  /** full length of the authored Bézier spine, the unit for event t */
  Lb: number;
  /** projected half widths (what the eye sees), used by the editor */
  hL: Float64Array;
  hR: Float64Array;
  ribbon: Ribbon;
  spiralStart: number;
  creases: { s: number; slope: number; ev: TurnoverEvent }[];
  baseFace: 0 | 1;
  depth: number;
  rootDist: number;
  children: StripGeo[];
  gaps: Gap[];
}

export interface Built {
  pieces: Ribbon[];
  geos: StripGeo[];
  all: StripGeo[];
}

// ---------------------------------------------------------------------------
// helpers

/** C2 easing (smootherstep) */
export const ease = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
};

function interpKnots(knots: { t: number; w: number }[], t: number) {
  if (!knots.length) return 30;
  if (t <= knots[0].t) return knots[0].w;
  for (let i = 0; i < knots.length - 1; i++) {
    const a = knots[i], b = knots[i + 1];
    if (t <= b.t) {
      const u = (t - a.t) / Math.max(1e-6, b.t - a.t);
      const e = (1 - Math.cos(Math.PI * u)) / 2;
      return a.w + (b.w - a.w) * e;
    }
  }
  return knots[knots.length - 1].w;
}

export function hAt(arr: Float64Array, tr: Track, s: number) {
  const f = tr.idx(s);
  const i = Math.min(tr.n - 2, Math.floor(f));
  if (tr.n < 2) return arr[0];
  return arr[i] + (arr[i + 1] - arr[i]) * (f - i);
}

/** Projected point at (s, v) using projected half widths (editor handles and hit tests). */
export function P(tr: Track, hL: Float64Array, hR: Float64Array, s: number, v: number): V {
  const f = tr.idx(s);
  const i = Math.min(tr.n - 2, Math.max(0, Math.floor(f)));
  const t = f - i;
  const x = tr.x[i] + (tr.x[i + 1] - tr.x[i]) * t;
  const y = tr.y[i] + (tr.y[i + 1] - tr.y[i]) * t;
  let tx = tr.tx[i] + (tr.tx[i + 1] - tr.tx[i]) * t;
  let ty = tr.ty[i] + (tr.ty[i + 1] - tr.ty[i]) * t;
  const l = Math.hypot(tx, ty) || 1;
  tx /= l;
  ty /= l;
  const h = v >= 0 ? hL[i] + (hL[i + 1] - hL[i]) * t : hR[i] + (hR[i + 1] - hR[i]) * t;
  return [x - ty * v * h, y + tx * v * h];
}

/** Twist value at arc length s (interpolated). */
export function at(arr: Float64Array, tr: Track, s: number) {
  return hAt(arr, tr, s);
}

/** Visible face at s: 0 = outer, 1 = lining. */
export function faceOfTwist(th: number): 0 | 1 {
  return Math.cos(th) >= 0 ? 0 : 1;
}

/**
 * Limit the projected width on the inside of tight bends so the surface never folds through
 * itself, then fill in projected half widths. Works per material side.
 */
function finishWidths(tr: Track, hU: Float64Array, hD: Float64Array, th: Float64Array, erodeAfter = true) {
  const n = tr.n;
  const hL = new Float64Array(n), hR = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const c = Math.cos(th[i]);
    const k = tr.k[i];
    // projected offset of the +u edge is along +n when cos > 0; the inner side of the bend is
    // +n when k > 0. Scale the material half width on whichever side lands inside the bend.
    const lim = Math.abs(k) > 1e-6 ? 0.88 / Math.abs(k) : Infinity;
    const innerIsU = (k > 0) === (c >= 0);
    const ac = Math.max(1e-3, Math.abs(c));
    if (innerIsU) hU[i] = Math.min(hU[i], lim / ac);
    else hD[i] = Math.min(hD[i], lim / ac);
  }
  if (erodeAfter) erode(hU, hD);
  for (let i = 0; i < n; i++) {
    const c = Math.cos(th[i]);
    const pu = Math.max(0.4, hU[i] * Math.abs(c)), pd = Math.max(0.4, hD[i] * Math.abs(c));
    if (c >= 0) {
      hL[i] = pu;
      hR[i] = pd;
    } else {
      hL[i] = pd;
      hR[i] = pu;
    }
  }
  return { hL, hR };
}

function erode(hU: Float64Array, hD: Float64Array) {
  const n = hU.length;
  for (const h of [hU, hD]) {
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 1; i < n; i++) h[i] = Math.min(h[i], h[i - 1] + STEP * 0.9);
      for (let i = n - 2; i >= 0; i--) h[i] = Math.min(h[i], h[i + 1] + STEP * 0.9);
    }
  }
}

/** Projected direction (unit, picture plane) of a material side at station s. */
function sideDir(tr: Track, th: Float64Array, s: number, side: number): V {
  const a = tr.at(s);
  const c = Math.cos(at(th, tr, s));
  const sg = side * (c >= 0 ? 1 : -1);
  return mul(perp([a.tx, a.ty]), sg);
}

/** Smooth the curvature jump where a terminal volute meets its stem. */
function smoothJoin(pts: Sample[], cum: number[], sJoin: number, span: number) {
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const out = pts.map((p) => ({ ...p }));
  for (let i = 0; i < pts.length; i++) {
    const d = Math.abs(cum[i] - sJoin);
    if (d > span) continue;
    const w = 0.5 * (1 + Math.cos((Math.PI * d) / span));
    let sx = 0, sy = 0, sw = 0;
    for (let j = Math.max(0, i - 12); j <= Math.min(pts.length - 1, i + 12); j++) {
      const g = Math.exp(-(((j - i) / 6) ** 2));
      sx += xs[j] * g;
      sy += ys[j] * g;
      sw += g;
    }
    out[i].x = xs[i] + (sx / sw - xs[i]) * w;
    out[i].y = ys[i] + (sy / sw - ys[i]) * w;
  }
  for (let i = 0; i < out.length; i++) {
    const a = out[Math.max(0, i - 1)], b = out[Math.min(out.length - 1, i + 1)];
    const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    out[i].tx = (b.x - a.x) / l;
    out[i].ty = (b.y - a.y) / l;
  }
  return out;
}

/** Recompute signed curvature from positions (after any smoothing). */
function recomputeK(tr: Track) {
  for (let i = 1; i < tr.n - 1; i++) {
    const ax = tr.x[i] - tr.x[i - 1], ay = tr.y[i] - tr.y[i - 1];
    const bx = tr.x[i + 1] - tr.x[i], by = tr.y[i + 1] - tr.y[i];
    const cr = ax * by - ay * bx;
    const d = Math.hypot(ax, ay) * Math.hypot(bx, by) * Math.hypot(tr.x[i + 1] - tr.x[i - 1], tr.y[i + 1] - tr.y[i - 1]);
    tr.k[i] = d > 0 ? (2 * cr) / d : 0;
  }
  if (tr.n > 2) {
    tr.k[0] = tr.k[1];
    tr.k[tr.n - 1] = tr.k[tr.n - 2];
  }
}

// ---------------------------------------------------------------------------

interface Ctx {
  doc: Doc;
  ribbons: Ribbon[];
  all: StripGeo[];
  st: Settings;
}

export function build(doc: Doc): Built {
  const ctx: Ctx = { doc, ribbons: [], all: [], st: doc.settings };
  const geos: StripGeo[] = [];
  doc.strips.forEach((s, i) => {
    const zBase = (s.z ?? 0) * 12 + i * 0.01;
    geos.push(buildStrip(ctx, s, IDENTITY, 0, zBase, 0, 0));
  });
  return { pieces: ctx.ribbons, geos, all: ctx.all };
}

function worldSpine(sp: Spine, f: Frame): Spine {
  return sp.map((p) => toWorld(f, p));
}

function buildStrip(ctx: Ctx, strip: Strip, frame: Frame, th0: number, zBase: number, depth: number, rootDist: number, enforceDir?: V, rootW?: number): StripGeo {
  const st = ctx.st;
  let sp = worldSpine(strip.spine, frame);
  if (enforceDir && sp.length >= 4) {
    const l = Math.hypot(sp[1][0] - sp[0][0], sp[1][1] - sp[0][1]);
    sp = sp.slice();
    sp[1] = add(sp[0], mul(enforceDir, l));
  }
  const dense = spineSamples(sp);
  const Lb = dense.cum[dense.cum.length - 1] || 1;
  const term = strip.events.filter((e): e is VoluteEvent => e.kind === 'volute' && e.mode === 'terminal').sort((a, b) => a.t - b.t)[0];
  let track: Track;
  let spiralStart = -1;
  let spiralMax: { cum: number[]; maxW: number[] } | null = null;
  const knots = rootW !== undefined && strip.width.length ? [{ t: 0, w: rootW }, ...strip.width.slice(1)] : strip.width;
  if (term && term.t > 0.02 && term.t < 1) {
    const sv = term.t * Lb;
    let pts: Sample[] = [];
    const cum: number[] = [];
    for (let i = 0; i < dense.pts.length; i++) {
      if (dense.cum[i] > sv) break;
      pts.push(dense.pts[i]);
      cum.push(dense.cum[i]);
    }
    const tmp = resample(dense.pts, dense.cum, STEP);
    const a = tmp.at(sv);
    const eyeW = toWorld(frame, term.eye);
    const w0 = interpKnots(knots, term.t);
    const spi = makeSpiral([a.x, a.y], [a.tx, a.ty], eyeW, term.eyeR, term.turns, Math.max(1.2, w0 * 0.06));
    for (let i = 1; i < spi.samples.length; i++) {
      pts.push(spi.samples[i]);
      cum.push(sv + spi.cum[i]);
    }
    pts = smoothJoin(pts, cum, sv, Math.max(20, w0 * 1.5));
    track = resample(pts, cum, STEP);
    recomputeK(track);
    spiralStart = sv;
    spiralMax = { cum: spi.cum.map((c) => c + sv), maxW: spi.maxW };
  } else {
    track = resample(dense.pts, dense.cum, STEP);
  }
  const n = track.n, L = track.L;
  const hU = new Float64Array(n), hD = new Float64Array(n), th = new Float64Array(n), z = new Float64Array(n);
  const turnovers = strip.events.filter((e): e is TurnoverEvent => e.kind === 'turnover').sort((a, b) => a.t - b.t);
  const taperSpan = lerp(0.12, 0.45, st.taper);
  const tipW = 1.6;
  let mi = 0;
  for (let i = 0; i < n; i++) {
    const s = track.s[i];
    let w: number;
    if (spiralStart >= 0 && s > spiralStart) {
      const w0 = interpKnots(knots, term!.t);
      const u = (s - spiralStart) / Math.max(1, L - spiralStart);
      w = w0 * lerp(1, 0.32, Math.pow(u, 0.8));
      while (mi < spiralMax!.cum.length - 2 && spiralMax!.cum[mi + 1] < s) mi++;
      w = Math.min(w, spiralMax!.maxW[mi]);
      w = lerp(w, tipW, smooth(0.9, 1, u));
    } else {
      w = interpKnots(knots, s / Lb);
      if (spiralStart < 0) {
        const u = s / L;
        const f = smooth(1 - taperSpan, 1, u);
        const tipTo = Math.max(tipW, w * lerp(0.55, 0.12, st.taper));
        w = lerp(w, Math.min(w, tipTo), Math.pow(f, 1.3));
      }
    }
    hU[i] = hD[i] = Math.max(0.6, w / 2);
    // twist and depth: each turn-over is a gradual half twist; the turned part rises in front
    let t0 = th0, zz = zBase;
    for (const to of turnovers) {
      const c = to.t * Lb, half = Math.max(8, (to.length * Lb) / 2);
      const e = ease(c - half, c + half, s);
      const turn = ((to as TurnoverEvent & { turn?: number }).turn ?? 180) * (Math.PI / 180);
      t0 += (to.edge === 'L' ? 1 : -1) * turn * e;
      zz += LIFT * e;
    }
    th[i] = t0;
    z[i] = zz;
  }
  // clusters cut the band's own edge into large lobes that lean toward the tip
  finishWidths(track, hU, hD, th);
  const leans = edgeLobes(strip, track, Lb, hU, hD, st);
  const { hL, hR } = finishWidths(track, hU, hD, th, false);
  const rolls = strip.events.filter((e): e is RollEvent => e.kind === 'roll');
  let rollU: Float64Array | undefined, rollD: Float64Array | undefined;
  if (rolls.length) {
    rollU = new Float64Array(n);
    rollD = new Float64Array(n);
    for (const ro of rolls) {
      const a = Math.min(ro.t0, ro.t1) * Lb, b = Math.max(ro.t0, ro.t1) * Lb, ramp = Math.max(6, (b - a) * 0.2);
      const arr = ro.side === 'L' ? rollU : rollD;
      for (let i = 0; i < n; i++) {
        const s = track.s[i];
        const e = Math.min(ease(a, a + ramp, s), 1 - ease(b - ramp, b, s));
        arr[i] = Math.max(arr[i], clamp(ro.amount, 0, 0.6) * e);
      }
    }
  }
  const ribbon: Ribbon = {
    id: strip.id,
    rollU,
    rollD,
    leanU: leans.leanU,
    leanD: leans.leanD,
    kind: 'strip',
    stripId: strip.id,
    level: 0,
    track,
    hU,
    hD,
    th,
    z,
    hL,
    hR,
    gaps: [],
    strokeStart: depth === 0,
    strokeEnd: true,
    rootDist,
    cup: 0.22,
    midrib: true,
    occlude: depth === 0,
  };
  const creases = turnovers.map((ev) => ({ s: ev.t * Lb, slope: 0, ev }));
  const g: StripGeo = { strip, frame, track, Lb, hL, hR, ribbon, spiralStart, creases, baseFace: faceOfTwist(th0), depth, rootDist, children: [], gaps: ribbon.gaps };
  ctx.all.push(g);
  ctx.ribbons.push(ribbon);
  // children and foliage
  for (const ev of strip.events) {
    if (ev.kind === 'branch') {
      const s = clamp(ev.t * Lb, 0, L);
      const a = track.at(s);
      const T: V = [a.tx, a.ty];
      const sg = ev.side === 'L' ? 1 : -1;
      const d = sideDir(track, th, s, sg); // where that material edge appears
      const flip = dot(d, perp(T)) * sg >= 0 ? 1 : -1; // the frame mirrors when the parent shows its lining
      const h = (sg > 0 ? hU : hD)[track.idx(s) | 0] * Math.abs(Math.cos(at(th, track, s)));
      const o = add([a.x, a.y], mul(d, h * 0.35));
      const fr: Frame = { o, ex: T, ey: mul(perp(T), flip) };
      const dir = rot(T, flip * sg * (ev.angle * Math.PI) / 180);
      const zc = at(z, track, s) + (ev.crossing === 'front' ? 5 : -5);
      const child = buildStrip(ctx, ev.child, fr, at(th, track, s), zc, depth + 1, rootDist + s, dir, ev.rootWidth);
      g.children.push(child);
      // the branch issues from beneath the parent's edge
      gapFor(ribbon, child.ribbon, s, sg);
    } else if (ev.kind === 'volute' && ev.mode === 'branching') {
      branchingVolute(ctx, g, ev);
    } else if (ev.kind === 'cluster') {
      clusterRibbons(ctx, g, ev);
    }
  }
  return g;
}

/**
 * Acanthus: within a cluster's interval the cloth grows outward on that side into a few large lobes,
 * each rising gently to a forward-leaning point and dropping sharply into a deep notch; the lobes
 * swell toward the middle of the cluster. Smaller teeth cut the lobes' backs.
 */
export function edgeLobes(strip: Strip, tr: Track, Lb: number, hU: Float64Array, hD: Float64Array, st: Settings) {
  let leanU: Float64Array | undefined, leanD: Float64Array | undefined;
  for (const ev of strip.events) {
    if (ev.kind !== 'cluster') continue;
    const s0 = Math.min(ev.t0, ev.t1) * Lb, s1 = Math.max(ev.t0, ev.t1) * Lb;
    if (s1 - s0 < 8) continue;
    const R = rng(hash(strip.id + ev.id + 'edge', ev.seed ?? 0));
    const U = ev.side === 'L';
    const arr = U ? hU : hD;
    if (U && !leanU) leanU = new Float64Array(tr.n);
    if (!U && !leanD) leanD = new Float64Array(tr.n);
    const lean = U ? leanU! : leanD!;
    const iMid = clamp(Math.round(tr.idx((s0 + s1) / 2)), 0, tr.n - 1);
    const h0 = arr[iMid];
    const n = clamp(Math.round((s1 - s0) / (h0 * 3.2)), 2, 5);
    const amp = h0 * ev.size * lerp(1.4, 2.8, st.lobeDepth);
    const cuts: number[] = [0];
    for (let i = 0; i < n; i++) cuts.push(cuts[i] + R.range(0.8, 1.25));
    const tot = cuts[n];
    // the lobes grow from small to large and back: the broad blade, then smaller toward the tip
    const sizes = Array.from({ length: n }, (_, i) => lerp(0.55, 1, Math.sin((Math.PI * (i + 0.7)) / (n + 0.4))) * R.range(0.85, 1.1));
    const notch = lerp(0.7, 0.85, st.sharpness);
    for (let i = 0; i < tr.n; i++) {
      const s = tr.s[i];
      if (s <= s0 || s >= s1) continue;
      const x = ((s - s0) / (s1 - s0)) * tot;
      let k = 0;
      while (k < n - 1 && x > cuts[k + 1]) k++;
      const p = (x - cuts[k]) / (cuts[k + 1] - cuts[k]);
      // a rounded lobe whose crest sits forward, with deep rounded notches between lobes
      const q = Math.pow(p, 0.8);
      const bump = Math.pow(Math.sin(Math.PI * q), 0.5);
      const shape = 1 - notch + notch * bump;
      const env = Math.pow(Math.sin(Math.PI * ((s - s0) / (s1 - s0))), 0.4);
      const extra = amp * sizes[k] * env * shape * smooth(0, 0.12, (s - s0) / (s1 - s0)) * (1 - smooth(0.88, 1, (s - s0) / (s1 - s0)));
      arr[i] += extra;
      // the lobe's outer part leans toward the tip, more so near its crest
      lean[i] = Math.max(lean[i], 0.7 * extra * Math.sin(Math.PI * Math.min(1, p * 1.1)));
    }
  }
  // the lean may not change faster than the cloth advances, or the surface would fold through itself
  for (const l of [leanU, leanD]) {
    if (!l) continue;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 1; i < tr.n; i++) l[i] = Math.min(l[i], l[i - 1] + STEP * 0.45);
      for (let i = tr.n - 2; i >= 0; i--) l[i] = Math.min(l[i], l[i + 1] + STEP * 0.45);
    }
  }
  // likewise the lobed width, so notches stay rounded rather than stepping
  for (const h of [hU, hD]) {
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 1; i < tr.n; i++) h[i] = Math.min(h[i], h[i - 1] + STEP * 1.6);
      for (let i = tr.n - 2; i >= 0; i--) h[i] = Math.min(h[i], h[i + 1] + STEP * 1.6);
    }
  }
  return { leanU, leanD };
}

/** Leave the parent's edge unstroked where a child emerges from beneath it. */
function gapFor(parent: Ribbon, child: Ribbon, s: number, materialSide: number) {
  const ptr = parent.track;
  const i0 = Math.max(0, Math.floor(ptr.idx(s)) - 60), i1 = Math.min(ptr.n - 1, Math.ceil(ptr.idx(s)) + 60);
  const region: Region = { track: ptr, hL: parent.hL, hR: parent.hR, i0, i1 };
  const cross: number[] = [];
  const ctr = child.track;
  for (const v of [1, -1]) {
    for (let i = 0; i < ctr.n; i++) {
      const q = P(ctr, child.hL, child.hR, ctr.s[i], v);
      const r = inRegion(region, q);
      if (!r.inside) {
        cross.push(r.s);
        break;
      }
    }
  }
  if (cross.length === 2) parent.gaps.push({ side: materialSide > 0 ? 1 : -1, s0: Math.min(...cross) - 0.8, s1: Math.max(...cross) + 0.8 });
}

// ---------------------------------------------------------------------------
// Branching volute: a coil that springs from the stem while the stem continues

function branchingVolute(ctx: Ctx, g: StripGeo, ev: VoluteEvent) {
  const tr = g.track, rb = g.ribbon;
  const s = clamp(ev.t * g.Lb, 0, tr.L);
  const a = tr.at(s);
  const T: V = [a.tx, a.ty];
  const eye = toWorld(g.frame, ev.eye);
  const side = dot(sub(eye, [a.x, a.y]), perp(T)) >= 0 ? 1 : -1;
  const start = P(tr, g.hL, g.hR, s, side * 0.3);
  const dir = rot(T, side * 0.5);
  const w0 = ev.width ?? Math.min(hAt(g.hL, tr, s), hAt(g.hR, tr, s)) * 1.4;
  const spi = makeSpiral(start, dir, eye, ev.eyeR, ev.turns, Math.max(1, w0 * 0.06));
  const ctr = trackFromSamples(spi.samples, STEP);
  const n = ctr.n;
  const hU = new Float64Array(n), hD = new Float64Array(n), th = new Float64Array(n), z = new Float64Array(n);
  const th0 = at(rb.th, tr, s), z0 = at(rb.z, tr, s) + (ev.crossing === 'front' ? 5 : -5);
  let mi = 0;
  for (let i = 0; i < n; i++) {
    const u = ctr.s[i] / ctr.L;
    while (mi < spi.cum.length - 2 && spi.cum[mi + 1] < ctr.s[i]) mi++;
    let w = w0 * lerp(1, 0.3, Math.pow(u, 0.8));
    w = Math.min(w, spi.maxW[mi]);
    w = lerp(w, 1.6, smooth(0.9, 1, u));
    hU[i] = hD[i] = w / 2;
    th[i] = th0;
    z[i] = z0;
  }
  const { hL, hR } = finishWidths(ctr, hU, hD, th);
  const r: Ribbon = { id: `${g.strip.id}:${ev.id}`, kind: 'leaf', stripId: g.strip.id, eventId: ev.id, level: 1, track: ctr, hU, hD, th, z, hL, hR, gaps: [], strokeStart: false, strokeEnd: true, rootDist: g.rootDist + s, cup: 0.25, midrib: true, occlude: false };
  ctx.ribbons.push(r);
  gapFor(rb, r, s, side * (Math.cos(th0) >= 0 ? 1 : -1));
}

// ---------------------------------------------------------------------------
// Foliage

export interface Region {
  track: Track;
  hL: Float64Array;
  hR: Float64Array;
  i0: number;
  i1: number;
}

export function inRegion(ex: Region, q: V): { inside: boolean; s: number } {
  const tr = ex.track;
  let best = Infinity, inside = false, s = 0;
  for (let i = ex.i0; i <= ex.i1; i++) {
    const dx = q[0] - tr.x[i], dy = q[1] - tr.y[i];
    const along = dx * tr.tx[i] + dy * tr.ty[i];
    const d2 = dx * dx + dy * dy;
    if (Math.abs(along) <= STEP * 0.8 && d2 < best) {
      best = d2;
      const across = -dx * tr.ty[i] + dy * tr.tx[i];
      inside = across <= ex.hL[i] && across >= -ex.hR[i];
      s = tr.s[i];
    }
  }
  return { inside, s };
}

interface LeafSpec {
  parent: Ribbon;
  sBase: number;
  baseHalf: number;
  /** material side of the parent it grows from */
  side: number;
  length: number;
  depth: number;
  split: number[];
  level: number;
  alpha?: number;
  /** probability the tip curls over to show the lining */
  curl: number;
  /** probability the outer edge rolls over */
  roll: number;
}

function clusterRibbons(ctx: Ctx, g: StripGeo, ev: ClusterEvent) {
  const st = ctx.st;
  const rb = g.ribbon, tr = rb.track;
  const L = tr.L;
  const s0 = clamp(Math.min(ev.t0, ev.t1) * g.Lb, 0, L), s1 = clamp(Math.max(ev.t0, ev.t1) * g.Lb, 0, L);
  if (s1 - s0 < 3) return;
  const R = rng(hash(g.strip.id + ev.id, ev.seed ?? 0));
  const sg = ev.side === 'L' ? 1 : -1;
  const hs = (s: number) => hAt(sg > 0 ? rb.hU : rb.hD, tr, s);
  const span = s1 - s0;
  const wm = Math.max(4, hAt(rb.hU, tr, (s0 + s1) / 2) + hAt(rb.hD, tr, (s0 + s1) / 2));
  const nL = clamp(Math.round(span / (wm * 1.6)), 1, 3);
  const wts: number[] = [];
  for (let i = 0; i < nL; i++) wts.push(R.range(0.7, 1.4));
  const tot = wts.reduce((a, b) => a + b, 0);
  const lobes: { sb: number; part: number; rel: number }[] = [];
  let acc = s0;
  const dominant = R.chance(0.65) ? nL - 1 : R.int(0, nL - 1);
  for (let i = 0; i < nL; i++) {
    const part = (span * wts[i]) / tot;
    lobes.push({ sb: acc + part * 0.55, part, rel: i === dominant ? 1 : R.range(0.5, 0.8) });
    acc += part;
  }
  const curl = ev.curl ?? lerp(0.15, 0.75, st.recurve);
  const roll = ev.roll ?? 0.5;
  for (let i = lobes.length - 1; i >= 0; i--) {
    if (i !== lobes.length - 1) continue;
    const lb = lobes[i];
    const h = hs(lb.sb);
    const w = hAt(rb.hU, tr, lb.sb) + hAt(rb.hD, tr, lb.sb);
    const length = w * ev.size * lerp(1.6, 3.0, st.lobeDepth) * R.range(0.9, 1.12) + h * 0.8;
    leaf(ctx, R, {
      parent: rb,
      sBase: lb.sb,
      baseHalf: Math.min(clamp(lb.part * 0.6, h * 1.0, h * 2.0), length * 0.22),
      side: sg,
      length,
      depth: ev.depth,
      split: ev.split,
      level: 1,
      curl,
      roll,
    }, g.strip.id, ev.id, `${i}`);
  }
}

/**
 * A lobe: a ribbon issuing from beneath its parent's edge, leaving at an angle, sweeping out and
 * hooking forward with steadily increasing curvature. It inherits the parent's twist (so it shows
 * the same face) and its tip may curl over to show the lining. Smaller lobes split off its flanks.
 */
function leaf(ctx: Ctx, R: Rng, sp: LeafSpec, stripId: string, eventId: string, path: string) {
  const st = ctx.st;
  if (sp.level > 1 && (sp.length < 14 || sp.baseHalf < 2.2)) return;
  const ptr = sp.parent.track;
  const a = ptr.at(sp.sBase);
  const T: V = [a.tx, a.ty];
  const thP = at(sp.parent.th, ptr, sp.sBase);
  const N = sideDir(ptr, sp.parent.th, sp.sBase, sp.side);
  const hProj = Math.max(0.5, hAt(sp.side > 0 ? sp.parent.hU : sp.parent.hD, ptr, sp.sBase) * Math.abs(Math.cos(thP)));
  const B = add([a.x, a.y], mul(N, hProj * 0.3));
  const alpha = sp.alpha ?? (lerp(sp.level === 1 ? 32 : 24, sp.level === 1 ? 52 : 40, R.next()) * Math.PI) / 180;
  const rsg = dot(rot(T, 0.1), N) > 0 ? 1 : -1;
  const a0 = angleOf(rot(T, rsg * alpha));
  const Ll = Math.max(5, sp.length);
  const beta = (lerp(40, 110, st.recurve) * R.range(0.8, 1.2) * Math.PI) / 180;
  const turn = -rsg;
  // a flame: it leans out, then sweeps forward along the stem and hooks at the tip; the
  // curvature rises and falls smoothly (no corners), concentrated toward the tip
  const kf = (s: number) => {
    const u = s / Ll;
    const out = -0.35 * Math.sin(Math.PI * Math.min(1, u / 0.45)) * (u < 0.45 ? 1 : 0);
    const hook = Math.pow(Math.sin((Math.PI / 2) * u), 1.4) * 1.6;
    return (turn * beta * (hook + out)) / Ll;
  };
  const samples = integrate(B, a0, Ll, kf, Math.max(30, Math.ceil(Ll / 1.2)));
  const tr = trackFromSamples(samples, Math.min(STEP, Ll / 30));
  const n = tr.n;
  const hU = new Float64Array(n), hD = new Float64Array(n), th = new Float64Array(n), z = new Float64Array(n);
  const sharp = st.sharpness;
  const pp = lerp(2.4, 1.05, sharp), qq = lerp(0.5, 1.25, sharp);
  const env = (u: number) => {
    if (u < 0.22) return lerp(1, 1.1, smooth(0, 0.22, u));
    const x = (u - 0.22) / 0.78;
    return 1.1 * Math.pow(Math.max(0, 1 - Math.pow(x, pp)), qq);
  };
  const asym = R.range(0.1, 0.28);
  // does the tip curl over? if so, by how much and which way
  const curls = R.chance(sp.level === 1 ? sp.curl : sp.curl * 0.5);
  const tipTurn = curls ? R.range(0.8, 1.0) * Math.PI * (R.chance(0.5) ? 1 : -1) : 0;
  const zBase = at(sp.parent.z, ptr, sp.sBase) - 3 - sp.level;
  // acanthus: the convex edge is cut into soft scallops between the attendant points
  const concaveU = turn > 0;
  // acanthus fingers: the outer edge is cut by deep, sharp notches into rounded fingers that lean
  // toward the tip; the inner edge gets fewer, shallower cuts
  const nScal = sp.level === 1 ? R.int(3, 4) : 2;
  const scalDepth = sp.level === 1 ? R.range(0.62, 0.8) : R.range(0.35, 0.5);
  const fingers = (u: number, n: number, depth: number) => {
    if (u < 0.12) return 1;
    const x = (u - 0.12) / 0.88;
    const p = (x * n) % 1;
    // rises gently to a rounded top late in each period, then drops sharply into the notch
    // each finger swells, then comes to a point that leans forward before the notch
    const g = Math.pow(Math.sin((Math.PI / 2) * Math.pow(p, 0.9)), 0.55);
    return 1 - depth * (1 - g) * smooth(0, 0.15, x);
  };
  const scal = (u: number) => fingers(u, nScal, scalDepth);
  const scalIn = (u: number) => fingers(u, Math.max(2, nScal - 1), scalDepth * 0.4);
  const rolls = sp.level <= 2 && R.chance(sp.roll);
  const rollAmt = rolls ? R.range(0.22, 0.38) : 0;
  const rollU = rolls ? new Float64Array(n) : undefined;
  const rollD = rolls ? new Float64Array(n) : undefined;
  for (let i = 0; i < n; i++) {
    const u = tr.s[i] / tr.L;
    const w = sp.baseHalf * env(u);
    const convexW = w * (1 + asym) * scal(u);
    const concaveW = w * (1 - asym) * scalIn(u);
    hU[i] = Math.max(0.3, concaveU ? concaveW : convexW);
    hD[i] = Math.max(0.3, concaveU ? convexW : concaveW);
    const e = ease(0.3, 0.85, u);
    th[i] = thP + tipTurn * e;
    z[i] = zBase + 10 * e * (curls ? 1 : 0);
    if (rolls) {
      const rr = rollAmt * ease(0.08, 0.3, u) * (1 - ease(0.75, 0.95, u));
      // the convex (outer) edge rolls over
      if (concaveU) rollD![i] = rr;
      else rollU![i] = rr;
    }
  }
  const { hL, hR } = finishWidths(tr, hU, hD, th);
  const r: Ribbon = {
    id: `${stripId}:${eventId}:${path}`,
    kind: 'leaf',
    stripId,
    eventId,
    level: sp.level,
    track: tr,
    hU,
    hD,
    th,
    z,
    hL,
    hR,
    gaps: [],
    strokeStart: false,
    strokeEnd: true,
    rootDist: sp.parent.rootDist + sp.sBase,
    cup: 0.35,
    midrib: sp.level <= 1 && Ll > 25,
    occlude: false,
    rollU,
    rollD,
  };
  ctx.ribbons.push(r);
  gapFor(sp.parent, r, sp.sBase, sp.side);
  // attendants along both flanks (larger on the convex side), each splitting again if depth allows
  if (sp.depth > 2 && sp.split.length > 1) {
    const parts = sp.split.slice(1, 3);
    const lead = sp.split[0] || 1;
    const k = parts.length;
    const convexU = turn > 0 ? -1 : 1;
    const specs: { u: number; side: number; rel: number }[] = [];
    for (let j = 0; j < k; j++) specs.push({ u: lerp(0.18, 0.64, k === 1 ? 0.5 : j / (k - 1)) + R.range(-0.04, 0.04), side: convexU, rel: clamp(parts[j] / lead, 0.15, 0.95) });
    const nc = R.chance(0.5) ? 1 : 0;
    for (let j = 0; j < nc; j++) specs.push({ u: lerp(0.3, 0.7, nc === 1 ? 0.5 : j / (nc - 1)) + R.range(-0.03, 0.03), side: -convexU, rel: clamp((parts[Math.min(parts.length - 1, j + 1)] / lead) * 0.75, 0.12, 0.7) });
    for (const sp2 of specs) {
      const sb = sp2.u * tr.L;
      const lh = hAt(sp2.side > 0 ? hU : hD, tr, sb);
      const convex = sp2.side === convexU;
      leaf(ctx, R, {
        parent: r,
        sBase: sb,
        baseHalf: Math.min(Math.max(0.8, lh * lerp(0.8, 1.15, sp2.rel)), Ll * sp2.rel * 0.2),
        side: sp2.side,
        length: Ll * sp2.rel * lerp(0.7, 0.92, R.next()) * (convex ? 1 : 0.7),
        alpha: (lerp(convex ? 30 : 22, convex ? 52 : 38, R.next()) * Math.PI) / 180,
        depth: sp.depth - 1,
        split: sp.split.slice(0, Math.max(2, sp.split.length - 1)).map((x, i) => (i === 0 ? x : x * R.range(0.75, 1.1))),
        level: sp.level + 1,
        curl: sp.curl,
        roll: sp.roll * 0.6,
      }, stripId, eventId, `${path}.${specs.indexOf(sp2)}`);
    }
  }
}

/** Visible face of a strip at s (0 outer, 1 lining), for the editor and checks. */
export function faceAt(g: StripGeo, s: number, _v = 0): 0 | 1 {
  return faceOfTwist(at(g.ribbon.th, g.track, s));
}

export { trackFromSamples };
export type { Sample as _Sample };
export type { Rng as _Rng, Side as _Side };
