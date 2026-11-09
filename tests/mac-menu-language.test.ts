import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// Through a variable: the root typecheck can't follow the Mac app's @beluga paths (its own tsc checks the file).
const MODULE = '../packages/mac/src/lib/menu-language.js';
const { menuLabels, menuWord } = (await import(MODULE)) as { menuLabels: () => Record<string, string>; menuWord: (w: string) => string };
import { menu } from '../packages/mac/src/i18n/en/menu.js';

const src = readFileSync('packages/mac/src-tauri/src/menu.rs', 'utf8');
const all = (re: RegExp): [string, string][] => [...src.matchAll(re)].map((m) => [m[1]!, m[2]!]);

/** The menu bar's and the tray's words go to menu.rs by id (lib/menu-language.ts), English exactly as it builds them. */
describe('the native menus’ words', () => {
  it('has every menu-bar item, menu and standard item, in menu.rs’s English', () => {
    const items = all(/item\(\s*app,\s*"([a-z-]+)",\s*"([^"]+)"/g).filter(([id]) => id !== 'ws-finder');
    const submenus = all(/with_id_and_items\(\s*app,\s*"(submenu\.[a-z]+)",\s*"([^"]+)"/g);
    const standard = all(/pre\(\s*"(predefined\.[a-z-]+)",\s*PredefinedMenuItem::(\w+)/g);
    expect(submenus.length).toBe(9);
    expect(standard.length).toBe(14);
    const words: Record<string, string> = menu;
    for (const [id, english] of [...items, ...submenus]) expect([id, words[`menu.${id}`]]).toEqual([id, english]);
    for (const [id] of standard) expect(words[`menu.${id}`]).toBeTruthy();
  });

  it('has the tray’s words, as menu.rs falls back to them', () => {
    const labels = menuLabels();
    for (const [id, english] of all(/tr\(\s*"([a-z.-]+)",\s*"([^"]+)"\)/g)) expect([id, labels[id]]).toEqual([id, english]);
  });

  it('leaves Run to the menu state, and names it there', () => {
    expect(menuLabels()['ws-run']).toBeUndefined();
    expect(menu['menu.ws-run']).toBe('Run');
    expect(menuWord('Stop Running')).toBe('Stop Running');
    expect(menuWord('Something else')).toBe('Something else');
  });
});
