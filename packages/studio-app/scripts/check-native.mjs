import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const DIRS = ['lib', 'app', 'components'];
const FORBIDDEN = /(?<!\.)\b(window|document|localStorage|navigator)\b/;

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, files);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) {
      files.push(full);
    }
  }
  return files;
}

const hits = [];
for (const d of DIRS) {
  for (const file of walk(join(ROOT, d))) {
    const lines = readFileSync(file, 'utf8').split('\n');
    let inBlockComment = false;
    lines.forEach((raw, i) => {
      let line = raw;
      if (inBlockComment) {
        const end = line.indexOf('*/');
        if (end === -1) return;
        line = line.slice(end + 2);
        inBlockComment = false;
      }
      const blockStart = line.indexOf('/*');
      if (blockStart !== -1) {
        const blockEnd = line.indexOf('*/', blockStart + 2);
        if (blockEnd === -1) {
          line = line.slice(0, blockStart);
          inBlockComment = true;
        } else {
          line = line.slice(0, blockStart) + line.slice(blockEnd + 2);
        }
      }
      const slashIdx = line.indexOf('//');
      if (slashIdx !== -1) line = line.slice(0, slashIdx);
      const m = FORBIDDEN.exec(line);
      if (m) {
        hits.push(`${relative(ROOT, file)}:${i + 1}: ${m[1]} -> ${raw.trim()}`);
      }
    });
  }
}

if (hits.length > 0) {
  console.error('check:native failed — browser globals found:\n' + hits.join('\n'));
  process.exit(1);
}
console.log('check:native passed: 0 browser globals in lib/, app/, components/.');
