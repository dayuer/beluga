// Render each .phone frame of the design page at the Android phone's size (374x827 dp, 3.25x)
// and dump the text elements' boxes. SERVE_URL comes from the environment, never from a file.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../packages/studio-app/package.json', import.meta.url));
const { chromium } = require('playwright');

const out = process.argv[2];
const url = process.env.SERVE_URL;
if (!url) throw new Error('SERVE_URL missing');
fs.mkdirSync(out, { recursive: true });

const W = 374;
const H = 827;
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 3200, height: 2200 }, deviceScaleFactor: 3.25 });
await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForSelector('.phone', { timeout: 30000 });
await page.waitForTimeout(1500);
await page.addStyleTag({ content: `.phone{width:${W}px!important;height:${H}px!important}` });
await page.waitForTimeout(500);

const labels = await page.$$eval('.phone', (els) => els.map((e) => e.getAttribute('data-screen-label')));
for (const label of labels) {
  const handle = await page.$(`.phone[data-screen-label="${label}"]`);
  await handle.scrollIntoViewIfNeeded();
  const code = label.split(' ')[0];
  await handle.screenshot({ path: path.join(out, `${code}.png`) });
  const boxes = await handle.evaluate((root) => {
    const base = root.getBoundingClientRect();
    const res = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = (n.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      const r = range.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const el = n.parentElement;
      const cs = getComputedStyle(el);
      res.push({ text, x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height, size: parseFloat(cs.fontSize), weight: cs.fontWeight, color: cs.color });
    }
    const boxesEls = [];
    root.querySelectorAll('.btn,.mfield,.marea,.seg,.nbar,.card,.sbar').forEach((el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      boxesEls.push({ cls: el.className, x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height, bg: cs.backgroundColor, radius: cs.borderRadius });
    });
    return { texts: res, blocks: boxesEls };
  });
  fs.writeFileSync(path.join(out, `${code}.json`), JSON.stringify({ label, ...boxes }, null, 1));
  console.log('design', code, label);
}
await browser.close();
