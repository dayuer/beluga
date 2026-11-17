#!/usr/bin/env node
// What changed in upstream's Simplified Chinese, and what this fork's own Chinese should do about it
// (docs/chinese.md). Read only: it prints, it never writes a catalog.
//
//   node scripts/zh-check.mjs                  # what upstream/main brings that this branch doesn't have yet
//   node scripts/zh-check.mjs <from> <to>      # between any two refs
//
// Exits 1 when an override of the fork's needs a look (its upstream wording changed, or its key is gone),
// or one only repeats upstream's wording.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const UP = 'packages/mac/src/i18n/zh-CN.json';
const FORK = 'packages/mac/src/i18n/zh-CN.fork.json';

/**
 * Upstream's catalog at two points, and the fork's own strings. `overrides` are the fork's entries
 * for upstream's own English strings (the rest are the fork's features, upstream has no key for them).
 */
export function compareZh({ before, after, fork }) {
  const added = Object.keys(after).filter((k) => !(k in before));
  const changed = Object.keys(after).filter((k) => k in before && before[k] !== after[k]);
  const removed = Object.keys(before).filter((k) => !(k in after));
  const overrides = Object.keys(fork).filter((k) => k in after || k in before);
  return {
    added,
    changed,
    removed,
    overrides,
    /** Upstream reworded what the fork overrides: is the fork's wording still the better one? */
    recheck: overrides.filter((k) => changed.includes(k)),
    /** Upstream dropped the string: the override no longer does anything. */
    gone: overrides.filter((k) => removed.includes(k)),
    /** The fork says what upstream now says: drop the override. */
    redundant: overrides.filter((k) => k in after && after[k] === fork[k]),
  };
}

const show = (ref, file) => JSON.parse(execFileSync('git', ['show', `${ref}:${file}`], { encoding: 'utf8', maxBuffer: 64 << 20 }));

function main() {
  const [from = 'HEAD', to = 'upstream/main'] = process.argv.slice(2);
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  const before = show(from, UP);
  const after = show(to, UP);
  const fork = JSON.parse(readFileSync(path.join(root, FORK), 'utf8'));
  const r = compareZh({ before, after, fork });
  const list = (title, keys, line) => {
    console.log(`\n${title} (${keys.length})`);
    for (const k of keys) console.log(`  ${line(k)}`);
  };
  console.log(`upstream's ${UP}: ${from} → ${to}`);
  list('new in upstream', r.added, (k) => `${JSON.stringify(k)} → ${after[k]}`);
  list('reworded by upstream', r.changed, (k) => `${JSON.stringify(k)}: ${before[k]} → ${after[k]}`);
  list('dropped by upstream', r.removed, (k) => JSON.stringify(k));
  list('fork overrides to look at again (upstream reworded them)', r.recheck, (k) => `${JSON.stringify(k)}: upstream ${after[k]}, fork ${fork[k]}`);
  list('fork overrides of strings upstream dropped (remove them)', r.gone, (k) => JSON.stringify(k));
  list('fork overrides that only repeat upstream (remove them)', r.redundant, (k) => `${JSON.stringify(k)} → ${fork[k]}`);
  console.log(`\nthe fork overrides ${r.overrides.length} of upstream's strings`);
  process.exitCode = r.recheck.length || r.gone.length || r.redundant.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
