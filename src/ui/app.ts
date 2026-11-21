import { V, add, sub, mul, dot, perp, norm, dist, clamp, rot } from '../geom/vec';
import { filterGesture, fitSpine, easySpine } from '../geom/bezier';
import type { Doc, Strip, StripEvent, ClusterEvent, TurnoverEvent, BranchEvent, VoluteEvent, RenderToggles, Side, Settings } from '../model/types';
import { SHEET, FRAME, uid, defaultToggles } from '../model/types';
import { build, Built, StripGeo, P, hAt, toWorld, toLocal } from '../model/build';
import { renderSVG } from '../render/svg';
import { clone, emptyDoc, newStrip, addStrip, syncMirror, bareFraction, defaultEye, walkStrips, mirrorStrip } from '../model/ops';
import { compose, isEnvelope, sweepsFromEnvelope } from '../model/compose';
import garter from '../presets/garter.json';
import stirling from '../presets/stirling.json';

type Tool = 'edit' | 'draw' | 'lobes' | 'fork' | 'width' | 'volute' | 'fold';
const PRESETS: Record<string, Doc> = { Garter: garter as unknown as Doc, Stirling: stirling as unknown as Doc };
const STORE = 'mantling.doc.v1';
const TSTORE = 'mantling.toggles.v1';

interface Sel {
  stripId?: string;
  eventId?: string;
  /** width tool: t of the crossbar */
  t?: number;
}

interface Handle {
  id: string;
  p: V;
  kind: 'anchor' | 'ctrl' | 'main';
  drag: (q: V) => void;
}

export function startApp(root: HTMLElement) {
  // ---------------------------------------------------------------- state
  let doc: Doc = load() ?? clone(PRESETS.Garter);
  let toggles: RenderToggles = loadToggles();
  let tool: Tool = 'edit';
  let sel: Sel = {};
  let mirror = true;
  let autoCompose = true;
  let smoothing = 0.55;
  let built: Built = build(doc);
  const history: string[] = [JSON.stringify(doc)];
  let hIndex = 0;
  let view = { x: 150, y: 120, w: 700, h: 700 };
  let lastGesture: { raw: V[]; stripId: string } | null = null;
  let handles: Handle[] = [];
  let draft = false;

  // ---------------------------------------------------------------- DOM
  root.innerHTML = `
<div class="stage-wrap"><svg id="stage" xmlns="http://www.w3.org/2000/svg"><g id="art"></g><g id="ov"></g></svg>
<div class="hud" id="hud"></div></div>
<div class="panel">
  <div class="ctx" id="ctx"></div>
  <div class="row tools" id="tools"></div>
  <div class="row actions" id="actions"></div>
</div>
<div class="sheet" id="sheet" hidden></div>`;
  const stage = root.querySelector('#stage') as SVGSVGElement;
  const art = root.querySelector('#art') as SVGGElement;
  const ov = root.querySelector('#ov') as SVGGElement;
  const ctxEl = root.querySelector('#ctx') as HTMLElement;
  const hud = root.querySelector('#hud') as HTMLElement;
  const sheet = root.querySelector('#sheet') as HTMLElement;

  const TOOLS: [Tool, string, string][] = [
    ['edit', 'Edit', 'Select and drag any handle'],
    ['draw', 'Sweep', 'Draw a stem (or a closed envelope)'],
    ['lobes', 'Lobes', 'Tap a strip edge to bracket a cluster'],
    ['fork', 'Fork', 'Tap a station to branch'],
    ['width', 'Width', 'Tap a station, drag the crossbar ends'],
    ['volute', 'Volute', 'Tap a station, place the eye'],
    ['fold', 'Fold', 'Tap the edge that rolls over'],
  ];
  const toolsEl = root.querySelector('#tools') as HTMLElement;
  toolsEl.innerHTML = TOOLS.map(([t, l]) => `<button data-tool="${t}">${l}</button>`).join('');
  toolsEl.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b) return;
    tool = b.dataset.tool as Tool;
    sel = tool === 'edit' ? sel : { stripId: sel.stripId };
    refreshUI();
  });
  const actionsEl = root.querySelector('#actions') as HTMLElement;
  actionsEl.innerHTML = `
<button data-a="undo" aria-label="Undo">↶</button><button data-a="redo" aria-label="Redo">↷</button>
<button data-a="compose">Compose</button><button data-a="reseed">Reseed</button>
<button data-a="mirror" class="toggle">Mirror</button><button data-a="delete">Delete</button><button data-a="more">More…</button>`;
  actionsEl.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b) return;
    const a = b.dataset.a;
    if (a === 'undo') undo();
    else if (a === 'redo') redo();
    else if (a === 'compose') {
      if (!doc.strips.some((s) => s.sweep)) {
        flash('Draw 1–3 sweeps (or an envelope) first; they become the composition’s stems.');
        return;
      }
      compose(doc);
      commit();
    } else if (a === 'reseed') {
      doc.seed = (doc.seed * 48271 + 11) % 2147483647;
      compose(doc);
      commit();
    } else if (a === 'mirror') {
      mirror = !mirror;
      refreshUI();
    } else if (a === 'delete') deleteSelection();
    else if (a === 'more') openSheet();
  });

  // ---------------------------------------------------------------- view
  function applyView() {
    stage.setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`);
  }
  function fitView() {
    const r = stage.getBoundingClientRect();
    const aspect = r.width / Math.max(1, r.height);
    // frame the mantling (and the helm with the top of the shield)
    let x0 = 330, y0 = 300, x1 = 670, y1 = 640;
    for (const p of built.pieces) {
      const tr = p.track;
      for (let i = 0; i < tr.n; i += 4) {
        const h = Math.max(p.hL[i], p.hR[i]);
        x0 = Math.min(x0, tr.x[i] - h);
        x1 = Math.max(x1, tr.x[i] + h);
        y0 = Math.min(y0, tr.y[i] - h);
        y1 = Math.max(y1, tr.y[i] + h);
      }
    }
    const m = 20;
    let cw = x1 - x0 + 2 * m, ch = y1 - y0 + 2 * m;
    if (cw / ch > aspect) ch = cw / aspect;
    else cw = ch * aspect;
    view = { x: (x0 + x1) / 2 - cw / 2, y: (y0 + y1) / 2 - ch / 2, w: cw, h: ch };
    applyView();
  }
  /** units per CSS pixel */
  function upp() {
    const r = stage.getBoundingClientRect();
    return view.w / Math.max(1, r.width);
  }
  function toSheet(e: { clientX: number; clientY: number }): V {
    const r = stage.getBoundingClientRect();
    // preserveAspectRatio xMidYMid meet
    const s = Math.max(view.w / r.width, view.h / r.height);
    const ox = (r.width * s - view.w) / 2, oy = (r.height * s - view.h) / 2;
    return [view.x + (e.clientX - r.left) * s - ox, view.y + (e.clientY - r.top) * s - oy];
  }

  // ---------------------------------------------------------------- render
  let rafPending = false;
  function render(isDraft = false) {
    draft = isDraft;
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      built = build(doc);
      const r = renderSVG(doc, { toggles, draft }, built);
      art.innerHTML = r.inner;
      drawOverlay();
    });
  }
  function renderNow() {
    built = build(doc);
    art.innerHTML = renderSVG(doc, { toggles, draft: false }, built).inner;
    drawOverlay();
  }

  // ---------------------------------------------------------------- history
  function commit() {
    const snap = JSON.stringify(doc);
    if (snap !== history[hIndex]) {
      history.splice(hIndex + 1);
      history.push(snap);
      if (history.length > 120) history.shift();
      hIndex = history.length - 1;
      save();
    }
    render(false);
    refreshUI();
  }
  function undo() {
    if (hIndex <= 0) return;
    hIndex--;
    doc = JSON.parse(history[hIndex]);
    afterRestore();
  }
  function redo() {
    if (hIndex >= history.length - 1) return;
    hIndex++;
    doc = JSON.parse(history[hIndex]);
    afterRestore();
  }
  function afterRestore() {
    if (sel.stripId && !findGeoStrip(sel.stripId)) sel = {};
    save();
    renderNow();
    refreshUI();
  }
  function save() {
    try {
      localStorage.setItem(STORE, JSON.stringify(doc));
    } catch {
      /* storage may be unavailable */
    }
  }

  // ---------------------------------------------------------------- lookup helpers
  function findGeoStrip(id: string): Strip | null {
    let f: Strip | null = null;
    walkStrips(doc, (s) => {
      if (s.id === id) f = s;
    });
    return f;
  }
  function geoOf(id?: string): StripGeo | undefined {
    return id ? built.all.find((g) => g.strip.id === id) : undefined;
  }
  function topOf(id: string): Strip | null {
    for (const s of doc.strips) {
      let hit = false;
      const rec = (x: Strip) => {
        if (x.id === id) hit = true;
        for (const e of x.events) if (e.kind === 'branch') rec(e.child);
      };
      rec(s);
      if (hit) return s;
    }
    return null;
  }
  function eventOf(stripId?: string, eventId?: string): StripEvent | undefined {
    const s = stripId ? findGeoStrip(stripId) : null;
    return s?.events.find((e) => e.id === eventId);
  }
  /** Mark an edited strip/event as manual and propagate mirroring. */
  function touched(stripId: string, ev?: StripEvent) {
    if (ev) delete ev.gen;
    const s = findGeoStrip(stripId);
    if (s) delete s.gen;
    const top = topOf(stripId);
    if (top && mirror && top.mirror && !top.mirrorBroken) {
      // keep the composer's sweep flag on both
      syncMirror(doc, top.id);
    }
  }

  /** Nearest strip station to a sheet point. */
  function hitStrip(q: V, maxV = 1.5): { g: StripGeo; s: number; t: number; v: number; side: Side } | null {
    let best: { g: StripGeo; s: number; t: number; v: number; side: Side } | null = null;
    let bestD = Infinity;
    const slack = 14 * upp();
    for (const g of built.all) {
      const tr = g.track;
      for (let i = 0; i < tr.n; i += 2) {
        const dx = q[0] - tr.x[i], dy = q[1] - tr.y[i];
        if (Math.abs(dx) > 80 || Math.abs(dy) > 80) continue;
        const along = dx * tr.tx[i] + dy * tr.ty[i];
        if (Math.abs(along) > 2.5) continue;
        const across = -dx * tr.ty[i] + dy * tr.tx[i];
        const h = across >= 0 ? g.hL[i] : g.hR[i];
        const v = across / Math.max(1, h);
        const over = Math.max(0, Math.abs(across) - h);
        if (over > slack || Math.abs(v) > maxV + slack / Math.max(1, h)) continue;
        const d = over + Math.abs(v) * 0.01 - g.depth * 0.001;
        if (d < bestD) {
          bestD = d;
          best = { g, s: tr.s[i], t: tr.s[i] / g.Lb, v: clamp(v, -1, 1), side: across >= 0 ? 'L' : 'R' };
        }
      }
    }
    return best;
  }

  // ---------------------------------------------------------------- overlay & handles
  function drawOverlay() {
    handles = [];
    const u = upp();
    const parts: string[] = [];
    const g = geoOf(sel.stripId);
    const R = 11 * u;
    if (g) {
      // highlight the selected strip's centreline
      const tr = g.track;
      let d = '';
      for (let i = 0; i < tr.n; i += 3) d += (i ? 'L' : 'M') + tr.x[i].toFixed(1) + ' ' + tr.y[i].toFixed(1);
      parts.push(`<path d="${d}" fill="none" stroke="#1d6fe0" stroke-width="${1.6 * u}" stroke-dasharray="${6 * u} ${4 * u}" opacity="0.8"/>`);
      if (tool === 'edit') spineHandles(g, parts, u);
      eventHandles(g, parts, u);
    }
    if (lastGesture && tool === 'draw') {
      const p = lastGesture.raw;
      parts.push(`<path d="M${p.map((q) => q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join('L')}" fill="none" stroke="#888" stroke-width="${1.2 * u}" opacity="0.7"/>`);
    }
    for (const h of handles) {
      const col = h.kind === 'main' ? '#1d6fe0' : h.kind === 'anchor' ? '#ffffff' : '#9cc3ff';
      parts.push(`<circle cx="${h.p[0]}" cy="${h.p[1]}" r="${R}" fill="${col}" stroke="#0b3d91" stroke-width="${1.5 * u}"/>`);
    }
    ov.innerHTML = parts.join('');
  }

  function spineHandles(g: StripGeo, parts: string[], u: number) {
    const s = g.strip;
    const W = (p: V) => toWorld(g.frame, p);
    for (let i = 0; i < s.spine.length; i++) {
      if (g.depth > 0 && i === 0) continue; // a branch root follows its parent
      const isAnchor = i % 3 === 0;
      const p = W(s.spine[i]);
      if (!isAnchor) {
        const a = W(s.spine[i % 3 === 1 ? i - 1 : i + 1]);
        parts.push(`<line x1="${a[0]}" y1="${a[1]}" x2="${p[0]}" y2="${p[1]}" stroke="#0b3d91" stroke-width="${1 * u}"/>`);
      }
      handles.push({
        id: `sp${i}`,
        p,
        kind: isAnchor ? 'anchor' : 'ctrl',
        drag: (q) => {
          const lq = toLocal(g.frame, q);
          const d = sub(lq, s.spine[i]);
          s.spine[i] = lq;
          if (isAnchor) {
            if (i > 0) s.spine[i - 1] = add(s.spine[i - 1], d);
            if (i < s.spine.length - 1) s.spine[i + 1] = add(s.spine[i + 1], d);
          } else {
            // keep G1 at the shared anchor: mirror the opposite handle's direction
            const a = i % 3 === 1 ? i - 1 : i + 1;
            const o = i % 3 === 1 ? i - 2 : i + 2;
            if (o > 0 && o < s.spine.length - 1 && a > 0 && a < s.spine.length - 1) {
              const dirv = norm(sub(s.spine[a], s.spine[i]));
              const l = dist(s.spine[a], s.spine[o]);
              s.spine[o] = add(s.spine[a], mul(dirv, l));
            }
          }
          touched(s.id);
        },
      });
    }
  }

  function eventHandles(g: StripGeo, parts: string[], u: number) {
    const s = g.strip;
    const tr = g.track;
    const ptAt = (t: number, v: number) => P(tr, g.hL, g.hR, clamp(t * g.Lb, 0, tr.L), v);
    const projT = (q: V) => {
      // nearest station on this strip
      let bi = 0, bd = Infinity;
      for (let i = 0; i < tr.n; i++) {
        const d = (q[0] - tr.x[i]) ** 2 + (q[1] - tr.y[i]) ** 2;
        if (d < bd) {
          bd = d;
          bi = i;
        }
      }
      const across = -(q[0] - tr.x[bi]) * tr.ty[bi] + (q[1] - tr.y[bi]) * tr.tx[bi];
      return { t: tr.s[bi] / g.Lb, across, i: bi };
    };
    for (const ev of s.events) {
      const active = ev.id === sel.eventId;
      if (ev.kind === 'cluster') {
        const sg = ev.side === 'L' ? 1 : -1;
        const a = ptAt(ev.t0, sg * 1.15), b = ptAt(ev.t1, sg * 1.15);
        parts.push(`<path d="M${a[0]} ${a[1]}L${b[0]} ${b[1]}" stroke="#1d6fe0" stroke-width="${(active ? 3 : 1.5) * u}" opacity="0.7"/>`);
        if (!active && tool !== 'edit' && tool !== 'lobes') continue;
        if (!active) {
          handles.push({ id: ev.id + 'm', p: ptAt((ev.t0 + ev.t1) / 2, sg * 1.15), kind: 'ctrl', drag: () => selectEvent(s.id, ev.id) });
          continue;
        }
        const setT = (key: 't0' | 't1') => (q: V) => {
          const old = ev[key];
          ev[key] = clamp(projT(q).t, 0, 1);
          if (bareFraction(s) < 0.4) ev[key] = old; // keep at least 40% bare
          touched(s.id, ev);
        };
        handles.push({ id: ev.id + 't0', p: a, kind: 'main', drag: setT('t0') });
        handles.push({ id: ev.id + 't1', p: b, kind: 'main', drag: setT('t1') });
        const tm = (ev.t0 + ev.t1) / 2;
        const base = ptAt(tm, sg);
        const c = tr.at(tm * g.Lb);
        const out = mul(perp([c.tx, c.ty]), sg);
        const h = hAt(sg > 0 ? g.hL : g.hR, tr, tm * g.Lb) * 2;
        const sp = add(base, mul(out, h * ev.size * 1.6 + 10));
        parts.push(`<line x1="${base[0]}" y1="${base[1]}" x2="${sp[0]}" y2="${sp[1]}" stroke="#1d6fe0" stroke-width="${1.2 * u}"/>`);
        handles.push({
          id: ev.id + 'sz',
          p: sp,
          kind: 'main',
          drag: (q) => {
            ev.size = clamp((dot(sub(q, base), out) - 10) / (h * 1.6), 0.3, 2.5);
            touched(s.id, ev);
          },
        });
      } else if (ev.kind === 'turnover') {
        const sg = ev.edge === 'L' ? 1 : -1;
        const cr = g.creases.find((c) => c.ev === ev);
        const cs = cr ? cr.s : ev.t * g.Lb;
        const p = P(tr, g.hL, g.hR, cs + (cr ? cr.slope * sg : 0), sg);
        if (!active) {
          handles.push({ id: ev.id + 'm', p, kind: 'ctrl', drag: () => selectEvent(s.id, ev.id) });
          continue;
        }
        handles.push({
          id: ev.id + 'cr',
          p,
          kind: 'main',
          drag: (q) => {
            // along the strip moves the fold; the offset from the centre station sets the crease's obliquity
            const r = projT(q);
            const c = tr.at(ev.t * g.Lb);
            const along = dot(sub(q, [c.x, c.y]), [c.tx, c.ty]);
            const h = Math.max(4, hAt(sg > 0 ? g.hL : g.hR, tr, ev.t * g.Lb));
            if (Math.abs(r.across) > h * 0.6) ev.crease = clamp((Math.atan2(along, h) * 180) / Math.PI * sg, -65, 65);
            else ev.t = clamp(r.t, 0.03, 0.97);
            touched(s.id, ev);
          },
        });
        const tp = ptAt(ev.t + ev.length / 2, 0);
        handles.push({
          id: ev.id + 'len',
          p: tp,
          kind: 'ctrl',
          drag: (q) => {
            ev.length = clamp(2 * Math.abs(projT(q).t - ev.t), 0.03, 0.4);
            touched(s.id, ev);
          },
        });
      } else if (ev.kind === 'branch') {
        const child = geoOf(ev.child.id);
        const sg = ev.side === 'L' ? 1 : -1;
        const rootP = ptAt(ev.t, sg * 0.35);
        if (!active) {
          handles.push({ id: ev.id + 'm', p: rootP, kind: 'ctrl', drag: () => selectEvent(s.id, ev.id) });
          continue;
        }
        handles.push({
          id: ev.id + 'root',
          p: rootP,
          kind: 'main',
          drag: (q) => {
            const r = projT(q);
            ev.t = clamp(r.t, 0.02, 0.98);
            const h = hAt(r.across >= 0 ? g.hL : g.hR, tr, ev.t * g.Lb);
            if (Math.abs(r.across) > h * 0.5) ev.side = r.across >= 0 ? 'L' : 'R';
            touched(s.id, ev);
          },
        });
        if (child) {
          const sp = ev.child.spine;
          const tipW = toWorld(child.frame, sp[sp.length - 1]);
          handles.push({
            id: ev.id + 'tip',
            p: tipW,
            kind: 'main',
            drag: (q) => {
              const fr = geoOf(ev.child.id)?.frame ?? child.frame;
              const lt = toLocal(fr, q);
              const ang = (ev.angle * Math.PI) / 180;
              const dir: V = [Math.cos(ang), sg * Math.sin(ang)];
              ev.child.spine = easySpine([0, 0], dir, lt, 0.35);
              touched(s.id, ev);
            },
          });
          // departure angle handle: a short arm from the root
          const armL = 40;
          const c = tr.at(ev.t * g.Lb);
          const dirW = rot([c.tx, c.ty], sg * (ev.angle * Math.PI) / 180);
          const ap = add(rootP, mul(dirW, armL));
          parts.push(`<line x1="${rootP[0]}" y1="${rootP[1]}" x2="${ap[0]}" y2="${ap[1]}" stroke="#1d6fe0" stroke-width="${1.2 * u}"/>`);
          handles.push({
            id: ev.id + 'ang',
            p: ap,
            kind: 'ctrl',
            drag: (q) => {
              const d = sub(q, rootP);
              const a = Math.atan2(dot(d, perp([c.tx, c.ty])) * sg, dot(d, [c.tx, c.ty]));
              ev.angle = clamp((a * 180) / Math.PI, 5, 120);
              touched(s.id, ev);
            },
          });
        }
      } else if (ev.kind === 'volute') {
        const eyeW = toWorld(g.frame, ev.eye);
        parts.push(`<circle cx="${eyeW[0]}" cy="${eyeW[1]}" r="${ev.eyeR}" fill="none" stroke="#1d6fe0" stroke-width="${1.4 * u}" stroke-dasharray="${4 * u} ${3 * u}"/>`);
        if (!active) {
          handles.push({ id: ev.id + 'm', p: eyeW, kind: 'ctrl', drag: () => selectEvent(s.id, ev.id) });
          continue;
        }
        handles.push({
          id: ev.id + 'eye',
          p: eyeW,
          kind: 'main',
          drag: (q) => {
            ev.eye = toLocal(g.frame, q);
            touched(s.id, ev);
          },
        });
        handles.push({
          id: ev.id + 'rim',
          p: add(eyeW, [ev.eyeR, 0]),
          kind: 'ctrl',
          drag: (q) => {
            ev.eyeR = clamp(dist(q, toWorld(g.frame, ev.eye)), 3, 120);
            touched(s.id, ev);
          },
        });
        const st = ptAt(ev.t, 0);
        handles.push({
          id: ev.id + 'st',
          p: st,
          kind: 'ctrl',
          drag: (q) => {
            ev.t = clamp(projT(q).t, 0.1, 0.98);
            touched(s.id, ev);
          },
        });
      }
    }
    if (tool === 'width' && sel.t !== undefined) {
      const t = sel.t;
      const c = tr.at(clamp(t * g.Lb, 0, tr.L));
      const n = perp([c.tx, c.ty]);
      const pl = P(tr, g.hL, g.hR, t * g.Lb, 1), pr = P(tr, g.hL, g.hR, t * g.Lb, -1);
      parts.push(`<line x1="${pl[0]}" y1="${pl[1]}" x2="${pr[0]}" y2="${pr[1]}" stroke="#1d6fe0" stroke-width="${2.2 * u}"/>`);
      const setW = (sg: number) => (q: V) => {
        const half = Math.abs(dot(sub(q, [c.x, c.y]), n));
        setWidthKnot(s, t, clamp(half * 2, 2, 200));
        void sg;
        touched(s.id);
      };
      handles.push({ id: 'wl', p: pl, kind: 'main', drag: setW(1) });
      handles.push({ id: 'wr', p: pr, kind: 'main', drag: setW(-1) });
    }
  }

  function setWidthKnot(s: Strip, t: number, w: number) {
    const k = s.width.find((x) => Math.abs(x.t - t) < 0.03);
    if (k) k.w = w;
    else {
      s.width.push({ t, w });
      s.width.sort((a, b) => a.t - b.t);
    }
  }

  function selectEvent(stripId: string, eventId: string) {
    sel = { stripId, eventId };
    refreshUI();
    drawOverlay();
  }

  // ---------------------------------------------------------------- gestures
  const pointers = new Map<number, V>();
  let pinch: { d: number; mid: V; view: typeof view } | null = null;
  let drag: Handle | null = null;
  let drawing: V[] | null = null;
  let moved = false;
  let downAt: V = [0, 0];

  stage.addEventListener('pointerdown', (e) => {
    stage.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    if (pointers.size === 2) {
      // two fingers: pan / zoom; abandon any one-finger action
      drag = null;
      drawing = null;
      const [a, b] = [...pointers.values()];
      pinch = { d: dist(a, b), mid: mul(add(a, b), 0.5), view: { ...view } };
      drawOverlay();
      return;
    }
    if (pointers.size > 2) return;
    const q = toSheet(e);
    downAt = q;
    moved = false;
    // handles first (44px targets)
    const R = 22 * upp();
    let best: Handle | null = null, bd = R;
    for (const h of handles) {
      // in a creating tool, the small "select this event" markers do not intercept taps
      if (tool !== 'edit' && h.id.endsWith('m')) continue;
      const d = dist(h.p, q);
      if (d < bd) {
        bd = d;
        best = h;
      }
    }
    if (best) {
      drag = best;
      return;
    }
    if (tool === 'draw') {
      drawing = [q];
      lastGesture = null;
    }
  });

  stage.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = dist(a, b);
      const mid = mul(add(a, b), 0.5);
      const r = stage.getBoundingClientRect();
      const k = clamp(pinch.d / Math.max(10, d), 0.08, 12);
      const v0 = pinch.view;
      const w = clamp(v0.w * k, 60, 3000), h = (v0.h * w) / v0.w;
      // keep the sheet point under the original midpoint under the new midpoint
      const s0 = v0.w / r.width;
      const px = v0.x + (pinch.mid[0] - r.left) * s0;
      const py = v0.y + (pinch.mid[1] - r.top) * s0;
      const s1 = w / r.width;
      view = { x: px - (mid[0] - r.left) * s1, y: py - (mid[1] - r.top) * s1, w, h };
      applyView();
      drawOverlay();
      return;
    }
    const q = toSheet(e);
    if (dist(q, downAt) > 4 * upp()) moved = true;
    if (drag) {
      drag.drag(q);
      render(true);
      return;
    }
    if (drawing) {
      drawing.push(q);
      const pts = drawing;
      ov.innerHTML = `<path d="M${pts.map((p) => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('L')}" fill="none" stroke="#1d6fe0" stroke-width="${2 * upp()}" stroke-linecap="round"/>`;
    }
  });

  const end = (e: PointerEvent) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pinch) {
      if (pointers.size < 2) pinch = null;
      return;
    }
    const q = toSheet(e);
    if (drag) {
      const wasSelect = !moved && drag.kind === 'ctrl' && drag.id.endsWith('m');
      if (!moved && !wasSelect && tool !== 'edit') {
        // a tap on a handle in a creating tool still creates
        drag = null;
        tap(q, e);
        return;
      }
      if (wasSelect) drag.drag(q);
      else if (moved) drag.drag(q);
      drag = null;
      commit();
      return;
    }
    if (drawing) {
      const raw = drawing;
      drawing = null;
      finishSweep(raw);
      return;
    }
    if (!moved) tap(q, e);
  };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);

  // ---------------------------------------------------------------- tools
  function fitGesture(raw: V[]) {
    const passes = Math.round(1 + smoothing * 7);
    const err = 2 + smoothing * 30;
    return fitSpine(filterGesture(raw, passes, 2.5), err);
  }

  function finishSweep(raw: V[]) {
    let len = 0;
    for (let i = 1; i < raw.length; i++) len += dist(raw[i], raw[i - 1]);
    if (len < 40) {
      drawOverlay();
      return;
    }
    if (isEnvelope(raw)) {
      const made = sweepsFromEnvelope(doc, raw, 2 + smoothing * 30, mirror);
      if (autoCompose) compose(doc);
      sel = { stripId: made[0]?.id };
      lastGesture = null;
      commit();
      flash('Envelope → ' + made.length + ' sweeps per side');
      return;
    }
    // root toward the helm: reverse the gesture if it was drawn inward
    const a = FRAME.anchor;
    if (dist(raw[raw.length - 1], a) < dist(raw[0], a) * 0.8) raw = raw.slice().reverse();
    if (dist(raw[0], a) < 90) raw = [[a[0] + Math.sign(raw[raw.length - 1][0] - a[0]) * 12, a[1] + (raw[0][1] - a[1]) * 0.5], ...raw];
    const sp = fitGesture(raw);
    if (sp.length < 4) return;
    const s = newStrip(sp);
    s.sweep = true;
    addStrip(doc, s, mirror && Math.abs(sp[0][0] - SHEET.cx) < 160);
    lastGesture = { raw, stripId: s.id };
    sel = { stripId: s.id };
    if (autoCompose) compose(doc);
    commit();
  }

  function refitLast() {
    if (!lastGesture) return;
    const s = findGeoStrip(lastGesture.stripId);
    if (!s) return;
    s.spine = fitGesture(lastGesture.raw);
    touched(s.id);
    if (autoCompose) compose(doc);
    render(false);
  }

  function tap(q: V, e: PointerEvent) {
    if ((window as unknown as { __dbg?: boolean }).__dbg) console.log('tap', tool, JSON.stringify(q));
    const h = hitStrip(q);
    if (tool === 'edit') {
      // tapping foliage selects its cluster
      const pieceEl = (e.target as Element).closest?.('[data-piece]') as HTMLElement | null;
      const pid = pieceEl?.dataset.piece;
      const piece = pid ? built.pieces.find((p) => p.id === pid) : undefined;
      if (piece?.eventId) sel = { stripId: piece.stripId, eventId: piece.eventId };
      else if (h) sel = { stripId: h.g.strip.id };
      else sel = {};
      refreshUI();
      drawOverlay();
      return;
    }
    if (!h) {
      flash('Tap on a strip');
      return;
    }
    const s = h.g.strip;
    const t = clamp(h.t, 0, 1);
    let ev: StripEvent | null = null;
    if (tool === 'lobes') {
      const half = 0.05;
      const c: ClusterEvent = { kind: 'cluster', id: uid('c'), t0: clamp(t - half, 0, 1), t1: clamp(t + half, 0, 1), side: h.side, size: 1, depth: 3, split: [1, 0.6, 0.42, 0.28] };
      s.events.push(c);
      if (bareFraction(s) < 0.4) {
        s.events.pop();
        flash('That would leave less than 40% of the strip bare');
        return;
      }
      ev = c;
    } else if (tool === 'fork') {
      const sg = h.side === 'L' ? 1 : -1;
      const L = h.g.track.L;
      const len = clamp(L * 0.4, 60, 260);
      const ang = 40;
      const a = (ang * Math.PI) / 180;
      const tip: V = [Math.cos(a) * len, sg * Math.sin(a) * len];
      const w = hAt(h.g.hL, h.g.track, h.s) + hAt(h.g.hR, h.g.track, h.s);
      const child: Strip = { id: uid('s'), spine: easySpine([0, 0], [Math.cos(a), sg * Math.sin(a)], tip, 0.35), width: [{ t: 0, w: w * 0.55 }, { t: 0.3, w: w * 0.62 }, { t: 1, w: w * 0.3 }], events: [] };
      const b: BranchEvent = { kind: 'branch', id: uid('b'), t, side: h.side, angle: ang, rootWidth: w * 0.55, crossing: 'behind', child };
      s.events.push(b);
      ev = b;
    } else if (tool === 'width') {
      sel = { stripId: s.id, t };
      refreshUI();
      drawOverlay();
      return;
    } else if (tool === 'volute') {
      const w = hAt(h.g.hL, h.g.track, h.s) + hAt(h.g.hR, h.g.track, h.s);
      const eyeR = clamp(w * 0.45, 5, 40);
      const terminal = t > 0.5;
      const turns = 1.3;
      const sp = s.spine;
      let eye: V;
      if (h.g.depth === 0) eye = defaultEye(sp, t, eyeR, turns);
      else {
        const c = h.g.track.at(h.s);
        const sg = h.side === 'L' ? 1 : -1;
        eye = toLocal(h.g.frame, add([c.x, c.y], mul(perp([c.tx, c.ty]), sg * eyeR * 3.5)));
      }
      if (!terminal) {
        // a branching coil springs to the side that was tapped
        const c = h.g.track.at(h.s);
        const sg = h.side === 'L' ? 1 : -1;
        const ew = add(add([c.x, c.y], mul(perp([c.tx, c.ty]), sg * (w * 0.5 + eyeR * 3))), mul([c.tx, c.ty], eyeR * 2));
        eye = toLocal(h.g.frame, ew);
      }
      const vEv: VoluteEvent = { kind: 'volute', id: uid('v'), t, eye, eyeR, turns, hand: 1, mode: terminal ? 'terminal' : 'branching', crossing: 'behind' };
      if (terminal) s.events = s.events.filter((x) => !(x.kind === 'volute' && x.mode === 'terminal'));
      s.events.push(vEv);
      ev = vEv;
    } else if (tool === 'fold') {
      const f: TurnoverEvent = { kind: 'turnover', id: uid('f'), t: clamp(t, 0.03, 0.97), length: 0.1, edge: h.side, crease: 35 };
      s.events.push(f);
      ev = f;
    }
    if (ev) {
      sel = { stripId: s.id, eventId: ev.id };
      touched(s.id, ev);
      commit();
    }
  }

  function deleteSelection() {
    if (!sel.stripId) return;
    const s = findGeoStrip(sel.stripId);
    if (!s) return;
    if (sel.eventId) {
      s.events = s.events.filter((e) => e.id !== sel.eventId);
      touched(s.id);
      sel = { stripId: s.id };
    } else {
      const top = topOf(s.id);
      if (top && top.id === s.id) {
        const partner = top.mirror && mirror && !top.mirrorBroken ? top.mirror : null;
        doc.strips = doc.strips.filter((x) => x.id !== s.id && x.id !== partner);
        for (const x of doc.strips) if (x.mirror === s.id) delete x.mirror;
      } else {
        // a branch child: remove its branch event from the parent
        walkStrips(doc, (x) => {
          x.events = x.events.filter((e) => !(e.kind === 'branch' && e.child.id === s.id));
        });
        if (top) touched(top.id);
      }
      sel = {};
    }
    commit();
  }

  // ---------------------------------------------------------------- context row
  function refreshUI() {
    for (const b of toolsEl.querySelectorAll('button')) b.classList.toggle('on', b.dataset.tool === tool);
    const mb = actionsEl.querySelector('[data-a="mirror"]') as HTMLElement;
    mb.classList.toggle('on', mirror);
    (actionsEl.querySelector('[data-a="undo"]') as HTMLButtonElement).disabled = hIndex <= 0;
    (actionsEl.querySelector('[data-a="redo"]') as HTMLButtonElement).disabled = hIndex >= history.length - 1;
    const s = sel.stripId ? findGeoStrip(sel.stripId) : null;
    const ev = eventOf(sel.stripId, sel.eventId);
    const bare = s ? Math.round(bareFraction(s) * 100) : null;
    let html = '';
    const hint = TOOLS.find((x) => x[0] === tool)![2];
    if (tool === 'draw') {
      html = `<label class="sl">Smoothing<input type="range" min="0" max="1" step="0.01" value="${smoothing}" data-c="smooth"></label>
<button data-c="auto" class="toggle ${autoCompose ? 'on' : ''}">Auto-compose</button>`;
    } else if (ev?.kind === 'cluster') {
      html = `<span class="tag ${bare! < 40 ? 'warn' : ''}">Bare ${bare}%</span>
<button data-c="depth">Depth ${ev.depth}</button><button data-c="split">${ev.split.length} parts</button><button data-c="cside">Side</button>`;
    } else if (ev?.kind === 'volute') {
      html = `<label class="sl wheel">Turns ${ev.turns.toFixed(2)}<input type="range" min="0.5" max="3" step="0.05" value="${ev.turns}" data-c="turns"></label>
<button data-c="flip">Flip</button><button data-c="mode">${ev.mode === 'terminal' ? 'Terminal' : 'Branching'}</button>`;
    } else if (ev?.kind === 'turnover') {
      html = `<span class="tag">Crease ${Math.round(ev.crease)}°</span><button data-c="edge">Edge ${ev.edge}</button>`;
    } else if (ev?.kind === 'branch') {
      html = `<span class="tag">Angle ${Math.round(ev.angle)}°</span><button data-c="cross">${ev.crossing === 'behind' ? 'Behind' : 'In front'}</button>`;
    } else if (s) {
      const top = topOf(s.id);
      html = `<span class="tag">Bare ${bare}%</span>${top && top.mirror ? `<button data-c="break" class="toggle ${top.mirrorBroken ? '' : 'on'}">${top.mirrorBroken ? 'Unlinked' : 'Linked'}</button>` : ''}`;
      if (s && top && top.id === s.id) html += `<button data-c="z">To front</button>`;
    } else html = `<span class="hint">${hint}</span>`;
    ctxEl.innerHTML = html;
  }

  ctxEl.addEventListener('input', (e) => {
    const el = e.target as HTMLInputElement;
    if (el.dataset.c === 'smooth') {
      smoothing = +el.value;
      refitLast();
    } else if (el.dataset.c === 'turns') {
      const ev = eventOf(sel.stripId, sel.eventId) as VoluteEvent;
      if (ev) {
        ev.turns = +el.value;
        touched(sel.stripId!, ev);
        render(true);
        const lab = el.parentElement!;
        lab.firstChild!.textContent = `Turns ${ev.turns.toFixed(2)}`;
      }
    }
  });
  ctxEl.addEventListener('change', (e) => {
    const el = e.target as HTMLInputElement;
    if (el.dataset.c === 'turns' || el.dataset.c === 'smooth') commit();
  });
  ctxEl.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b) return;
    const c = b.dataset.c;
    const s = sel.stripId ? findGeoStrip(sel.stripId) : null;
    const ev = eventOf(sel.stripId, sel.eventId);
    if (c === 'auto') {
      autoCompose = !autoCompose;
      refreshUI();
      return;
    }
    if (!s) return;
    if (ev?.kind === 'cluster') {
      if (c === 'depth') ev.depth = (ev.depth % 3) + 1;
      if (c === 'split') ev.split = ev.split.length >= 4 ? [1, 0.6] : ev.split.length === 2 ? [1, 0.62, 0.4] : [1, 0.6, 0.42, 0.28];
      if (c === 'cside') ev.side = ev.side === 'L' ? 'R' : 'L';
    } else if (ev?.kind === 'volute') {
      if (c === 'flip') {
        // mirror the eye across the stem's tangent at entry
        const g = geoOf(s.id)!;
        const a = g.track.at(clamp(ev.t * g.Lb, 0, g.track.L));
        const eyeW = toWorld(g.frame, ev.eye);
        const n = perp([a.tx, a.ty]);
        const d = dot(sub(eyeW, [a.x, a.y]), n);
        ev.eye = toLocal(g.frame, sub(eyeW, mul(n, 2 * d)));
        ev.hand = (ev.hand * -1) as 1 | -1;
      }
      if (c === 'mode') ev.mode = ev.mode === 'terminal' ? 'branching' : 'terminal';
    } else if (ev?.kind === 'turnover') {
      if (c === 'edge') ev.edge = ev.edge === 'L' ? 'R' : 'L';
    } else if (ev?.kind === 'branch') {
      if (c === 'cross') ev.crossing = ev.crossing === 'behind' ? 'front' : 'behind';
    } else if (c === 'break') {
      const top = topOf(s.id)!;
      const partner = doc.strips.find((x) => x.id === top.mirror);
      const v = !top.mirrorBroken;
      top.mirrorBroken = v;
      if (partner) partner.mirrorBroken = v;
      if (!v) syncMirror(doc, top.id);
    } else if (c === 'z') {
      const top = topOf(s.id)!;
      const zmax = Math.max(0, ...doc.strips.map((x) => x.z ?? 0));
      top.z = zmax + 1;
      const partner = doc.strips.find((x) => x.id === top.mirror);
      if (partner) partner.z = zmax + 1;
    }
    if (ev) touched(s.id, ev);
    else touched(s.id);
    commit();
  });

  // ---------------------------------------------------------------- settings sheet
  function openSheet() {
    const st = doc.settings;
    const slider = (k: keyof Settings, label: string) =>
      `<label class="sl">${label}<input type="range" min="0" max="1" step="0.01" value="${st[k]}" data-s="${k}"></label>`;
    const tg = (k: keyof RenderToggles, label: string) => `<button class="toggle ${toggles[k] ? 'on' : ''}" data-t="${k}">${label}</button>`;
    sheet.innerHTML = `<div class="sheet-in">
<div class="sheet-h"><h2>Settings</h2><button data-x="close">Done</button></div>
${slider('sharpness', 'Lobe sharpness')}${slider('recurve', 'Recurve')}${slider('lobeDepth', 'Lobe depth')}${slider('frequency', 'Cluster frequency')}${slider('taper', 'Taper')}
<h3>Rendering</h3><div class="wrap">${tg('flat', 'Flat colour')}${tg('outline', 'Outline')}${tg('midrib', 'Midrib')}${tg('shading', 'Shading')}${tg('hatching', 'Hatching')}</div>
<h3>Presets</h3><div class="wrap">${Object.keys(PRESETS).map((k) => `<button data-p="${k}">${k}</button>`).join('')}<button data-p="">Blank sheet</button></div>
<h3>File</h3><div class="wrap"><button data-x="export">Export SVG</button><button data-x="reset">Reset</button><button data-x="fit">Fit view</button><a class="btn" href="./proofs.html">Proofs</a></div>
<p class="note">One finger draws and edits; two fingers pan and zoom. Mirroring is on by default; “Linked” on a selected strip breaks it per stroke.</p>
</div>`;
    sheet.hidden = false;
  }
  sheet.addEventListener('input', (e) => {
    const el = e.target as HTMLInputElement;
    const k = el.dataset.s as keyof Settings | undefined;
    if (k) {
      doc.settings[k] = +el.value;
      render(true);
    }
  });
  sheet.addEventListener('change', (e) => {
    if ((e.target as HTMLElement).dataset.s) commit();
  });
  sheet.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b) {
      if (e.target === sheet) sheet.hidden = true;
      return;
    }
    if (b.dataset.t) {
      const k = b.dataset.t as keyof RenderToggles;
      toggles[k] = !toggles[k];
      b.classList.toggle('on', toggles[k]);
      try {
        localStorage.setItem(TSTORE, JSON.stringify(toggles));
      } catch {
        /* ignore */
      }
      render(false);
    } else if (b.dataset.p !== undefined) {
      doc = b.dataset.p ? clone(PRESETS[b.dataset.p]) : emptyDoc('Blank');
      sel = {};
      lastGesture = null;
      sheet.hidden = true;
      built = build(doc);
      fitView();
      commit();
    } else if (b.dataset.x === 'close') sheet.hidden = true;
    else if (b.dataset.x === 'fit') {
      fitView();
      drawOverlay();
      sheet.hidden = true;
    } else if (b.dataset.x === 'reset') {
      doc = emptyDoc('Blank');
      sel = {};
      sheet.hidden = true;
      commit();
      flash('Reset (undo brings it back)');
    } else if (b.dataset.x === 'export') exportSVG();
  });

  function exportSVG() {
    const { svg } = renderSVG(doc, { toggles });
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(doc.name || 'mantling').replace(/\W+/g, '-').toLowerCase()}.svg`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  let flashT = 0;
  function flash(msg: string) {
    hud.textContent = msg;
    hud.classList.add('show');
    clearTimeout(flashT);
    flashT = window.setTimeout(() => hud.classList.remove('show'), 2200);
  }

  // ---------------------------------------------------------------- go
  fitView();
  window.addEventListener('resize', () => {
    fitView();
    drawOverlay();
  });
  renderNow();
  refreshUI();
  // expose for tests
  (window as unknown as Record<string, unknown>).__mantling = {
    get doc() {
      return doc;
    },
    setDoc(d: Doc) {
      doc = d;
      commit();
    },
    get history() {
      return { length: history.length, index: hIndex };
    },
    mirrorStrip,
    get sel() {
      return sel;
    },
    hit(q: V) {
      const h = hitStrip(q);
      return h ? { id: h.g.strip.id, t: h.t, v: h.v } : null;
    },
    get handles() {
      return handles.map((h) => ({ id: h.id, p: h.p }));
    },
  };
}

function load(): Doc | null {
  try {
    const s = localStorage.getItem(STORE);
    if (!s) return null;
    const d = JSON.parse(s);
    return d && d.version === 1 ? d : null;
  } catch {
    return null;
  }
}
function loadToggles(): RenderToggles {
  try {
    const s = localStorage.getItem(TSTORE);
    if (s) return { ...defaultToggles(), ...JSON.parse(s) };
  } catch {
    /* ignore */
  }
  return defaultToggles();
}
