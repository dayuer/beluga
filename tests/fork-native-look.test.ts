import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The fork's Mac-native touches (packages/mac/src/fork/native/native-look.css) hang on upstream's
 * class names and attributes. After a sync that renames one, this fails and names it, instead of
 * the blue Create PR quietly coming back.
 */

const mac = path.join('packages', 'mac', 'src');
const read = (...parts: string[]): string => readFileSync(path.join(mac, ...parts), 'utf8');
const classes = (css: string): Set<string> => new Set([...css.matchAll(/\.([A-Za-z][\w-]*)/g)].map((m) => m[1]!));
const anchorsIn = (css: string): string[] => [...new Set([...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/\[class\*='_([A-Za-z][\w-]*)_'\]/g)].map((m) => m[1]!))];

describe('the Mac-native look’s upstream anchors', () => {
  const look = read('fork', 'native', 'native-look.css');

  it('finds every class the overlay anchors on', () => {
    const upstream = new Set(
      [
        ['components', 'ui.module.css'],
        ['layout', 'BranchControl.module.css'],
        ['layout', 'panel', 'panel.module.css'],
        ['views', 'overview.module.css'],
        ['dialogs', 'settings.module.css'],
        ['views', 'project-home.module.css'],
        ['views', 'project', 'main-sync.module.css'],
      ].flatMap((parts) => [...classes(read(...parts))]),
    );
    expect(anchorsIn(look).filter((name) => !upstream.has(name))).toEqual([]);
  });

  it('finds the attributes and markup the rules read', () => {
    const branch = read('layout', 'BranchControl.tsx');
    expect(branch).toContain('data-branch-step={main.id}');
    expect(branch).toContain('data-branch-more={wsId}');
    expect(branch).toContain("'primary'");
    expect(read('views', 'ChatView.tsx')).toContain('<EmptyActions>');
    expect(read('components', 'ui.tsx')).toContain('<div className={s.emptyActions}>{children}</div>');
    expect(read('components', 'ui.tsx')).toContain('{icon ? <Icon name={icon} size={ICON_SIZE[size]} /> : null}');
  });

  it('finds the pages’ markup the 1a–1c rules read', () => {
    expect(read('views', 'Overview.tsx')).toContain('<OverviewHeader sort={prefs.sort} onSort={(sort) => setPrefs({ sort })} />');
    // The header's columns are the rows' own: the same grid as views/overview.module.css's .row.
    const columns = (css: string): string | undefined => /grid-template-columns:\s*([^;]+);/.exec(css)?.[1];
    const row = /\.row \{([^}]*)\}/.exec(read('views', 'overview.module.css'))?.[1] ?? '';
    expect(columns(read('fork', 'native', 'overview-header.module.css'))).toBe(columns(row));
    expect(read('layout', 'BranchControl.tsx')).toContain('data-branch-state={branch.kind}');
    expect(read('layout', 'RightPanel.tsx')).toContain('<div className={s.views}>');
    const settings = read('dialogs', 'Settings.tsx');
    expect(settings).toContain('data-settings-window=""');
    expect(settings).toContain('<Dialog.Close className={s.close} aria-label="Close">');
  });

  it('touches only a Mac: every rule starts with the Mac flag', () => {
    const look = read('fork', 'native', 'native-look.css').replace(/\/\*[\s\S]*?\*\//g, '');
    const selectors = [...look.matchAll(/(?:^|\})\s*([^{}]+)\{/g)].flatMap((m) => {
      const out: string[] = [];
      let depth = 0;
      let cur = '';
      for (const c of m[1]!) {
        if (c === '(') depth++;
        if (c === ')') depth--;
        if (c === ',' && depth === 0) (out.push(cur.trim()), (cur = ''));
        else cur += c;
      }
      return [...out, cur.trim()];
    });
    expect(selectors.length).toBeGreaterThan(20);
    expect(selectors.filter((s) => !s.startsWith(":root[data-os='mac'] "))).toEqual([]);
  });

  it('is loaded by the fork’s own sidebar module, not by an upstream file', () => {
    const index = read('fork', 'sidebar', 'index.ts');
    expect(index).toContain("import '../native/native-look.css';");
  });
});
