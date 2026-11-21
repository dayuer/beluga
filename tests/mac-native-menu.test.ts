import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { keyEquivalentOf, nativeItems } from '../packages/mac/src/lib/native-menu-model.js';

describe('native menus (Mac)', () => {
  it('turns the app’s shortcuts into NSMenu key equivalents', () => {
    expect(keyEquivalentOf('⌘J')).toEqual({ key: 'j', modifiers: 1 });
    expect(keyEquivalentOf('⇧⌘C')).toEqual({ key: 'c', modifiers: 3 });
    expect(keyEquivalentOf('⌥⌘1')).toEqual({ key: '1', modifiers: 5 });
    expect(keyEquivalentOf('⌘↩')).toEqual({ key: '\r', modifiers: 1 });
    expect(keyEquivalentOf('⌘⌫')).toEqual({ key: '\b', modifiers: 1 });
    expect(keyEquivalentOf('⌃⌘,')).toEqual({ key: ',', modifiers: 9 });
    expect(keyEquivalentOf('⌘F5')).toEqual({ key: String.fromCharCode(0xf708), modifiers: 1 });
    expect(keyEquivalentOf('⌘↑')).toEqual({ key: '\uF700', modifiers: 1 });
  });

  it('shows no shortcut rather than a wrong one', () => {
    expect(keyEquivalentOf(undefined)).toBeUndefined();
    expect(keyEquivalentOf('')).toBeUndefined();
    // No modifier: a menu item's key equivalent would fire on the bare key.
    expect(keyEquivalentOf('↩')).toBeUndefined();
    expect(keyEquivalentOf('Space')).toBeUndefined();
    expect(keyEquivalentOf('⌘☃')).toBeUndefined();
    expect(keyEquivalentOf('Opens the project')).toBeUndefined();
  });

  it('builds the menu: groups, sections, hints, checkmarks, submenus, and an id for each action', async () => {
    const ran: string[] = [];
    const go = (name: string) => () => void ran.push(name);
    const picks: Array<() => void> = [];
    const items = await nativeItems(
      [
        { label: 'Rename', keys: '⌘R', icon: 'file', onSelect: go('rename') },
        { label: 'Make Private', hint: 'Only you', onSelect: go('private') },
        { label: 'Move to', submenu: [{ label: 'Work', checked: true, onSelect: go('work') }] },
        { label: 'Blue', header: 'Colour', swatch: '#00f', onSelect: go('blue') },
        { label: 'Trust', hint: 'Trusted', disabled: true },
        { label: 'Delete', danger: true, onSelect: go('delete') },
      ],
      (text) => `«${text}»`,
      async (p) => (p ? { png: [1], template: !('swatch' in p) } : undefined),
      picks,
    );
    expect(items).toEqual([
      { kind: 'item', id: 0, text: '«Rename»', enabled: true, key: 'r', modifiers: 1, icon: [1], template: true },
      { kind: 'item', id: 1, text: '«Make Private»', enabled: true, subtitle: '«Only you»' },
      { kind: 'item', text: '«Move to»', enabled: true, items: [{ kind: 'item', id: 2, text: '«Work»', enabled: true, checked: true }] },
      { kind: 'separator' },
      { kind: 'header', text: '«Colour»' },
      { kind: 'item', id: 3, text: '«Blue»', enabled: true, icon: [1], template: false },
      { kind: 'item', text: '«Trust»', enabled: false, subtitle: '«Trusted»' },
      { kind: 'separator' },
      { kind: 'item', id: 4, text: '«Delete»', enabled: true },
    ]);
    for (const pick of picks) pick();
    expect(ran).toEqual(['rename', 'private', 'work', 'blue', 'delete']);
  });
});

describe('the press cursor', () => {
  const root = path.join(import.meta.dirname, '../packages/mac/src');
  const css = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? css(path.join(dir, e.name)) : e.name.endsWith('.css') ? [path.join(dir, e.name)] : []));

  it('is the arrow on the app’s controls; only links show the hand', () => {
    // A link reads as one by its name, or is one of these (a mention, a task's chip, a file path).
    const linkish = /link|Link|href/;
    const links = new Set(['chat/mention.module.css .pill', 'components/telemetry-levels.module.css .privacy', 'tasks/task-ref.module.css .chip', 'components/code/code.module.css .refPath']);
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
