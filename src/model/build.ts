/**
 * Doc -> ordered list of cloth pieces. Every piece is a region of a Track described in that
 * track's own (s, v) coordinates, so outline, shading, hatching and midrib are all generated
 * from one mapping and can never drift apart.
 */
import { V, add, mul, perp, rot, dot, sub, clamp, lerp, smooth, rng, hash, Rng, angleOf } from '../geom/vec';
import { Spine } from '../geom/bezier';
import { Track, Sample, spineSamples, trackFromSamples, integrate, resample } from '../geom/track';
import { makeSpiral } from '../geom/spiral';
import type { Doc, Strip, ClusterEvent, TurnoverEvent, VoluteEvent, Settings, Side } from './types';

export const STEP = 1.5;

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

export type Kind = 'strip' | 'leaf' | 'lip' | 'rim';

export interface Piece {
  id: string;
  kind: Kind;
  /** owning strip id + event id (for hit testing / selection) */
  stripId: string;
  eventId?: string;
  track: Track;
  hL: Float64Array;
  hR: Float64Array;
  s0: (v: number) => number;
  s1: (v: number) => number;
  vMin: number;
  vMax: number;
  face: 0 | 1;
  /** strength of the cupped-lobe shading (darker at base) */
  cup: number;
  /** fill fades in over this arc length from the start (lobe bases melt into the parent) */
  alphaIn: number;
  /** fold shadow at the start (just past a crease) */
  startShade: number;
  strokeStart: boolean;
  strokeEnd: boolean;
  exclude?: { track: Track; hL: Float64Array; hR: Float64Array; i0: number; i1: number };
  /** arc length from the helm root (for occlusion) at s=0 of this piece's track */
  rootDist: number;
  level: number;
  midrib: boolean;
  /** stretches of an edge left unstroked because foliage issues from beneath it */
  gaps?: Gap[];
}

export interface Gap {
  side: 1 | -1;
  s0: number;
  s1: number;
}

export interface StripGeo {
  strip: Strip;
  frame: Frame;
  track: Track;
  /** full length of the authored Bézier spine, the unit for event t */
  Lb: number;
  hL: Float64Array;
  hR: Float64Array;
  /** where a terminal volute replaces the spine (abs arc), or -1 */
  spiralStart: number;
  creases: { s: number; slope: number; ev: TurnoverEvent }[];
  baseFace: 0 | 1;
  depth: number;
  rootDist: number;
  children: StripGeo[];
  gaps: Gap[];
}

export interface Built {
  pieces: Piece[];
  geos: StripGeo[];
  /** every strip geo, flattened (for hit tests) */
  all: StripGeo[];
}

// ---------------------------------------------------------------------------

function interpKnots(knots: { t: number; w: number }[], t: number) {
  if (!knots.length) return 30;
  if (t <= knots[0].t) return knots[0].w;
  for (let i = 0; i < knots.length - 1; i++) {
    const a = knots[i], b = knots[i + 1];
    if (t <= b.t) {
      const u = (t - a.t) / Math.max(1e-6, b.t - a.t);
      // smooth (cosine) interpolation keeps swells rounded
      const e = (1 - Math.cos(Math.PI * u)) / 2;
      return a.w + (b.w - a.w) * e;
    }
  }
  return knots[knots.length - 1].w;
}

/** Clamp each side's half width to the local radius of curvature so offsets never fold, then smooth. */
function clampToCurvature(tr: Track, hL: Float64Array, hR: Float64Array) {
  const n = tr.n;
  for (let i = 0; i < n; i++) {
    const k = tr.k[i];
    if (k > 1e-6) hL[i] = Math.min(hL[i], 0.9 / k);
    else if (k < -1e-6) hR[i] = Math.min(hR[i], 0.9 / -k);
  }
  for (const h of [hL, hR]) {
    // erode: a station may not exceed its neighbours by more than a gentle slope
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 1; i < n; i++) h[i] = Math.min(h[i], h[i - 1] + STEP * 0.9);
      for (let i = n - 2; i >= 0; i--) h[i] = Math.min(h[i], h[i + 1] + STEP * 0.9);
    }
    const c = Float64Array.from(h);
    for (let i = 2; i < n - 2; i++) h[i] = Math.min(c[i], (c[i - 2] + c[i - 1] + c[i] + c[i + 1] + c[i + 2]) / 5);
  }
}

export function hAt(arr: Float64Array, tr: Track, s: number) {
  const f = tr.idx(s);
  const i = Math.min(tr.n - 2, Math.floor(f));
  if (tr.n < 2) return arr[0];
  return arr[i] + (arr[i + 1] - arr[i]) * (f - i);
}

/** Point at (s, v) on a track with per-side half widths. */
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

const sideSign = (s: Side) => (s === 'L' ? 1 : -1);

// ---------------------------------------------------------------------------

export function build(doc: Doc): Built {
  const ctx: Ctx = { doc, pieces: [], all: [], st: doc.settings };
  const geos: StripGeo[] = [];
  const order = doc.strips.map((s, i) => ({ s, i })).sort((a, b) => (a.s.z ?? 0) - (b.s.z ?? 0) || a.i - b.i);
  for (const { s } of order) {
    const g = buildStrip(ctx, s, IDENTITY, 0, 0, 0);
    geos.push(g);
  }
  for (const g of geos) emit(ctx, g);
  return { pieces: ctx.pieces, geos, all: ctx.all };
}

interface Ctx {
  doc: Doc;
  pieces: Piece[];
  all: StripGeo[];
  st: Settings;
  pending?: Map<StripGeo, { behind: (() => void)[]; front: (() => void)[] }>;
}

/** Transform a local spine into world coordinates. */
function worldSpine(sp: Spine, f: Frame): Spine {
  return sp.map((p) => toWorld(f, p));
}

export function buildStrip(ctx: Ctx, strip: Strip, frame: Frame, baseFace: 0 | 1, depth: number, rootDist: number, enforceDir?: V): StripGeo {
  const st = ctx.st;
  let sp = worldSpine(strip.spine, frame);
  if (enforceDir && sp.length >= 4) {
    const l = Math.hypot(sp[1][0] - sp[0][0], sp[1][1] - sp[0][1]);
    sp = sp.slice();
    sp[1] = add(sp[0], mul(enforceDir, l));
  }
  const dense = spineSamples(sp);
  const Lb = dense.cum[dense.cum.length - 1] || 1;
  const term = strip.events
    .filter((e): e is VoluteEvent => e.kind === 'volute' && e.mode === 'terminal')
    .sort((a, b) => a.t - b.t)[0];
  let track: Track;
  let spiralStart = -1;
  let spiralMax: { cum: number[]; maxW: number[] } | null = null;
  if (term && term.t > 0.02 && term.t < 1) {
    const sv = term.t * Lb;
    const pts: Sample[] = [];
    const cum: number[] = [];
    for (let i = 0; i < dense.pts.length; i++) {
      if (dense.cum[i] > sv) break;
      pts.push(dense.pts[i]);
      cum.push(dense.cum[i]);
    }
    const tmp = resample(dense.pts, dense.cum, STEP);
    const a = tmp.at(sv);
    const eyeW = toWorld(frame, term.eye);
    const w0 = interpKnots(strip.width, term.t);
    const spi = makeSpiral([a.x, a.y], [a.tx, a.ty], eyeW, term.eyeR, term.turns, Math.max(1.2, w0 * 0.06));
    const base = sv;
    for (let i = 1; i < spi.samples.length; i++) {
      pts.push(spi.samples[i]);
      cum.push(base + spi.cum[i]);
    }
    if (pts.length < 2) pts.push(spi.samples[0]), cum.push(base);
    // make sure the join sample is the exact entry
    track = resample(pts, cum, STEP);
    spiralStart = sv;
    spiralMax = { cum: spi.cum.map((c) => c + base), maxW: spi.maxW };
  } else {
    track = resample(dense.pts, dense.cum, STEP);
  }
  const n = track.n;
  const L = track.L;
  const hL = new Float64Array(n), hR = new Float64Array(n);
  const turnovers = strip.events.filter((e): e is TurnoverEvent => e.kind === 'turnover').sort((a, b) => a.t - b.t);
  const taperSpan = lerp(0.12, 0.45, st.taper);
  const tipW = 1.6;
  let mi = 0;
  for (let i = 0; i < n; i++) {
    const s = track.s[i];
    let w: number;
    if (spiralStart >= 0 && s > spiralStart) {
      const w0 = interpKnots(strip.width, term!.t);
      const u = (s - spiralStart) / Math.max(1, L - spiralStart);
      w = w0 * lerp(1, 0.3, Math.pow(u, 0.8));
      while (mi < spiralMax!.cum.length - 2 && spiralMax!.cum[mi + 1] < s) mi++;
      w = Math.min(w, spiralMax!.maxW[mi]);
      const tail = smooth(0.9, 1, u);
      w = lerp(w, tipW, tail);
    } else {
      w = interpKnots(strip.width, s / Lb);
      if (spiralStart < 0) {
        const u = s / L;
        const f = smooth(1 - taperSpan, 1, u);
        const tipTo = Math.max(tipW, w * lerp(0.55, 0.12, st.taper));
        w = lerp(w, Math.min(w, tipTo), Math.pow(f, 1.3));
      }
    }
    for (const to of turnovers) {
      // foreshortening: narrowest just before the crease, recovering beyond it
      const ds = (s - to.t * Lb + to.length * Lb * 0.12) / Math.max(4, (to.length * Lb) / 2);
      if (Math.abs(ds) < 1) w *= 1 - 0.45 * Math.pow(Math.cos((ds * Math.PI) / 2), 2);
    }
    hL[i] = hR[i] = Math.max(0.6, w / 2);
  }
  clampToCurvature(track, hL, hR);
  const creases = turnovers.map((ev) => {
    const s = ev.t * Lb;
    const h = hAt(hL, track, s);
    const sgn = ev.edge === 'L' ? 1 : -1;
    // the rolling edge's end of the crease lies further along
    const slope = sgn * Math.tan((clamp(Math.abs(ev.crease), 0, 70) * Math.PI) / 180) * h;
    return { s, slope, ev };
  });
  const g: StripGeo = { strip, frame, track, Lb, hL, hR, spiralStart, creases, baseFace, depth, rootDist, children: [], gaps: [] };
  ctx.all.push(g);
  return g;
}

export function faceAt(g: StripGeo, s: number, v = 0): 0 | 1 {
  let f = g.baseFace;
  for (const c of g.creases) if (s > c.s + c.slope * v) f = (1 - f) as 0 | 1;
  return f;
}

// ---------------------------------------------------------------------------
// Emission (draw order)

function emit(ctx: Ctx, g: StripGeo) {
  const st = ctx.st;
  const strip = g.strip;
  const tr = g.track;
  const L = tr.L;
  const frontKids: (() => void)[] = [];
  // children (branches and branching volutes)
  for (const ev of strip.events) {
    if (ev.kind === 'branch') {
      const s = clamp(ev.t * g.Lb, 0, L);
      const a = tr.at(s);
      const sg = sideSign(ev.side);
      const T: V = [a.tx, a.ty];
      const N = perp(T);
      const o = P(tr, g.hL, g.hR, s, sg * 0.35);
      const frame: Frame = { o, ex: T, ey: N };
      const dir = rot(T, sg * (ev.angle * Math.PI) / 180);
      const face = faceAt(g, s, sg * 0.35);
      const child = buildStrip(ctx, { ...ev.child, width: rootWidthed(ev.child.width, ev.rootWidth) }, frame, face, g.depth + 1, g.rootDist + s, dir);
      child.strip = ev.child; // keep identity for editing
      g.children.push(child);
      if (ev.crossing === 'front') frontKids.push(() => emit(ctx, child));
      else emit(ctx, child);
    } else if (ev.kind === 'volute' && ev.mode === 'branching') {
      const pc = branchingVolute(ctx, g, ev);
      if (pc) {
        if (ev.crossing === 'front') frontKids.push(() => ctx.pieces.push(...pc));
        else ctx.pieces.push(...pc);
      }
    }
  }
  // foliage issues from beneath the stem's edge
  for (const ev of strip.events) if (ev.kind === 'cluster') ctx.pieces.push(...clusterPieces(ctx, g, ev));
  // own surface, split at creases
  const bounds: ((v: number) => number)[] = [() => 0];
  for (const c of g.creases) bounds.push((v: number) => clamp(c.s + c.slope * v, 0, L));
  bounds.push(() => L);
  let face = g.baseFace;
  const lips: Piece[] = [];
  for (let k = 0; k < bounds.length - 1; k++) {
    const p: Piece = {
      id: `${strip.id}:seg${k}`,
      kind: 'strip',
      stripId: strip.id,
      track: tr,
      hL: g.hL,
      hR: g.hR,
      s0: bounds[k],
      s1: bounds[k + 1],
      vMin: -1,
      vMax: 1,
      face,
      cup: 0,
      alphaIn: 0,
      startShade: k > 0 ? 1 : 0,
      strokeStart: k > 0 || g.depth > 0 ? k > 0 : true,
      strokeEnd: true,
      rootDist: g.rootDist,
      level: 0,
      midrib: true,
      gaps: g.gaps,
    };
    if (g.depth > 0 && k === 0) {
      p.strokeStart = false;
    }
    ctx.pieces.push(p);
    if (k > 0) {
      // the lip of the rolling edge, in the face before the crease, passes in front
      const c = g.creases[k - 1];
      const ve = c.ev.edge === 'L' ? 1 : -1;
      const lipLen = Math.max(12, interpKnots(strip.width, c.s / g.Lb) * 1.7);
      const w = 0.85;
      lips.push({
        ...p,
        id: `${strip.id}:lip${k}`,
        kind: 'lip',
        eventId: c.ev.id,
        vMin: ve > 0 ? 1 - w : -1,
        vMax: ve > 0 ? 1 : -1 + w,
        s0: bounds[k],
        s1: (v: number) => {
          const q = clamp(1 - Math.abs(v - ve) / w, 0, 1);
          return clamp(bounds[k](v) + lipLen * Math.pow(q, 0.8), 0, L);
        },
        face: (1 - face) as 0 | 1,
        startShade: 0,
        strokeStart: true,
        midrib: false,
      });
      for (const l of lips.splice(0)) ctx.pieces.push(l);
    }
    face = (1 - face) as 0 | 1;
  }
  // a terminal volute's inner rim turns over to show a narrow return of the other face
  if (g.spiralStart >= 0) {
    const s0 = g.spiralStart + (L - g.spiralStart) * 0.12;
    const s1 = L - (L - g.spiralStart) * 0.06;
    const a = tr.at((s0 + s1) / 2);
    const inner = a.k >= 0 ? 1 : -1;
    const w = 0.3;
    const f = faceAt(g, (s0 + s1) / 2);
    ctx.pieces.push({
      id: `${strip.id}:rim`,
      kind: 'rim',
      stripId: strip.id,
      track: tr,
      hL: g.hL,
      hR: g.hR,
      s0: () => s0,
      s1: () => s1,
      vMin: inner > 0 ? 1 - w : -1,
      vMax: inner > 0 ? 1 : -1 + w,
      face: (1 - f) as 0 | 1,
      cup: 0,
      alphaIn: 0,
      startShade: 0,
      strokeStart: false,
      strokeEnd: false,
      rootDist: g.rootDist,
      level: 0,
      midrib: false,
    });
  }
  for (const f of frontKids) f();
  void st;
}

function rootWidthed(knots: { t: number; w: number }[], rootW: number) {
  if (!knots.length) return [{ t: 0, w: rootW }];
  const k = knots.map((x) => ({ ...x }));
  k[0] = { t: 0, w: rootW };
  return k;
}

// ---------------------------------------------------------------------------
// Branching volute: a coil that springs from the stem while the stem continues

function branchingVolute(_ctx: Ctx, g: StripGeo, ev: VoluteEvent): Piece[] | null {
  const tr = g.track;
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
  const hL = new Float64Array(n), hR = new Float64Array(n);
  let mi = 0;
  for (let i = 0; i < n; i++) {
    const u = ctr.s[i] / ctr.L;
    while (mi < spi.cum.length - 2 && spi.cum[mi + 1] < ctr.s[i]) mi++;
    let w = w0 * lerp(1, 0.3, Math.pow(u, 0.8));
    w = Math.min(w, spi.maxW[mi]);
    w = lerp(w, 1.6, smooth(0.9, 1, u));
    hL[i] = hR[i] = w / 2;
  }
  clampToCurvature(ctr, hL, hR);
  const face = faceAt(g, s);
  const enter = Math.min(ctr.L * 0.3, hAt(g.hL, tr, s) * 1.2);
  const body: Piece = {
    id: `${g.strip.id}:${ev.id}`,
    kind: 'leaf',
    stripId: g.strip.id,
    eventId: ev.id,
    track: ctr,
    hL,
    hR,
    s0: () => 0,
    s1: () => ctr.L,
    vMin: -1,
    vMax: 1,
    face,
    cup: 0.3,
    alphaIn: ev.crossing === 'front' ? enter : 0,
    startShade: 0,
    strokeStart: false,
    strokeEnd: true,
    exclude: { track: tr, hL: g.hL, hR: g.hR, i0: Math.max(0, Math.floor(tr.idx(s)) - 40), i1: Math.min(tr.n - 1, Math.ceil(tr.idx(s)) + 40) },
    rootDist: g.rootDist + s,
    level: 1,
    midrib: true,
  };
  const inner = spi.turnSign;
  const rim: Piece = {
    ...body,
    id: body.id + ':rim',
    kind: 'rim',
    vMin: inner > 0 ? 0.7 : -1,
    vMax: inner > 0 ? 1 : -0.7,
    s0: () => ctr.L * 0.2,
    s1: () => ctr.L * 0.94,
    face: (1 - face) as 0 | 1,
    alphaIn: 0,
    strokeStart: false,
    strokeEnd: false,
    exclude: undefined,
    midrib: false,
  };
  return [body, rim];
}

// ---------------------------------------------------------------------------
// Foliage: a cluster bursts into lobes; each lobe splits into unequal, forward-hooking leaflets.
// Lobes lie beneath their parent; the parent's edge is left unstroked where they issue.

export interface Region {
  track: Track;
  hL: Float64Array;
  hR: Float64Array;
  i0: number;
  i1: number;
}

/** Is q inside the region of a track (between its edges), and at what arc length? */
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
  parent: Track;
  pHL: Float64Array;
  pHR: Float64Array;
  gaps: Gap[];
  sBase: number;
  baseHalf: number;
  sg: number; // side of parent (+1 left)
  length: number;
  depth: number;
  split: number[];
  face: 0 | 1;
  level: number;
  rootDist: number;
  /** departure angle (radians) from the parent's tangent; random when absent */
  alpha?: number;
  /** total forward hook (radians); from settings when absent */
  beta?: number;
  /** split into a fan of fingers from a shared base instead of a body with attendants */
  fan?: boolean;
}

function clusterPieces(ctx: Ctx, g: StripGeo, ev: ClusterEvent): Piece[] {
  const st = ctx.st;
  const tr = g.track;
  const L = tr.L;
  const s0 = clamp(Math.min(ev.t0, ev.t1) * g.Lb, 0, L), s1 = clamp(Math.max(ev.t0, ev.t1) * g.Lb, 0, L);
  if (s1 - s0 < 3) return [];
  const R = rng(hash(g.strip.id + ev.id, ev.seed ?? 0));
  const sg = sideSign(ev.side);
  const hs = (s: number) => hAt(sg > 0 ? g.hL : g.hR, tr, s);
  const span = s1 - s0;
  const wm = Math.max(4, hAt(g.hL, tr, (s0 + s1) / 2) + hAt(g.hR, tr, (s0 + s1) / 2));
  const nL = clamp(Math.round(span / (wm * 1.5)), 1, 3);
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
  const out: Piece[] = [];
  for (let i = lobes.length - 1; i >= 0; i--) {
    const lb = lobes[i];
    const h = hs(lb.sb);
    const w = hAt(g.hL, tr, lb.sb) + hAt(g.hR, tr, lb.sb);
    const length = w * ev.size * lerp(1.8, 4.2, st.lobeDepth) * lb.rel * R.range(0.9, 1.12) + h * 0.5;
    const base: LeafSpec = {
      parent: tr,
      pHL: g.hL,
      pHR: g.hR,
      gaps: g.gaps,
      sBase: lb.sb,
      baseHalf: clamp(lb.part * 0.5, h * 0.75, h * 1.3),
      sg,
      length,
      depth: ev.depth,
      split: ev.split,
      face: faceAt(g, lb.sb, sg * 0.9),
      level: 1,
      rootDist: g.rootDist + lb.sb,
    };
    out.push(...lobeFan(ctx, R, base, lb.part, g.strip.id, ev.id, `${i}`));
  }
  return out;
}

/**
 * A lobe splits into 2-4 unequal fingers that fan from a shared base: the rootward fingers leave
 * steeply, the tipward ones lie flatter, and all hook forward. One is the dominant tongue.
 */
function lobeFan(ctx: Ctx, R: Rng, sp: LeafSpec, part: number, stripId: string, eventId: string, path: string): Piece[] {
  if (sp.depth <= 1 || sp.split.length < 2 || !sp.fan) return leaf(ctx, R, sp, stripId, eventId, path);
  const k = clamp(sp.split.length, 2, 4);
  const lead = Math.max(...sp.split.slice(0, k));
  // the dominant tongue is usually the outermost-but-one or the most tipward finger
  const order = sp.split.slice(0, k).map((x) => x / lead);
  const domAt = R.chance(0.5) ? k - 1 : Math.max(0, k - 2);
  const rels: number[] = [];
  const rest = order.slice(1).sort((a, b) => b - a);
  for (let j = 0; j < k; j++) rels.push(j === domAt ? 1 : rest.shift() ?? 0.4);
  const out: Piece[][] = [];
  const spread = Math.max(sp.baseHalf * 1.8, part * 0.95);
  const aHi = (lerp(78, 66, ctx.st.recurve) * Math.PI) / 180;
  const aLo = (lerp(34, 24, ctx.st.recurve) * Math.PI) / 180;
  for (let j = 0; j < k; j++) {
    const f = k === 1 ? 0.5 : j / (k - 1);
    const rel = rels[j];
    out.push(
      leaf(ctx, R, {
        ...sp,
        sBase: sp.sBase + (f - 0.5) * spread,
        baseHalf: Math.max(1, (spread / k) * lerp(0.75, 1.05, rel) + sp.baseHalf * 0.2),
        length: sp.length * lerp(0.45, 1, rel) * R.range(0.92, 1.08),
        alpha: lerp(aHi, aLo, f) + R.range(-0.08, 0.08),
        beta: undefined,
        depth: sp.depth - 1,
        split: sp.split.map((x, i) => (i === 0 ? x : x * R.range(0.7, 1.05))),
      }, stripId, eventId, `${path}.${j}`),
    );
  }
  // tipward fingers lie beneath rootward ones
  const flat: Piece[] = [];
  for (let j = out.length - 1; j >= 0; j--) flat.push(...out[j]);
  return flat;
}

function leaf(ctx: Ctx, R: Rng, sp: LeafSpec, stripId: string, eventId: string, path: string): Piece[] {
  const st = ctx.st;
  // a leaflet too small to read as a distinct finger only crumbles the edge: leave it out
  if (sp.level > 1 && (sp.length < 9 || sp.baseHalf < 1.6)) return [];
  const a = sp.parent.at(sp.sBase);
  const T: V = [a.tx, a.ty];
  const N = mul(perp(T), sp.sg);
  const h = sp.sg > 0 ? hAt(sp.pHL, sp.parent, sp.sBase) : hAt(sp.pHR, sp.parent, sp.sBase);
  const inset = 0.3;
  const B = add([a.x, a.y], mul(N, h * inset));
  const alpha = sp.alpha ?? (lerp(38, 62, R.next()) * Math.PI) / 180;
  const rsg = dot(rot(T, 0.1), N) > 0 ? 1 : -1;
  const a0 = angleOf(rot(T, rsg * alpha));
  const Ll = Math.max(5, sp.length);
  const beta = sp.beta ?? (lerp(25, 140, st.recurve) * R.range(0.8, 1.2) * Math.PI) / 180;
  const turn = -rsg; // hook back toward the direction of travel
  const p = 2.3;
  // flame: a slight outward bow, then an accelerating forward hook
  const kf = (s: number) => {
    const u = s / Ll;
    return (turn * beta * (p + 1) * Math.pow(u, p)) / Ll - (turn * 0.35 * beta * Math.max(0, 1 - u / 0.35)) / Ll;
  };
  const samples = integrate(B, a0, Ll, kf, Math.max(24, Math.ceil(Ll / 1.5)));
  const tr = trackFromSamples(samples, Math.min(STEP, Ll / 30));
  const n = tr.n;
  const hL = new Float64Array(n), hR = new Float64Array(n);
  const sharp = st.sharpness;
  const pp = lerp(2.4, 1.05, sharp), qq = lerp(0.5, 1.25, sharp);
  const env = (u: number) => {
    if (u < 0.22) return lerp(1, 1.1, smooth(0, 0.22, u));
    const x = (u - 0.22) / 0.78;
    return 1.1 * Math.pow(Math.max(0, 1 - Math.pow(x, pp)), qq);
  };
  const concaveL = turn > 0;
  const asym = R.range(0.1, 0.28);
  for (let i = 0; i < n; i++) {
    const u = tr.s[i] / tr.L;
    const w = sp.baseHalf * env(u);
    hL[i] = Math.max(0.3, w * (concaveL ? 1 - asym : 1 + asym));
    hR[i] = Math.max(0.3, w * (concaveL ? 1 + asym : 1 - asym));
  }
  clampToCurvature(tr, hL, hR);
  const pi0 = sp.parent.idx(sp.sBase);
  const region: Region = {
    track: sp.parent,
    hL: sp.pHL,
    hR: sp.pHR,
    i0: Math.max(0, Math.floor(pi0 - (sp.baseHalf * 4 + 10) / STEP)),
    i1: Math.min(sp.parent.n - 1, Math.ceil(pi0 + (sp.baseHalf * 4 + 10) / STEP)),
  };
  // where the lobe's two flanks emerge from under the parent's edge: leave that edge unstroked
  const cross: number[] = [];
  for (const v of [1, -1]) {
    for (let i = 0; i < n; i += 1) {
      const q = P(tr, hL, hR, tr.s[i], v);
      const r = inRegion(region, q);
      if (!r.inside) {
        cross.push(r.s);
        break;
      }
    }
  }
  if (cross.length === 2) sp.gaps.push({ side: sp.sg > 0 ? 1 : -1, s0: Math.min(...cross) - 0.8, s1: Math.max(...cross) + 0.8 });
  const gaps: Gap[] = [];
  const piece: Piece = {
    id: `${stripId}:${eventId}:${path}`,
    kind: 'leaf',
    stripId,
    eventId,
    track: tr,
    hL,
    hR,
    s0: () => 0,
    s1: () => tr.L,
    vMin: -1,
    vMax: 1,
    face: sp.face,
    cup: 1,
    alphaIn: 0,
    startShade: 0,
    strokeStart: false,
    strokeEnd: true,
    exclude: region,
    rootDist: sp.rootDist,
    level: sp.level,
    midrib: sp.level <= 1 && Ll > 25,
    gaps,
  };
  const out: Piece[] = [];
  if (sp.depth > 1 && sp.split.length > 1) {
    const parts = sp.split.slice(1);
    const lead = sp.split[0] || 1;
    const k = parts.length;
    const convexSg = concaveL ? -1 : 1;
    const groups: Piece[][] = [];
    // attendants on the convex flank (the larger cuts) and smaller ones on the concave flank,
    // staggered so the edge reads as deeply serrated rather than as separate ribbons
    const specs: { u: number; side: number; rel: number }[] = [];
    for (let j = 0; j < k; j++) {
      const rel = clamp(parts[j] / lead, 0.15, 0.95);
      specs.push({ u: lerp(0.18, 0.64, k === 1 ? 0.5 : j / (k - 1)) + R.range(-0.04, 0.04), side: convexSg, rel });
    }
    const nc = Math.max(1, k - 1);
    for (let j = 0; j < nc; j++) {
      const rel = clamp((parts[Math.min(parts.length - 1, j + 1)] / lead) * 0.75, 0.12, 0.7);
      specs.push({ u: lerp(0.3, 0.7, nc === 1 ? 0.5 : j / (nc - 1)) + R.range(-0.03, 0.03), side: -convexSg, rel });
    }
    specs.sort((x, y) => x.u - y.u);
    for (let j = 0; j < specs.length; j++) {
      const { u, side, rel } = specs[j];
      const sb = u * tr.L;
      const lh = hAt(side > 0 ? hL : hR, tr, sb);
      const subSplit = sp.split.slice(0, Math.max(2, sp.split.length - 1)).map((x, i) => (i === 0 ? x : x * R.range(0.75, 1.1)));
      const convex = side === convexSg;
      groups.push(
        leaf(ctx, R, {
          parent: tr,
          pHL: hL,
          pHR: hR,
          gaps,
          sBase: sb,
          baseHalf: Math.max(0.8, lh * lerp(0.8, 1.15, rel)),
          sg: side,
          length: Ll * rel * lerp(0.7, 0.92, R.next()) * (convex ? 1 : 0.7),
          alpha: (lerp(convex ? 50 : 35, convex ? 80 : 55, R.next()) * Math.PI) / 180,
          depth: sp.depth - 1,
          split: subSplit,
          face: sp.face,
          level: sp.level + 1,
          rootDist: sp.rootDist,
        }, stripId, eventId, `${path}.${j}`),
      );
    }
    // tipward attendants furthest back
    for (let j = groups.length - 1; j >= 0; j--) out.push(...groups[j]);
  }
  out.push(piece);
  return out;
}

export { trackFromSamples };
