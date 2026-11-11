import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { blocking, compareVersions, onlyVersionChanged, parseNumstat, reportLines, stale, unexplained, versionOf, withVersion } from '../scripts/sync-upstream.mjs';
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
