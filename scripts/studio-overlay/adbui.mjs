// Drive the Android phone: `shot <name>` saves a screenshot and the UI tree as JSON (dp),
// `tap <text>` taps the first element whose text or description contains it, `key <code>`.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const SERIAL = process.env.ANDROID_SERIAL ?? '324750623054';
const DENSITY = 3.25;
const here = process.env.OVERLAY_DIR ?? path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../.beluga/scratch/overlay');
const adb = (...args) => execFileSync('adb', ['-s', SERIAL, ...args], { maxBuffer: 64 * 1024 * 1024 });

function tree() {
  adb('shell', 'uiautomator', 'dump', '--compressed', '/sdcard/ui.xml');
  const xml = adb('exec-out', 'cat', '/sdcard/ui.xml').toString('utf8');
  const nodes = [];
  const re = /<node [^>]*?text="([^"]*)"[^>]*?content-desc="([^"]*)"[^>]*?clickable="([^"]*)"[^>]*?bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/g;
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    const [, text, desc, clickable, l, t, r, b] = m;
    const un = (s) => s.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#10;/g, '\n');
    nodes.push({ text: un(text), desc: un(desc), clickable: clickable === 'true', px: [+l, +t, +r, +b], x: +l / DENSITY, y: +t / DENSITY, w: (+r - +l) / DENSITY, h: (+b - +t) / DENSITY });
  }
  return nodes;
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === 'shot') {
  const dir = path.join(here, 'device');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${arg}.png`), adb('exec-out', 'screencap', '-p'));
  const nodes = tree();
  fs.writeFileSync(path.join(dir, `${arg}.json`), JSON.stringify(nodes, null, 1));
  console.log('shot', arg, nodes.filter((n) => n.text || n.desc).map((n) => n.text || n.desc).slice(0, 14).join(' | '));
} else if (cmd === 'tap') {
  const hit = tree().find((n) => (n.text && n.text.includes(arg)) || (n.desc && n.desc.includes(arg)));
  if (!hit) {
    console.log('no element with', arg);
    process.exit(1);
  }
  const [l, t, r, b] = hit.px;
  adb('shell', 'input', 'tap', String(Math.round((l + r) / 2)), String(Math.round((t + b) / 2)));
  console.log('tapped', arg);
} else if (cmd === 'key') {
  adb('shell', 'input', 'keyevent', arg);
} else if (cmd === 'texts') {
  console.log(tree().filter((n) => n.text || n.desc).map((n) => `${n.text || n.desc} @${n.px.join(',')}${n.clickable ? ' *' : ''}`).join('\n'));
}
