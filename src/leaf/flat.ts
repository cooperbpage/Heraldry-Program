/**
 * Flat acanthus leaf components, built as the drawing manuals build them.
 *
 * Anatomy (names follow the carving and drawing manuals):
 *  - MIDRIB from the base to the tip, with guide STATIONS that crowd together toward the tip.
 *  - LOBES on each side, one per station. A lobe is a fan of FINGERS (serrations) that all spring
 *    from one root near the midrib and spread outward, leaning and hooking toward the leaf's tip.
 *    Fingers are drawn as petal shapes: round-ended (Acanthus mollis, Roman) or drawn out into
 *    points (A. spinosus, Greek).
 *  - EYES: the small round hollows at the bottom of the slit between two lobes, where one lobe
 *    overlaps the next.
 *  - a TERMINAL LOBE at the tip and a STEM at the base.
 *
 * The leaf is the union of all its parts (body, every finger, terminal lobe, stem) minus the eyes,
 * so parts may overlap freely and the outline never tangles. Each part is kept separately too, so
 * the warping stage can bend parts before they are united.
 *
 * Coordinates: midrib along +x from the base (x = 0) to the tip (x = length); +y is the leaf's left.
 */
import polygonClipping from 'polygon-clipping';

export type TipType = 'pointed' | 'rounded' | 'lobed';

export interface LeafParams {
  length: number;
  /** outer half-width as a fraction of length */
  width: number;
  /** where along the midrib the leaf is widest (0..1) */
  widest: number;
  /** lobes per side (0 = an unlobed tongue) */
  lobes: number;
  sides: 'both' | 'left' | 'right';
  /** how deep the cuts between lobes go: 0 shallow .. 1 almost to the midrib */
  depth: number;
  /** stations crowd toward the tip (0 even .. 1 strongly) */
  crowd: number;
  /** lobes shrink toward the tip (0 equal .. 1 small) */
  diminish: number;
  /** lobes lean toward the tip (0 straight out .. 1 swept far forward) */
  lean: number;
  /** fingers per lobe */
  fingers: number;
  /** how deeply the fingers are separated (0 merged scallops .. 1 separate fingers) */
  fingerDepth: number;
  /** 0 round fingers .. 1 pointed fingers */
  pointed: number;
  /** finger tips hook toward the leaf tip (0..1) */
  hook: number;
  /** fingers swell toward their ends (0 straight-sided .. 1 bulbous with narrow necks) */
  bulb: number;
  /** size of the eye hollows (0 = none) */
  eye: number;
  tip: TipType;
  tipFingers: number;
  /** stem length as a fraction of length */
  stem: number;
  /** stem width as a fraction of the maximum half-width */
  stemWidth: number;
  /** right side scale relative to left */
  asym: number;
  /** random irregularity (0..1) */
  jitter: number;
  seed: number;
}

export const defaultLeaf = (): LeafParams => ({
  length: 300,
  width: 0.3,
  widest: 0.4,
  lobes: 3,
  sides: 'both',
  depth: 0.65,
  crowd: 0.4,
  diminish: 0.35,
  lean: 0.5,
  fingers: 3,
  fingerDepth: 0.55,
  pointed: 0.15,
  hook: 0.5,
  bulb: 0.5,
  eye: 0.5,
  tip: 'lobed',
  tipFingers: 3,
  stem: 0.12,
  stemWidth: 0.3,
  asym: 1,
  jitter: 0.2,
  seed: 1,
});

export type P = [number, number];
export type Ring = P[];
export interface Pt {
  p: P;
  c?: boolean;
}

export interface Part {
  kind: 'body' | 'finger' | 'tip' | 'stem';
  /** which lobe (side * (index + 1)), 0 for parts that belong to no lobe */
  lobe: number;
  ring: Ring;
}

export interface FlatLeaf {
  /** closed outline(s) as SVG path data (even-odd) */
  d: string;
  rings: Ring[];
  /** construction lines: midrib and pipes */
  lines: string[];
  /** the separate parts before union (for the lab view and for warping) */
  parts: Part[];
  guides: { eyes: P[]; roots: P[]; envelope: P[] };
  bbox: [number, number, number, number];
}

function rng(seed: number) {
  let s = (Math.floor(seed) * 2654435761) >>> 0 || 7;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const add = (a: P, b: P): P => [a[0] + b[0], a[1] + b[1]];
const sub = (a: P, b: P): P => [a[0] - b[0], a[1] - b[1]];
const mul = (a: P, k: number): P => [a[0] * k, a[1] * k];
const len = (a: P) => Math.hypot(a[0], a[1]);
const norm = (a: P): P => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l];
};
const leftN = (d: P): P => [-d[1], d[0]];

/** Outer envelope half-width at fraction x (0 base .. 1 tip). */
export function envelope(x: number, q: LeafParams) {
  const w = q.width * q.length;
  x = Math.min(1, Math.max(0, x));
  if (x <= q.widest) {
    const t = x / Math.max(1e-3, q.widest);
    return w * (0.3 + 0.7 * Math.sin((Math.PI / 2) * t));
  }
  const t = (x - q.widest) / Math.max(1e-3, 1 - q.widest);
  return w * Math.pow(Math.max(0, Math.cos((Math.PI / 2) * t)), 0.75);
}

/**
 * A petal: a shape running from `root` to `tip` along an arc that bends by `bend` radians
 * (positive = toward the left of travel). Half-width grows from `w0` at the root to `wMax`, then
 * closes in a round cap or a point. `bulb` moves the widest point toward the end.
 */
export function petal(root: P, tip: P, w0: number, wMax: number, bend: number, pointed: number, bulb: number, n = 36): Ring {
  const ch = sub(tip, root);
  const L = len(ch);
  const d = norm(ch);
  const nrm = leftN(d);
  const sag = L * Math.tan(bend / 4);
  const centre = (t: number): { p: P; t: P } => {
    const p = add(add(root, mul(d, L * t)), mul(nrm, Math.sin(Math.PI * t) * sag));
    const tt = norm(add(mul(d, L), mul(nrm, Math.cos(Math.PI * t) * Math.PI * sag)));
    return { p, t: tt };
  };
  const peak = lerp(0.5, 0.78, bulb);
  const width = (t: number) => {
    if (t <= peak) {
      const u = t / peak;
      return lerp(w0, wMax, Math.pow(Math.sin((Math.PI / 2) * u), lerp(1.4, 0.7, bulb)));
    }
    const u = (t - peak) / (1 - peak);
    const round = Math.sqrt(Math.max(0, 1 - u * u));
    const pointy = Math.pow(1 - u, 1.3);
    return wMax * lerp(round, pointy, pointed);
  };
  const L1: P[] = [], R1: P[] = [];
  for (let i = 0; i <= n; i++) {
    const t = 1 - Math.pow(1 - i / n, 1.6);
    const c = centre(t);
    const w = width(t);
    const m = leftN(c.t);
    L1.push(add(c.p, mul(m, w)));
    R1.push(add(c.p, mul(m, -w)));
  }
  return [...L1, ...R1.reverse()];
}

function circle(c: P, r: number, n = 24): Ring {
  const out: Ring = [];
  for (let i = 0; i < n; i++) out.push([c[0] + r * Math.cos((2 * Math.PI * i) / n), c[1] + r * Math.sin((2 * Math.PI * i) / n)]);
  return out;
}

export function flatLeaf(q: LeafParams): FlatLeaf {
  const R = rng(q.seed);
  const Lx = q.length;
  const n = Math.max(0, Math.round(q.lobes));
  const parts: Part[] = [];
  const eyes: P[] = [];
  const roots: P[] = [];
  const slits: { a: P; b: P }[] = [];
  const xT = n > 0 ? 0.8 : 0.86;
  const W = (x: number, s: number) => envelope(x, q) * (s < 0 ? q.asym : 1);
  const st: number[] = [];
  for (let k = 0; k <= n; k++) {
    const u = n === 0 ? 0 : k / n;
    st.push(lerp(0.06, xT, 1 - Math.pow(1 - u, 1 + q.crowd * 1.5)));
  }
  // the uncut body along the midrib
  const coreW = (x: number) => Math.max(q.stemWidth * q.width * Lx * 0.4, envelope(x, q) * lerp(0.7, 0.12, q.depth));
  {
    const top: P[] = [], bot: P[] = [];
    for (let i = 0; i <= 40; i++) {
      const x = (i / 40) * xT * 1.02;
      top.push([x * Lx, coreW(x)]);
      bot.push([x * Lx, -coreW(x) * q.asym]);
    }
    parts.push({ kind: 'body', lobe: 0, ring: [...top, ...bot.reverse()] });
  }
    for (const s of [1, -1]) {
    const has = n > 0 && (q.sides === 'both' || (q.sides === 'left' && s > 0) || (q.sides === 'right' && s < 0));
    if (!has) {
      const top: P[] = [];
      for (let i = 0; i <= 40; i++) {
        const x = (i / 40) * xT * 1.02;
        top.push([x * Lx, s * W(x, s) * (n > 0 ? 0.8 : 1)]);
      }
      parts.push({ kind: 'body', lobe: 0, ring: [...top, [xT * Lx, 0], [0, 0]] });
      continue;
    }
    for (let k = 0; k < n; k++) {
      const xa = st[k], xb = st[k + 1];
      const span = (xb - xa) * Lx;
      const size = (1 - q.diminish * (k / Math.max(1, n))) * (1 + (R() - 0.5) * q.jitter * 0.3);
      const xr = Math.max(0.02, lerp(xa, xb, 0.45) - q.lean * (xb - xa) * 0.9);
      const root: P = [xr * Lx, s * coreW(xr) * 0.6];
      roots.push(root);
      const m = Math.max(1, Math.round(q.fingers));
      // finger tips sit evenly along the envelope, from just behind this station to past the next
      // one (the lobe leans forward and overhangs the next lobe's root)
      const xs0 = xa + (xb - xa) * 0.12, xs1 = xb - (xb - xa) * 0.04;
      const tipsX: number[] = [];
      for (let j = 0; j < m; j++) tipsX.push(lerp(xs0, xs1, m === 1 ? 0.75 : (j + 0.5) / m));
      const tipSpacing = ((xs1 - xs0) * Lx) / Math.max(1, m);
      for (let j = 0; j < m; j++) {
        const u = m === 1 ? 1 : j / (m - 1);
        const x = Math.min(0.97, tipsX[j]);
        const want = size * (0.86 + 0.14 * u) * (1 + (R() - 0.5) * q.jitter * 0.2);
        const tip: P = [x * Lx, s * W(x, s) * want];
        const reach = len(sub(tip, root));
        // neighbouring fingers overlap: less overlap = deeper notches between them
        const wMax = Math.max(2, tipSpacing * 0.5 * lerp(1.35, 0.62, q.fingerDepth) * (m === 1 ? 1.25 : 1));
        // fingers hook forward toward the leaf tip
        const bend = (s > 0 ? -1 : 1) * lerp(0.05, 0.9, q.hook) * (0.5 + 0.7 * u) * Math.min(1, reach / (tipSpacing * 3));
        parts.push({ kind: 'finger', lobe: s * (k + 1), ring: petal(root, tip, Math.min(wMax, span * 0.35), wMax, bend, q.pointed, q.bulb) });
      }
      if (k < n - 1) {
        const eyeP: P = [xb * Lx, s * coreW(xb) * 1.05];
        eyes.push(eyeP);
        // the slit runs from the eye out between this lobe's front finger and the next lobe's back one
        const outer: P = [(xb + (xb - xa) * 0.15 * q.lean) * Lx, s * W(xb, s) * 1.3];
        slits.push({ a: eyeP, b: outer });
      }
    }
  }
  // terminal lobe
  const tipReach = (1 - xT) * Lx;
  const ew = envelope(xT, q);
  if (q.tip === 'pointed') {
    parts.push({ kind: 'tip', lobe: 0, ring: petal([xT * Lx - tipReach * 0.8, 0], [Lx, 0], ew * 0.45, ew * 0.5, 0, 0.95, 0.3) });
  } else if (q.tip === 'rounded') {
    parts.push({ kind: 'tip', lobe: 0, ring: petal([xT * Lx - tipReach * 0.6, 0], [Lx, 0], ew * 0.6, ew * 0.75, 0, 0, 0.6) });
  } else {
    const m = Math.max(1, Math.round(q.tipFingers));
    const spread = 60 + 22 * m;
    for (let j = 0; j < m; j++) {
      const u = m === 1 ? 0.5 : j / (m - 1);
      const ang = ((u - 0.5) * spread * Math.PI) / 180;
      const dir: P = [Math.cos(ang), Math.sin(ang)];
      const reach = tipReach * (1.05 - 0.3 * Math.abs(u - 0.5) * 2) + ew * 0.15;
      const root: P = [xT * Lx - tipReach * 0.4, 0];
      const angGap = ((spread / Math.max(1, m - 1 + 0.4)) * Math.PI) / 180;
      const wMax = Math.max(2, reach * Math.sin(angGap / 2) * lerp(1.2, 0.65, q.fingerDepth) * (m === 1 ? 1.6 : 1));
      parts.push({ kind: 'tip', lobe: 0, ring: petal(root, add(root, mul(dir, reach)), wMax * 0.3, wMax, -ang * 0.5 * q.hook, q.pointed, q.bulb) });
    }
  }
  if (q.stem > 0.01) {
    const sw = q.width * Lx * q.stemWidth * 0.5;
    parts.push({ kind: 'stem', lobe: 0, ring: petal([Lx * 0.05, 0], [-q.stem * Lx, 0], sw, sw * 1.05, 0, 0.9, 0.1) });
  }
  // union of the parts, minus the eyes
  type Poly = [number, number][][];
  const toPoly = (r: Ring): Poly => [[...r, r[0]]];
  const rnd = (r: Ring, k: number): Ring => r.map((v) => [Math.round(v[0] * k) / k, Math.round(v[1] * k) / k] as P);
  const safe = <T,>(f: () => T, g: () => T): T => {
    try {
      return f();
    } catch {
      return g();
    }
  };
  let geom = polygonClipping.union(toPoly(rnd(parts[0].ring, 1000)));
  for (const part of parts.slice(1)) {
    const g0 = geom;
    geom = safe(
      () => polygonClipping.union(g0, toPoly(rnd(part.ring, 1000))),
      () => safe(() => polygonClipping.union(g0, toPoly(rnd(part.ring, 20))), () => g0),
    );
  }
  if (eyes.length) {
    const er = (e: P) => Math.max(0.8, q.eye * envelope(e[0] / Lx, q) * 0.13);
    const cuts: Poly[] = [];
    slits.forEach((sl, i) => {
      const r = er(eyes[i]);
      const d = norm(sub(sl.b, sl.a));
      const nn = leftN(d);
      const g0 = Math.max(0.5, r * 0.45), g1 = Math.max(1, r * 0.9 + len(sub(sl.b, sl.a)) * 0.04);
      cuts.push(toPoly([add(sl.a, mul(nn, g0)), add(sl.b, mul(nn, g1)), add(sl.b, mul(nn, -g1)), add(sl.a, mul(nn, -g0))]));
      if (q.eye > 0.02) cuts.push(toPoly(circle(add(sl.a, mul(d, -r * 0.4)), r)));
    });
    for (const c of cuts) {
      const g0 = geom;
      geom = safe(() => polygonClipping.difference(g0, c), () => g0);
    }
  }
  const rings: Ring[] = [];
  for (const poly of geom) for (const ring of poly) rings.push(ring.slice(0, -1).map((p) => [p[0], p[1]] as P));
  const d = rings.map((r) => 'M' + r.map((p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join('L') + 'Z').join('');
  const lines: string[] = [];
  lines.push(smoothPath([{ p: [-(q.stem * Lx) * 0.7, 0] }, { p: [0.4 * Lx, 0] }, { p: [xT * Lx, 0] }], false));
  for (const r of roots) lines.push(smoothPath([{ p: r }, { p: [r[0] - Math.abs(r[1]) * 0.8, r[1] * 0.4] }, { p: [r[0] - Math.abs(r[1]) * 1.6, 0] }], false));
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  for (const r of rings)
    for (const p of r) {
      bx0 = Math.min(bx0, p[0]);
      bx1 = Math.max(bx1, p[0]);
      by0 = Math.min(by0, p[1]);
      by1 = Math.max(by1, p[1]);
    }
  const env: P[] = [];
  for (let i = 0; i <= 30; i++) env.push([(i / 30) * Lx, envelope(i / 30, q)]);
  return { d, rings, lines, parts, guides: { eyes, roots, envelope: env }, bbox: [bx0, by0, bx1 - bx0, by1 - by0] };
}

/** Centripetal Catmull–Rom through the points as cubic Béziers; flagged points stay sharp. */
export function smoothPath(pts: Pt[], closed: boolean): string {
  const n = pts.length;
  if (n < 2) return '';
  const P = pts.map((x) => x.p);
  const C = pts.map((x) => !!x.c);
  const f = (v: P) => `${v[0].toFixed(2)},${v[1].toFixed(2)}`;
  let d = 'M' + f(P[0]);
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const p1 = P[i], p2 = P[(i + 1) % n];
    const i0 = i - 1 < 0 ? (closed ? n - 1 : -1) : i - 1;
    const i3 = i + 2 >= n ? (closed ? (i + 2) % n : -1) : i + 2;
    const p0: P = C[i] || i0 < 0 ? [2 * p1[0] - p2[0], 2 * p1[1] - p2[1]] : P[i0];
    const p3: P = C[(i + 1) % n] || i3 < 0 ? [2 * p2[0] - p1[0], 2 * p2[1] - p1[1]] : P[i3];
    const dd = (a: P, b: P) => Math.max(1e-6, Math.sqrt(Math.hypot(a[0] - b[0], a[1] - b[1])));
    const t0 = dd(p0, p1), t1 = dd(p1, p2), t2 = dd(p2, p3);
    const m1 = [0, 1].map((k) => ((p1[k] - p0[k]) / t0 - (p2[k] - p0[k]) / (t0 + t1) + (p2[k] - p1[k]) / t1) * t1);
    const m2 = [0, 1].map((k) => ((p2[k] - p1[k]) / t1 - (p3[k] - p1[k]) / (t1 + t2) + (p3[k] - p2[k]) / t2) * t1);
    d += `C${f([p1[0] + m1[0] / 3, p1[1] + m1[1] / 3])} ${f([p2[0] - m2[0] / 3, p2[1] - m2[1] / 3])} ${f(p2)}`;
  }
  return d + (closed ? 'Z' : '');
}

/** Named starting points (the repertoire). */
export const REPERTOIRE: Record<string, { note: string; p: Partial<LeafParams> }> = {
  'Roman (mollis)': {
    note: 'Broad and soft: round, swelling fingers, moderate cuts, round eyes, a fan-shaped tip.',
    p: { lobes: 3, fingers: 3, pointed: 0.0, depth: 0.6, eye: 0.6, width: 0.34, lean: 0.45, tip: 'lobed', tipFingers: 3, fingerDepth: 0.5, bulb: 0.7, hook: 0.35 },
  },
  'Greek (spinosus)': {
    note: 'Narrow and deeply cut: pointed fingers hooking toward the tip, small eyes, a pointed tip.',
    p: { lobes: 4, fingers: 3, pointed: 0.9, depth: 0.85, eye: 0.35, width: 0.28, lean: 0.6, tip: 'pointed', fingerDepth: 0.75, bulb: 0.2, hook: 0.8 },
  },
  'Heraldic flame': {
    note: 'Few large lobes of fat fingers sweeping hard toward a long pointed tip, with a long tail.',
    p: { lobes: 2, fingers: 3, pointed: 0.2, depth: 0.7, eye: 0.55, width: 0.3, widest: 0.32, lean: 0.85, tip: 'pointed', stem: 0.3, stemWidth: 0.22, diminish: 0.25, hook: 0.7, bulb: 0.7 },
  },
  'Half leaf': {
    note: 'Lobes on one side only; the other edge a clean sweep (a leaf turned on its edge).',
    p: { lobes: 3, sides: 'left', fingers: 3, pointed: 0.15, depth: 0.65, width: 0.3, lean: 0.65, tip: 'pointed', stem: 0.25, bulb: 0.6 },
  },
  'Scalloped frond': {
    note: 'Many shallow lobes of one or two fingers: a frond whose edge just ripples.',
    p: { lobes: 6, fingers: 2, pointed: 0.2, depth: 0.35, eye: 0.25, width: 0.22, lean: 0.45, tip: 'rounded', crowd: 0.3, fingerDepth: 0.3, bulb: 0.5 },
  },
  'Lobe (component)': {
    note: 'A single lobe used as a part: no side lobes, a fan of fingers at the end.',
    p: { lobes: 0, width: 0.3, widest: 0.62, tip: 'lobed', tipFingers: 4, pointed: 0.05, stem: 0.08, bulb: 0.7 },
  },
  'Tongue (component)': {
    note: 'A plain pointed tongue for tails, transitions and the ends of stems.',
    p: { lobes: 0, width: 0.16, widest: 0.3, tip: 'pointed', stem: 0.02 },
  },
};
