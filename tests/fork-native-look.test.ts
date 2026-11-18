import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The fork's Mac-native touches (packages/mac/src/fork/native/native-look.css) hang on upstream's
 * class names and attributes. After a sync that renames one, this fails and names it, instead of
 * the blue Create PR or the underlined dock tab quietly coming back.
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

  it('finds every class Liquid Glass anchors on, and the attributes that switch it', () => {
    const glass = read('fork', 'native', 'liquid-glass.css');
    const upstream = new Set(
      [
        ['layout', 'Shell.module.css'],
        ['layout', 'Sidebar.module.css'],
        ['layout', 'Toolbar.module.css'],
        ['layout', 'panel', 'panel.module.css'],
        ['components', 'ui.module.css'],
        ['layout', 'SidebarSearch.module.css'],
        ['views', 'overview', 'filter-bar.module.css'],
        ['components', 'form.module.css'],
      ].flatMap((parts) => [...classes(read(...parts))]),
    );
    expect(anchorsIn(glass).filter((name) => !upstream.has(name))).toEqual([]);
    // Only a Mac with transparency on: lib/prefs.ts sets both.
    const prefs = read('lib', 'prefs.ts');
    expect(prefs).toContain('root.dataset.os = keyPlatform();');
    expect(prefs).toContain("root.dataset.glass = reduce ? 'off' : 'on';");
    expect(glass.replace(/\/\*[\s\S]*?\*\//g, '').match(/^[^@\s{}][^{]*\{/gm)?.every((rule) => rule.includes(":root[data-os='mac'][data-glass='on']"))).toBe(true);
    expect(read('layout', 'Sidebar.tsx')).toContain('<nav ref={drop.ref} className={cx(s.sidebar');
    // The floating sidebar is found by the attribute fork/sidebar puts on it (it sits in a wrapper).
    expect(read('fork', 'sidebar', 'one-selected.ts')).toContain("nav.setAttribute('data-fork-sidebar', '');");
  });

  it('is loaded by the fork’s overlay, not by an upstream file', () => {
    const index = read('fork', 'calm', 'index.ts');
    expect(index).toContain("import '../native/native-look.css';");
    expect(index).toContain("import '../native/liquid-glass.css';");
  });
});
