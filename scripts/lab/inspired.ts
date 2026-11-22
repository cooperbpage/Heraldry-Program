// Five original single plumes, inspired by the references. Each is one stem from the helm with all its parts.
import { writeFileSync } from 'node:fs';
import { emptyDoc } from '../../src/model/ops';
import { renderSVG } from '../../src/render/svg';
import { defaultToggles } from '../../src/model/types';
import type { Doc, Strip, StripEvent, Palette, Settings } from '../../src/model/types';
import type { V } from '../../src/geom/vec';
import { traced, local } from './recreate';

const out = process.argv[2];
type Ev = StripEvent;
function plume(name: string, pal: Palette, st: Partial<Settings>, stemPts: V[], width: [number, number][], events: Ev[], branches: { pts: V[]; width: [number, number][]; events: Ev[]; crossing?: 'behind' | 'front' }[] = []): Doc {
  const d = emptyDoc(name);
  d.palette = pal;
  d.settings = { ...d.settings, ...st };
  const stem = traced(stemPts);
  const evs: Ev[] = [...events];
  branches.forEach((b, i) => {
    const l = local(stem, -1, b.pts);
    const child: Strip = { id: `b${i}`, spine: traced(l.pts), width: b.width.map(([t, w]) => ({ t, w })), events: b.events };
    evs.push({ kind: 'branch', id: `br${i}`, t: l.t, side: l.side, angle: l.angle, rootWidth: b.width[0][1], crossing: b.crossing ?? 'behind', child });
  });
  d.strips.push({ id: 'p', spine: stem, width: width.map(([t, w]) => ({ t, w })), events: evs });
  return d;
}
const cl = (id: string, t0: number, t1: number, side: 'L' | 'R', size: number, curl = 0.5, roll = 0.4, depth = 2): Ev => ({ kind: 'cluster', id, t0, t1, side, size, depth, split: [1, 0.65, 0.45], curl, roll });
const to = (id: string, t: number, length: number, edge: 'L' | 'R', turn = 180): Ev => ({ kind: 'turnover', id, t, length, edge, crease: 0, turn });
const ro = (id: string, t0: number, t1: number, side: 'L' | 'R', amount = 0.45): Ev => ({ kind: 'roll', id, t0, t1, side, amount });
const vo = (id: string, t: number, eye: V, eyeR: number, turns = 0.85): Ev => ({ kind: 'volute', id, t, eye, eyeR, turns, hand: 1, mode: 'terminal' });

const RED_WHITE: Palette = { outer: '#c4262a', lining: '#efe9de', ink: '#2a1a17', paper: '#fbf8f1' };
const BLUE_SILVER: Palette = { outer: '#2f6cc0', lining: '#b3b5b2', ink: '#22303f', paper: '#f5f0e2' };
const RED_GOLD: Palette = { outer: '#d42a26', lining: '#d9a640', ink: '#3a2516', paper: '#f6efdc' };
const RED_GREY: Palette = { outer: '#a3161c', lining: '#b2aca4', ink: '#2a1a17', paper: '#f1e9da' };

export const designs: Record<string, Doc> = {
  // 1 · a wave: rises from the helm, crests, turns over white across the crest, and falls in an S into an open scroll
  wave: plume('Wave crest', RED_WHITE, { recurve: 0.55, lobeDepth: 0.55 },
    [[540, 400], [600, 340], [690, 300], [770, 320], [820, 370], [810, 450], [770, 520], [760, 590], [800, 630], [840, 610], [830, 575], [805, 585]],
    [[0, 30], [0.3, 40], [0.6, 34], [1, 18]],
    [cl('c1', 0.08, 0.26, 'R', 1.0, 0.4), to('t1', 0.38, 0.22, 'R'), cl('c2', 0.48, 0.62, 'L', 1.0, 0.6), vo('v1', 0.86, [808, 598], 14, 0.9)],
    [{ pts: [[590, 360], [610, 410], [650, 450], [700, 470], [735, 455]], width: [[0, 22], [0.6, 20], [1, 12]], events: [cl('bc', 0.3, 0.6, 'R', 0.9, 0.7), to('bt', 0.72, 0.3, 'L')] }]),
  // 2 · out along a band with lobes above, rolling into a large scroll, then turning over to silver into a second smaller scroll
  scroll: plume('Double scroll', BLUE_SILVER, { recurve: 0.6, lobeDepth: 0.5 },
    [[540, 420], [620, 400], [710, 360], [780, 350], [840, 380], [850, 450], [800, 490], [745, 470], [740, 430], [775, 420]],
    [[0, 24], [0.3, 30], [0.7, 24], [1, 12]],
    [cl('c1', 0.06, 0.3, 'R', 1.0, 0.5), ro('r1', 0.05, 0.4, 'L', 0.5), ro('r2', 0.45, 0.75, 'R', 0.5), cl('c2', 0.62, 0.8, 'L', 0.7, 0.5)],
    [{ pts: [[800, 470], [790, 520], [760, 570], [740, 610], [770, 650], [805, 640], [800, 612], [780, 620]], width: [[0, 20], [0.5, 18], [1, 10]], events: [to('bt', 0.3, 0.25, 'R'), cl('bc', 0.45, 0.65, 'L', 0.8, 0.5)] }]),
  // 3 · flame: broad fronds streaming up and out, their tips curling over to gold; a gold curl with a red flick at the top
  flame: plume('Flame fronds', RED_GOLD, { recurve: 0.55, lobeDepth: 0.65, sharpness: 0.6 },
    [[540, 410], [590, 380], [640, 330], [670, 270], [690, 220], [730, 190], [770, 205], [775, 240], [750, 245]],
    [[0, 30], [0.4, 34], [0.8, 24], [1, 16]],
    [cl('c1', 0.1, 0.34, 'R', 1.2, 0.8), cl('c2', 0.3, 0.5, 'L', 1.0, 0.7), ro('r1', 0.4, 0.66, 'R', 0.5), to('t1', 0.72, 0.18, 'L'), cl('c3', 0.8, 0.92, 'R', 0.8, 1)],
    [{ pts: [[600, 370], [660, 380], [720, 370], [770, 340], [800, 300]], width: [[0, 24], [0.5, 22], [1, 12]], events: [cl('bc', 0.2, 0.6, 'R', 1.1, 0.8), to('bt', 0.7, 0.3, 'L')] }]),
  // 4 · upright: rises close beside the helm in an S with heavy fronds stacked upward, turning over at the top into a grey curl
  upright: plume('Upright fronds', RED_GREY, { recurve: 0.5, lobeDepth: 0.6 },
    [[535, 410], [580, 380], [600, 320], [590, 250], [600, 190], [640, 150], [680, 160], [685, 200], [660, 205]],
    [[0, 30], [0.4, 36], [0.8, 26], [1, 16]],
    [cl('c1', 0.12, 0.32, 'R', 1.1, 0.5), cl('c2', 0.36, 0.56, 'R', 1.1, 0.6), cl('c3', 0.3, 0.5, 'L', 0.8, 0.5), to('t1', 0.66, 0.2, 'L'), vo('v1', 0.86, [664, 182], 12, 0.85)],
    [{ pts: [[575, 390], [630, 400], [690, 390], [730, 360], [745, 320]], width: [[0, 22], [0.5, 22], [1, 12]], events: [cl('bc', 0.25, 0.7, 'L', 1.0, 0.6), to('bt', 0.75, 0.25, 'R')] }]),
  // 5 · drop: out and falling beside the shield, turning over twice (white, red, white) and ending in a curl
  drop: plume('Falling turn-overs', RED_WHITE, { recurve: 0.55, lobeDepth: 0.5 },
    [[540, 430], [610, 420], [680, 440], [720, 490], [740, 550], [720, 620], [690, 660], [700, 720], [740, 740], [765, 715], [748, 695]],
    [[0, 30], [0.3, 34], [0.7, 26], [1, 14]],
    [cl('c1', 0.06, 0.22, 'R', 0.9, 0.5), to('t1', 0.3, 0.16, 'L'), cl('c2', 0.38, 0.5, 'L', 0.9, 0.6), to('t2', 0.58, 0.16, 'R'), cl('c3', 0.64, 0.76, 'R', 0.8, 0.6), vo('v1', 0.88, [742, 716], 11, 0.85)]),
};
if (out) for (const [k, d] of Object.entries(designs)) writeFileSync(`${out}/${k}.svg`, renderSVG(d, { toggles: defaultToggles() }).svg);
