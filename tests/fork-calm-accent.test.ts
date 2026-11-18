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
    // Split on the commas outside parentheses: `:not(:disabled, :active)` is one selector.
    const split = (sel: string): string[] => {
      const out: string[] = [];
      let depth = 0;
      let cur = '';
      for (const ch of sel) {
        if (ch === '(') depth++;
        if (ch === ')') depth--;
        if (ch === ',' && depth === 0) (out.push(cur.trim()), (cur = ''));
        else cur += ch;
      }
      return [...out, cur.trim()];
    };
    const bare = selectors.flatMap(split).filter((sel) => !sel.startsWith(':root[data-calm]'));
    expect(bare).toEqual([]);
  });

  it('finds every upstream class it anchors on, in the module that defines it', () => {
    const home: Record<string, string> = {
      badgeUrgent: read('components', 'ui.module.css'),
      iconBadge: read('components', 'ui.module.css'),
      pill_info: read('layout', 'BranchControl.module.css'),
      primary: read('components', 'ui.module.css'),
      merge: read('components', 'ui.module.css'),
      mainError: read('layout', 'BranchControl.module.css'),
      mainMerged: read('layout', 'BranchControl.module.css'),
      primaryError: read('layout', 'Toolbar.module.css'),
      chevrons: read('components', 'select.module.css'),
      footLink: read('tasks', 'tasks.module.css'),
      invite: read('layout', 'Sidebar.module.css'),
      footer: read('layout', 'Sidebar.module.css'),
      sidebarList: read('network', 'network.module.css'),
    };
    const names = anchorsIn(css);
    expect(names.sort()).toEqual(['badgeUrgent', 'chevrons', 'footLink', 'footer', 'iconBadge', 'invite', 'mainError', 'mainMerged', 'merge', 'pill_info', 'primary', 'primaryError', 'sidebarList']);
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

  it('anchors the sidebar’s current-project row on its upstream class (sidebar-look.css, BLG-249)', () => {
    const look = read('fork', 'sidebar', 'sidebar-look.css');
    expect(anchorsIn(look)).toContain('currentProject');
    expect(classes(read('layout', 'Sidebar.module.css')).has('currentProject')).toBe(true);
    expect(look).toContain(":root[data-calm] [data-fork-sidebar] [class*='_currentProject_']:not([class*='_selected_'])");
  });

  it('takes the friends card out of the navigation, and keeps its way back (settings switch, palette command)', () => {
    expect(css).toContain("[role='group'][aria-label='Talk with friends'] {\n  display: none;");
    expect(read('network', 'NetworkSettings.tsx')).toContain('label="Talk with friends directly"');
    expect(read('network', 'net-palette.ts')).toContain("'net:turn-on'");
  });

  it('draws the solid action flat: no gradient, no shadow, and leaves pressed, focused, disabled, the branch button’s error and merged looks, and idle-window states to upstream', () => {
    const rule = /:root\[data-calm\]:not\(\[data-window='idle'\]\) :where\(\[class\*='_primary_'\]\)([^{]*)\{([^}]*)\}/.exec(css);
    expect(rule).not.toBeNull();
    expect(rule![1]).toContain(":not(:disabled, :active, :focus-visible, [class*='_mainError_'], [class*='_mainMerged_'], [class*='_primaryError_'], [class*='_merge_'])");
    expect(rule![2]).toContain('background: var(--control-accent);');
    expect(rule![2]).toContain('box-shadow: none;');
  });

  it('is imported by calm.css', () => {
    expect(read('fork', 'calm', 'calm.css')).toContain("@import './calm-accent.css';");
  });

  it('draws the focus ring as a clear 2px line, not the 3px halo', () => {
    expect(css).toMatch(/--focus-ring: 0 0 0 2px color-mix\(in srgb, var\(--accent\) 75%, transparent\)/);
    expect(css).not.toMatch(/--focus-ring:[^;]*3px/);
  });
});
