import { describe, expect, it } from 'vitest';
import { hexOf } from '../packages/mac/src/lib/hex-colour.js';

/**
 * The Mac's native sheets draw in the page's colours (Settings › Appearance: light or dark, the
 * theme, the accent), not the Mac's own: the page reads them as WebKit computes them and sends
 * them as #rrggbb (lib/hex-colour.ts, used by lib/native-sheet.ts; native_sheet.rs takes them).
 */
describe('hexOf', () => {
  it('reads the colours WebKit computes', () => {
    expect(hexOf('rgb(59, 130, 246)')).toBe('#3b82f6');
    expect(hexOf('rgba(255, 255, 255, 0.5)')).toBe('#ffffff');
    expect(hexOf('rgb(0 117 255)')).toBe('#0075ff');
    // color-mix() comes back in color(srgb …), 0–1.
    expect(hexOf('color(srgb 0.1176 0.1176 0.1294)')).toBe('#1e1e21');
    expect(hexOf('color(srgb 1 1 1 / 0.4)')).toBe('#ffffff');
  });

  it('gives nothing for what is not a colour it can read', () => {
    for (const bad of ['', 'AccentColor', 'var(--accent)', 'color(display-p3 1 0 0)', 'transparent']) expect(hexOf(bad)).toBeUndefined();
  });
});
