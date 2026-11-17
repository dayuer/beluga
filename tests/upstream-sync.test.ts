import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  blocking,
  bothChanged,
  CALM_SUMMARY_MARKER,
  calmFiles,
  calmSummary,
  compareVersions,
  forkCalmFindings,
  onlyVersionChanged,
  parseArgs,
  parseNumstat,
  reportLines,
  selectorsIn,
  stale,
  staleSelectors,
  unexplained,
  versionOf,
  withCalmSummary,
  withVersion,
} from '../scripts/sync-upstream.mjs';
import type { SelectorUse } from '../scripts/sync-upstream.mjs';
import { withForkSettings } from '../packages/mac/src/fork/settings-index.js';

/** Syncing upstream into this fork (docs/fork.md, scripts/sync-upstream.mjs). */
describe('syncing upstream', () => {
  it('orders versions', () => {
    expect(compareVersions('3.2.0', '3.1.1')).toBe(1);
    expect(compareVersions('3.1.1', '3.2.0')).toBe(-1);
    expect(compareVersions('3.10.0', '3.9.9')).toBe(1);
    expect(compareVersions('3.1.0', '3.1.0')).toBe(0);
    expect(compareVersions('3.1.0-rc.1', '3.1.0')).toBe(-1);
  });

  it('changes only the version, keeping the rest of the file as it was', () => {
    const text = '{\n  "name": "beluga-mac",\n  "version": "3.1.0",\n  "deps": { "x": { "version": "9.9.9" } }\n}';
    expect(versionOf(text)).toBe('3.1.0');
    expect(withVersion(text, '3.2.0')).toBe(text.replace('"3.1.0"', '"3.2.0"'));
  });

  it('takes upstream’s file only when the fork changed nothing but the version', () => {
    const base = '{\n  "version": "3.1.0",\n  "private": true\n}';
    expect(onlyVersionChanged(base, base.replace('3.1.0', '3.1.1'))).toBe(true);
    expect(onlyVersionChanged(base, base.replace('true', 'false'))).toBe(false);
    expect(onlyVersionChanged(undefined, base)).toBe(false);
  });

  it('lets Finder’s .DS_Store through and names what else stops the merge', () => {
    expect(blocking('.DS_Store\ndocs/guide/.DS_Store')).toEqual([]);
    expect(blocking('.DS_Store\nsrc/a.ts\npackages/mac/package.json')).toEqual(['src/a.ts', 'packages/mac/package.json']);
    expect(blocking('')).toEqual([]);
  });

  it('names the touch points docs/fork.md doesn’t explain', () => {
    expect(unexplained(['a.ts', 'b.ts'], 'why `a.ts` stays')).toEqual(['b.ts']);
  });

  it('explains every touch point it knows of in docs/fork.md', () => {
    const doc = readFileSync('docs/fork.md', 'utf8');
    for (const f of ['src/companion/coverage.ts', 'packages/mac/src/dialogs/settings-index.ts', 'packages/mac/src/i18n/index.ts', 'tests/parity.test.ts']) expect(doc).toContain(`\`${f}\``);
  });
});

/** The merge checks: what both sides changed, what calm mode anchors on (docs/fork.md「同步上游」). */
describe('checking a merge', () => {
  it('reads the switches, keeping the real remote when none is given', () => {
    expect(parseArgs([])).toEqual({ report: false, afterMerge: false, remote: 'upstream', ref: 'main' });
    expect(parseArgs(['--report'])).toMatchObject({ report: true, afterMerge: false });
    expect(parseArgs(['--after-merge', '--remote', 'calm-rehearsal', '--ref', 'main'])).toEqual({
      report: false,
      afterMerge: true,
      remote: 'calm-rehearsal',
      ref: 'main',
    });
    expect(parseArgs(['--remote=mirror', '--ref=next'])).toMatchObject({ remote: 'mirror', ref: 'next' });
  });

  it('lists the files both sides changed, once, in order', () => {
    expect(bothChanged(['b', 'a', 'b'], ['a', 'b', 'c'])).toEqual(['a', 'b']);
    expect(bothChanged(['a'], [])).toEqual([]);
    expect(bothChanged([], ['a'])).toEqual([]);
  });

  const DOC = [
    '### 只有一行接入点',
    '- `packages/mac/src/old.ts`',
    '### 沉稳界面（docs/calm-ui.md）',
    '- `packages/mac/src/main.tsx`：一行 `useSidebarHold(drop.ref)`，探针在 `fork/calm/hold-order.ts`，规则只在 `:root[data-calm]` 下生效',
    '### M3 逐页补改',
    '- `packages/mac/src/chat/flight.ts`',
    '### 版本号（脚本自动处理）',
    '- `packages/mac/package.json`',
  ].join('\n');

  it('takes the calm sections (hooks and M3 follow-ups) but only paths', () => {
    const files = calmFiles(DOC);
    expect(files.has('packages/mac/src/main.tsx')).toBe(true);
    expect(files.has('packages/mac/src/chat/flight.ts')).toBe(true);
    expect(files.has('fork/calm/hold-order.ts')).toBe(true);
    expect(files.has('packages/mac/src/old.ts')).toBe(false);
    expect(files.has('packages/mac/package.json')).toBe(false);
    expect(files.has(':root[data-calm]')).toBe(false);
    expect(files.has('useSidebarHold(drop.ref)')).toBe(false);
  });

  it('runs to the end of the file when the end heading is gone', () => {
    expect(calmFiles('### 沉稳界面\n- `a/b.ts`').has('a/b.ts')).toBe(true);
    expect(calmFiles('no headings at all').size).toBe(0);
  });
});

describe('the calm overlay’s anchors', () => {
  const CSS = [
    '/* .needsRow explained in a comment is not a selector */',
    ":root[data-calm] [class*='_needsRow_']::after { display: none }",
    '.signal .glass-surface:hover { transform: none }',
    '[data-step][data-current] { margin-top: 0 }',
    "[aria-label='Your card'] {}",
    '[aria-label="Side question"] {}',
    "@import './calm-tokens.css';",
  ].join('\n');

  it('reads the classes, data attributes and aria literals a rule anchors on', () => {
    const uses = selectorsIn([{ file: 'fork/calm/a.css', text: CSS }]);
    const at = (kind: string, name: string) => uses.find((u) => u.kind === kind && u.name === name);
    expect(at('class', '_needsRow_')?.selector).toBe("[class*='_needsRow_']");
    expect(at('class', 'glass-surface')?.selector).toBe('.glass-surface');
    expect(at('class', 'needsRow')).toBeUndefined();
    expect(at('class', 'css')).toBeUndefined();
    expect(at('data', 'data-step')).toBeTruthy();
    expect(at('data', 'data-current')).toBeTruthy();
    expect(at('aria', 'Your card')?.selector).toBe("[aria-label='Your card']");
    expect(at('aria', 'Side question')?.selector).toBe('[aria-label="Side question"]');
  });

  const use = (kind: SelectorUse['kind'], name: string): SelectorUse => ({ kind, name, selector: name, files: ['fork/calm/a.css'] });
  const stale = (uses: SelectorUse[], sources: { file: string; text: string }[]): string[] =>
    staleSelectors(uses, sources).map((u) => `${u.kind}|${u.name}`);

  it('keeps a CSS-module class alive while upstream still writes .needsRow', () => {
    expect(stale([use('class', '_needsRow_')], [{ file: 'layout/signal.module.css', text: '.needsRow { color: amber }' }])).toEqual([]);
  });

  it('reports a class upstream renamed away', () => {
    const sources = [{ file: 'layout/signal.module.css', text: '.needsLine { color: amber }' }];
    expect(stale([use('class', '_needsRow_')], sources)).toEqual(['class|_needsRow_']);
  });

  it('does not mistake a longer class for the same name', () => {
    const sources = [{ file: 'layout/signal.module.css', text: '.needsRowBig { color: amber }' }];
    expect(stale([use('class', '_needsRow_')], sources)).toEqual(['class|_needsRow_']);
  });

  it('lets a third-party class through', () => {
    expect(stale([use('class', 'react-flow__node')], [])).toEqual([]);
  });

  it('keeps a data attribute any source sets, fork included, and never the switch itself', () => {
    expect(stale([use('data', 'data-dragging')], [{ file: 'fork/calm/hold-order.ts', text: "observe(root, { attributeFilter: ['data-dragging'] })" }])).toEqual([]);
    expect(stale([use('data', 'data-dragging')], [{ file: 'chat/a.tsx', text: 'nothing' }])).toEqual(['data|data-dragging']);
    expect(stale([use('data', 'data-calm')], [])).toEqual([]);
  });

  it('counts an aria literal only in a tsx outside fork/', () => {
    const sources = [{ file: 'views/usage/YourCard.tsx', text: '<section aria-label="Your card" />' }];
    expect(stale([use('aria', 'Your card')], sources)).toEqual([]);
    expect(stale([use('aria', 'Your card')], [{ file: 'fork/calm/x.tsx', text: 'Your card' }])).toEqual(['aria|Your card']);
    expect(stale([use('aria', 'Your card')], [{ file: 'chat/a.tsx', text: 'nothing' }])).toEqual(['aria|Your card']);
  });
});

describe('the calm summary written after a merge', () => {
  it('starts with the marker and says what to look at', () => {
    const summary = calmSummary({
      risk: ['src/a.ts', 'packages/mac/src/chat/flight.ts'],
      calmRisk: ['packages/mac/src/chat/flight.ts'],
      newFindings: [{ at: 'sentinel/home.module.css:12', key: 'keyframes|sentinel/home.module.css|pulse' }],
      goneFindings: ['infinite|chat/x.css|spin'],
      stale: [{ kind: 'class', name: '_needsRow_', selector: "[class*='_needsRow_']", files: ['fork/calm/calm-state.css'] }],
    });
    expect(summary.startsWith(CALM_SUMMARY_MARKER)).toBe(true);
    expect(summary).toContain('packages/mac/src/chat/flight.ts ⚠ 沉稳界面');
    expect(summary).toContain('sentinel/home.module.css:12');
    expect(summary).toContain("[class*='_needsRow_']");
  });

  it('is appended once, so a rerun does not stack it', () => {
    const summary = calmSummary({ risk: ['src/a.ts'] });
    const once = withCalmSummary('Merge upstream 3.2.0', summary);
    expect(once).toContain(CALM_SUMMARY_MARKER);
    expect(withCalmSummary(once, summary)).toBe(once);
  });

  it('says so plainly when there is nothing to fix', () => {
    expect(calmSummary()).toContain('没有需要补的动效');
  });

  it('reads the NEW and GONE lists from the fork-calm output', () => {
    const out = [
      'fork-calm report: 440 upstream findings (fork/calm/ checked separately)',
      '  NEW since tests/fork-calm.snapshot.json (1):',
      '    + sentinel/home.module.css:12  keyframes|sentinel/home.module.css|pulse',
      '',
      '  GONE (1):',
      '    - infinite|chat/x.css|spin',
    ].join('\n');
    expect(forkCalmFindings(out)).toEqual({
      added: [{ at: 'sentinel/home.module.css:12', key: 'keyframes|sentinel/home.module.css|pulse' }],
      gone: ['infinite|chat/x.css|spin'],
    });
  });
});

describe('the fork’s settings rows', () => {
  type E = Parameters<typeof withForkSettings>[0][number];
  const e = (pane: string, label: string, group?: string): E => ({ pane, label, ...(group ? { group } : {}) }) as E;

  it('go right after the group they follow, in its pane', () => {
    const base = [e('claude', 'A', undefined), e('claude', 'a1', 'A'), e('claude', 'B'), e('phone', 'A')];
    const out = withForkSettings(base, [{ after: 'A', entries: [e('claude', 'Mine')] }]);
    expect(out.map((x) => x.label)).toEqual(['A', 'a1', 'Mine', 'B', 'A']);
  });

  it('go at the end when that group is gone upstream', () => {
    const out = withForkSettings([e('claude', 'B')], [{ after: 'Gone', entries: [e('claude', 'Mine')] }]);
    expect(out.map((x) => x.label)).toEqual(['B', 'Mine']);
  });
});

/** The report counts how much of each upstream file the fork changes (min-conflict, BLG-190). */
describe('the touch-point report', () => {
  it('reads git’s numstat: a changed line counts once, a binary file 0', () => {
    expect(parseNumstat('1\t1\tsrc/workspaces/git.ts\n3\t0\tpackages/mac/src/main.tsx\n-\t-\tlogo.png\n')).toEqual([
      { file: 'src/workspaces/git.ts', add: 1, del: 1, lines: 1 },
      { file: 'packages/mac/src/main.tsx', add: 3, del: 0, lines: 3 },
      { file: 'logo.png', add: 0, del: 0, lines: 0 },
    ]);
  });

  it('lists each file with its +/- and changed lines, marks the unexplained, and adds them up', () => {
    const stats = parseNumstat('1\t1\ta.ts\n12\t5\tb.ts\n');
    const lines = reportLines(['a.ts', 'b.ts'], stats, ['b.ts']);
    expect(lines[0]).toMatch(/^ {4}\+1\/-1 +1 {2}a\.ts$/);
    expect(lines[1]).toMatch(/^ {2}! \+12\/-5 +12 {2}b\.ts$/);
    expect(lines[2]).toBe('  In all: 2 files, +13/-6, 13 changed lines; 1 over 3 lines.');
  });

  it('names the files docs/fork.md still lists but the fork no longer changes', () => {
    const doc = '`README.md` stays upstream’s.\n## 改了上游的文件\n- `a.ts`, `b.ts`, `packages/mac/package.json`, `fork/own.ts`';
    const upstream = new Set(['README.md', 'a.ts', 'b.ts', 'packages/mac/package.json']);
    expect(stale(['a.ts'], doc, upstream)).toEqual(['b.ts']);
  });
});
