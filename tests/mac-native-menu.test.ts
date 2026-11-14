import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { acceleratorOf, nativeFits } from '../packages/mac/src/lib/native-menu-model.js';

describe('native menus (Mac)', () => {
  it('turns the app’s shortcuts into accelerators NSMenu shows', () => {
    expect(acceleratorOf('⌘J')).toBe('Cmd+J');
    expect(acceleratorOf('⇧⌘C')).toBe('Shift+Cmd+C');
    expect(acceleratorOf('⌥⌘1')).toBe('Alt+Cmd+1');
    expect(acceleratorOf('⌘↩')).toBe('Cmd+Enter');
    expect(acceleratorOf('⌘⌫')).toBe('Cmd+Backspace');
    expect(acceleratorOf('⌃⌘,')).toBe('Ctrl+Cmd+,');
    expect(acceleratorOf('⌘F5')).toBe('Cmd+F5');
  });

  it('shows no shortcut rather than a wrong one', () => {
    expect(acceleratorOf(undefined)).toBeUndefined();
    expect(acceleratorOf('')).toBeUndefined();
    // No modifier: a menu item's key equivalent would fire on the bare key.
    expect(acceleratorOf('↩')).toBeUndefined();
    expect(acceleratorOf('Space')).toBeUndefined();
    // Not a key NSMenu knows, or a description.
    expect(acceleratorOf('⌘☃')).toBeUndefined();
    expect(acceleratorOf('Opens the project')).toBeUndefined();
  });

  it('goes native only when nothing a row says is lost', () => {
    const go = () => undefined;
    expect(nativeFits([{ label: 'Rename', onSelect: go }, { label: 'Delete', danger: true, separate: true, onSelect: go }])).toBe(true);
    expect(nativeFits([{ label: 'Blue', swatch: '#00f', checked: true, onSelect: go }, { label: 'Move to', submenu: [{ label: 'Work', icon: 'folder', onSelect: go }], onSelect: go }])).toBe(true);
    // An explanation under an item, or a mark of its own, keeps the web menu.
    expect(nativeFits([{ label: 'Make Private', hint: 'Only you; the team won’t see it', onSelect: go }])).toBe(false);
    expect(nativeFits([{ label: 'Mac mini', mark: {}, onSelect: go }])).toBe(false);
    expect(nativeFits([{ label: 'Move to', submenu: [{ label: 'Work', hint: '3 projects', onSelect: go }], onSelect: go }])).toBe(false);
  });
});

describe('the press cursor', () => {
  const root = path.join(import.meta.dirname, '../packages/mac/src');
  const css = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? css(path.join(dir, e.name)) : e.name.endsWith('.css') ? [path.join(dir, e.name)] : []));

  it('is the arrow on the app’s controls; only links show the hand', () => {
    // A link reads as one by its name, or is one of these (a mention, a task's chip, a file path).
    const linkish = /link|Link|href/;
    const links = new Set(['chat/mention.module.css .pill', 'tasks/task-ref.module.css .chip', 'components/code/code.module.css .refPath']);
    const hands: string[] = [];
    for (const file of css(root)) {
      const text = readFileSync(file, 'utf8');
      for (const rule of text.matchAll(/([^{}]+)\{[^{}]*(?<![-\w])cursor:\s*pointer/g)) {
        const selector = rule[1]!.replace(/\/\*[\s\S]*?\*\//g, '').trim();
        const where = `${path.relative(root, file).split(path.sep).join('/')} ${selector}`;
        if (!linkish.test(selector) && !links.has(where)) hands.push(where);
      }
    }
    expect(hands).toEqual([]);
    const base = readFileSync(path.join(root, 'styles/base.css'), 'utf8');
    expect(base).toMatch(/:root\[data-app='tauri'\]\s*\{\s*--press-cursor:\s*default;/);
  });
});
