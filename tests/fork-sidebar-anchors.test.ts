import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { IN_CHAT_SELECTION, SELECTED_CLASS } from '../packages/mac/src/fork/sidebar/one-selected.js';

/**
 * The fork's sidebar look (packages/mac/src/fork/sidebar/) hangs on upstream's class names and
 * attributes. scripts/sync-upstream.mjs only scans fork/calm for stale anchors, so this checks
 * these: after a sync that renames one, this fails and names it, instead of the double highlight
 * and the glowing rows quietly coming back.
 */

const mac = path.join('packages', 'mac', 'src');
const read = (...parts: string[]): string => readFileSync(path.join(mac, ...parts), 'utf8');
const classes = (css: string): Set<string> => new Set([...css.matchAll(/\.([A-Za-z][\w-]*)/g)].map((m) => m[1]!));
const anchorsIn = (css: string): string[] => [...new Set([...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/\[class\*='_([A-Za-z][\w-]*)_'\]/g)].map((m) => m[1]!))];

describe('the sidebar look’s upstream anchors', () => {
  const upstream = new Set([...classes(read('layout', 'Sidebar.module.css')), ...classes(read('layout', 'signal.module.css'))]);

  it('finds every class the overlay anchors on', () => {
    const look = read('fork', 'sidebar', 'sidebar-look.css');
    const missing = anchorsIn(look).filter((name) => !upstream.has(name));
    expect(missing).toEqual([]);
    expect(upstream.has(SELECTED_CLASS.replaceAll('_', ''))).toBe(true);
  });

  it('finds the row, its indent and the chat selection where one-selected.ts expects them', () => {
    const row = read('layout', 'sidebar-parts.tsx');
    expect(row).toContain('role="button"');
    expect(row).toContain('cx(s.row, selected && s.selected');
    // The indent the overlay and the owner rule read: padding-left 8px plus 14 per level.
    expect(row).toContain('paddingLeft: 8 + indent * 14');
    expect(read('layout', 'workspace-row.tsx')).toContain(`'${IN_CHAT_SELECTION}'`);
  });

  it('finds the needs-you edge the overlay draws as a dot', () => {
    const marks = read('layout', 'signal-marks.tsx');
    expect(marks).toContain('<span className={m.edge} data-signal="needs"');
  });
});
