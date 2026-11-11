import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * What calm mode's overlay cannot reach (docs/calm-ui.md §9.2): a static scan of the Mac app's
 * sources for motion the CSS overlay cannot switch off. Upstream findings are a report, never a
 * failure (they change with every sync); this fork's own fork/calm/ files must stay clean.
 *
 * Findings are keyed without line numbers so upstream reordering does not churn the snapshot:
 *   category | path under packages/mac/src | name
 * `CALM_UPDATE=1 npx vitest run tests/fork-calm.test.ts` accepts the current upstream list.
 */

const SRC = path.join(__dirname, '../packages/mac/src');
const SNAPSHOT = path.join(__dirname, 'fork-calm.snapshot.json');

/** One-off decoration that may keep its motion (docs/calm-ui.md §7.4). */
const KEEP_DECOR = ['onboarding/', 'dialogs/star-scene.module.css', 'components/PixelBurst.tsx', 'components/pixel-burst-model.ts'];

/** Files are named from the repository root here, as docs/fork.md names them. */
const REPO = path.join(__dirname, '..');

/**
 * Every place this fork reaches into an upstream file (docs/fork.md's touch points; each one is
 * designed in docs/calm/hooks.md). `match` is the line the fork relies on: a missing match means an
 * upstream change moved or removed the hook and the fork's behaviour is silently gone. That is a
 * broken fork integration, not an upstream style finding, so it fails the run (unlike the report
 * below). Each task that adds a hook adds its row here.
 */
const TOUCHPOINTS: readonly { readonly file: string; readonly match: RegExp; readonly why: string }[] = [
  { file: 'packages/mac/src/main.tsx', match: /import '\.\/fork\/calm\/index\.js'/, why: 'calm overlay loads before the first frame (M0)' },
  { file: 'packages/mac/src/dialogs/Settings.tsx', match: /<CalmRow \/>/, why: 'the calm switch in Settings › Appearance (M0)' },
  { file: 'tests/mac-settings-search.test.ts', match: /read\('fork\/calm\/settings\.tsx'\)/, why: 'settings search reads the fork row (M0)' },
  { file: 'packages/mac/src/layout/Sidebar.tsx', match: /useSidebarHold\(drop\.ref\)/, why: 'the sidebar probe that holds its order (BLG-165)' },
  { file: 'packages/mac/src/layout/EntryRow.tsx', match: /useHeldEntries\(/, why: 'the frozen order both sidebar lists read (BLG-165)' },
  { file: 'packages/mac/src/chat/ChatLog.tsx', match: /<JumpLabel rows=\{rows\.length\} \/>/, why: 'the count of messages below, on the way back down (BLG-166)' },
];

/** Names this fork's own overlay must never use (CLAUDE.md's list). */
const BANNED = ['pop', 'hop', 'bounce', 'ripple', 'sheen', 'shimmer', 'breathe', 'pulse', 'shake', 'blink', 'glow'];

/** Categories that fail when they appear in fork/calm/ (the overlay may only fade and shorten). */
const FORBIDDEN_IN_FORK = new Set(['spring', 'overscale', 'long-duration']);

type Category = 'keyframes' | 'infinite' | 'element-animate' | 'inline-motion' | 'live-motion' | 'framer-motion' | 'hover-size' | 'spring' | 'overscale' | 'long-duration';

interface Finding {
  readonly category: Category;
  /** The path under packages/mac/src, always with `/`. */
  readonly file: string;
  readonly name: string;
  readonly line: number;
  /** category|file|name: stable across upstream reordering. */
  readonly key: string;
}

const relative = (full: string): string => path.relative(SRC, full).split(path.sep).join('/');

const skipped = (file: string): boolean => KEEP_DECOR.some((p) => file === p || (p.endsWith('/') && file.startsWith(p)));

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sources(full));
    else if (/\.(css|tsx|ts)$/.test(name)) out.push(full);
  }
  return out;
}

const lineAt = (text: string, at: number): number => text.slice(0, at).split('\n').length;

/** The animation's name in an `animation:` value, so "infinite" says which one. */
function animationName(value: string): string {
  const keyword = new Set(['infinite', 'normal', 'reverse', 'alternate', 'alternate-reverse', 'forwards', 'backwards', 'both', 'none', 'running', 'paused', 'linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out', 'step-start', 'step-end', 'inherit', 'initial', 'unset', 'revert']);
  for (const token of value.split(/[\s,]+/)) {
    const t = token.trim();
    if (!t || /^[\d.]+m?s$/.test(t) || /^(cubic-bezier|steps|linear)\(/.test(t) || keyword.has(t)) continue;
    if (/^[A-Za-z_][\w-]*$/.test(t)) return t;
  }
  return 'animation';
}

/** The first time in an animation/transition value: the duration (a second one would be the delay). */
function firstTime(value: string): { token: string; ms: number } | undefined {
  const m = /(\d*\.?\d+)(ms|s)\b/.exec(value);
  if (!m) return undefined;
  const ms = Number(m[1]) * (m[2] === 's' ? 1000 : 1);
  return { token: `${m[1]}${m[2]}`, ms };
}

function scan(file: string, text: string, out: Finding[]): void {
  const add = (category: Category, name: string, at: number): void => {
    out.push({ category, file, name, line: lineAt(text, at), key: `${category}|${file}|${name}` });
  };

  if (file.endsWith('.css')) {
    for (const m of text.matchAll(/@keyframes\s+([A-Za-z_][\w-]*)/g)) add('keyframes', m[1]!, m.index ?? 0);

    // Rules: a selector and a flat body. Nested at-rules are skipped; their inner rules are found.
    for (const rule of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = rule[1]!.trim().replace(/\s+/g, ' ');
      const body = rule[2]!;
      if (/:(hover|focus|focus-visible|active)\b|\[aria-selected/.test(selector)) {
        const size = /(?:^|;)\s*(font-weight|border-width|width|height|padding(?:-[a-z]+)?|margin(?:-[a-z]+)?|transform|scale)\s*:/.exec(body);
        if (size) add('hover-size', selector, rule.index ?? 0);
      }
      for (const decl of body.matchAll(/(?:^|;)\s*(animation|transition)\s*:\s*([^;]+)/g)) {
        if (/\binfinite\b/.test(decl[2]!)) add('infinite', animationName(decl[2]!), (rule.index ?? 0) + (decl.index ?? 0));
        if (decl[1] === 'animation' || decl[1] === 'transition') {
          const time = firstTime(decl[2]!);
          if (time && time.ms > 200) add('long-duration', `${decl[1]}=${time.token}`, (rule.index ?? 0) + (decl.index ?? 0));
        }
      }
      // animation-duration / transition-duration, and Beluga's own --dur tokens.
      for (const decl of body.matchAll(/(?:^|;)\s*((?:animation|transition)-duration|--dur[\w-]*)\s*:\s*([^;]+)/g)) {
        const time = firstTime(decl[2]!);
        if (time && time.ms > 200) add('long-duration', `${decl[1]}=${time.token}`, (rule.index ?? 0) + (decl.index ?? 0));
      }
    }
  }

  if (/\.tsx?$/.test(file)) {
    if (/\.animate\s*\(/.test(text)) add('element-animate', 'animate', text.search(/\.animate\s*\(/));
    if (/from\s+['"][^'"]*live-motion(?:\.js)?['"]/.test(text) || /import\(\s*['"][^'"]*live-motion/.test(text)) add('live-motion', 'live-motion', text.search(/live-motion/));
    // framer-motion animates through props, which no CSS rule can stop (the runtime calm-check sees
    // these as unnamed `js` animations; this makes them visible to the static report too).
    if (/from\s+['"](framer-motion|motion\/react)['"]/.test(text)) add('framer-motion', 'motion', text.search(/framer-motion|motion\/react/));
    if (file.endsWith('.tsx')) {
      for (const style of text.matchAll(/style=\{\{([\s\S]*?)\}\}/g)) {
        for (const prop of style[1]!.matchAll(/\b(animation|transition)[A-Za-z]*\s*:/g)) add('inline-motion', prop[1]!, (style.index ?? 0) + (prop.index ?? 0));
      }
    }
    // JavaScript durations (`el.animate(..., { duration: 900 })`: milliseconds).
    for (const m of text.matchAll(/\bduration\s*:\s*(\d+)/g)) {
      if (Number(m[1]) > 200) add('long-duration', `duration=${m[1]}ms`, m.index ?? 0);
    }
  }

  // Curves and scales are written the same way in CSS and TS.
  for (const m of text.matchAll(/cubic-bezier\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/g)) {
    // cubic-bezier(x1, y1, x2, y2): any control point outside [0, 1] overshoots or anticipates.
    const [, , y1, , y2] = m;
    const y = [Number(y1), Number(y2)];
    if (y.some((n) => n < 0 || n > 1)) add('spring', m[0]!.replace(/\s+/g, ''), m.index ?? 0);
  }
  for (const m of text.matchAll(/scale[XYZ]?\(\s*(-?[\d.]+)/g)) {
    if (Number(m[1]) > 1) add('overscale', `scale(${m[1]})`, m.index ?? 0);
  }
}

const ALL: Finding[] = [];
for (const full of sources(SRC)) {
  const file = relative(full);
  if (skipped(file)) continue;
  scan(file, readFileSync(full, 'utf8'), ALL);
}

/** The overlay does not cover these: the report is about upstream. One finding per key. */
const UPSTREAM = [...new Map(ALL.filter((f) => !f.file.startsWith('fork/')).map((f) => [f.key, f])).values()];

const report = (): void => {
  const counts = new Map<Category, number>();
  for (const f of UPSTREAM) counts.set(f.category, (counts.get(f.category) ?? 0) + 1);
  const current = UPSTREAM.map((f) => f.key).sort();
  const snapshot = existsSync(SNAPSHOT) ? (JSON.parse(readFileSync(SNAPSHOT, 'utf8')) as { version: number; findings: string[] }) : { version: 1, findings: [] };
  if (process.env.CALM_UPDATE === '1') {
    writeFileSync(SNAPSHOT, `${JSON.stringify({ version: 1, findings: current }, null, 2)}\n`);
    console.log(`fork-calm: wrote ${current.length} upstream findings to tests/fork-calm.snapshot.json`);
    return;
  }
  const before = new Set(snapshot.findings);
  const now = new Set(current);
  const added = current.filter((k) => !before.has(k));
  const gone = snapshot.findings.filter((k) => !now.has(k));
  const byKey = new Map(ALL.map((f) => [f.key, f]));
  console.log(`\nfork-calm report: ${current.length} upstream findings (fork/calm/ checked separately)`);
  for (const [category, count] of [...counts].sort((a, b) => b[1] - a[1])) console.log(`  ${category.padEnd(15)} ${count}`);
  if (added.length) {
    console.log(`\n  NEW since tests/fork-calm.snapshot.json (${added.length}):`);
    for (const key of added) {
      const f = byKey.get(key);
      console.log(`    + ${f?.file ?? key}:${f?.line ?? '?'}  ${key}`);
    }
  }
  if (gone.length) {
    console.log(`\n  GONE (${gone.length}):`);
    for (const key of gone) console.log(`    - ${key}`);
  }
  if (added.length || gone.length) console.log('\n  CALM_UPDATE=1 npx vitest run tests/fork-calm.test.ts accepts this list.');
};

describe('fork-calm: what the overlay cannot reach', () => {
  it('prints the upstream report; new or gone upstream code is information, not failure', () => {
    report();
    expect(Array.isArray(ALL)).toBe(true);
  });

  it('keeps fork/calm free of springs, overscales, long durations and banned names', () => {
    const violations = ALL.filter((f) => {
      if (!f.file.startsWith('fork/')) return false;
      const lower = f.name.toLowerCase();
      return FORBIDDEN_IN_FORK.has(f.category) || BANNED.some((word) => lower.includes(word));
    });
    expect(violations.map((f) => `${f.category}|${f.file}|${f.name}`)).toEqual([]);
  });

  it('keeps every line into an upstream file that the fork relies on', () => {
    const missing = TOUCHPOINTS.filter((t) => {
      const full = path.join(REPO, t.file);
      return !existsSync(full) || !t.match.test(readFileSync(full, 'utf8'));
    });
    expect(missing.map((t) => `${t.file}: ${t.why}`)).toEqual([]);
  });
});
