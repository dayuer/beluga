import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A sheet opened from Settings sits over the Settings window, not behind it (BLG-213). The wiring
 * is three parts that must agree: Settings marks its window `data-settings`, FormSheet looks that
 * up and sets `data-over-settings` on its overlay and content, and sheet.module.css layers those
 * above Settings (44/45) and below alerts and the palette (50).
 */

const ROOT = path.join(__dirname, '..', 'packages', 'mac', 'src');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
const zOf = (css: string, selector: string) => {
  const m = css.match(new RegExp(`${selector.replace(/[[\]]/g, '\\$&')}\\s*\\{[^}]*z-index:\\s*(\\d+)`));
  return m ? Number(m[1]) : undefined;
};

describe('a sheet opened from Settings', () => {
  it('Settings marks its window, FormSheet looks for the mark and sets data-over-settings', () => {
    expect(read('dialogs/Settings.tsx')).toMatch(/<Dialog\.Content\s+className=\{s\.window\}\s+data-settings=""/);
    const sheet = read('components/FormSheet.tsx');
    expect(sheet).toContain(`document.querySelector('[data-settings]')`);
    expect(sheet).toMatch(/<Dialog\.Overlay className=\{s\.overlay\} data-over-settings=\{overSettings\}/);
    expect(sheet).toMatch(/className=\{cx\(s\.sheet, tall && s\.tall\)\}\s+data-over-settings=\{overSettings\}/);
  });

  it('layers above Settings and below alerts and the palette', () => {
    const css = read('dialogs/sheet.module.css');
    const settings = Math.max(zOf(read('dialogs/settings.module.css'), '.overlay') ?? 0, zOf(read('dialogs/settings.module.css'), '.window') ?? 0);
    const overlay = zOf(css, '.overlay[data-over-settings]');
    const sheet = zOf(css, '.sheet[data-over-settings]');
    expect(overlay).toBeGreaterThan(settings);
    expect(sheet).toBeGreaterThan(overlay!);
    expect(sheet).toBeLessThan(zOf(read('components/alert.module.css'), '.overlay') ?? 50);
    expect(sheet).toBeLessThan(zOf(read('dialogs/palette.module.css'), '.overlay') ?? 50);
  });

  it('Settings opened from the welcome: the sheet goes above the welcome and its Settings window', () => {
    const css = read('dialogs/sheet.module.css');
    const settingsWindow = zOf(read('dialogs/settings.module.css'), '.window[data-over-welcome]') ?? 0;
    const overlay = zOf(css, '.overlay[data-over-welcome]');
    const sheet = zOf(css, '.sheet[data-over-welcome]');
    expect(overlay).toBeGreaterThan(settingsWindow);
    expect(sheet).toBeGreaterThan(overlay!);
    expect(read('components/FormSheet.tsx')).toContain(`settingsWindow?.hasAttribute('data-over-welcome')`);
  });
});
