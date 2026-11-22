/**
 * Render two-faced cloth ribbons to SVG.
 *
 * Each ribbon is meshed as a 3D surface: centreline (x, y, z), width direction W rotated about the
 * tangent by the twist θ, and a shallow cup across the width. A quad's colour is simply whichever
 * face of the cloth points at the viewer; its shade comes from its true 3D normal lit from the upper
 * left. Ribbons are cut into short patches that are painted far-to-near, so a band passes in front
 * of or behind itself and its neighbours exactly as its depth says. Outlines are the cloth's own
 * edges, drawn with their patch, so they are hidden by whatever lies in front of them.
 */
import { clamp, lerp, smooth } from '../geom/vec';
import type { Doc, RenderToggles } from '../model/types';
import { SHEET } from '../model/types';
import { build, Built, Ribbon, STEP } from '../model/build';
import { frameArt } from './frame';

type V3 = [number, number, number];
type RGB = [number, number, number];

const LG: V3 = (() => {
  const l = Math.hypot(-0.5, -0.75, 0.75);
  return [-0.5 / l, -0.75 / l, 0.75 / l];
})();

const hex = (h: string): RGB => {
  const x = h.replace('#', '');
  const f = x.length === 3 ? x.split('').map((c) => c + c).join('') : x;
  return [parseInt(f.slice(0, 2), 16), parseInt(f.slice(2, 4), 16), parseInt(f.slice(4, 6), 16)];
};
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const css = (c: RGB) => '#' + c.map((x) => Math.round(clamp(x, 0, 255)).toString(16).padStart(2, '0')).join('');

const LEVELS = 64;
const BMIN = 0.15, BMAX = 1.75;
const level = (b: number) => clamp(Math.round(((b - BMIN) / (BMAX - BMIN)) * (LEVELS - 1)), 0, LEVELS - 1);
const levelB = (l: number) => BMIN + (l / (LEVELS - 1)) * (BMAX - BMIN);

function ramp(mid: RGB, ink: RGB, isLight: boolean) {
  const dark = mix(mid, ink, isLight ? 0.55 : 0.66);
  const light = isLight ? mix(mid, [255, 255, 255], 0.85) : mix(mid, [255, 236, 230], 0.45);
  return (b: number): string => {
    let c: RGB;
    if (b < 1) c = mix(dark, mid, clamp((b - 0.2) / 0.8, 0, 1));
    else c = mix(mid, light, clamp((b - 1) / 0.6, 0, 1));
    return css(c);
  };
}

const r1 = (x: number) => Math.round(x * 10) / 10;

export interface RenderOpts {
  toggles: RenderToggles;
  draft?: boolean;
  noFrame?: boolean;
  background?: boolean;
}

export interface RenderResult {
  svg: string;
  inner: string;
  built: Built;
}

interface Mesh {
  rows: number[]; // station indices used as rows
  M: number;
  P: V3[][]; // [row][col] 3D points
  S: number[]; // arc length per row
}

function cross(a: V3, b: V3): V3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function nrm(a: V3): V3 {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

function meshOf(r: Ribbon, draft: boolean): Mesh {
  const tr = r.track;
  let hmax = 0;
  for (let i = 0; i < tr.n; i++) hmax = Math.max(hmax, r.hU[i], r.hD[i]);
  const M = draft ? 2 : clamp(Math.ceil((2 * hmax) / 3), 4, 16);
  const want = draft ? 6 : r.kind === 'leaf' ? Math.min(2.2, tr.L / 22) : 2.6;
  const every = Math.max(1, Math.round(want / Math.max(1e-3, tr.n > 1 ? tr.s[1] : STEP)));
  const rows: number[] = [];
  for (let i = 0; i < tr.n; i += every) rows.push(i);
  if (rows[rows.length - 1] !== tr.n - 1) rows.push(tr.n - 1);
  const P: V3[][] = [];
  const S: number[] = [];
  for (const i of rows) {
    const ip = Math.max(0, i - 1), inx = Math.min(tr.n - 1, i + 1);
    const ds = Math.max(1e-3, tr.s[inx] - tr.s[ip]);
    const dz = (r.z[inx] - r.z[ip]) / ds;
    const T = nrm([tr.tx[i], tr.ty[i], dz]);
    const n0 = nrm([-T[1], T[0], 0]);
    const up = cross(T, n0);
    const c = Math.cos(r.th[i]), s = Math.sin(r.th[i]);
    const W: V3 = [n0[0] * c + up[0] * s, n0[1] * c + up[1] * s, n0[2] * c + up[2] * s];
    const N = cross(T, W);
    const row: V3[] = [];
    const lu = r.leanU?.[i] ?? 0, ld = r.leanD?.[i] ?? 0;
    for (let j = 0; j <= M; j++) {
      const u = -1 + (2 * j) / M;
      const sgn = u >= 0 ? 1 : -1;
      // edge lobes lean toward the tip: shift the outer part of the cross-section along the tangent
      const ln = (u >= 0 ? lu : ld) * Math.pow(Math.abs(u), 2);
      const h = u >= 0 ? r.hU[i] : r.hD[i];
      const f = (u >= 0 ? r.rollU?.[i] : r.rollD?.[i]) ?? 0;
      const au = Math.abs(u);
      if (f > 0.01 && au > 1 - f) {
        // the edge rolls over toward the viewer around a small cylinder, showing the lining
        const u0 = 1 - f;
        const cup0 = r.cup * h * (u0 * u0 - 0.33);
        const phMax = 1.15 * Math.PI;
        const rr = (f * h) / phMax;
        const ph = ((au - u0) / f) * phMax;
        const a = u0 * h + rr * Math.sin(ph);
        const b = cup0 + rr * (1 - Math.cos(ph)) * 1.6;
        row.push([tr.x[i] + W[0] * sgn * a + N[0] * b + T[0] * ln, tr.y[i] + W[1] * sgn * a + N[1] * b + T[1] * ln, r.z[i] + W[2] * sgn * a + N[2] * b]);
      } else {
        const cup = r.cup * h * (u * u - 0.33);
        row.push([tr.x[i] + W[0] * u * h + N[0] * cup + T[0] * ln, tr.y[i] + W[1] * u * h + N[1] * cup + T[1] * ln, r.z[i] + W[2] * u * h + N[2] * cup]);
      }
    }
    P.push(row);
    S.push(tr.s[i]);
  }
  return { rows, M, P, S };
}

interface Quad {
  pts: V3[];
  z: number;
  key: string;
  b: number;
  face: number;
  i: number;
  j: number;
}

interface Patch {
  z: number;
  order: number;
  svg: string;
}

export function renderSVG(doc: Doc, opts: RenderOpts, built?: Built): RenderResult {
  const B = built ?? build(doc);
  const T = opts.toggles;
  const draft = !!opts.draft;
  const pal = doc.palette;
  const ink = hex(pal.ink);
  const faces = [hex(pal.outer), hex(pal.lining)];
  const isLight = faces.map((c) => (c[0] + c[1] + c[2]) / 3 > 150);
  const grey: RGB[] = [[150, 150, 150], [228, 228, 228]];
  const ramps = [0, 1].map((f) => ramp(T.flat ? faces[f] : grey[f], ink, T.flat ? isLight[f] : f === 1));
  const flatCol = [0, 1].map((f) => (T.flat ? css(faces[f]) : '#ffffff'));
  const shading = T.shading && !draft;
  const used = new Map<string, string>();
  const patches: Patch[] = [];
  let order = 0;
  for (const r of B.pieces) {
    const m = meshOf(r, draft);
    const nRows = m.P.length;
    if (nRows < 2) continue;
    const L = r.track.L;
    const PR = Math.max(2, Math.round(10 / Math.max(0.5, L / nRows)));
    const inGap = (side: 1 | -1, s: number) => {
      for (const g of r.gaps) if (g.side === side && s >= g.s0 && s <= g.s1) return true;
      return false;
    };
    for (let p0 = 0; p0 < nRows - 1; p0 += PR) {
      const p1 = Math.min(nRows - 1, p0 + PR);
      const quads: Quad[] = [];
      let zs = 0;
      for (let i = p0; i < p1; i++) {
        for (let j = 0; j < m.M; j++) {
          const a = m.P[i][j], b = m.P[i + 1][j], c = m.P[i + 1][j + 1], d = m.P[i][j + 1];
          const n = nrm(cross([c[0] - a[0], c[1] - a[1], c[2] - a[2]], [d[0] - b[0], d[1] - b[1], d[2] - b[2]]));
          // the quad's normal points out of the outer face; whichever face points at us is what we see
          const outer = n[2] >= 0;
          const face = outer ? 0 : 1;
          const nn: V3 = outer ? n : [-n[0], -n[1], -n[2]];
          let br = 1;
          if (shading) {
            const dl = Math.max(0, nn[0] * LG[0] + nn[1] * LG[1] + nn[2] * LG[2]);
            br = 0.22 + 1.25 * dl + 0.18 * Math.pow(dl, 16);
            const s = (m.S[i] + m.S[i + 1]) / 2;
            if (r.kind === 'leaf') br *= lerp(0.72, 1.05, smooth(0, 0.6, s / Math.max(1, L)));
            if (r.occlude) br *= 1 - 0.36 * Math.exp(-(r.rootDist + s) / 55);
          }
          const z = (a[2] + b[2] + c[2] + d[2]) / 4;
          zs += z;
          quads.push({ pts: [a, b, c, d], z, key: shading ? `f${face}l${level(br)}` : `f${face}`, b: br, face, i, j });
        }
      }
      // fold lines: wherever neighbouring quads show different faces the cloth is turning over
      const faceAt = new Map<number, number>();
      for (const q of quads) faceAt.set(q.i * 64 + q.j, q.face);
      let folds = '';
      if (T.outline || !(T.flat || T.shading)) {
        for (const q of quads) {
          const right = faceAt.get(q.i * 64 + q.j + 1);
          if (right !== undefined && right !== q.face) folds += `M${r1(q.pts[3][0])} ${r1(q.pts[3][1])}L${r1(q.pts[2][0])} ${r1(q.pts[2][1])}`;
          const next = faceAt.get((q.i + 1) * 64 + q.j);
          if (next !== undefined && next !== q.face) folds += `M${r1(q.pts[1][0])} ${r1(q.pts[1][1])}L${r1(q.pts[2][0])} ${r1(q.pts[2][1])}`;
        }
      }
      quads.sort((q1, q2) => q1.z - q2.z);
      // merge consecutive quads of the same colour (painter order is kept)
      let out = '';
      let curKey = '', curD = '';
      const flush = () => {
        if (!curD) return;
        out += `<path class="${curKey}" d="${curD}"/>`;
        curD = '';
      };
      for (const q of quads) {
        if (q.key !== curKey) {
          flush();
          curKey = q.key;
          if (!used.has(q.key)) {
            const f = +q.key[1];
            const col = shading ? ramps[f](levelB(+q.key.slice(q.key.indexOf('l') + 1))) : flatCol[f];
            used.set(q.key, `.${q.key}{fill:${col};stroke:${col}}`);
          }
        }
        const pp = q.pts;
        curD += `M${r1(pp[0][0])} ${r1(pp[0][1])}L${r1(pp[1][0])} ${r1(pp[1][1])}L${r1(pp[2][0])} ${r1(pp[2][1])}L${r1(pp[3][0])} ${r1(pp[3][1])}Z`;
      }
      flush();
      // hatching across the darker parts, following the cross-contour of the cloth
      if (T.hatching && !draft) {
        let hd = '';
        for (let i = p0; i < p1; i += 2) {
          for (let j = 0; j < m.M; j++) {
            const q = quads.find((x) => x.pts[0] === m.P[i][j]);
            if (q && q.b < 0.8) hd += `M${r1(m.P[i][j][0])} ${r1(m.P[i][j][1])}L${r1(m.P[i][j + 1][0])} ${r1(m.P[i][j + 1][1])}`;
          }
        }
        if (hd) out += `<path d="${hd}" fill="none" stroke="${pal.ink}" stroke-width="0.5" opacity="0.5"/>`;
      }
      if (T.midrib && r.midrib && !draft) {
        const mid = Math.round(m.M / 2);
        let md = '';
        for (let i = p0; i <= p1; i++) {
          const f = m.S[i] / L;
          if (f < 0.04 || f > 0.9) continue;
          md += (md ? 'L' : 'M') + r1(m.P[i][mid][0]) + ' ' + r1(m.P[i][mid][1]);
        }
        if (md) out += `<path d="${md}" fill="none" stroke="${pal.ink}" stroke-width="0.9" opacity="0.35" stroke-linecap="round"/>`;
      }
      if (T.outline || !(T.flat || T.shading)) {
        const w = r.level === 0 ? 1.5 : r.level === 1 ? 1.1 : 0.85;
        if (folds) out += `<path d="${folds}" fill="none" stroke="${pal.ink}" stroke-width="${w * 0.8}" stroke-linecap="round"/>`;
        let sd = '';
        for (const [j, side] of [[m.M, 1], [0, -1]] as [number, 1 | -1][]) {
          let run = '';
          for (let i = p0; i <= p1; i++) {
            const hidden = r.gaps.length > 0 && inGap(side, m.S[i]);
            if (hidden) {
              run = '';
              continue;
            }
            run += (run ? 'L' : 'M') + r1(m.P[i][j][0]) + ' ' + r1(m.P[i][j][1]);
            if (i === p1 || (r.gaps.length && inGap(side, m.S[Math.min(p1, i + 1)]))) {
              if (run.includes('L')) sd += run;
              run = '';
            }
          }
        }
        if (p0 === 0 && r.strokeStart) sd += 'M' + m.P[0].map((q) => r1(q[0]) + ' ' + r1(q[1])).join('L');
        if (p1 === nRows - 1 && r.strokeEnd) sd += 'M' + m.P[nRows - 1].map((q) => r1(q[0]) + ' ' + r1(q[1])).join('L');
        if (sd) out += `<path d="${sd}" fill="none" stroke="${pal.ink}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"/>`;
      }
      patches.push({ z: zs / Math.max(1, quads.length), order: order++, svg: `<g data-piece="${r.id}">${out}</g>` });
    }
  }
  patches.sort((a, b) => a.z - b.z || a.order - b.order);
  const style = `<style>#mantling path[class]{stroke-width:.6px;stroke-linejoin:round}${[...used.values()].join('')}</style>`;
  const bg = opts.background !== false ? `<rect width="${SHEET.w}" height="${SHEET.h}" fill="${pal.paper}"/>` : '';
  const frame = opts.noFrame ? '' : frameArt(pal.ink);
  const inner = `<defs>${style}</defs>${bg}<g id="mantling">${patches.map((p) => p.svg).join('')}</g>${frame}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SHEET.w} ${SHEET.h}" width="${SHEET.w}" height="${SHEET.h}">${inner}</svg>`;
  return { svg, inner, built: B };
}
