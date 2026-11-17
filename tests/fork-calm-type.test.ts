import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

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
