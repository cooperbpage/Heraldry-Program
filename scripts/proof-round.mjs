// node scripts/proof-round.mjs <round-name> [names...]
// Renders each preset, crops it to its mantling, and composes a side-by-side with its reference.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
const { chromium } = createRequire(import.meta.url)('playwright');
const round = process.argv[2];
const names = process.argv.slice(3).length ? process.argv.slice(3) : ['garter', 'stirling'];
const REF = {
  garter: { file: 'public/references/garter.png', h: 508, crop: [5, 5, 490, 265], title: 'Garter (lion crest, white supporters)' },
  stirling: { file: 'public/references/stirling.jpg', h: 564, crop: [50, 55, 355, 310], title: 'Earl of Stirling (beaver crest)' },
};
const dir = `public/proofs/${round}`;
mkdirSync(dir, { recursive: true });
const tmp = resolve('node_modules/.proof-tmp');
mkdirSync(tmp, { recursive: true });
execSync(`npx esbuild scripts/proof-svgs.ts --bundle --platform=node --format=esm --outfile=${tmp}/ps.mjs --log-level=warning`);
execSync(`node ${tmp}/ps.mjs ${tmp} ${names.join(' ')}`);
const boxes = JSON.parse(readFileSync(`${tmp}/boxes.json`, 'utf8'));
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const name of names) {
  const ref = REF[name];
  const [bx, by, bw, bh] = boxes[name];
  // include the helm and top of the shield for context
  const y1 = Math.max(by + bh, 560);
  const svg = readFileSync(`${tmp}/${name}.svg`, 'utf8').replace(/viewBox="[^"]*"/, `viewBox="${bx} ${by} ${bw} ${y1 - by}"`).replace('width="1000" height="1000"', 'width="100%" height="100%"');
  writeFileSync(`${tmp}/${name}-crop.svg`, svg);
  const H = 640;
  const [cx, cy, cw, ch] = ref.crop;
  const refW = Math.round((H * cw) / ch);
  const genW = Math.round((H * bw) / (y1 - by));
  const html = `<!doctype html><html><body style="margin:0;background:#fbf8f1;font-family:Georgia,serif">
<div style="display:flex;gap:16px;padding:12px;align-items:flex-start">
<figure style="margin:0"><div style="width:${refW}px;height:${H}px;overflow:hidden;position:relative;border:1px solid #d6ccbb">
<img src="${resolve(ref.file)}" style="position:absolute;left:${(-cx * H) / ch}px;top:${(-cy * H) / ch}px;height:${(H / ch) * ref.h}px"></div>
<figcaption style="font-size:18px;color:#5a4f45;margin-top:6px">Reference · ${ref.title}</figcaption></figure>
<figure style="margin:0"><div style="width:${genW}px;height:${H}px;border:1px solid #d6ccbb"><img src="${tmp}/${name}-crop.svg" style="width:100%;height:100%"></div>
<figcaption style="font-size:18px;color:#5a4f45;margin-top:6px">Generated preset · ${round}</figcaption></figure></div></body></html>`;
  writeFileSync(`${tmp}/${name}.html`, html);
  await page.setViewportSize({ width: refW + genW + 60, height: H + 70 });
  await page.goto('file://' + `${tmp}/${name}.html`);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
  // a full-size render of the generated sheet too
  await page.setViewportSize({ width: 1000, height: 1000 });
  await page.setContent(`<html><body style="margin:0">${readFileSync(`${tmp}/${name}.svg`, 'utf8')}</body></html>`);
  await page.screenshot({ path: `${dir}/${name}-sheet.png` });
  console.log('wrote', `${dir}/${name}.png`);
}
await browser.close();
