// compose.mjs <code>: device | design | overlay (red = only on the phone, cyan = only in the design)
// plus a table of matched text boxes (dp). Writes out/<code>.png and prints the table.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../packages/studio-app/package.json', import.meta.url));
const { PNG } = require('pngjs');

const here = process.env.OVERLAY_DIR ?? path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../.beluga/scratch/overlay');
const [code, designCode = code] = process.argv.slice(2);
const read = (p) => PNG.sync.read(fs.readFileSync(p));
const dev = read(path.join(here, 'device', `${code}.png`));
const des = read(path.join(here, 'design', `${designCode}.png`));
const W = 1216;
const H = 2688;
const gray = (img, i) => (img.data[i] * 0.299 + img.data[i + 1] * 0.587 + img.data[i + 2] * 0.114) | 0;

const half = (img) => {
  const w = W / 2;
  const h = H / 2;
  const out = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 3; c++) {
        let s = 0;
        for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) s += img.data[((2 * y + dy) * W + 2 * x + dx) * 4 + c];
        out.data[(y * w + x) * 4 + c] = s >> 2;
      }
      out.data[(y * w + x) * 4 + 3] = 255;
    }
  }
  return out;
};
const a = half(dev);
const b = half(des);
const w = W / 2;
const h = H / 2;
const gap = 12;
const out = new PNG({ width: w * 3 + gap * 2, height: h });
out.data.fill(255);
const put = (img, ox) => {
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 4; c++) out.data[(y * out.width + ox + x) * 4 + c] = img.data[(y * w + x) * 4 + c];
};
put(a, 0);
put(b, w + gap);
for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const g1 = gray(a, i);
    const g2 = gray(b, i);
    const o = (y * out.width + 2 * (w + gap) + x) * 4;
    out.data[o] = g2;
    out.data[o + 1] = g1;
    out.data[o + 2] = g1;
    out.data[o + 3] = 255;
  }
}
fs.mkdirSync(path.join(here, 'out'), { recursive: true });
fs.writeFileSync(path.join(here, 'out', `${code}.png`), PNG.sync.write(out));

// Text boxes: match by exact text; compare left edge and vertical centre (dp).
const devNodes = JSON.parse(fs.readFileSync(path.join(here, 'device', `${code}.json`), 'utf8')).filter((n) => n.text);
const designBoxes = JSON.parse(fs.readFileSync(path.join(here, 'design', `${designCode}.json`), 'utf8')).texts;
const rows = [];
for (const d of designBoxes) {
  const cands = devNodes.filter((n) => n.text.replace(/\s+/g, ' ').trim() === d.text);
  const hit = cands.sort((p, q) => Math.abs(p.y - d.y) + Math.abs(p.x - d.x) - (Math.abs(q.y - d.y) + Math.abs(q.x - d.x)))[0];
  if (!hit) continue;
  rows.push({ text: d.text.slice(0, 18), dx: +(hit.x - d.x).toFixed(1), dcy: +(hit.y + hit.h / 2 - (d.y + d.h / 2)).toFixed(1), design: `${d.x.toFixed(0)},${(d.y + d.h / 2).toFixed(0)}`, phone: `${hit.x.toFixed(0)},${(hit.y + hit.h / 2).toFixed(0)}`, size: d.size });
}
console.log(`${code}: ${rows.length} matched text boxes of ${designBoxes.length} in the design`);
for (const r of rows) console.log(`  ${r.text.padEnd(20)} design(${r.design}) phone(${r.phone}) dx=${r.dx} dy=${r.dcy} size=${r.size}`);
