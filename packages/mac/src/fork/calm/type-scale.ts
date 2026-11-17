/**
 * The type scale rewrite (M8, BLG-244; docs/calm/finish.md §3). Pure functions: no DOM, no vite.
 * type-plugin.ts runs them over the mac CSS at build time (and in dev, so screenshots show it).
 *
 * A declaration in px or rem between 9px and 30px is moved onto the nearest step of the scale in
 * calm-type.css, and written as `var(--calm-fs-N, <original>)`: with calm off the variable is not
 * defined, the fallback is the original value, and nothing changes. Weights become
 * `var(--calm-fw-…, <original>)`. Anything else (em, %, calc, clamp, inherit, shorthands, existing
 * custom properties, values outside the ranges) is left as it is and listed with a reason.
 */

/** The eight steps: rem, with the px they draw at a 13px base. Ascending. */
export const FS: readonly { token: string; rem: number }[] = [
  { token: '--calm-fs-1', rem: 0.77 },
  { token: '--calm-fs-2', rem: 0.846 },
  { token: '--calm-fs-3', rem: 0.923 },
  { token: '--calm-fs-4', rem: 1 },
  { token: '--calm-fs-5', rem: 1.154 },
  { token: '--calm-fs-6', rem: 1.385 },
  { token: '--calm-fs-7', rem: 1.692 },
  { token: '--calm-fs-8', rem: 2.154 },
];

/** The base the steps are measured against: upstream's root size. */
export const BASE_PX = 13;

/** The weight tokens, by range (inclusive). */
export const FW: ReadonlyArray<{ token: '--calm-fw-regular' | '--calm-fw-medium' | '--calm-fw-semibold' | '--calm-fw-bold'; from: number; to: number }> = [
  { token: '--calm-fw-regular', from: 400, to: 400 },
  { token: '--calm-fw-medium', from: 450, to: 560 },
  { token: '--calm-fw-semibold', from: 590, to: 680 },
  { token: '--calm-fw-bold', from: 700, to: 800 },
];

export interface TypeReport {
  decls: number;
  spellingsBefore: number;
  mapped: number;
  kept: { value: string; prop: 'font-size' | 'font-weight'; files: string[]; why: string }[];
  spellingsAfter: number;
}

/** A value's plan: the token it maps to, or why it stays. */
export type Plan = { token: string; fallback: string } | { keep: string };

const KEEP_PARTS: ReadonlyArray<[RegExp, string]> = [
  [/var\(/, 'custom property'],
  [/calc\(|clamp\(|min\(|max\(/, 'calc/clamp'],
  [/%/, 'percent'],
  [/\bem\b|\d\s*em$/, 'em (relative to the parent)'],
  [/\b(inherit|initial|unset|revert)\b/, 'keyword'],
];

/** Plans one font-size value: a step of FS, or the reason it stays. */
export function planSize(value: string): Plan {
  const v = value.trim();
  for (const [re, why] of KEEP_PARTS) if (re.test(v)) return { keep: why };
  const m = /^(\d*\.?\d+)(px|rem)$/.exec(v);
  if (!m) return { keep: 'other unit or keyword' };
  const px = m[2] === 'px' ? Number(m[1]) : Number(m[1]) * BASE_PX;
  if (px < 9 || px > 30) return { keep: `outside 9–30px (${px}px)` };
  let best = FS[0]!;
  let bestD = Number.POSITIVE_INFINITY;
  for (const step of FS) {
    const d = Math.abs(step.rem * BASE_PX - px);
    // FS ascends and the comparison is strict: an exact middle goes to the smaller step.
    if (d < bestD - 1e-9) {
      best = step;
      bestD = d;
    }
  }
  return { token: best.token, fallback: v };
}

/** Plans one font-weight value: a range of FW, or the reason it stays. */
export function planWeight(value: string): Plan {
  const v = value.trim();
  if (/var\(|inherit|initial|unset|revert/.test(v)) return { keep: 'custom property or inherit' };
  if (v === 'normal') return { token: '--calm-fw-regular', fallback: v };
  if (v === 'bold') return { token: '--calm-fw-bold', fallback: v };
  const n = Number(v);
  if (!Number.isFinite(n)) return { keep: 'keyword or other' };
  const hit = FW.find((r) => n >= r.from && n <= r.to);
  return hit ? { token: hit.token, fallback: v } : { keep: `outside 400–800 (${n})` };
}

/** Files the rewrite never touches: the fork's own CSS, the global styles, and the keep-decor scenes. */
const SKIP_DIRS = ['fork/', 'styles/', 'onboarding/scenes/', 'Wormhole', 'reactbits', 'PixelBurst', 'star-scene', 'call/', 'YourCard'];

/** True for a file (relative to packages/mac/src) the scale must not touch. */
export function skipFile(file: string): boolean {
  const f = file.replace(/\\/g, '/').replace(/^\.?\/?/, '');
  return SKIP_DIRS.some((d) => f.startsWith(d) || f.includes(`/${d}`));
}

/** Rewrites one stylesheet. Returns the new text, what was mapped, and what stayed (with reasons). */
export function rewriteType(css: string, file: string): { code: string; mapped: number; kept: TypeReport['kept'] } {
  const kept: TypeReport['kept'] = [];
  let mapped = 0;
  const keep = (value: string, prop: 'font-size' | 'font-weight', why: string): void => {
    const hit = kept.find((k) => k.value === value && k.prop === prop);
    if (hit) {
      if (!hit.files.includes(file)) hit.files.push(file);
    } else kept.push({ value, prop, files: [file], why });
  };
  const code = css.replace(/(font-size|font-weight)(\s*:\s*)([^;{}]+?)(\s*!important)?(\s*)(?=[;}])/g, (whole, prop: string, colon: string, raw: string, important: string | undefined, tail: string) => {
    const bang = important ?? '';
    const plan = prop === 'font-size' ? planSize(raw) : planWeight(raw);
    if ('keep' in plan) {
      keep(raw.trim(), prop as 'font-size' | 'font-weight', plan.keep);
      return whole;
    }
    mapped++;
    return `${prop}${colon}var(${plan.token}, ${plan.fallback})${bang}${tail}`;
  });
  return { code, mapped, kept };
}
