/**
 * Finding the coloured glows in the mac CSS, and rewriting them onto calm tokens (M8, BLG-245 and
 * BLG-256; docs/calm/finish.md §4). Pure functions: no DOM, no vite. type-plugin.ts runs rewriteGlow
 * over the upstream CSS at build time (and in dev), the way it runs the type scale.
 *
 * A glow is a box-shadow or drop-shadow whose colour is the accent, a status colour or a saturated
 * literal, and whose blur is above 0 or whose spread is above 2px. Neutral shadows, 0.5–2px outlines
 * and fills are not glows.
 *
 * The rewrite never changes a number: a halo's spread `3px` becomes `var(--calm-ring, 3px)` (and the
 * percentage of its colour-mix becomes `var(--calm-ring-alpha, 22%)`), and a blurred glow's whole layer
 * becomes `var(--calm-glow-off, <the layer>)`. calm-glow.css defines the variables under :root[data-calm]
 * only (2px, 60%, and a transparent no-op layer), so with calm off every fallback is the original and the
 * page draws what upstream wrote.
 */

export interface Glow {
  line: number;
  value: string;
  kind: 'box-shadow' | 'drop-shadow';
  why: string;
}

/** Splits on the commas that are not inside parentheses. */
export function layers(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of value) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const COLOURED = /--(accent|warn|error|success|merged?|claude|busy|live|danger|ok|done|failed|running)\b|#[0-9a-f]{3,8}\b|oklch\(|hsl\(|rgb\(\s*(?!0\s+0\s+0\b)\d/i;
const NEUTRAL = /--(hairline|shadow|control-drop|control-bezel|lift|bg-sunken|text\b)|rgb\(\s*0\s+0\s+0\b|\bblack\b/i;

/** Drops every (…) group, innermost first, so colour functions do not contribute numbers. */
const stripFns = (s: string): string => {
  let prev = '';
  let out = s;
  while (out !== prev) {
    prev = out;
    out = out.replace(/\([^()]*\)/g, ' C ');
  }
  return out;
};

/** The lengths in one shadow layer, in px (rem at 13px); the colour is what is left over once functions are dropped. */
export function lengthsOf(layer: string): number[] {
  return [...stripFns(layer).matchAll(/(?<![\w.-])(-?\d*\.?\d+)(px|rem)?(?![\d.]*%)/g)].map((m) => Number(m[1]) * (m[2] === 'rem' ? 13 : 1));
}

/** Whether one shadow layer is a glow, and why. */
export function glowLayer(layer: string, kind: Glow['kind']): string | undefined {
  const body = layer.replace(/^inset\s+/, '');
  if (!COLOURED.test(body) || NEUTRAL.test(body)) return undefined;
  const nums = lengthsOf(body);
  // box-shadow: x y blur spread; drop-shadow(): x y blur.
  const blur = nums[2] ?? 0;
  const spread = kind === 'box-shadow' ? (nums[3] ?? 0) : 0;
  if (blur > 0) return `blur ${blur}px`;
  if (spread > 2) return `spread ${spread}px`;
  return undefined;
}

/** Every coloured glow in one stylesheet, with its line. Comments are blanked first so their text is not read. */
export function findGlows(css: string): Glow[] {
  const blank = css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  const found: Glow[] = [];
  for (const m of blank.matchAll(/(box-shadow|drop-shadow)\s*\(?\s*:?\s*([^;{}]+)/g)) {
    const kind = m[1] as Glow['kind'];
    const value = m[2]!.replace(/\s+/g, ' ').trim();
    const line = blank.slice(0, m.index ?? 0).split('\n').length;
    if (kind === 'box-shadow' && value.startsWith('none')) continue;
    const parts = kind === 'drop-shadow' ? [`drop-shadow(${value}`] : layers(value);
    for (const p of parts) {
      const why = glowLayer(p.replace(/^drop-shadow\(/, '').replace(/\)\s*$/, ''), kind);
      if (why) found.push({ line, value: p.slice(0, 120), kind, why });
    }
  }
  return found;
}

// ---- the rewrite ---------------------------------------------------------------------------------

/** Files the glow rewrite leaves alone: the fork's own, the global styles, and the keep-decor scenes (docs/calm-ui.md §7.4). */
const SKIP_GLOW_DIRS = ['fork/', 'styles/', 'onboarding/scenes/', 'Wormhole', 'reactbits', 'PixelBurst', 'star-scene', 'call/', 'YourCard'];

export function skipGlowFile(file: string): boolean {
  const f = file.replace(/\\/g, '/').replace(/^\.?\/?/, '');
  return SKIP_GLOW_DIRS.some((d) => f.startsWith(d) || f.includes(`/${d}`));
}

/** Splits a layer on the whitespace outside parentheses. */
function words(layer: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of layer) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (/\s/.test(ch) && depth === 0) {
      if (cur) out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

const isLength = (w: string): boolean => /^-?\d*\.?\d+(px|rem)?$/.test(w);

/** A spread this large is a fill (a tint written as an inset shadow), not a halo. */
const FILL_SPREAD = 50;

export interface GlowRewrite {
  code: string;
  /** Halos whose spread went onto --calm-ring. */
  rings: number;
  /** Blurred glows whose layer went onto --calm-glow-off. */
  glows: number;
  /** Glows left as they are on purpose (a tint, an unrecognised shape), with the layer. */
  kept: string[];
}

/** Rewrites one box-shadow value; the layers that are not glows come back byte for byte. */
function rewriteValue(value: string, counts: { rings: number; glows: number }, kept: string[]): string {
  const parts = layers(value);
  const replace = (layer: string): string => {
    const why = glowLayer(layer, 'box-shadow');
    if (!why) return layer;
    const body = layer.replace(/^inset\s+/, '');
    const nums = lengthsOf(body);
    if ((nums[2] ?? 0) > 0) {
      counts.glows++;
      return `var(--calm-glow-off, ${layer})`;
    }
    if ((nums[3] ?? 0) >= FILL_SPREAD) {
      kept.push(layer);
      return layer;
    }
    // A halo: replace the fourth length (the spread) with the ring token.
    const ws = words(layer);
    let n = 0;
    const next = ws.map((w) => {
      if (isLength(w) && ++n === 4) return `var(--calm-ring, ${w})`;
      // The colour's own percentage rides on --calm-ring-alpha: a ring has to be seen where a halo only glowed.
      return w.replace(/^(color-mix\(in srgb,\s*[^,]+?\s+)(\d+(?:\.\d+)?%)(,\s*transparent\))$/, (_m, a: string, pct: string, z: string) => `${a}var(--calm-ring-alpha, ${pct})${z}`);
    });
    if (n < 4) {
      kept.push(layer);
      return layer;
    }
    counts.rings++;
    return next.join(' ');
  };
  // Keep the text between the layers (commas, newlines, indent) as it was.
  let out = '';
  let cursor = 0;
  for (const layer of parts) {
    const at = value.indexOf(layer, cursor);
    out += value.slice(cursor, at) + replace(layer);
    cursor = at + layer.length;
  }
  return out + value.slice(cursor);
}

/** Rewrites every `box-shadow:` declaration of a stylesheet. Text that is not a glow is untouched. */
export function rewriteGlow(css: string): GlowRewrite {
  const counts = { rings: 0, glows: 0 };
  const kept: string[] = [];
  const code = css.replace(/(box-shadow\s*:\s*)([^;{}]+?)(\s*!important)?(\s*)(?=[;}])/g, (whole, head: string, value: string, bang: string | undefined, tail: string) => {
    const before = counts.rings + counts.glows;
    const next = rewriteValue(value, counts, kept);
    return counts.rings + counts.glows === before ? whole : `${head}${next}${bang ?? ''}${tail}`;
  });
  return { code, rings: counts.rings, glows: counts.glows, kept };
}

/** Replaces each `var(<name>, <fallback>)` with `pick(fallback)`; the fallback may hold parentheses of its own. */
function replaceVar(css: string, name: string, pick: (fallback: string) => string): string {
  const open = `var(${name}, `;
  let out = '';
  let at = 0;
  for (;;) {
    const i = css.indexOf(open, at);
    if (i < 0) return out + css.slice(at);
    let depth = 1;
    let j = i + open.length;
    while (j < css.length && depth > 0) {
      if (css[j] === '(') depth++;
      else if (css[j] === ')') depth--;
      j++;
    }
    out += css.slice(at, i) + pick(css.slice(i + open.length, j - 1));
    at = j;
  }
}

/** What a rewritten stylesheet draws with calm on: the tokens replaced by their calm values (for the test). */
export function withCalmValues(css: string): string {
  return replaceVar(replaceVar(replaceVar(css, '--calm-ring-alpha', () => '60%'), '--calm-ring', () => '2px'), '--calm-glow-off', () => '0 0 0 0 transparent');
}

/** The reverse, for the equivalence test: what the page draws with calm off (every variable undefined). */
export function withoutCalm(css: string): string {
  return replaceVar(replaceVar(replaceVar(css, '--calm-ring-alpha', (f) => f), '--calm-ring', (f) => f), '--calm-glow-off', (f) => f);
}
