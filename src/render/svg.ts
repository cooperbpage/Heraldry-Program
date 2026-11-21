import { V, clamp, lerp, smooth } from '../geom/vec';
import type { Doc, RenderToggles } from '../model/types';
import { SHEET } from '../model/types';
import { build, P, Piece, hAt, Built, inRegion } from '../model/build';
import { frameArt } from './frame';

// light from the upper left, toward the viewer (SVG y points down)
const LG = (() => {
  const l = Math.hypot(-0.55, -0.8, 0.75);
  return [-0.55 / l, -0.8 / l, 0.75 / l];
})();

type RGB = [number, number, number];
const hex = (h: string): RGB => {
  const x = h.replace('#', '');
  const f = x.length === 3 ? x.split('').map((c) => c + c).join('') : x;
  return [parseInt(f.slice(0, 2), 16), parseInt(f.slice(2, 4), 16), parseInt(f.slice(4, 6), 16)];
};
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const css = (c: RGB) => '#' + c.map((x) => Math.round(clamp(x, 0, 255)).toString(16).padStart(2, '0')).join('');

const LEVELS = 56;
const BMIN = 0.12, BMAX = 1.85;

function ramp(mid: RGB, ink: RGB, isLight: boolean) {
  const dark = mix(mid, ink, isLight ? 0.55 : 0.68);
  const light = isLight ? mix(mid, [255, 255, 255], 0.85) : mix(mid, [255, 236, 230], 0.5);
  const spec: RGB = [255, 250, 244];
  return (b: number): string => {
    let c: RGB;
    if (b < 1) c = mix(dark, mid, clamp((b - 0.2) / 0.8, 0, 1));
    else if (b < 1.5) c = mix(mid, light, (b - 1) / 0.5);
    else c = mix(light, spec, clamp((b - 1.5) / 0.35, 0, 1) * 0.7);
    return css(c);
  };
}

const f1 = (x: number) => (Math.round(x * 10) / 10).toString();
const pt = (p: V) => f1(p[0]) + ' ' + f1(p[1]);
/** Compact path: absolute start, then relative steps on a 0.1 grid (no accumulated drift). */
function relPath(pts: V[]) {
  let qx = Math.round(pts[0][0] * 10), qy = Math.round(pts[0][1] * 10);
  let d = 'M' + qx / 10 + ' ' + qy / 10 + 'l';
  for (let i = 1; i < pts.length; i++) {
    const nx = Math.round(pts[i][0] * 10), ny = Math.round(pts[i][1] * 10);
    const dx = (nx - qx) / 10, dy = (ny - qy) / 10;
    d += (i > 1 && dx >= 0 ? ' ' : i > 1 ? '' : '') + dx + (dy >= 0 ? ' ' : '') + dy;
    qx = nx;
    qy = ny;
  }
  return d;
}

export interface RenderOpts {
  toggles: RenderToggles;
  /** skip expensive layers (used while dragging) */
  draft?: boolean;
  /** omit frame (helm & shield) */
  noFrame?: boolean;
  background?: boolean;
}

interface PieceMesh {
  I: number;
  J: number;
  vs: number[];
  grid: V[][]; // [j][i]
  sAt: (i: number, v: number) => number;
}

function meshOf(p: Piece, draft: boolean): PieceMesh {
  const tr = p.track;
  const vs: number[] = [];
  let maxLen = 0;
  for (const v of [p.vMin, (p.vMin + p.vMax) / 2, p.vMax]) maxLen = Math.max(maxLen, p.s1(v) - p.s0(v));
  const s0m = p.s0(0), s1m = p.s1(0);
  let maxH = 0;
  for (let i = 0; i <= 8; i++) {
    const s = lerp(s0m, s1m, i / 8);
    maxH = Math.max(maxH, hAt(p.hL, tr, s), hAt(p.hR, tr, s));
  }
  const span = (maxH * (p.vMax - p.vMin)) / 2;
  const J = draft ? 2 : clamp(Math.ceil(span / 2.8), 3, 20);
  for (let j = 0; j <= J; j++) vs.push(p.vMin + ((p.vMax - p.vMin) * j) / J);
  const I = clamp(Math.ceil(maxLen / (draft ? 6 : 3.6)), p.kind === 'leaf' ? (draft ? 8 : 18) : 2, 500);
  const sAt = (i: number, v: number) => {
    const a = p.s0(v), b = p.s1(v);
    return a + ((b - a) * i) / I;
  };
  const grid: V[][] = vs.map((v) => {
    const row: V[] = [];
    for (let i = 0; i <= I; i++) row.push(P(tr, p.hL, p.hR, sAt(i, v), v));
    return row;
  });
  return { I, J, vs, grid, sAt };
}

/** Brightness of the cloth at (s, v): a shallow concave channel with rolled edges, lit from the upper left. */
function brightness(p: Piece, s: number, v: number) {
  const a = p.track.at(s);
  const nx = -a.ty, ny = a.tx; // +v direction
  const av = Math.abs(v);
  // channel: surface tilts toward the midline; at the rim the edge rolls over and faces outward
  const slope = 0.8 * v * (1 - 2.8 * smooth(0.86, 1.0, av)) + (p.kind === 'leaf' ? 0.25 * v : 0);
  let gx = -slope * nx, gy = -slope * ny, gz = 1;
  const gl = Math.hypot(gx, gy, gz);
  gx /= gl;
  gy /= gl;
  gz /= gl;
  const d = Math.max(0, gx * LG[0] + gy * LG[1] + gz * LG[2]);
  let b = 0.25 + 1.22 * d + 0.14 * Math.pow(d, 18);
  // midrib groove
  if (p.midrib) b -= 0.28 * Math.exp(-((v / 0.085) ** 2));
  const s0 = p.s0(v), s1 = p.s1(v);
  const u = (s - s0) / Math.max(1e-3, s1 - s0);
  if (p.cup > 0) b *= lerp(1 - 0.42 * p.cup, 1.06, smooth(0, 0.65, u));
  if (p.startShade > 0) b *= 1 - 0.38 * p.startShade * Math.exp(-(s - s0) / 9);
  // occlusion near the helm
  const rd = p.rootDist + s;
  if (p.level === 0) b *= 1 - 0.38 * Math.exp(-rd / 60);
  return b;
}

const level = (b: number) => clamp(Math.round(((b - BMIN) / (BMAX - BMIN)) * (LEVELS - 1)), 0, LEVELS - 1);
const levelB = (l: number) => BMIN + (l / (LEVELS - 1)) * (BMAX - BMIN);

function insideExclusion(p: Piece, q: V) {
  return p.exclude ? inRegion(p.exclude, q).inside : false;
}

/** Closed outline (for fills / clips) and stroked runs. */
function outlineOf(p: Piece, m: PieceMesh) {
  const { grid, I, J } = m;
  const left = grid[J], right = grid[0];
  const ring: V[] = [];
  for (let i = 0; i <= I; i++) ring.push(left[i]);
  for (let j = J - 1; j >= 0; j--) ring.push(grid[j][I]);
  for (let i = I - 1; i >= 0; i--) ring.push(right[i]);
  for (let j = 1; j < J; j++) ring.push(grid[j][0]);
  const closed = 'M' + ring.map(pt).join('L') + 'Z';
  // stroke runs
  const runs: V[][] = [];
  let cur: V[] = [];
  const push = (q: V, allow: boolean) => {
    if (allow) cur.push(q);
    else if (cur.length) {
      if (cur.length > 1) runs.push(cur);
      cur = [];
    }
  };
  const flush = () => {
    if (cur.length > 1) runs.push(cur);
    cur = [];
  };
  const limitI = p.exclude ? Math.ceil(I * 0.6) : -1;
  const gaps = p.gaps ?? [];
  const inGap = (side: 1 | -1, s: number) => {
    for (const g of gaps) if (g.side === side && s >= g.s0 && s <= g.s1) return true;
    return false;
  };
  const edge = (row: V[], dir: 1 | -1) => {
    const side: 1 | -1 = dir > 0 ? 1 : -1;
    const v = dir > 0 ? p.vMax : p.vMin;
    const onEdge = Math.abs(v) > 0.999;
    for (let k = 0; k <= I; k++) {
      const i = dir > 0 ? k : I - k;
      const q = row[i];
      const hidden = (i <= limitI && insideExclusion(p, q)) || (onEdge && gaps.length > 0 && inGap(side, m.sAt(i, v)));
      push(q, !hidden);
    }
  };
  // start cap (from right to left at i=0)
  if (p.strokeStart) for (let j = 0; j <= J; j++) push(grid[j][0], true);
  else flush();
  edge(left, 1);
  if (p.strokeEnd) for (let j = J; j >= 0; j--) push(grid[j][I], true);
  else flush();
  edge(right, -1);
  if (p.strokeStart && cur.length) push(grid[0][0], true);
  flush();
  // merge first & last runs if they touch
  const stroke = runs.map((r) => 'M' + r.map(pt).join('L')).join('');
  return { closed, stroke };
}

export interface RenderResult {
  svg: string;
  /** the same content without the outer <svg> element, for embedding */
  inner: string;
  built: Built;
}

export function renderSVG(doc: Doc, opts: RenderOpts, built?: Built): RenderResult {
  const b = built ?? build(doc);
  const T = opts.toggles;
  const draft = !!opts.draft;
  const pal = doc.palette;
  const ink = hex(pal.ink);
  const faces = [hex(pal.outer), hex(pal.lining)];
  const isLight = faces.map((c) => (c[0] + c[1] + c[2]) / 3 > 150);
  const greyFaces: RGB[] = [[150, 150, 150], [228, 228, 228]];
  const ramps = [0, 1].map((f) => ramp(T.flat ? faces[f] : greyFaces[f], ink, T.flat ? isLight[f] : f === 1));
  const flatFill = (f: number) => (T.flat ? css(faces[f]) : '#ffffff');
  const defs: string[] = [];
  const body: string[] = [];
  const shading = T.shading && !draft;
  const used = new Map<string, string>();
  const boxes: { x0: number; y0: number; x1: number; y1: number; id: string }[] = [];
  b.pieces.forEach((p, idx) => {
    const m = meshOf(p, draft);
    const { closed, stroke } = outlineOf(p, m);
    const oid = `o${idx}`;
    defs.push(`<path id="${oid}" d="${closed}"/>`);
    // bbox
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const row of m.grid) for (const q of row) {
      if (q[0] < x0) x0 = q[0];
      if (q[0] > x1) x1 = q[0];
      if (q[1] < y0) y0 = q[1];
      if (q[1] > y1) y1 = q[1];
    }
    const g: string[] = [];
    // cast shadow onto cloth already drawn (follows crossing order)
    if (shading && p.level <= 1 && p.kind !== 'rim' && boxes.length) {
      const under = boxes.filter((q) => q.x0 < x1 + 6 && q.x1 > x0 && q.y0 < y1 + 8 && q.y1 > y0).slice(-40);
      if (under.length) {
        const cid = `c${idx}`;
        defs.push(`<clipPath id="${cid}">${under.map((q) => `<use href="#${q.id}"/>`).join('')}</clipPath>`);
        const k = p.level === 0 ? 1 : 0.6;
        g.push(
          `<g clip-path="url(#${cid})" fill="${pal.ink}">` +
            `<use href="#${oid}" transform="translate(${f1(3.2 * k)} ${f1(4.2 * k)})" opacity="0.13"/>` +
            `<use href="#${oid}" transform="translate(${f1(1.6 * k)} ${f1(2.1 * k)})" opacity="0.12"/></g>`,
        );
      }
    }
    boxes.push({ x0, y0, x1, y1, id: oid });
    const ramp = ramps[p.face];
    if (shading) {
      if (p.alphaIn <= 0) g.push(`<use href="#${oid}" fill="${ramp(1)}"/>`);
      const paths = new Map<string, string[]>();
      for (let j = 0; j < m.J; j++) {
        const vc = (m.vs[j] + m.vs[j + 1]) / 2;
        let runStart = 0;
        let runKey = '';
        const keyAt = (i: number) => {
          const s = (m.sAt(i, m.vs[j]) + m.sAt(i + 1, m.vs[j]) + m.sAt(i, m.vs[j + 1]) + m.sAt(i + 1, m.vs[j + 1])) / 4;
          const lv = level(brightness(p, s, vc));
          let al = 4;
          if (p.alphaIn > 0) al = clamp(Math.round(smooth(0, p.alphaIn, s - p.s0(vc)) * 4), 0, 4);
          return lv + ':' + al;
        };
        const close = (i0: number, i1: number, key: string) => {
          if (key.endsWith(':0')) return;
          const a = m.grid[j], c = m.grid[j + 1];
          const pts: V[] = [];
          for (let i = i0; i <= i1; i++) pts.push(a[i]);
          for (let i = i1; i >= i0; i--) pts.push(c[i]);
          const d = relPath(pts) + 'z';
          let arr = paths.get(key);
          if (!arr) paths.set(key, (arr = []));
          arr.push(d);
        };
        for (let i = 0; i < m.I; i++) {
          const key = keyAt(i);
          if (i === 0) {
            runKey = key;
            runStart = 0;
          } else if (key !== runKey) {
            close(runStart, i, runKey);
            runKey = key;
            runStart = i;
          }
        }
        close(runStart, m.I, runKey);
      }
      const keys = [...paths.keys()].sort((x, y) => parseInt(x) - parseInt(y));
      for (const key of keys) {
        const [lv, al] = key.split(':').map(Number);
        const cls = `f${p.face}l${lv}`;
        if (!used.has(cls)) {
          const col = ramp(levelB(lv));
          used.set(cls, `.${cls}{fill:${col};stroke:${col}}`);
        }
        const op = al < 4 ? ` opacity="${al / 4}"` : '';
        g.push(`<path class="${cls}" d="${paths.get(key)!.join('')}"${op}/>`);
      }
    } else if (T.flat || T.outline) {
      g.push(`<use href="#${oid}" fill="${flatFill(p.face)}"/>`);
    }
    if (T.hatching && !draft) g.push(hatch(p, m, pal.ink));
    if (T.midrib && p.midrib && !draft) g.push(midrib(p, pal.ink, T.flat ? 0.5 : 0.6));
    if (T.outline || !(T.flat || T.shading)) {
      const w = p.level === 0 ? 1.5 : p.level === 1 ? 1.1 : 0.85;
      g.push(`<path d="${stroke}" fill="none" stroke="${pal.ink}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"/>`);
    }
    body.push(`<g data-piece="${p.id}">${g.join('')}</g>`);
  });
  const bg = opts.background !== false ? `<rect width="${SHEET.w}" height="${SHEET.h}" fill="${pal.paper}"/>` : '';
  const frame = opts.noFrame ? '' : frameArt(pal.ink);
  const inner =
    `<defs><style>#mantling path[class]{stroke-width:.55px;stroke-linejoin:round}${[...used.values()].join('')}</style>${defs.join('')}</defs>${bg}<g id="mantling">${body.join('')}</g>${frame}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SHEET.w} ${SHEET.h}" width="${SHEET.w}" height="${SHEET.h}">${inner}</svg>`;
  return { svg, inner, built: b };
}

function midrib(p: Piece, ink: string, op: number) {
  const s0 = p.s0(0), s1 = p.s1(0);
  const L = s1 - s0;
  if (L < 12) return '';
  const N = clamp(Math.ceil(L / 4), 6, 200);
  const top: V[] = [], bot: V[] = [];
  for (let i = 0; i <= N; i++) {
    const u = lerp(0.04, p.kind === 'leaf' ? 0.8 : 0.9, i / N);
    const s = s0 + L * u;
    const w = 0.045 * Math.pow(Math.max(0, Math.sin((Math.PI * i) / N)), 0.6);
    top.push(P(p.track, p.hL, p.hR, s, w));
    bot.push(P(p.track, p.hL, p.hR, s, -w));
  }
  return `<path d="M${top.map(pt).join('L')}L${bot.reverse().map(pt).join('L')}Z" fill="${ink}" opacity="${op}"/>`;
}

/** Cross-contour hatching in the shaded parts; the strokes bow with the channel. */
function hatch(p: Piece, m: PieceMesh, ink: string) {
  const rows = m.I;
  const s0 = p.s0(0), s1 = p.s1(0);
  const L = s1 - s0;
  const every = Math.max(1, Math.round(4.2 / Math.max(0.5, L / rows)));
  let d = '';
  const NV = 14;
  for (let i = 1; i < rows; i += every) {
    let cur: V[] = [];
    for (let k = 0; k <= NV; k++) {
      const v = lerp(p.vMin, p.vMax, k / NV);
      const s = m.sAt(i, v);
      const h = (hAt(p.hL, p.track, s) + hAt(p.hR, p.track, s)) / 2;
      const bow = 0.35 * h * (1 - v * v);
      const ss = Math.min(p.s1(v), s + bow);
      const bb = brightness(p, ss, v);
      if (bb < 0.78) cur.push(P(p.track, p.hL, p.hR, ss, v * 0.96));
      else {
        if (cur.length > 1) d += 'M' + cur.map(pt).join('L');
        cur = [];
      }
    }
    if (cur.length > 1) d += 'M' + cur.map(pt).join('L');
  }
  return d ? `<path d="${d}" fill="none" stroke="${ink}" stroke-width="0.55" opacity="0.55" stroke-linecap="round"/>` : '';
}
