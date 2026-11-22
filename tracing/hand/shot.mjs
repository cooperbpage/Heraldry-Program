import { createRequire } from 'node:module'; import { resolve } from 'node:path';
const { chromium } = createRequire(import.meta.url)('playwright');
const b = await chromium.launch(); const p = await b.newPage();
for (let i = 2; i < process.argv.length; i += 2) {
  await p.goto('file://' + resolve(process.argv[i])); await p.waitForTimeout(100);
  const s = await p.evaluate(() => { const e = document.querySelector('svg'); return [e.width.baseVal.value, e.height.baseVal.value]; });
  await p.setViewportSize({ width: Math.round(s[0]), height: Math.round(s[1]) });
  await p.screenshot({ path: process.argv[i + 1] });
}
await b.close();
