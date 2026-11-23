// Brings upstream (beluga-labs/beluga) into this fork with as few conflicts as possible (docs/fork.md).
//   node scripts/sync-upstream.mjs                 → a sync/upstream-<date> branch with upstream merged in
//   node scripts/sync-upstream.mjs --report        → only the report: risk, touch points by how many lines
//
// What it does for a sync:
//   1. Turns on git rerere here, so a conflict resolved once is resolved the same way next time.
//   2. Before merging, prints the files this fork changes that upstream changed too («check while
//      merging»): those are where a conflict or a silently lost hook will be.
//   3. Fetches upstream and merges upstream/main into a new branch off the current one (a merge, not a
//      rebase: this fork's main is published).
//   4. Settles the version files itself: the higher of the two versions, when this fork changed
//      nothing else in that file.
//   5. Prints what's still in conflict, and the fork's touch points: upstream files it changes, with
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

/**
 * `git diff --numstat` as rows: a file, its lines added and removed (a binary file counts 0), and its
 * changed lines: the larger of the two (a line changed counts once, as does a line added).
 */
export const parseNumstat = (text) =>
  text
    .split('\n')
    .map((l) => l.split('\t'))
    .filter((c) => c.length >= 3 && c[2])
    .map(([a, d, file]) => {
      const add = Number(a) || 0;
      const del = Number(d) || 0;
      return { file, add, del, lines: Math.max(add, del) };
    });

/** The report's lines: each touched file with its +/- and changed lines (`!`: not explained), then the totals. */
export function reportLines(touched, stats, missing) {
  const by = new Map(stats.map((r) => [r.file, r]));
  const rows = touched.map((file) => by.get(file) ?? { file, add: 0, del: 0, lines: 0 });
  const width = Math.max(0, ...rows.map((r) => `+${r.add}/-${r.del}`.length));
  const out = rows.map((r) => `  ${missing.includes(r.file) ? '!' : ' '} ${`+${r.add}/-${r.del}`.padEnd(width)}  ${String(r.lines).padStart(3)}  ${r.file}`);
  const sum = (k) => rows.reduce((n, r) => n + r[k], 0);
  out.push(`  In all: ${rows.length} files, +${sum('add')}/-${sum('del')}, ${sum('lines')} changed lines; ${rows.filter((r) => r.lines > 3).length} over 3 lines.`);
  return out;
}

/** The upstream files a fork changes that `doc` (docs/fork.md) doesn't name in backticks. */
export const unexplained = (touched, doc) => touched.filter((f) => !doc.includes(`\`${f}\``));

/** The options a run can carry: `--report`, `--remote <name>`, `--ref <branch>`. */
export function parseArgs(argv) {
  const args = { report: false, remote: 'upstream', ref: 'main' };
  const value = (i, flag) => {
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) throw new Error(`${flag} needs a value`);
    return next;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--report') args.report = true;
    else if (a === '--remote') args.remote = value(i++, '--remote');
    else if (a.startsWith('--remote=')) args.remote = a.slice('--remote='.length);
    else if (a === '--ref') args.ref = value(i++, '--ref');
    else if (a.startsWith('--ref=')) args.ref = a.slice('--ref='.length);
  }
  return args;
}

/**
 * The files both sides changed since they last met: this fork's touch points that upstream also
 * changed this time. Sorted, deduplicated. These are the «check while merging» files.
 */
export function bothChanged(forkTouched, upstreamChanged) {
  const upstream = new Set(upstreamChanged);
  return [...new Set(forkTouched)].filter((f) => upstream.has(f)).sort();
}

/**
 * Upstream files `doc`'s list of touch points (from its "## 改了上游的文件" heading on) names in
 * backticks that the fork no longer changes: the list says more than there is. The version files
 * don't count (they change only with a release).
 */
export const stale = (touched, doc, upstreamFiles) => {
  const changed = new Set(touched);
  const list = doc.slice(Math.max(0, doc.indexOf('## 改了上游的文件')));
  const named = [...list.matchAll(/`([^`\s]+)`/g)].map((m) => m[1]);
  return [...new Set(named)].filter((f) => upstreamFiles.has(f) && !changed.has(f) && !VERSION_FILES.includes(f));
};

const git = (args, opts = {}) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', opts.quiet ? 'ignore' : 'inherit'], ...opts }).trim();
const tryGit = (args) => {
  try {
    return git(args, { quiet: true });
  } catch {
    return undefined;
  }
};
const names = (text) => (text ? text.split('\n').map((f) => f.trim()).filter(Boolean) : []);

/** Upstream files this branch changes or removes, against where it last met upstream. */
function touchPoints(ref = 'HEAD', remote = 'upstream', upstreamRef = 'main') {
  const base = tryGit(['merge-base', ref, `${remote}/${upstreamRef}`]);
  if (!base) return [];
  return names(git(['diff', '--name-only', '--diff-filter=MDR', base, ref]));
}

/** How many lines this branch changes in each upstream file (against the same base). */
function touchStats(ref = 'HEAD', remote = 'upstream', upstreamRef = 'main') {
  const base = tryGit(['merge-base', ref, `${remote}/${upstreamRef}`]);
  if (!base) return [];
  return parseNumstat(git(['diff', '--numstat', '--diff-filter=MDR', base, ref]));
}

const doc = () => (existsSync(FORK_DOC) ? readFileSync(FORK_DOC, 'utf8') : '');

/**
 * «Check while merging»: fork touch points that upstream changed too since the two last met.
 * Printed before a merge, and again in --report.
 */
function riskSection(remote, ref) {
  const target = `${remote}/${ref}`;
  const base = tryGit(['merge-base', 'HEAD', target]);
  if (!base) {
    console.log(`\n合并时检查 (check while merging): ${target} 还不存在，先 fetch。`);
    return [];
  }
  const upstreamChanged = names(tryGit(['diff', '--name-only', `${base}..${target}`]));
  const risk = bothChanged(touchPoints('HEAD', remote, ref), upstreamChanged);
  console.log(`\n合并时检查 (check while merging): ${risk.length} files this fork changes that upstream changed too`);
  if (!risk.length) console.log('  没有：这次上游没有碰 fork 改过的文件。');
  for (const f of risk) console.log(`  ${f}`);
  return risk;
}

/** The touch-point listing (`!` = docs/fork.md does not explain this file yet). */
function listing(remote, ref) {
  const touched = touchPoints('HEAD', remote, ref);
  const missing = unexplained(touched, doc());
  const ahead = tryGit(['rev-list', '--count', `${remote}/${ref}..HEAD`]) ?? '?';
  const behind = tryGit(['rev-list', '--count', `HEAD..${remote}/${ref}`]) ?? '?';
  console.log(`\nThis fork: ${ahead} commits ahead of ${remote}/${ref}, ${behind} behind.`);
  console.log(`It changes ${touched.length} upstream files (each one can conflict on a sync; +added/-removed, then changed lines):`);
  for (const line of reportLines(touched, touchStats('HEAD', remote, ref), missing)) console.log(line);
  const old = stale(touched, doc(), new Set(names(tryGit(['ls-tree', '-r', '--name-only', `${remote}/${ref}`]))));
  if (old.length) console.log(`\n${old.length} named in ${FORK_DOC} but no longer changed (take them off the list):\n${old.map((f) => `    ${f}`).join('\n')}`);
  if (missing.length) console.log(`\n! ${missing.length} not explained in ${FORK_DOC} yet: move the change into a fork file, or add a line there saying why it has to stay.`);
  return missing.length;
}

/** --report: the same three sections a sync prints, without merging or amending anything. */
function report(args) {
  riskSection(args.remote, args.ref);
  return listing(args.remote, args.ref);
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

function sync(args) {
  const { remote, ref } = args;
  const target = `${remote}/${ref}`;
  const dirty = blocking(git(['diff', '--name-only', 'HEAD']));
  if (dirty.length) {
    console.error(`Commit or stash these first: the merge needs a clean tree.\n${dirty.map((f) => `  ${f}`).join('\n')}`);
    process.exit(1);
  }
  if (!tryGit(['remote', 'get-url', remote])) {
    if (remote === 'upstream') git(['remote', 'add', 'upstream', UPSTREAM_URL]);
    else {
      console.error(`No remote named ${remote}. Add it first (--remote is for a rehearsal mirror; the real remote stays untouched).`);
      process.exit(1);
    }
  }
  git(['config', 'rerere.enabled', 'true']);
  git(['config', 'rerere.autoupdate', 'true']);
  git(['fetch', remote, '--tags']);

  const behind = Number(git(['rev-list', '--count', `HEAD..${target}`]));
  if (!behind) {
    console.log(`Already up to date with ${target}.`);
    process.exit(report(args) ? 1 : 0);
  }
  const upVersion = versionOf(git(['show', `${target}:packages/mac/package.json`])) ?? 'main';
  const branch = `sync/upstream-${upVersion}-${new Date().toISOString().slice(0, 10)}`;
  riskSection(remote, ref);
  git(['switch', '-c', branch]);
  console.log(`\nOn ${branch}: merging ${behind} upstream commits (upstream ${upVersion}).`);

  let clean = true;
  try {
    git(['merge', '--no-ff', '--no-edit', '-m', `Merge upstream ${upVersion}`, target]);
  } catch {
    clean = false;
  }
  if (!clean) {
    for (const s of settleVersions()) console.log(`  version settled: ${s}`);
    const left = git(['diff', '--name-only', '--diff-filter=U']).split('\n').filter(Boolean);
    if (left.length) {
      console.log(`\n${left.length} files still in conflict (rerere already applied what it remembered):`);
      for (const f of left) console.log(`  ${f}`);
      console.log(`\nResolve them, \`git add\` them, then \`git commit --no-edit\`.`);
      console.log('rerere remembers your resolutions for next time.');
      listing(remote, ref);
      process.exit(1);
    }
    git(['commit', '--no-edit']);
  }

  listing(remote, ref);
  console.log(`\nMerged. Next: npm run typecheck, npx vitest run, then open a PR from this branch into main.`);
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  if (args.report) {
    tryGit(['fetch', args.remote]);
    process.exit(report(args) ? 1 : 0);
  }
  sync(args);
}
