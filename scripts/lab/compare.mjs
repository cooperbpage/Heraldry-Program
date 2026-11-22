// Side-by-side: reference with the chosen plume outlined | program's recreation.
// node compare.mjs <out.png> <refImage> <refW> <refH> <cropX,cropY,cropW,cropH> <polygon x,y;x,y;...> <svg> <svgCrop x y w h> <title> [<recreation label>]
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const { chromium } = createRequire(import.meta.url)('playwright');
const [out, refImg, refW, refH, crop, poly, svgFile, svgCrop, title, label = 'Recreation by the program'] = process.argv.slice(2);
const [cx, cy, cw, ch] = crop.split(',').map(Number);
const H = 560;
const k = H / ch;
const W1 = Math.round(cw * k);
const pts = poly.split(';').map((p) => p.split(',').map(Number)).map(([x, y]) => `${((x - cx) * k).toFixed(1)},${((y - cy) * k).toFixed(1)}`).join(' ');
const [sx, sy, sw, sh] = svgCrop.split(' ').map(Number);
const W2 = Math.round((H * sw) / sh);
const svg = readFileSync(svgFile, 'utf8').replace(/viewBox="[^"]*"/, `viewBox="${svgCrop}"`).replace('width="1000" height="1000"', `width="${W2}" height="${H}"`);
const html = `<!doctype html><html><body style="margin:0;background:#fbf8f1;font-family:Georgia,serif">
<div style="padding:10px 14px 0;font-size:19px;color:#3a2f27">${title}</div>
<div style="display:flex;gap:16px;padding:10px 14px;align-items:flex-start">
<figure style="margin:0"><div style="width:${W1}px;height:${H}px;overflow:hidden;position:relative;border:1px solid #d6ccbb">
<img src="${resolve(refImg)}" style="position:absolute;left:${-cx * k}px;top:${-cy * k}px;width:${refW * k}px;height:${refH * k}px">
<svg style="position:absolute;left:0;top:0" width="${W1}" height="${H}"><polygon points="${pts}" fill="none" stroke="#00c3ff" stroke-width="3.5" stroke-dasharray="10 6"/></svg></div>
<figcaption style="font-size:16px;color:#5a4f45;margin-top:6px">Reference · chosen plume outlined in blue dashes</figcaption></figure>
<figure style="margin:0"><div style="width:${W2}px;height:${H}px;border:1px solid #d6ccbb">${svg}</div>
<figcaption style="font-size:16px;color:#5a4f45;margin-top:6px">${label}</figcaption></figure></div></body></html>`;
const tmp = resolve('node_modules/.cache/compare.html');
writeFileSync(tmp, html);
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: W1 + W2 + 60, height: H + 90 } });
await p.goto('file://' + tmp);
await p.waitForTimeout(300);
await p.screenshot({ path: out, fullPage: true });
await b.close();
