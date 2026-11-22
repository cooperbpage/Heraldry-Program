// Rasterise HTML or SVG files with headless Chromium: node scripts/png.mjs in.svg out.png [width] [height]
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const jobs = [];
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 4) jobs.push({ src: args[i], out: args[i + 1], w: +(args[i + 2] || 1000), h: +(args[i + 3] || 1000) });
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const j of jobs) {
  await page.setViewportSize({ width: j.w, height: j.h });
  if (j.src.endsWith('.svg')) {
    let svg = readFileSync(j.src, 'utf8');
    if (process.env.CROP) svg = svg.replace(/viewBox="[^"]*"/, `viewBox="${process.env.CROP}"`);
    await page.setContent(`<html><body style="margin:0;width:${j.w}px;height:${j.h}px">${svg.replace('width="1000" height="1000"', `width="${j.w}" height="${j.h}"`)}</body></html>`);
  } else await page.goto('file://' + resolve(j.src));
  await page.waitForTimeout(50);
  await page.screenshot({ path: j.out, fullPage: true });
}
await browser.close();
