/**
 * `rgb(…)`, `rgba(…)` or `color(srgb …)` as WebKit computes it → `#rrggbb` (undefined: not a colour it gave).
 * On its own, with no imports, so the root tests can reach it without the Mac's app (native-sheet.ts uses it).
 */
export function hexOf(computed: string): string | undefined {
  const byte = (n: number): string => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0');
  const rgb = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(computed);
  if (rgb) return `#${byte(+rgb[1]!)}${byte(+rgb[2]!)}${byte(+rgb[3]!)}`;
  const srgb = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(computed);
  if (srgb) return `#${byte(+srgb[1]! * 255)}${byte(+srgb[2]! * 255)}${byte(+srgb[3]! * 255)}`;
  return undefined;
}
