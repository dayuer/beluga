import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { THEMES, allThemesCss, contrast, derived, isSolid, mix, themeAnsi, themeCss, themeFor, themeIdOf, themePatch } from '../packages/mac/src/lib/themes.js';
import { TERMINAL_PRESETS } from '../packages/mac/src/lib/terminal-themes.js';

const picked = { lightTheme: 'light', darkTheme: 'dark' };

describe('the window themes (BLG-696)', () => {
  it('has unique ids, Light and Dark first-class, and a terminal theme that exists for each one that names it', () => {
    const ids = THEMES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining(['light', 'dark', 'super-dark', 'oled', 'dracula', 'mocha', 'latte']));
    for (const t of THEMES) if (t.term) expect(TERMINAL_PRESETS.map((p) => p.name)).toContain(t.term);
  });

  it.each(THEMES.map((t) => [t.name, t] as const))('%s is readable', (_, t) => {
    const k = t.colors;
    for (const surface of [k.bg, k.raised, k.sidebar]) {
      // 6: the well-known themes' own text sits at 6–7 (Latte, Frappé, Dawn), well over WCAG's 4.5.
      expect(contrast(k.text, surface), `text on ${surface}`).toBeGreaterThanOrEqual(6);
      expect(contrast(k.text2, surface), `secondary text on ${surface}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(k.text3, surface), `faint text on ${surface}`).toBeGreaterThanOrEqual(2.4);
    }
    for (const state of [k.ok, k.warn, k.error, k.info, k.claude]) expect(contrast(state, k.bg), `${state} on ${k.bg}`).toBeGreaterThanOrEqual(2.4);
  });

  it('keeps Light and Dark’s previews true to tokens.css', () => {
    const css = readFileSync('packages/mac/src/styles/tokens.css', 'utf8');
    for (const base of ['light', 'dark'] as const) {
      const block = css.slice(css.indexOf(`:root[data-theme='${base}']`));
      const t = THEMES.find((th) => th.id === base)!;
      expect(block).toContain(`--bg: ${t.colors.bg};`);
      expect(block).toContain(`--text: ${t.colors.text};`);
      expect(block).toContain(`--bg-sidebar-solid: ${t.colors.sidebar};`);
    }
  });

  it('writes a theme over its base, opaque, with its accent and P3 colours where the screen has them', () => {
    const oled = themeCss(THEMES.find((t) => t.id === 'oled')!);
    expect(oled).toContain(":root[data-theme='dark'][data-palette='oled'] {");
    expect(oled).toContain('--bg: #000000;');
    expect(oled).toContain('--bg-sidebar: #000000;');
    // On black a shadow can't show: what sits on it is lifted a hair and edged in light.
    expect(oled).toContain('--bg-raised: #111114;');
    expect(oled).toMatch(/--shadow-pop: 0 0 0 0\.5px rgba\(255, 255, 255, [0-9.]+\), inset/);
    expect(oled).toContain('--rim: inset 0 0.5px 0');
    expect(themeCss(THEMES.find((t) => t.id === 'dracula')!)).not.toContain('--rim');
    expect(oled).toContain('--theme-accent: #3fb4ff;');
    expect(oled).toMatch(/@media \(color-gamut: p3\) \{[\s\S]*--theme-accent: color\(display-p3/);
    expect(allThemesCss()).not.toContain("[data-palette='dark']");
    expect(isSolid(THEMES.find((t) => t.id === 'dark')!)).toBe(false);
    expect(isSolid(THEMES.find((t) => t.id === 'oled')!)).toBe(true);
  });

  it('repaints every colour tokens.css sets for Light and Dark, in every theme', () => {
    const css = readFileSync('packages/mac/src/styles/tokens.css', 'utf8');
    const block = (base: string): string[] => {
      const start = css.indexOf(`:root[data-theme='${base}'] {`);
      const body = css.slice(start, css.indexOf('\n}', start));
      return [...body.matchAll(/^\s*(--[\w-]+):/gm)].map((m) => m[1]!);
    };
    // Not a theme's to give: the selection is made from the accent, the words on a red face are
    // white or the page, the dot floor is a shade, and --bg-sidebar is written from `sidebar`. The
    // overlays (hover, press, hairlines, the pop's shadow) are black or white over whatever is under
    // them, right on any theme of their base; a theme gives its own only where they vanish (OLED).
    const overlays = ['--bg-hover', '--bg-press', '--hairline', '--hairline-strong', '--shadow-pop'];
    const notThemes = new Set(['--bg-selected', '--on-error-fill', '--dot-floor', '--bg-sidebar', ...overlays]);
    const written = new Set(themeCss(THEMES.find((t) => t.id === 'nord')!).match(/--[\w-]+(?=:)/g));
    for (const base of ['light', 'dark']) for (const token of block(base)) if (!notThemes.has(token)) expect(written, `${token} (${base})`).toContain(token);
  });

  it('makes Merge, a call and a Delete button from each theme’s own colours', () => {
    // Light and Dark keep tokens.css's hand-set ones.
    const css = readFileSync('packages/mac/src/styles/tokens.css', 'utf8');
    for (const base of ['light', 'dark'] as const) {
      const block = css.slice(css.indexOf(`:root[data-theme='${base}']`));
      const d = derived(THEMES.find((t) => t.id === base)!);
      expect(block).toContain(`--merge: ${d.merge};`);
      expect(block).toContain(`--call: ${d.call};`);
      expect(block).toContain(`--call-ink: ${d.callInk};`);
    }
    for (const t of THEMES) {
      const d = derived(t);
      expect(contrast('#ffffff', d.merge), `Merge's words on ${t.name}`).toBeGreaterThanOrEqual(3.6);
      expect(contrast('#ffffff', d.errorFill), `Delete's words on ${t.name}`).toBeGreaterThanOrEqual(3.6);
      expect(contrast(d.callInk, t.colors.bg), `a call's words on ${t.name}`).toBeGreaterThanOrEqual(3);
    }
    const dracula = themeCss(THEMES.find((t) => t.id === 'dracula')!);
    expect(dracula).toContain(`--merge: ${derived(THEMES.find((t) => t.id === 'dracula')!).merge};`);
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
  });

  it('draws a step’s output in the theme’s terminal colours, but not its black, white or ones that don’t read', () => {
    const dracula = THEMES.find((t) => t.id === 'dracula')!;
    const css = themeCss(dracula);
    expect(css).toContain('--theme-ansi-1: #ff5555;');
    expect(css).toContain('--theme-ansi-14: #a4ffff;');
    for (const i of [0, 7, 8, 15]) expect(css).not.toContain(`--theme-ansi-${i}:`);
    for (const t of THEMES) for (const c of themeAnsi(t) ?? []) if (c) expect(contrast(c, t.colors.code), `${c} on ${t.name}`).toBeGreaterThanOrEqual(3);
    // No terminal theme of its own: Beluga's colours (the stylesheets' fallbacks).
    expect(themeAnsi(THEMES.find((t) => t.id === 'one-dark')!)).toBeUndefined();
    const steps = readFileSync('packages/mac/src/chat/steps/steps.module.css', 'utf8');
    expect(steps).toMatch(/--ansi-1: var\(--theme-ansi-1, #[0-9a-f]{6}\);/);
    expect(steps).toMatch(/--ansi-0: #[0-9a-f]{6};/);
  });

  it('falls back to Light or Dark for an unknown theme or one of the other base', () => {
    expect(themeIdOf('dracula', 'dark')).toBe('dracula');
    expect(themeIdOf('dracula', 'light')).toBe('light');
    expect(themeIdOf('gone', 'dark')).toBe('dark');
    expect(themeIdOf(undefined, 'light')).toBe('light');
    expect(themeFor('dark', { ...picked, darkTheme: 'oled' }).id).toBe('oled');
    expect(themeFor('light', { ...picked, darkTheme: 'oled' }).id).toBe('light');
  });

  it('shows a picked theme at once, with its own accent when you had the system’s', () => {
    expect(themePatch('dracula', { appearance: 'light', accent: 'system' }, 'light')).toEqual({ darkTheme: 'dracula', appearance: 'dark', accent: 'theme' });
    expect(themePatch('dracula', { appearance: 'system', accent: 'rose' }, 'dark')).toEqual({ darkTheme: 'dracula' });
    expect(themePatch('super-dark', { appearance: 'dark', accent: 'system' }, 'dark')).toEqual({ darkTheme: 'super-dark' });
    expect(themePatch('latte', { appearance: 'dark', accent: 'theme' }, 'dark')).toEqual({ lightTheme: 'latte', appearance: 'light' });
    expect(themePatch('nope', { appearance: 'dark', accent: 'system' }, 'dark')).toEqual({});
  });
});
