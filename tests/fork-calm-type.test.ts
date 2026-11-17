import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { JUSTIFIED, REMAINING_LIMIT, planSize, planWeight, rewriteType, skipFile, summarize } from '../packages/mac/src/fork/calm/type-scale.js';
import { readdirSync, statSync } from 'node:fs';

/** Every .css under packages/mac/src, with its path relative to src (as fork-calm-glow.test.ts reads them). */
function macCss(dir = path.join('packages', 'mac', 'src'), rel = ''): { rel: string; css: string }[] {
  return readdirSync(dir).flatMap((f) => {
    const abs = path.join(dir, f);
    const r = rel ? `${rel}/${f}` : f;
    if (statSync(abs).isDirectory()) return macCss(abs, r);
    return f.endsWith('.css') ? [{ rel: r, css: readFileSync(abs, 'utf8') }] : [];
  });
}

/**
 * The type scale (M8, BLG-252 and BLG-244; docs/calm/finish.md §3). The tokens are defined only
 * under :root[data-calm], so with calm off nothing here changes what upstream draws.
 */

const mac = path.join('packages', 'mac', 'src');
const read = (...parts: string[]): string => readFileSync(path.join(mac, ...parts), 'utf8');

/** The declarations of a rule whose selector is exactly `selector`. */
const declsOf = (css: string, selector: string): Record<string, string> => {
  const body = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const m = new RegExp(`${selector.replace(/[[\]()]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(body);
  const out: Record<string, string> = {};
  for (const d of (m?.[1] ?? '').split(';')) {
    const [k, ...v] = d.split(':');
    if (k && v.length) out[k.trim()] = v.join(':').trim();
  }
  return out;
};

describe('calm-type.css: the scale', () => {
  const css = read('fork', 'calm', 'calm-type.css');
  const decls = declsOf(css, ':root[data-calm]');

  it('defines eight size steps in rem, rising, at a 13px base', () => {
    const steps = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => decls[`--calm-fs-${i}`]);
    expect(steps).toEqual(['0.77rem', '0.846rem', '0.923rem', '1rem', '1.154rem', '1.385rem', '1.692rem', '2.154rem']);
    const px = steps.map((s) => Math.round(Number.parseFloat(s!) * 13));
    expect(px).toEqual([10, 11, 12, 13, 15, 18, 22, 28]);
    expect([...px].sort((a, b) => a - b)).toEqual(px);
  });

  it('defines five relative (em) steps, rising', () => {
    const em = [1, 2, 3, 4, 5].map((i) => decls[`--calm-fs-em-${i}`]);
    expect(em).toEqual(['0.8em', '0.86em', '0.92em', '1.1em', '1.2em']);
  });

  it('defines four weights', () => {
    expect([decls['--calm-fw-regular'], decls['--calm-fw-medium'], decls['--calm-fw-semibold'], decls['--calm-fw-bold']]).toEqual(['400', '500', '600', '700']);
  });

  it('is gated: nothing outside :root[data-calm]', () => {
    const body = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const selectors = [...body.matchAll(/([^{}]+)\{/g)].map((m) => m[1]!.trim());
    expect(selectors).toEqual([':root[data-calm]']);
  });

  it('is imported by calm.css', () => {
    expect(read('fork', 'calm', 'calm.css')).toContain("@import './calm-type.css';");
  });
});

describe('type-scale: the rewrite', () => {
  it('maps px and rem to the nearest step, and an exact middle to the smaller one', () => {
    expect(planSize('12px')).toEqual({ token: '--calm-fs-3', fallback: '12px' });
    expect(planSize('0.9rem')).toEqual({ token: '--calm-fs-3', fallback: '0.9rem' });
    expect(planSize('13px')).toEqual({ token: '--calm-fs-4', fallback: '13px' });
    expect(planSize('11.5px')).toEqual({ token: '--calm-fs-3', fallback: '11.5px' });
    // 12.5px is 0.5 from 12 and 0.5 from 13 at a 13px base: the smaller step is not nearer, so 13 wins by a hair.
    expect(planSize('12.5px')).toEqual({ token: '--calm-fs-4', fallback: '12.5px' });
  });

  it('keeps em, percentages, calc, custom properties, shorthands and out-of-range sizes', () => {
    for (const v of ['90%', 'calc(1rem + 2px)', 'var(--control-text)', 'inherit', '8px', '34px', '0.42em', '1.35em', '1em']) expect('keep' in planSize(v)).toBe(true);
  });

  it('maps em to the nearest of five relative steps when one is within 0.05em, and keeps the rest', () => {
    expect(planSize('0.78em')).toEqual({ token: '--calm-fs-em-1', fallback: '0.78em' });
    expect(planSize('0.85em')).toEqual({ token: '--calm-fs-em-2', fallback: '0.85em' });
    expect(planSize('0.94em')).toEqual({ token: '--calm-fs-em-3', fallback: '0.94em' });
    expect(planSize('1.12em')).toEqual({ token: '--calm-fs-em-4', fallback: '1.12em' });
    expect(planSize('1.22em')).toEqual({ token: '--calm-fs-em-5', fallback: '1.22em' });
    expect(planSize('1.05em')).toEqual({ keep: 'em outside the steps (1.05em)' });
  });

  it('maps weights by range and keeps what is outside 400–800', () => {
    expect(planWeight('600')).toEqual({ token: '--calm-fw-semibold', fallback: '600' });
    expect(planWeight('650')).toEqual({ token: '--calm-fw-semibold', fallback: '650' });
    expect(planWeight('550')).toEqual({ token: '--calm-fw-medium', fallback: '550' });
    expect(planWeight('700')).toEqual({ token: '--calm-fw-bold', fallback: '700' });
    expect(planWeight('900')).toEqual({ keep: 'outside 400–800 (900)' });
    expect(planWeight('inherit')).toEqual({ keep: 'custom property or inherit' });
  });

  it('wraps each mapped value with its original as the fallback, and keeps !important', () => {
    const out = rewriteType('.a { font-size: 0.9rem !important; font-weight: 650; }', 'x/a.module.css');
    expect(out.code).toBe('.a { font-size: var(--calm-fs-3, 0.9rem) !important; font-weight: var(--calm-fw-semibold, 650); }');
    expect(out.mapped).toBe(2);
  });

  it('with the variables undefined, every rewrite draws the original value (fallback equivalence, all mac CSS)', () => {
    let checked = 0;
    for (const { rel, css } of macCss()) {
      if (skipFile(rel)) continue;
      const out = rewriteType(css, rel);
      // Unwrap every var(--calm-fs-N | --calm-fw-N, X) to X: what is left must be the original text, byte for byte.
      const unwrapped = out.code.replace(/var\(--calm-f[sw]-[\w-]+, ([^()]*)\)/g, '$1');
      expect(unwrapped).toBe(css);
      checked += out.mapped;
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it('skips the fork, the global styles and the keep-decor scenes', () => {
    for (const f of ['fork/calm/calm.css', 'styles/tokens.css', 'onboarding/scenes/scenes.module.css', 'components/reactbits/GlassSurface.css', 'call/notes.module.css', 'components/YourCard.module.css', 'sentinel/numbers.module.css', 'components/views/views.module.css', 'views/usage/usage.module.css']) {
      expect(skipFile(f)).toBe(f !== 'views/usage/usage.module.css');
    }
  });
});

describe('type-scale: the numbers (docs/calm/finish.md §3.3)', () => {
  // The same summary the build prints at buildEnd (type-plugin.ts): the processed files only, skipped ones are not counted.
  const processed = macCss().filter(({ rel }) => !skipFile(rel));
  const report = summarize(processed.map(({ rel, css }) => rewriteType(css, rel)));

  it('reports the spellings before and after, and one number for the limit', () => {
    console.log(`type-scale: ${report.decls} decls in ${processed.length} files; spellings ${report.spellingsBefore} → ${report.spellingsAfter} (tokens ${report.tokens}, kept ${report.kept.length} of which ${report.justified} justified); remaining against the limit: ${report.remaining}`);
    expect(report.decls).toBeGreaterThan(2000);
    expect(report.spellingsAfter).toBeLessThan(report.spellingsBefore * 0.5);
  });

  it('keeps the remaining spellings (calm tokens plus kept values on no exception list) within the design limit of 25', () => {
    expect(REMAINING_LIMIT).toBe(25);
    expect(report.unjustified).toEqual([]);
    expect(report.remaining).toBeLessThanOrEqual(25);
  });

  it('gives every kept value a reason, and keeps no exception on the list that the rewrite no longer leaves', () => {
    expect(report.kept.every((k) => k.why.length > 0)).toBe(true);
    const stale = [...JUSTIFIED.keys()].filter((k) => !report.kept.some((x) => `${x.prop} ${x.value}` === k));
    expect(stale).toEqual([]);
  });
});
