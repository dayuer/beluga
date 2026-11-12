// Brings upstream (beluga-labs/beluga) into this fork with as few conflicts as possible (docs/fork.md).
//   node scripts/sync-upstream.mjs                 → a sync/upstream-<date> branch with upstream merged in
//   node scripts/sync-upstream.mjs --report        → only the report: risk, calm checks, touch points
//   node scripts/sync-upstream.mjs --after-merge   → the calm checks after a merge resolved by hand
//
// What it does for a sync:
//   1. Turns on git rerere here, so a conflict resolved once is resolved the same way next time.
//   2. Before merging, prints the files this fork changes that upstream changed too («check while
//      merging»): those are where a conflict or a silently lost hook will be.
//   3. Fetches upstream and merges upstream/main into a new branch off the current one (a merge, not a
//      rebase: this fork's main is published).
//   4. Settles the version files itself: the higher of the two versions, when this fork changed
//      nothing else in that file.
//   5. After a clean merge (or `--after-merge` once a hand-resolved merge is committed): runs
//      tests/fork-calm.test.ts, prints upstream findings that are new (new motion) and gone, and
//      checks the calm overlay's selectors against the merged sources (rules that no longer anchor
//      anything). Appends the result to the merge commit's message when it is the merge this script
//      made.
//   6. Prints what's still in conflict, and the fork's touch points: upstream files it changes, with
//      the ones docs/fork.md doesn't explain yet.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const UPSTREAM_URL = 'https://github.com/beluga-labs/beluga.git';
/** Files whose only fork change is the app's version: settled to the higher version on a sync. */
export const VERSION_FILES = ['packages/mac/package.json', 'packages/mac/src-tauri/tauri.conf.json'];
const FORK_DOC = 'docs/fork.md';
const CALM_DOC_START = '### 沉稳界面';
const CALM_DOC_END = '### 版本号';
/** First line of the block this script appends to a merge commit's message: its presence means done. */
export const CALM_SUMMARY_MARKER = '## 沉稳检查（sync 自动附加）';
/** Classes no source in this repo declares (a library puts them on the DOM). Never removed. */
export const THIRD_PARTY_CLASSES = ['glass-surface', 'react-flow__node', 'react-flow__edge-path'];

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

/** The options a run can carry: `--report`, `--after-merge`, `--remote <name>`, `--ref <branch>`. */
export function parseArgs(argv) {
  const args = { report: false, afterMerge: false, remote: 'upstream', ref: 'main' };
  const value = (i, flag) => {
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) throw new Error(`${flag} needs a value`);
    return next;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--report') args.report = true;
    else if (a === '--after-merge') args.afterMerge = true;
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
 * The paths docs/fork.md registers in its calm sections, as a set: everything from
 * `### 沉稳界面` up to (not including) `### 版本号`, which covers the hook list and the M3
 * per-page follow-ups. Backticked prose that is not a path (a selector, a call) is left out.
 * No start heading means the document predates calm mode and the set is empty; no end heading
 * means the section runs to the end of the file.
 */
export function calmFiles(doc) {
  const out = new Set();
  const start = doc.indexOf(CALM_DOC_START);
  if (start < 0) return out;
  const end = doc.indexOf(CALM_DOC_END, start + CALM_DOC_START.length);
  const section = end < 0 ? doc.slice(start) : doc.slice(start, end);
  for (const m of section.matchAll(/`([^`\n]+)`/g)) {
    const p = m[1].trim();
    if (p.includes('/') && !/[\s()[\]<>{}]/.test(p)) out.add(p);
  }
  return out;
}

/** CSS text with comments and import/url paths gone: `./calm.css` in either is not a class. */
const cssSelectorsOnly = (text) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/@import[^;]*;/g, ' ')
    .replace(/url\([^)]*\)/g, ' ');

/**
 * A selector the calm overlay anchors on, one entry per name:
 *   class → the class name as written (`.glass-surface`, or `_needsRow_` from `[class*='_needsRow_']`)
 *   data  → the attribute (`data-step`)
 *   aria  → the literal value (`Your card` in `[aria-label='Your card']`; the attribute is in `selector`)
 */
export function selectorsIn(calmCss) {
  const uses = new Map();
  const add = (kind, name, selector, file) => {
    const key = `${kind}|${name}`;
    const found = uses.get(key);
    if (found) {
      if (!found.files.includes(file)) found.files.push(file);
      return;
    }
    uses.set(key, { kind, name, selector, files: [file] });
  };
  for (const { file, text } of calmCss) {
    const css = cssSelectorsOnly(text);
    // [class*='_needsRow_'] — a CSS-module class, hashed at build time.
    for (const m of css.matchAll(/\[class\s*\*=\s*(['"])([^'"]+)\1\s*\]/g)) add('class', m[2], m[0], file);
    // .glass-surface — a plain class.
    for (const m of css.matchAll(/\.([A-Za-z_][\w-]*)/g)) add('class', m[1], m[0], file);
    // [data-step], [data-motion='reduce'] — the value is not compared, only the attribute.
    for (const m of css.matchAll(/\[(data-[a-z0-9-]+)(?=[\s\]=~|^$*])[^\]]*\]/g)) add('data', m[1], m[0], file);
    // [aria-label='Your card'] / [aria-label="Your card"] — the literal is what has to stay.
    for (const m of css.matchAll(/\[(aria-[a-z-]+)\s*=\s*(['"])([^'"]+)\2\s*\]/g))
      add('aria', m[3], m[0], file);
  }
  return [...uses.values()];
}

/**
 * The calm overlay rules that no longer anchor anything after a merge.
 *
 * - class: a CSS-module name (`_needsRow_`) is alive when some CSS outside fork/ still writes
 *   `.needsRow`; a plain name is alive when that class is written, or it is third-party. This
 *   catches a rename that removes the class; a same-named class in another module still counts as
 *   alive (a false negative, never a false positive) — which is why the caller reports it and does
 *   not fail the run.
 * - data: alive when the attribute appears in any source (fork/ included: hold-order sets
 *   data-dragging/data-arranging itself). `data-calm` is the switch itself and is always alive.
 * - aria: alive when the literal appears in a tsx outside fork/.
 *
 * `sources` are files under packages/mac/src, `file` relative with `/` (e.g. `chat/a.tsx`).
 */
export function staleSelectors(uses, sources) {
  const cssOutsideFork = sources.filter((s) => s.file.endsWith('.css') && !s.file.startsWith('fork/'));
  const tsxOutsideFork = sources.filter((s) => s.file.endsWith('.tsx') && !s.file.startsWith('fork/'));
  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const alive = (use) => {
    if (use.kind === 'class') {
      if (THIRD_PARTY_CLASSES.includes(use.name)) return true;
      const bare = use.name.replace(/^_+/, '').replace(/_+$/, '');
      if (!bare) return true;
      const pattern = new RegExp(`\\.${escape(bare)}(?![\\w-])`);
      return cssOutsideFork.some((s) => pattern.test(s.text));
    }
    if (use.kind === 'data') {
      if (use.name === 'data-calm') return true;
      return sources.some((s) => s.text.includes(use.name));
    }
    return tsxOutsideFork.some((s) => s.text.includes(use.name));
  };
  return uses.filter((use) => !alive(use));
}

/**
 * The Markdown this script appends to the merge commit's message: what to look at while merging,
 * what upstream's new motion is, what the overlay no longer reaches. `risk` is every file both
 * sides changed; `calmRisk` the ones docs/fork.md registers as calm touch points.
 */
export function calmSummary({ risk = [], calmRisk = [], newFindings = [], goneFindings = [], stale = [] } = {}) {
  const lines = [CALM_SUMMARY_MARKER, ''];
  lines.push(`- 合并时检查（fork 改过、上游也改了）: ${risk.length}`);
  for (const f of risk) lines.push(`  - ${f}${calmRisk.includes(f) ? ' ⚠ 沉稳界面' : ''}`);
  lines.push(`- 新增的动效（fork-calm NEW）: ${newFindings.length}`);
  for (const f of newFindings) lines.push(`  - ${typeof f === 'string' ? f : `${f.at} ${f.key}`}`);
  lines.push(`- 消失的动效（fork-calm GONE）: ${goneFindings.length}`);
  for (const f of goneFindings) lines.push(`  - ${f}`);
  lines.push(`- 覆盖层失效的规则: ${stale.length}`);
  for (const u of stale) lines.push(`  - \`${u.selector}\`（${u.files.join('、')}）`);
  if (!risk.length && !newFindings.length && !goneFindings.length && !stale.length) lines.push('- 没有需要补的动效，也没有失效的规则。');
  lines.push('');
  lines.push('处理完再开 PR；快照只在逐条裁决后以 CALM_UPDATE=1 更新（docs/fork.md「同步上游」）。');
  return `${lines.join('\n')}\n`;
}

/** `message` with `summary` appended, unless it already carries one (so reruns do not stack). */
export function withCalmSummary(message, summary) {
  if (message.includes(CALM_SUMMARY_MARKER)) return message;
  return `${message.trimEnd()}\n\n${summary}`;
}

/**
 * The NEW and GONE entries from tests/fork-calm.test.ts's printed report. Findings are keyed
 * `category|file|name`; NEW lines carry `file:line` before the key.
 */
export function forkCalmFindings(text) {
  const added = [];
  const gone = [];
  let section = null;
  for (const line of text.split('\n')) {
    if (/NEW since tests\/fork-calm\.snapshot\.json/.test(line)) {
      section = 'new';
      continue;
    }
    if (/^\s*GONE \(\d+\):/.test(line)) {
      section = 'gone';
      continue;
    }
    if (section === 'new') {
      const m = /^\s*\+\s+(\S+:\d+)\s{2,}(.+)$/.exec(line);
      if (m) added.push({ at: m[1], key: m[2].trim() });
      else if (line.trim()) section = null;
    } else if (section === 'gone') {
      const m = /^\s*-\s+(.+)$/.exec(line);
      if (m) gone.push(m[1].trim());
      else if (line.trim()) section = null;
    }
  }
  return { added, gone };
}

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

const doc = () => (existsSync(FORK_DOC) ? readFileSync(FORK_DOC, 'utf8') : '');

/**
 * «Check while merging»: fork touch points that upstream changed too since the two last met.
 * Printed before a merge, and again in --report. Files docs/fork.md registers as calm-mode touch
 * points carry a ⚠ 沉稳界面 mark: those are the hooks whose loss is a broken calm experience.
 */
function riskSection(remote, ref) {
  const target = `${remote}/${ref}`;
  const base = tryGit(['merge-base', 'HEAD', target]);
  if (!base) {
    console.log(`\n合并时检查 (check while merging): ${target} 还不存在，先 fetch。`);
    return { risk: [], calmRisk: [] };
  }
  const upstreamChanged = names(tryGit(['diff', '--name-only', `${base}..${target}`]));
  const risk = bothChanged(touchPoints('HEAD', remote, ref), upstreamChanged);
  const calm = calmFiles(doc());
  const calmRisk = risk.filter((f) => calm.has(f));
  console.log(`\n合并时检查 (check while merging): ${risk.length} files this fork changes that upstream changed too`);
  if (!risk.length) console.log('  没有：这次上游没有碰 fork 改过的文件。');
  for (const f of risk) console.log(`  ${calm.has(f) ? `⚠ 沉稳界面  ${f}` : f}`);
  return { risk, calmRisk };
}

/** Every file under packages/mac/src that the calm checks read, `file` relative with `/`. */
function scanSources(root) {
  const src = path.join(root, 'packages/mac/src');
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(css|tsx|ts)$/.test(name)) out.push({ file: path.relative(src, full).split(path.sep).join('/'), text: readFileSync(full, 'utf8') });
    }
  };
  walk(src);
  return out;
}

/** Runs the fork-calm report; returns whether it passed and its printed output. */
function runForkCalm(root) {
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  try {
    const out = execFileSync(npx, ['vitest', 'run', 'tests/fork-calm.test.ts'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 120_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    console.log(out.trimEnd());
    return { ok: true, out };
  } catch (err) {
    const out = `${err.stdout ?? ''}${err.stderr ?? ''}`;
    if (out) console.log(out.trimEnd());
    return { ok: false, out };
  }
}

/**
 * After the merge: upstream's new motion, the calm overlay's stale selectors, and a reminder to
 * rerun calm-check. Reports stale selectors without failing on them (a global or same-named class
 * can make one a false negative, never a false positive); a broken fork-calm does fail.
 */
function calmChecks(root) {
  const { ok, out } = runForkCalm(root);
  const findings = forkCalmFindings(out);
  const sources = scanSources(root);
  const uses = selectorsIn(sources.filter((s) => s.file.startsWith('fork/calm/') && s.file.endsWith('.css')));
  const stale = staleSelectors(uses, sources);

  console.log(`\n覆盖层失效的规则 (stale overlay selectors): ${stale.length}`);
  if (!stale.length) console.log('  没有：覆盖层锚定的类名、data 属性与 aria 字面量都还在。');
  for (const u of stale) console.log(`  ⚠ ${u.selector}  (${u.files.join(', ')})`);
  console.log('\n重跑 calm-check 主要场景（沉稳开 + reduced-motion 各一遍）:');
  console.log('  npm run dev');
  console.log('  cd packages/mac && npm run dev');
  console.log('  node packages/mac/scripts/calm-check.mjs room chatrun chatsteps tasks sentinel usage onboarding call');
  return { ok, findings, stale };
}

/** The files both sides of a merge changed since the merge base: what riskSection printed before it. */
function mergeRisk() {
  const parents = (tryGit(['rev-list', '--parents', '-n', '1', 'HEAD']) ?? '').split(' ').filter(Boolean).slice(1);
  if (parents.length < 2) return { risk: [], calmRisk: [] };
  const base = tryGit(['merge-base', parents[0], parents[1]]);
  if (!base) return { risk: [], calmRisk: [] };
  const ours = names(tryGit(['diff', '--name-only', `${base}..${parents[0]}`]));
  const theirs = names(tryGit(['diff', '--name-only', `${base}..${parents[1]}`]));
  const risk = bothChanged(ours, theirs);
  const calm = calmFiles(doc());
  return { risk, calmRisk: risk.filter((f) => calm.has(f)) };
}

/** Appends the calm summary to the merge commit, under the guardrails in docs/fork.md. */
function amendWithCalmSummary(summary) {
  const parents = (tryGit(['rev-list', '--parents', '-n', '1', 'HEAD']) ?? '').split(' ').filter(Boolean).slice(1);
  if (parents.length < 2) {
    console.log('\n（HEAD 不是合并提交，沉稳检查没有写进提交说明。）');
    return;
  }
  const subject = tryGit(['log', '-1', '--format=%s']) ?? '';
  if (!subject.startsWith('Merge upstream')) {
    console.log('\n（HEAD 的标题不是 Merge upstream，沉稳检查没有写进提交说明。）');
    return;
  }
  const message = git(['log', '-1', '--format=%B']);
  if (message.includes(CALM_SUMMARY_MARKER)) {
    console.log('\n提交说明里已有沉稳检查段，没有重复追加。');
    return;
  }
  execFileSync('git', ['commit', '--amend', '-F', '-'], { input: withCalmSummary(message, summary), encoding: 'utf8' });
  console.log('\n沉稳检查已写进这条合并提交的说明（--amend，可 `git commit --amend -F -` 重跑核对）。');
}

/**
 * The whole after-merge step; returns true when fork-calm passes. With `amend` (a sync's own clean
 * merge, or --after-merge), the result also goes into the merge commit's message.
 */
function afterMergeChecks(root, { amend = false } = {}) {
  const checks = calmChecks(root);
  if (!checks.ok) {
    console.log('\nfork-calm 失败：上游把某个接入点搬走或删掉了，fork 的沉稳行为已经悄悄消失。');
    console.log('按 tests/fork-calm.test.ts 的 TOUCHPOINTS 逐条核对（每条带 why），把接入点接回去再重跑。');
    return false;
  }
  if (amend) {
    const { risk, calmRisk } = mergeRisk();
    amendWithCalmSummary(calmSummary({ risk, calmRisk, newFindings: checks.findings.added, goneFindings: checks.findings.gone, stale: checks.stale }));
  }
  return true;
}

/** The touch-point listing (`!` = docs/fork.md does not explain this file yet). */
function listing(remote, ref) {
  const touched = touchPoints('HEAD', remote, ref);
  const missing = unexplained(touched, doc());
  const ahead = tryGit(['rev-list', '--count', `${remote}/${ref}..HEAD`]) ?? '?';
  const behind = tryGit(['rev-list', '--count', `HEAD..${remote}/${ref}`]) ?? '?';
  console.log(`\nThis fork: ${ahead} commits ahead of ${remote}/${ref}, ${behind} behind.`);
  console.log(`It changes ${touched.length} upstream files (each one can conflict on a sync):`);
  for (const f of touched) console.log(`  ${missing.includes(f) ? '!' : ' '} ${f}`);
  if (missing.length) console.log(`\n! ${missing.length} not explained in ${FORK_DOC} yet: move the change into a fork file, or add a line there saying why it has to stay.`);
  return missing.length;
}

/** --report: the same three sections a sync prints, without merging or amending anything. */
function report(args) {
  riskSection(args.remote, args.ref);
  afterMergeChecks(git(['rev-parse', '--show-toplevel']));
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
      console.log(`Then run the calm checks on the merged tree:`);
      console.log(`  node scripts/sync-upstream.mjs --after-merge${remote === 'upstream' ? '' : ` --remote ${remote}`}${ref === 'main' ? '' : ` --ref ${ref}`}`);
      console.log('rerere remembers your resolutions for next time.');
      listing(remote, ref);
      process.exit(1);
    }
    git(['commit', '--no-edit']);
  }

  const root = git(['rev-parse', '--show-toplevel']);
  const passed = afterMergeChecks(root, { amend: true });
  listing(remote, ref);
  console.log(`\nMerged. Next: npm run typecheck, npx vitest run, then open a PR from this branch into main.`);
  process.exit(passed ? 0 : 1);
}

/** --after-merge: a hand-resolved merge is committed; run the checks and annotate that commit. */
function afterMerge(args) {
  if (git(['diff', '--name-only', '--diff-filter=U']).trim()) {
    console.error('Still in conflict: resolve, `git add`, `git commit --no-edit`, then run --after-merge again.');
    return 1;
  }
  return afterMergeChecks(git(['rev-parse', '--show-toplevel']), { amend: true }) ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  if (args.report) {
    tryGit(['fetch', args.remote]);
    process.exit(report(args) ? 1 : 0);
  }
  if (args.afterMerge) process.exit(afterMerge(args));
  sync(args);
}
