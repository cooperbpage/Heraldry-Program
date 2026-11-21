/**
 * Generative mode. The user's sweeps are kept exactly; the composer adds clusters, branches,
 * volutes and folds following the design grammar. Everything it adds is ordinary data marked
 * `gen`, so every manual tool can edit it; an edited item loses `gen` and survives Reseed.
 */
import { V, rng, hash, Rng, clamp, lerp, dist, sub, norm, add, mul, perp, dot } from '../geom/vec';
import { fitSpine } from '../geom/bezier';
import { trackFromSpine, Track } from '../geom/track';
import type { Doc, Strip, StripEvent, Side, ClusterEvent } from './types';
import { FRAME, SHEET, uid } from './types';
import { addStrip, defaultEye, defaultWidth, syncMirror, clone } from './ops';

const flip = (s: Side): Side => (s === 'L' ? 'R' : 'L');

/** Outer (convex) side over an interval. */
function outerOf(tr: Track, t0: number, t1: number): Side {
  let k = 0;
  for (let i = 0; i <= 8; i++) k += tr.at(tr.L * lerp(t0, t1, i / 8)).k;
  return k > 0 ? 'R' : 'L';
}

function covered(evs: StripEvent[]) {
  const iv = evs.filter((e): e is ClusterEvent => e.kind === 'cluster').map((e) => [Math.min(e.t0, e.t1), Math.max(e.t0, e.t1)]).sort((a, b) => a[0] - b[0]);
  let c = 0, s = -1, e = -1;
  for (const [a, b] of iv) {
    if (a > e) {
      if (e > s) c += e - s;
      s = a;
      e = b;
    } else e = Math.max(e, b);
  }
  if (e > s) c += e - s;
  return c;
}

function overlapsAny(evs: StripEvent[], t0: number, t1: number, pad = 0.03) {
  for (const e of evs) {
    if (e.kind === 'cluster' && t0 < Math.max(e.t0, e.t1) + pad && t1 > Math.min(e.t0, e.t1) - pad) return true;
    if ((e.kind === 'turnover' || e.kind === 'branch' || (e.kind === 'volute' && e.mode === 'branching')) && e.t > t0 - pad && e.t < t1 + pad) return true;
  }
  return false;
}

/** Try to add a cluster without breaking the 40% bare rule or crowding other events. */
function tryCluster(evs: StripEvent[], t0: number, t1: number, side: Side, size: number, depth: number, R: Rng, limit = 1): boolean {
  t0 = clamp(t0, 0.02, 1);
  t1 = clamp(t1, 0.02, limit);
  if (t1 - t0 < 0.04) return false;
  if (overlapsAny(evs, t0, t1, 0.02)) return false;
  const ev: ClusterEvent = { kind: 'cluster', id: uid('c'), t0, t1, side, size, depth, split: splitFor(R), gen: true, seed: R.int(0, 9999) };
  if (covered([...evs, ev]) > 0.6) return false;
  evs.push(ev);
  return true;
}

/** A cluster on the other edge over an existing interval: allowed if the bare rule still holds. */
function pushCluster(evs: StripEvent[], t0: number, t1: number, side: Side, size: number, depth: number, R: Rng) {
  t0 = clamp(t0, 0.02, 1);
  t1 = clamp(t1, 0.02, 1);
  if (t1 - t0 < 0.03) return false;
  const ev: ClusterEvent = { kind: 'cluster', id: uid('c'), t0, t1, side, size, depth, split: splitFor(R), gen: true, seed: R.int(0, 9999) };
  if (covered([...evs, ev]) > 0.6) return false;
  evs.push(ev);
  return true;
}

function splitFor(R: Rng) {
  const n = R.pick([3, 3, 4, 4, 2]);
  const out = [1];
  let x = R.range(0.5, 0.7);
  for (let i = 1; i < n; i++) {
    out.push(Math.round(x * 100) / 100);
    x *= R.range(0.55, 0.8);
  }
  return out;
}

/** Peaks of |curvature| (turnover / branch-worthy events), as t values. */
function turningPoints(tr: Track): number[] {
  const N = 40;
  const ks: number[] = [];
  for (let i = 0; i <= N; i++) ks.push(Math.abs(tr.at((tr.L * i) / N).k));
  const out: { t: number; k: number }[] = [];
  for (let i = 2; i < N - 1; i++) if (ks[i] >= ks[i - 1] && ks[i] >= ks[i + 1]) out.push({ t: i / N, k: ks[i] });
  return out.sort((a, b) => b.k - a.k).map((x) => x.t);
}

/** Decorate one sweep. `rank` 0 is the dominant mass of its side. */
function decorate(s: Strip, R: Rng, freq: number, rank: number, isChild = false) {
  s.events = s.events.filter((e) => !e.gen);
  const kept = s.events;
  const tr = trackFromSpine(s.spine);
  const L = tr.L;
  const w = (t: number) => {
    const k = s.width;
    let a = k[0];
    for (const x of k) if (x.t <= t) a = x;
    return a.w;
  };
  const hasTerminal = kept.some((e) => e.kind === 'volute' && e.mode === 'terminal');
  let tipLimit = 1;
  // terminal: a volute with an open eye, or a burst of leaves
  if (!hasTerminal) {
    const curl = Math.abs(tr.at(L * 0.92).k) * L > 2.2;
    if (curl || R.chance(isChild ? 0.45 : 0.55)) {
      const t = R.range(0.76, 0.86);
      const eyeR = clamp(w(t) * R.range(0.55, 0.85), 8, 30);
      const turns = R.range(0.8, 1.15);
      kept.push({ kind: 'volute', id: uid('v'), t, eye: defaultEye(s.spine, t, eyeR, turns), eyeR, turns, hand: 1, mode: 'terminal', gen: true });
      tipLimit = t;
      // leaves on the outer rim of the coil's shoulder
      tryCluster(kept, t - R.range(0.16, 0.22), t - 0.03, outerOf(tr, t - 0.2, t), R.range(1.0, 1.3), 3, R, tipLimit);
      // leaves on the coil's outer rim
      if (R.chance(0.7)) pushCluster(kept, t + 0.02, t + R.range(0.08, 0.12), outerOf(tr, t - 0.1, t), R.range(0.7, 1.0), 2, R);
    } else {
      tryCluster(kept, R.range(0.8, 0.86), 1, outerOf(tr, 0.8, 1), R.range(0.9, 1.2), 3, R);
      if (R.chance(0.5)) tryCluster(kept, R.range(0.88, 0.93), 1, flip(outerOf(tr, 0.8, 1)), R.range(0.6, 0.8), 2, R);
    }
  } else tipLimit = Math.min(...kept.filter((e): e is import('./types').VoluteEvent => e.kind === 'volute' && e.mode === 'terminal').map((e) => e.t));
  // clusters at the turns
  const turns = [...turningPoints(tr), 0.3, 0.5, 0.62].filter((t) => t > 0.18 && t < tipLimit - 0.12);
  const nC = (isChild ? 1 : 2) + (R.chance(freq) ? 1 : 0) + (freq > 0.75 && R.chance(0.6) ? 1 : 0);
  for (let i = 0, made = 0; i < turns.length && made < nC; i++) {
    const t = turns[i];
    const half = R.range(0.05, 0.08);
    const o = outerOf(tr, t - half, t + half);
    if (tryCluster(kept, t - half, t + half, o, R.range(1.0, 1.35) * (rank === 0 ? 1.1 : 0.9), 3, R, tipLimit)) {
      made++;
      if (R.chance(0.6)) pushCluster(kept, t - half * 0.8, t + half * 0.7, flip(o), R.range(0.55, 0.8), 2, R);
    }
  }
  // a turnover showing the lining for a stretch
  if (!isChild && R.chance(rank === 0 ? 0.35 : 0.55)) {
    for (let k = 0; k < 6; k++) {
      const t = R.range(0.28, 0.55);
      if (!overlapsAny(kept, t - 0.06, t + 0.06, 0.02)) {
        kept.push({ kind: 'turnover', id: uid('f'), t, length: R.range(0.08, 0.12), edge: outerOf(tr, t - 0.05, t + 0.05), crease: R.range(25, 45), gen: true });
        // and usually turn back again later so the lining shows as a return, not the rest of the strip
        if (R.chance(0.6)) {
          const t2 = t + R.range(0.16, 0.26);
          if (t2 < tipLimit - 0.08 && !overlapsAny(kept, t2 - 0.05, t2 + 0.05, 0.01))
            kept.push({ kind: 'turnover', id: uid('f'), t: t2, length: R.range(0.08, 0.12), edge: flip(outerOf(tr, t2 - 0.05, t2 + 0.05)), crease: R.range(25, 45), gen: true });
        }
        break;
      }
    }
  }
  // a branch from the outer side carrying its own smaller ornament
  if (!isChild && L > 220 && R.chance(rank === 0 ? 0.85 : 0.55)) {
    for (let k = 0; k < 8; k++) {
      const t = R.range(0.34, 0.62);
      if (overlapsAny(kept, t - 0.05, t + 0.05, 0.01)) continue;
      const side = R.chance(0.75) ? outerOf(tr, t - 0.1, t + 0.1) : flip(outerOf(tr, t - 0.1, t + 0.1));
      const sg = side === 'L' ? 1 : -1;
      const len = L * R.range(0.3, 0.45);
      const ang = R.range(30, 55);
      const a = (ang * Math.PI) / 180;
      const bend = R.range(0.15, 0.4) * -sg;
      // child spine in the attachment frame (+x along parent, +y toward parent's left)
      const tip: V = [Math.cos(a) * len, sg * Math.sin(a) * len];
      const c1: V = [Math.cos(a) * len * 0.35, sg * Math.sin(a) * len * 0.35];
      const mid: V = mul(add(c1, tip), 0.5);
      const off = mul(perp(norm(sub(tip, c1))), len * bend);
      const child: Strip = { id: uid('s'), spine: [[0, 0], c1, add(mid, off), tip], width: [], events: [], gen: true };
      const rw = w(t) * R.range(0.5, 0.65);
      child.width = [{ t: 0, w: rw }, { t: 0.3, w: rw * 1.15 }, { t: 1, w: rw * 0.45 }];
      decorate(child, R, freq, rank + 1, true);
      kept.push({ kind: 'branch', id: uid('b'), t, side, angle: ang, rootWidth: rw, crossing: R.chance(0.8) ? 'behind' : 'front', child, gen: true });
      break;
    }
  }
  // lining-up fans issuing behind the root of the dominant sweep
  if (!isChild && rank === 0) {
    const nf = R.int(2, 3);
    for (let i = 0; i < nf; i++) {
      const t = R.range(0.04, 0.12);
      const side: Side = i % 2 ? 'L' : 'R';
      const sg = side === 'L' ? 1 : -1;
      const ang = R.range(35, 70);
      const a = (ang * Math.PI) / 180;
      const len = L * R.range(0.35, 0.5);
      const tip: V = [Math.cos(a) * len, sg * Math.sin(a) * len];
      const c1: V = [Math.cos(a) * len * 0.35, sg * Math.sin(a) * len * 0.35];
      const mid: V = add(mul(add(c1, tip), 0.5), mul(perp(norm(sub(tip, c1))), -sg * len * 0.08));
      const fw = w(t) * R.range(0.9, 1.2);
      const fan: Strip = { id: uid('s'), spine: [[0, 0], c1, mid, tip], width: [{ t: 0, w: fw * 0.8 }, { t: 0.4, w: fw }, { t: 1, w: fw * 0.75 }], events: [], gen: true };
      fan.events.push({ kind: 'turnover', id: uid('f'), t: 0.06, length: 0.06, edge: side, crease: 15, gen: true });
      fan.events.push({ kind: 'cluster', id: uid('c'), t0: 0.72, t1: 1, side: flip(side), size: 0.6, depth: 2, split: [1, 0.85, 0.7], gen: true, seed: R.int(0, 9999) });
      fan.events.push({ kind: 'cluster', id: uid('c'), t0: 0.8, t1: 1, side, size: 0.45, depth: 2, split: [1, 0.8], gen: true, seed: R.int(0, 9999) });
      kept.push({ kind: 'branch', id: uid('b'), t, side, angle: ang, rootWidth: fw * 0.8, crossing: 'behind', child: fan, gen: true });
    }
  }
  s.events = kept.sort((a, b) => ('t' in a ? a.t : a.t0) - ('t' in b ? b.t : b.t0));
}

/** Compose every authored sweep (and its mirror). */
export function compose(doc: Doc) {
  const R0 = doc.seed;
  // mirrored pairs are composed once, from whichever comes first; the partner is re-derived
  const sweeps = doc.strips.filter((s, i) => {
    if (!s.sweep) return false;
    if (!s.mirror || s.mirrorBroken) return true;
    const j = doc.strips.findIndex((o) => o.id === s.mirror);
    return j < 0 || i < j;
  });
  // rank sweeps per side by length (dominant first)
  const bySide = new Map<string, Strip[]>();
  for (const s of sweeps) {
    const side = s.spine[0][0] + s.spine[s.spine.length - 1][0] > 2 * SHEET.cx ? 'r' : 'l';
    if (!bySide.has(side)) bySide.set(side, []);
    bySide.get(side)!.push(s);
  }
  for (const list of bySide.values()) {
    list.sort((a, b) => trackFromSpine(b.spine).L - trackFromSpine(a.spine).L);
    list.forEach((s, rank) => decorate(s, rng(hash(s.id, R0)), doc.settings.frequency, rank));
  }
  for (const s of sweeps) if (s.mirror && !s.mirrorBroken) syncMirror(doc, s.id);
  void clone;
}

/** Is this gesture a closed envelope rather than a sweep? */
export function isEnvelope(pts: V[]) {
  if (pts.length < 20) return false;
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += dist(pts[i], pts[i - 1]);
  return L > 500 && dist(pts[0], pts[pts.length - 1]) < Math.max(50, L * 0.08);
}

/**
 * From an envelope drawn around the shield, derive a hierarchy of 2-3 sweeps per side: a dominant
 * upper sweep up and out, a middle one out to the widest point, and a lower one falling beside the
 * shield. Each ends travelling along the envelope so it curls rather than radiating.
 */
export function sweepsFromEnvelope(doc: Doc, env: V[], err: number, mirror: boolean): Strip[] {
  const cx = SHEET.cx;
  const right = env.filter((p) => p[0] > cx + 20);
  const left = env.filter((p) => p[0] < cx - 20);
  const half = right.length >= left.length ? right : left;
  const sgn = half === right ? 1 : -1;
  if (half.length < 6) return [];
  const hw = Math.max(...half.map((p) => Math.abs(p[0] - cx)));
  const top = half.filter((p) => Math.abs(p[0] - cx) > hw * 0.45).reduce((a, b) => (b[1] < a[1] ? b : a));
  const wide = half.reduce((a, b) => (Math.abs(b[0] - cx) > Math.abs(a[0] - cx) ? b : a));
  const low = half.reduce((a, b) => (b[1] > a[1] ? b : a));
  const anchor = FRAME.anchor;
  const made: Strip[] = [];
  const mk = (end: V, rootDy: number, bulge: number, widthScale: number, curlIn: number) => {
    const root: V = [anchor[0] + sgn * 14, anchor[1] + rootDy];
    const d = sub(end, root);
    const n = norm(perp(d));
    const outward = dot(n, [sgn, 0]) > 0 ? n : mul(n, -1);
    const m1 = add(add(root, mul(d, 0.35)), mul(outward, -bulge * 0.4));
    const m2 = add(add(root, mul(d, 0.75)), mul(outward, bulge));
    // curl the end over and down, back toward the shield side
    const back: V = [end[0] + sgn * curlIn * 0.3, end[1] + curlIn * 0.9];
    const pts: V[] = [];
    const ctrl = [root, m1, m2, end, back];
    for (let i = 0; i < ctrl.length - 1; i++) for (let k = 0; k < 12; k++) pts.push(lerpPt(ctrl[i], ctrl[i + 1], k / 12));
    pts.push(back);
    const sp = fitSpine(smoothPts(pts, 6), err);
    const L = trackFromSpine(sp).L;
    const st: Strip = { id: uid('s'), spine: sp, width: defaultWidth(L).map((k) => ({ ...k, w: k.w * widthScale })), events: [], sweep: true };
    made.push(st);
  };
  mk(top, -18, 50, 0.95, 50);
  mk(wide, 6, 40, 0.85, 45);
  if (low[1] > FRAME.shield.y + 40) mk(low, 30, -30, 0.7, 35);
  for (const s of made) addStrip(doc, s, mirror);
  return made;
}

const lerpPt = (a: V, b: V, t: number): V => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
function smoothPts(p: V[], passes: number) {
  let c = p;
  for (let k = 0; k < passes; k++) {
    const n: V[] = [c[0]];
    for (let i = 1; i < c.length - 1; i++) n.push([(c[i - 1][0] + 2 * c[i][0] + c[i + 1][0]) / 4, (c[i - 1][1] + 2 * c[i][1] + c[i + 1][1]) / 4]);
    n.push(c[c.length - 1]);
    c = n;
  }
  return c;
}

export { clone };
