import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * fork/calm/calm-accent.css (M8 §1): the one-solid-action overlay. It only holds if every rule is
 * calm-gated and its anchors still exist upstream; a sync that renames one fails here, naming it.
 */

const mac = path.join('packages', 'mac', 'src');
const read = (...parts: string[]): string => readFileSync(path.join(mac, ...parts), 'utf8');
const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');
const anchorsIn = (css: string): string[] => [...new Set([...stripComments(css).matchAll(/\[class\*='_([A-Za-z][\w-]*)_'\]/g)].map((m) => m[1]!))];
const classes = (css: string): Set<string> => new Set([...css.matchAll(/\.([A-Za-z][\w-]*)/g)].map((m) => m[1]!));

describe('calm-accent.css', () => {
  const css = read('fork', 'calm', 'calm-accent.css');

  it('gates every rule under :root[data-calm]', () => {
    const selectors = [...stripComments(css).matchAll(/([^{}]+)\{/g)].map((m) => m[1]!.trim());
    expect(selectors.length).toBeGreaterThan(0);
    const bare = selectors.flatMap((sel) => sel.split(',').map((s) => s.trim())).filter((sel) => !sel.startsWith(':root[data-calm]'));
    expect(bare).toEqual([]);
  });

  it('finds every upstream class it anchors on, in the module that defines it', () => {
    const home: Record<string, string> = {
      badgeUrgent: read('components', 'ui.module.css'),
      primary: read('components', 'ui.module.css'),
      merge: read('components', 'ui.module.css'),
      chevrons: read('components', 'select.module.css'),
    };
    const names = anchorsIn(css);
    expect(names.sort()).toEqual(['badgeUrgent', 'chevrons', 'merge', 'primary']);
    const missing = names.filter((name) => !classes(home[name]!).has(name));
    expect(missing).toEqual([]);
  });

  it('anchors the needs-you rows on the data attributes the Sentinel home sets', () => {
    expect(css).toContain("[data-need]");
    expect(read('sentinel', 'SentinelHome.tsx')).toContain('data-need={x.key}');
  });

  it('keeps the Talk with friends card findable (the promo card is hidden in BLG-250, not renamed)', () => {
    expect(read('network', 'NetworkSidebar.tsx')).toContain('aria-label="Talk with friends"');
  });

  it('is imported by calm.css', () => {
    expect(read('fork', 'calm', 'calm.css')).toContain("@import './calm-accent.css';");
  });

  it('draws the focus ring as a clear 2px line, not the 3px halo', () => {
    expect(css).toMatch(/--focus-ring: 0 0 0 2px color-mix\(in srgb, var\(--accent\) 75%, transparent\)/);
    expect(css).not.toMatch(/--focus-ring:[^;]*3px/);
  });
});
