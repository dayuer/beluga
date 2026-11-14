import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The fork's native controls (packages/mac/src/fork/native/) hang on upstream's CSS-module class
 * names and attributes. After a sync that renames one, this fails and names it, instead of the
 * sheets quietly going back to looking like a web page.
 */

const mac = path.join('packages', 'mac', 'src');
const read = (...parts: string[]): string => readFileSync(path.join(mac, ...parts), 'utf8');
const classes = (css: string): Set<string> => new Set([...css.matchAll(/\.([A-Za-z][\w-]*)/g)].map((m) => m[1]!));
const anchorsIn = (css: string): string[] => [...new Set([...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/\[class\*='_([A-Za-z][\w-]*)_'\]/g)].map((m) => m[1]!))];

describe('the native controls’ upstream anchors', () => {
  const look = read('fork', 'native', 'native-controls.css');
  const upstream = new Set(['form.module.css', 'alert.module.css', 'ui.module.css', 'select.module.css'].flatMap((f) => [...classes(read('components', f))]));

  it('finds every class the overlay anchors on', () => {
    const missing = anchorsIn(look).filter((name) => !upstream.has(name));
    expect(missing).toEqual([]);
  });

  it('is loaded with the page and scoped to data-native', () => {
    expect(read('fork', 'boot.ts')).toContain("import './native/index.js'");
    expect(read('main.tsx')).toContain("import './fork/boot.js'");
    const rules = look.replace(/\/\*[\s\S]*?\*\//g, '').split('}').map((r) => r.split('{')[0]!.trim()).filter(Boolean);
    for (const selectors of rules) for (const one of selectors.split(/,(?![^(]*\))/)) expect(one.trim()).toMatch(/^:root\[data-native\]/);
  });

  it('finds the markup the selectors expect', () => {
    const form = read('components', 'FormSheet.tsx');
    expect(form).toContain('<div className={s.buttons}>');
    expect(form).toContain('className={s.controlRow}');
    expect(form).toContain('className={cx(s.input, mono && s.mono, invalid && s.invalid, className)}');
    expect(form).toContain('className={cx(s.input, s.area, mono && s.mono, className)}');
    expect(form).toContain('className={cx(s.button, s.default, destructive && s.destructive)}');
    expect(read('components', 'Alert.tsx')).toContain('<input type="checkbox" className={s.box}');
    const select = read('components', 'Select.tsx');
    expect(select).toContain('data-select-trigger=""');
    expect(select).toContain('<svg className={s.chevrons}');
    const ui = read('components', 'ui.tsx');
    expect(ui).toContain("role={radio ? 'radiogroup' : 'tablist'}");
    expect(ui).toContain('className={cx(s.segment, o.value === value && s.segmentOn, bare && s.segmentIcon)}');
  });

  it('uses only theme tokens for colour', () => {
    const body = look.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(body).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|\b(white|black)\b/i);
  });
});
