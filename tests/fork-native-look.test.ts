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
    const upstream = new Set([...classes(read('components', 'ui.module.css')), ...classes(read('layout', 'BranchControl.module.css')), ...classes(read('layout', 'panel', 'panel.module.css'))]);
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

  it('is loaded by the fork’s overlay, not by an upstream file', () => {
    expect(read('fork', 'calm', 'index.ts')).toContain("import '../native/native-look.css';");
  });
});
