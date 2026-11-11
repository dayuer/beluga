// Brings upstream (beluga-labs/beluga) into this fork with as few conflicts as possible (docs/fork.md).
//   node scripts/sync-upstream.mjs            → a sync/upstream-<date> branch with upstream merged in
//   node scripts/sync-upstream.mjs --report   → only the report: which upstream files this fork changes
//
// What it does for a sync:
//   1. Turns on git rerere here, so a conflict resolved once is resolved the same way next time.
//   2. Fetches upstream and merges upstream/main into a new branch off the current one (a merge, not a
//      rebase: this fork's main is published).
//   3. Settles the version files itself: the higher of the two versions, when this fork changed
//      nothing else in that file.
//   4. Prints what's still in conflict, and the fork's touch points: upstream files it changes, with
//      the ones docs/fork.md doesn't explain yet.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const UPSTREAM_URL = 'https://github.com/beluga-labs/beluga.git';
/** Files whose only fork change is the app's version: settled to the higher version on a sync. */
export const VERSION_FILES = ['packages/mac/package.json', 'packages/mac/src-tauri/tauri.conf.json'];
const FORK_DOC = 'docs/fork.md';

/** -1, 0 or 1 comparing two x.y.z versions (a pre-release tag sorts before its release). */
export function compareVersions(a, b) {
  const parse = (v) => {
    const [core, pre] = String(v).split('-', 2);
    return { nums: core.split('.').map((n) => Number(n) || 0), pre };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < Math.max(x.nums.length, y.nums.length); i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0);
    if (d) return Math.sign(d);
  }
  if (x.pre === y.pre) return 0;
  if (x.pre === undefined) return 1;
  if (y.pre === undefined) return -1;
  return x.pre < y.pre ? -1 : 1;
}

/** The first `"version": "…"` in a JSON text, or undefined. */
export const versionOf = (text) => /"version"\s*:\s*"([^"]+)"/.exec(text)?.[1];

/** `text` with its first `"version"` set to `version`, the rest byte for byte. */
export const withVersion = (text, version) => text.replace(/("version"\s*:\s*")[^"]+(")/, `$1${version}$2`);

/** True when `ours` differs from `base` only in its version (so taking theirs loses nothing of ours). */
export const onlyVersionChanged = (base, ours) => base !== undefined && ours !== undefined && withVersion(ours, versionOf(base) ?? '') === base;

/** Changed files that stop a merge, from `git diff --name-only HEAD`: all but Finder's .DS_Store (upstream tracks some, and Finder rewrites them). */
export const blocking = (names) =>
  names
    .split('\n')
    .map((f) => f.trim())
    .filter((f) => f && path.basename(f) !== '.DS_Store');

/** The upstream files a fork changes that `doc` (docs/fork.md) doesn't name in backticks. */
export const unexplained = (touched, doc) => touched.filter((f) => !doc.includes(`\`${f}\``));

const git = (args, opts = {}) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', opts.quiet ? 'ignore' : 'inherit'], ...opts }).trim();
const tryGit = (args) => {
  try {
    return git(args, { quiet: true });
  } catch {
    return undefined;
  }
};

/** Upstream files this branch changes or removes, against where it last met upstream. */
function touchPoints(ref = 'HEAD') {
  const base = git(['merge-base', ref, 'upstream/main']);
  return git(['diff', '--name-only', '--diff-filter=MDR', base, ref]).split('\n').filter(Boolean);
}

function report(ref = 'HEAD') {
  const touched = touchPoints(ref);
  const doc = existsSync(FORK_DOC) ? readFileSync(FORK_DOC, 'utf8') : '';
  const missing = unexplained(touched, doc);
  const ahead = git(['rev-list', '--count', `upstream/main..${ref}`]);
  const behind = git(['rev-list', '--count', `${ref}..upstream/main`]);
  console.log(`\nThis fork: ${ahead} commits ahead of upstream, ${behind} behind.`);
  console.log(`It changes ${touched.length} upstream files (each one can conflict on a sync):`);
  for (const f of touched) console.log(`  ${missing.includes(f) ? '!' : ' '} ${f}`);
  if (missing.length) console.log(`\n! ${missing.length} not explained in ${FORK_DOC} yet: move the change into a fork file, or add a line there saying why it has to stay.`);
  return missing.length;
}

/** Settles conflicted version files to the higher version; returns the ones it settled. */
function settleVersions() {
  const conflicted = new Set(git(['diff', '--name-only', '--diff-filter=U']).split('\n').filter(Boolean));
  const settled = [];
  for (const f of VERSION_FILES) {
    if (!conflicted.has(f)) continue;
    const base = tryGit(['show', `:1:${f}`]);
    const ours = tryGit(['show', `:2:${f}`]);
    const theirs = tryGit(['show', `:3:${f}`]);
    if (theirs === undefined || !onlyVersionChanged(base, ours)) continue;
    const high = compareVersions(versionOf(ours), versionOf(theirs)) > 0 ? versionOf(ours) : versionOf(theirs);
    writeFileSync(f, `${withVersion(theirs, high)}\n`);
    git(['add', f]);
    settled.push(`${f} → ${high}`);
  }
  return settled;
}

function sync() {
  const dirty = blocking(git(['diff', '--name-only', 'HEAD']));
  if (dirty.length) {
    console.error(`Commit or stash these first: the merge needs a clean tree.\n${dirty.map((f) => `  ${f}`).join('\n')}`);
    process.exit(1);
  }
  if (!tryGit(['remote', 'get-url', 'upstream'])) git(['remote', 'add', 'upstream', UPSTREAM_URL]);
  git(['config', 'rerere.enabled', 'true']);
  git(['config', 'rerere.autoupdate', 'true']);
  git(['fetch', 'upstream', '--tags']);

  const behind = Number(git(['rev-list', '--count', 'HEAD..upstream/main']));
  if (!behind) {
    console.log('Already up to date with upstream.');
    process.exit(report() ? 1 : 0);
  }
  const upVersion = versionOf(git(['show', 'upstream/main:packages/mac/package.json'])) ?? 'main';
  const branch = `sync/upstream-${upVersion}-${new Date().toISOString().slice(0, 10)}`;
  git(['switch', '-c', branch]);
  console.log(`On ${branch}: merging ${behind} upstream commits (upstream ${upVersion}).`);

  let clean = true;
  try {
    git(['merge', '--no-ff', '--no-edit', '-m', `Merge upstream ${upVersion}`, 'upstream/main']);
  } catch {
    clean = false;
  }
  if (!clean) {
    for (const s of settleVersions()) console.log(`  version settled: ${s}`);
    const left = git(['diff', '--name-only', '--diff-filter=U']).split('\n').filter(Boolean);
    if (left.length) {
      console.log(`\n${left.length} files still in conflict (rerere already applied what it remembered):`);
      for (const f of left) console.log(`  ${f}`);
      console.log('\nResolve them, `git add` them, then `git commit --no-edit`. rerere remembers your resolutions for next time.');
      report();
      process.exit(1);
    }
    git(['commit', '--no-edit']);
  }
  console.log('\nMerged. Next: npm run typecheck, npx vitest run, then open a PR from this branch into main.');
  report();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--report')) {
    tryGit(['fetch', 'upstream']);
    process.exit(report() ? 1 : 0);
  }
  sync();
}
