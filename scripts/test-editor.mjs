// Headless check of the editor at phone size: node scripts/test-editor.mjs <outdir>
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
const { chromium, devices } = createRequire(import.meta.url)('playwright');
const out = process.argv[2] || '.';
import { appendFileSync, writeFileSync } from 'node:fs';
const srv = process.env.NOSERVE ? null : spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { stdio: 'pipe' });
if (srv) await new Promise((r) => setTimeout(r, 2500));
writeFileSync(`${out}/log.txt`, '');
const log = (l) => appendFileSync(`${out}/log.txt`, l + '\n');
const base = 'http://localhost:4173/Heraldry-Program/';
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 13'], hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => { errors.push(String(e)); log('  PAGEERR ' + String(e).slice(0, 200)); });
page.on('console', (m) => m.text().startsWith('tap') && log('  ' + m.text()));
page.on('console', (m) => { if (m.type() === 'error') { errors.push(m.text()); log('  ERR ' + m.text().slice(0, 90)); } });
const results = [];
const ok = (name, cond, info = "") => { const l = `${cond ? "PASS" : "FAIL"} ${name} ${info}`; results.push(l); log(l); };
page.setDefaultTimeout(8000);
log('goto'); await page.goto(base); await page.evaluate(() => { window.__dbg = true; }); log('loaded');
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/ui-0-garter.png` });
const M = () => page.evaluate(() => window.__mantling);
const nStrips = () => page.evaluate(() => window.__mantling.doc.strips.length);
const hist = () => page.evaluate(() => window.__mantling.history);
const box = await page.locator('#stage').boundingBox();
// sheet -> screen mapping using the live viewBox
const toScreen = async (x, y) => page.evaluate(([x, y]) => {
  const s = document.querySelector('#stage');
  const p = s.createSVGPoint(); p.x = x; p.y = y;
  const q = p.matrixTransform(s.getScreenCTM());
  return [q.x, q.y];
}, [x, y]);
// blank sheet
await page.click('button[data-a="more"]');
await page.click('button[data-p=""]');
await page.waitForTimeout(300);
ok('blank sheet', (await nStrips()) === 0);
// draw an unsteady S sweep
await page.click('button[data-tool="draw"]');
const pts = [];
for (let i = 0; i <= 60; i++) {
  const t = i / 60;
  const x = 520 + 250 * t;
  const y = 395 - 120 * Math.sin(t * Math.PI * 1.1) + 40 * t + (Math.sin(i * 1.7) * 3);
  pts.push(await toScreen(x, y));
}
await page.mouse.move(...pts[0]);
await page.mouse.down();
for (const p of pts.slice(1)) await page.mouse.move(p[0], p[1], { steps: 2 });
await page.mouse.up();
await page.waitForTimeout(700);
let d = await page.evaluate(() => window.__mantling.doc);
ok('sweep + mirror', d.strips.length === 2, `strips=${d.strips.length}`);
ok('sweep fitted with few segments', (d.strips[0].spine.length - 1) / 3 <= 3, `segments=${(d.strips[0].spine.length - 1) / 3}`);
ok('auto-compose added events', d.strips[0].events.length > 0, `events=${d.strips[0].events.length}`);
await page.screenshot({ path: `${out}/ui-1-sweep.png` });
// reseed changes generated ornament but keeps the sweep
const before = JSON.stringify(d.strips[0].spine);
const evBefore = JSON.stringify(d.strips[0].events.map((e) => e.kind + (e.t ?? e.t0)));
await page.click('button[data-a="reseed"]');
await page.waitForTimeout(500);
d = await page.evaluate(() => window.__mantling.doc);
ok('reseed keeps sweep', JSON.stringify(d.strips[0].spine) === before);
ok('reseed changes ornament', JSON.stringify(d.strips[0].events.map((e) => e.kind + (e.t ?? e.t0))) !== evBefore);
// undo / redo
const h1 = await hist();
await page.click('button[data-a="undo"]');
await page.waitForTimeout(400);
ok('undo', (await hist()).index === h1.index - 1);
await page.click('button[data-a="redo"]');
await page.waitForTimeout(400);
ok('redo', (await hist()).index === h1.index);
// helper to find a point on strip 0 at arc fraction t and cross offset v
const stripPt = async (t, v) => page.evaluate(([t, v]) => {
  const d = window.__mantling.doc; const sp = d.strips[0].spine;
  // approximate: sample the bezier
  const seg = Math.min(Math.floor(t * ((sp.length - 1) / 3)), (sp.length - 1) / 3 - 1);
  const u = t * ((sp.length - 1) / 3) - seg;
  const [a, b, c, e] = [sp[seg * 3], sp[seg * 3 + 1], sp[seg * 3 + 2], sp[seg * 3 + 3]];
  const m = 1 - u;
  const p = [0, 1].map((k) => m * m * m * a[k] + 3 * m * m * u * b[k] + 3 * m * u * u * c[k] + u * u * u * e[k]);
  const dd = [0, 1].map((k) => 3 * (m * m * (b[k] - a[k]) + 2 * m * u * (c[k] - b[k]) + u * u * (e[k] - c[k])));
  const l = Math.hypot(dd[0], dd[1]);
  return [p[0] - dd[1] / l * v, p[1] + dd[0] / l * v];
}, [t, v]);
const tapAt = async (x, y) => { const s = await toScreen(x, y); await page.touchscreen.tap(s[0], s[1]); await page.waitForTimeout(500); };
const count = (kind) => page.evaluate((k) => window.__mantling.doc.strips[0].events.filter((e) => e.kind === k).length, kind);
for (const [tool, kind, t, v] of [['lobes', 'cluster', 0.2, 12], ['fold', 'turnover', 0.3, -12], ['fork', 'branch', 0.45, 10], ['volute', 'volute', 0.4, 0]]) {
  await page.click(`button[data-tool="${tool}"]`);
  const n0 = await count(kind);
  const [x, y] = await stripPt(t, v);
  await tapAt(x, y);
  const n1 = await count(kind);
  ok(`${tool} tool adds ${kind}`, n1 === n0 + 1, `${n0}->${n1}`);
  await page.screenshot({ path: `${out}/ui-2-${tool}.png` });
}
writeFileSync(`${out}/doc-after-tools.json`, JSON.stringify(await page.evaluate(() => window.__mantling.doc)));
// width: tap then drag crossbar end
await page.click('button[data-tool="width"]');
{
  const [x, y] = await stripPt(0.25, 0);
  log('  hit ' + JSON.stringify(await page.evaluate(([x, y]) => [window.__mantling.hit([x, y]), window.__mantling.doc.strips[0].id], [x, y])) + ' at ' + x + ',' + y);
  await tapAt(x, y);
  const k0 = await page.evaluate(() => window.__mantling.doc.strips[0].width.length);
  log('  width sel ' + JSON.stringify(await page.evaluate(() => [window.__mantling.sel, window.__mantling.handles])));
  const hw = await page.evaluate(() => window.__mantling.handles.find((h) => h.id === 'wl')?.p);
  const [ex, ey] = hw ?? await stripPt(0.25, 14);
  const [fx, fy] = await stripPt(0.25, 34);
  const a = await toScreen(ex, ey), b = await toScreen(fx, fy);
  // the handle sits on the edge; find it by trying the handle position
  await page.mouse.move(a[0], a[1]); await page.mouse.down(); await page.mouse.move(b[0], b[1], { steps: 5 }); await page.mouse.up();
  await page.waitForTimeout(500);
  const k1 = await page.evaluate(() => window.__mantling.doc.strips[0].width.length);
  ok('width knot inserted', k1 === k0 + 1, `${k0}->${k1}`);
}
// mirror partner follows edits
d = await page.evaluate(() => window.__mantling.doc);
ok('mirror partner synced', d.strips[1].events.length === d.strips[0].events.length, `${d.strips[0].events.length}/${d.strips[1].events.length}`);
// two-finger pinch via CDP touch events
const vb0 = await page.getAttribute('#stage', 'viewBox');
const cdp = await ctx.newCDPSession(page);
const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
const tp = (pts) => pts.map(([x, y], i) => ({ x, y, id: i }));
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp([[cx - 40, cy], [cx + 40, cy]]) });
for (let k = 1; k <= 8; k++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp([[cx - 40 - k * 10, cy], [cx + 40 + k * 10, cy]]) });
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await page.waitForTimeout(300);
const vb1 = await page.getAttribute('#stage', 'viewBox');
ok('pinch zoom changes view', vb0 !== vb1, `${vb0} -> ${vb1}`);
const nAfterPinch = await nStrips();
ok('pinch did not draw', nAfterPinch === d.strips.length);
// presets load
await page.click('button[data-a="more"]');
await page.click('button[data-p="Stirling"]');
await page.waitForTimeout(800);
ok('preset loads', (await page.evaluate(() => window.__mantling.doc.name)) === 'Stirling');
await page.screenshot({ path: `${out}/ui-3-stirling.png` });
// export
await page.click('button[data-a="more"]');
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('button[data-x="export"]')]);
const p = await dl.path();
const fs = await import('node:fs');
const svg = fs.readFileSync(p, 'utf8');
ok('export svg', svg.startsWith('<svg') && svg.length > 10000, `${(svg.length / 1024) | 0}KB`);
// reset is undoable
await page.click('button[data-x="reset"]');
await page.waitForTimeout(400);
ok('reset', (await nStrips()) === 0);
await page.click('button[data-a="undo"]');
await page.waitForTimeout(600);
ok('reset undoable', (await nStrips()) > 0);
// touch targets
const small = await page.evaluate(() => [...document.querySelectorAll('.panel button')].filter((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && (r.width < 44 || r.height < 44); }).length);
ok('44px targets', small === 0, `small=${small}`);
ok('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log(results.join('\n'));
await browser.close();
srv?.kill();
