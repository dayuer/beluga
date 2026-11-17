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

/**
 * Relative sizes (em, of the parent) go onto five steps too, when one is within 0.05em: an em value
 * says "this much smaller than where I sit", and these keep that meaning. Anything further from every
 * step stays as written (BLG-255).
 */
export const EM: readonly { token: string; em: number }[] = [
  { token: '--calm-fs-em-1', em: 0.8 },
  { token: '--calm-fs-em-2', em: 0.86 },
  { token: '--calm-fs-em-3', em: 0.92 },
  { token: '--calm-fs-em-4', em: 1.1 },
  { token: '--calm-fs-em-5', em: 1.2 },
];
const EM_REACH = 0.05;

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
  /** Calm tokens that appear in the rewritten CSS (each is one spelling). */
  tokens: number;
  /** Kept values on the JUSTIFIED list: exceptions, each with its reason. */
  justified: number;
  /** Kept values that are on no list: they count against the limit. */
  unjustified: string[];
  /** Tokens plus the kept values: every distinct spelling left in the processed files. */
  spellingsAfter: number;
  /** What the limit of 25 is measured on: tokens plus the unjustified kept values. */
  remaining: number;
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
  const em = /^(\d*\.?\d+)em$/.exec(v);
  if (em) {
    const n = Number(em[1]);
    let best: (typeof EM)[number] | undefined;
    let bestD = EM_REACH + 1e-9;
    for (const step of EM) {
      const d = Math.abs(step.em - n);
      if (d < bestD - 1e-9) {
        best = step;
        bestD = d;
      }
    }
    return best ? { token: best.token, fallback: v } : { keep: `em outside the steps (${n}em)` };
  }
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

/**
 * Files left out because moving them onto rem steps changed their layout: their sizes are written in px
 * to fit fixed-width tiles, and on rem they grow with the text-size preference. Found by looking at the
 * workspace, tasks, Sentinel and overview pages at text size 16 with calm on and off (finish.md §3.8).
 */
const SKIP_FILES: readonly string[] = [
  'sentinel/numbers.module.css', // the At a glance number tiles: labels and deltas wrap and clip at text size 16
  'components/views/views.module.css', // the tile, table and chart parts those tiles use (tileLabel, tileValue…)
];

/** True for a file (relative to packages/mac/src) the scale must not touch. */
export function skipFile(file: string): boolean {
  const f = file.replace(/\\/g, '/').replace(/^\.?\/?/, '');
  return SKIP_FILES.includes(f) || SKIP_DIRS.some((d) => f.startsWith(d) || f.includes(`/${d}`));
}

/** Rewrites one stylesheet. Returns the new text, what was mapped, and what stayed (with reasons). */
export function rewriteType(css: string, file: string): { code: string; mapped: number; kept: TypeReport['kept']; before: string[]; tokens: string[] } {
  const kept: TypeReport['kept'] = [];
  const before: string[] = [];
  const tokens: string[] = [];
  let mapped = 0;
  const keep = (value: string, prop: 'font-size' | 'font-weight', why: string): void => {
    const hit = kept.find((k) => k.value === value && k.prop === prop);
    if (hit) {
      if (!hit.files.includes(file)) hit.files.push(file);
    } else kept.push({ value, prop, files: [file], why });
  };
  const code = css.replace(/(font-size|font-weight)(\s*:\s*)([^;{}]+?)(\s*!important)?(\s*)(?=[;}])/g, (whole, prop: string, colon: string, raw: string, important: string | undefined, tail: string) => {
    const bang = important ?? '';
    before.push(`${prop} ${raw.trim()}`);
    const plan = prop === 'font-size' ? planSize(raw) : planWeight(raw);
    if ('keep' in plan) {
      keep(raw.trim(), prop as 'font-size' | 'font-weight', plan.keep);
      return whole;
    }
    mapped++;
    tokens.push(plan.token);
    return `${prop}${colon}var(${plan.token}, ${plan.fallback})${bang}${tail}`;
  });
  return { code, mapped, kept, before, tokens };
}

/**
 * The kept values that are exceptions on purpose, each with the reason. A kept value that is on no
 * list counts against the limit of 25 (REMAINING_LIMIT). Keyed by `prop value` as written.
 */
export const JUSTIFIED: ReadonlyMap<string, string> = new Map<string, string>([
  ['font-size clamp(28px, 3.4vw, 40px)', 'fluid size (clamp of vw): it has no fixed step to land on'],
  ['font-size clamp(38px, 5.4vw, 64px)', 'fluid size (clamp of vw): it has no fixed step to land on'],
  ['font-size clamp(1.3rem, 2.4vw, 1.9rem)', 'fluid size (clamp of vw): it has no fixed step to land on'],
  ['font-size clamp(3.4rem, 9vw, 7.5rem)', 'fluid size (clamp of vw): it has no fixed step to land on'],
  ['font-size clamp(1.05rem, 1.6vw, 1.3rem)', 'fluid size (clamp of vw): it has no fixed step to land on'],
  ['font-size clamp(2.6rem, 5.4vw, 5.2rem)', 'fluid size (clamp of vw): it has no fixed step to land on'],
  ['font-size clamp(2.4rem, 4.6vw, 3.6rem)', 'fluid size (clamp of vw): it has no fixed step to land on'],
  ['font-size calc(1em * var(--fit, 1))', 'computed from, or already, a design-system size variable (--control-text…, --fits, --md-size): another token, not a loose value'],
  ['font-size var(--control-text)', 'computed from, or already, a design-system size variable (--control-text…, --fits, --md-size): another token, not a loose value'],
  ['font-size calc(var(--control-text) - 1px)', 'computed from, or already, a design-system size variable (--control-text…, --fits, --md-size): another token, not a loose value'],
  ['font-size var(--md-size)', 'computed from, or already, a design-system size variable (--control-text…, --fits, --md-size): another token, not a loose value'],
  ['font-size var(--control-text-small)', 'computed from, or already, a design-system size variable (--control-text…, --fits, --md-size): another token, not a loose value'],
  ['font-size var(--control-text-large)', 'computed from, or already, a design-system size variable (--control-text…, --fits, --md-size): another token, not a loose value'],
  ['font-size 0.42em', 'em outside the five steps (more than 0.05em from each): a relative size that would change if snapped'],
  ['font-size 0.6em', 'em outside the five steps (more than 0.05em from each): a relative size that would change if snapped'],
  ['font-size 1.05em', 'em outside the five steps (more than 0.05em from each): a relative size that would change if snapped'],
  ['font-size 1.35em', 'em outside the five steps (more than 0.05em from each): a relative size that would change if snapped'],
  ['font-size 1.45em', 'em outside the five steps (more than 0.05em from each): a relative size that would change if snapped'],
  ['font-size 1em', 'em outside the five steps (more than 0.05em from each): a relative size that would change if snapped'],
  ['font-size 2em', 'em outside the five steps (more than 0.05em from each): a relative size that would change if snapped'],
  ['font-size inherit', 'inherit: the size of the parent, nothing to snap'],
  ['font-size 0', 'zero: hides the text, not a size'],
  ['font-size 8.5px', 'below 9px: a hairline label the scale does not cover'],
]);

/** The limit on distinct spellings left after the tokens: tokens plus unjustified kept values (design §3). */
export const REMAINING_LIMIT = 25;

/**
 * One report from the per-file results. The plugin (at buildEnd) and tests/fork-calm-type.test.ts
 * both call this, so the build and the test print the same numbers.
 */
export function summarize(results: readonly { before: string[]; mapped: number; kept: TypeReport['kept']; tokens: string[] }[]): TypeReport {
  const before = new Set<string>();
  const tokens = new Set<string>();
  const kept = new Map<string, TypeReport['kept'][number]>();
  let decls = 0;
  let mapped = 0;
  for (const r of results) {
    decls += r.before.length;
    mapped += r.mapped;
    for (const b of r.before) before.add(b);
    for (const t of r.tokens) tokens.add(t);
    for (const k of r.kept) {
      const key = `${k.prop} ${k.value}`;
      const hit = kept.get(key);
      if (hit) hit.files.push(...k.files.filter((f) => !hit.files.includes(f)));
      else kept.set(key, { ...k, files: [...k.files] });
    }
  }
  const unjustified = [...kept.keys()].filter((k) => !JUSTIFIED.has(k));
  return {
    decls,
    spellingsBefore: before.size,
    mapped,
    kept: [...kept.values()],
    tokens: tokens.size,
    justified: kept.size - unjustified.length,
    unjustified,
    spellingsAfter: tokens.size + kept.size,
    remaining: tokens.size + unjustified.length,
  };
}
