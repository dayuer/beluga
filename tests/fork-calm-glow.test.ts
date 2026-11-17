import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { findGlows, rewriteGlow, skipGlowFile, withCalmValues, withoutCalm } from '../packages/mac/src/fork/calm/glow-scan.js';

/**
 * Colored glows (M8 BLG-245 and BLG-256; docs/calm/finish.md §4). A glow is a box-shadow or
 * drop-shadow whose colour is the accent, a status colour or a saturated literal, and whose blur is
 * above 0 or whose spread is above 2px. Neutral shadows, 0.5–2px outlines and insets are not glows.
 *
 * The build rewrites the upstream CSS onto two tokens (type-plugin.ts → glow-scan.ts): a halo's spread
 * becomes `var(--calm-ring, 3px)` and a blurred glow's layer becomes `var(--calm-glow-off, <layer>)`.
 * calm-glow.css defines them under :root[data-calm] only, so calm off draws upstream's own values.
 * What stays is in GLOW_EXCEPTIONS (and the keep-decor directories the rewrite skips), each with a reason.
 */

const mac = path.join('packages', 'mac', 'src');

/** Every .css under packages/mac/src, with its path relative to src. */
export function macCss(dir = mac, rel = ''): { rel: string; css: string }[] {
  return readdirSync(dir).flatMap((f) => {
    const abs = path.join(dir, f);
    const r = rel ? `${rel}/${f}` : f;
    if (statSync(abs).isDirectory()) return macCss(abs, r);
    return f.endsWith('.css') ? [{ rel: r, css: readFileSync(abs, 'utf8') }] : [];
  });
}

/** Glows that stay with calm on, in files the rewrite processes: the file and the start of the layer, with the reason. */
export const GLOW_EXCEPTIONS: ReadonlyArray<{ file: string; match: string; why: string }> = [
  { file: 'components/update.module.css', match: 'inset 0 0 0 100px', why: 'a background tint written as an inset shadow (100px spread, 8% accent): a fill, not a halo' },
];

describe('fork-calm-glow: findGlows', () => {
  it('reads a spread ring and a blur, and skips neutral shadows, outlines and insets', () => {
    expect(findGlows('.a { box-shadow: 0 0 0 5px color-mix(in srgb, var(--accent) 18%, transparent); }')).toHaveLength(1);
    expect(findGlows('.a { box-shadow: 0 0 12px var(--accent); }')).toHaveLength(1);
    expect(findGlows('.a { box-shadow: 0 0 0 2px var(--accent); }')).toHaveLength(0);
    expect(findGlows('.a { box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--accent) 70%, transparent); }')).toHaveLength(0);
    expect(findGlows('.a { box-shadow: 0 2px 8px rgb(0 0 0 / 0.2); }')).toHaveLength(0);
    expect(findGlows('.a { box-shadow: var(--shadow-pop); }')).toHaveLength(0);
    expect(findGlows('.a { filter: drop-shadow(0 0 6px var(--warn)); }')).toHaveLength(1);
  });
});

describe('fork-calm-glow: the rewrite', () => {
  it('puts a halo’s spread on --calm-ring and a blurred glow’s layer on --calm-glow-off, and leaves the other layers alone', () => {
    const halo = rewriteGlow('.a:focus { box-shadow: 0 0 0 0.5px var(--hairline-strong), 0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent); }');
    expect(halo.code).toBe('.a:focus { box-shadow: 0 0 0 0.5px var(--hairline-strong), 0 0 0 var(--calm-ring, 3px) color-mix(in srgb, var(--accent) var(--calm-ring-alpha, 22%), transparent); }');
    expect(halo.rings).toBe(1);
    const glow = rewriteGlow('.b { box-shadow: var(--lift), 0 8px 24px -8px color-mix(in srgb, var(--accent) 40%, transparent) !important; }');
    expect(glow.code).toBe('.b { box-shadow: var(--lift), var(--calm-glow-off, 0 8px 24px -8px color-mix(in srgb, var(--accent) 40%, transparent)) !important; }');
    expect(glow.glows).toBe(1);
  });

  it('leaves neutral shadows, thin outlines and background tints as they are', () => {
    const css = '.a { box-shadow: 0 2px 8px rgb(0 0 0 / 0.2); }\n.b { box-shadow: 0 0 0 2px var(--accent); }\n.c { box-shadow: inset 0 0 0 100px color-mix(in srgb, var(--accent) 8%, transparent); }';
    const out = rewriteGlow(css);
    expect(out.code).toBe(css);
    expect(out.kept).toHaveLength(1);
  });

  it('with calm off (every variable undefined) draws what upstream wrote: unwrapping gives back each file byte for byte', () => {
    let rewritten = 0;
    for (const { rel, css } of macCss()) {
      if (skipGlowFile(rel)) continue;
      const out = rewriteGlow(css);
      expect(withoutCalm(out.code), rel).toBe(css);
      rewritten += out.rings + out.glows;
    }
    expect(rewritten).toBeGreaterThan(50);
  });

  it('with calm on leaves no coloured glow in a processed file, except GLOW_EXCEPTIONS', () => {
    const left: string[] = [];
    for (const { rel, css } of macCss()) {
      if (skipGlowFile(rel)) continue;
      for (const g of findGlows(withCalmValues(rewriteGlow(css).code))) {
        if (!GLOW_EXCEPTIONS.some((e) => e.file === rel && g.value.startsWith(e.match))) left.push(`${rel}:${g.line} ${g.value} (${g.why})`);
      }
    }
    expect(left).toEqual([]);
  });

  it('keeps every exception on the list real: each is still a glow in its file', () => {
    for (const e of GLOW_EXCEPTIONS) {
      const file = macCss().find((f) => f.rel === e.file);
      expect(file, e.file).toBeDefined();
      expect(findGlows(file!.css).some((g) => g.value.startsWith(e.match)), `${e.file} ${e.match}`).toBe(true);
    }
  });
});

describe('fork-calm-glow: the scan', () => {
  it('leaves no coloured glow in fork/** outside GLOW_EXCEPTIONS', () => {
    const offending: string[] = [];
    for (const { rel, css } of macCss()) {
      if (!rel.startsWith('fork/')) continue;
      for (const g of findGlows(css)) {
        const excepted = GLOW_EXCEPTIONS.some((e) => e.file === rel && g.value.includes(e.match));
        if (!excepted) offending.push(`${rel}:${g.line} ${g.value} (${g.why})`);
      }
    }
    expect(offending).toEqual([]);
  });

  it('prints the whole list: every glow in the source, what the rewrite does with it (file:line, value)', () => {
    const rows = macCss().flatMap(({ rel, css }) => findGlows(css).map((g) => `${rel}:${g.line}  ${g.why.padEnd(14)} ${skipGlowFile(rel) ? 'keep-decor ' : g.why.startsWith('blur') ? 'glow-off   ' : 'ring       '} ${g.value}`));
    console.log(`fork-calm-glow: ${rows.length} coloured glows under packages/mac/src\n${rows.join('\n')}`);
    expect(rows.length).toBeGreaterThan(0);
  });
});

describe('fork-calm-glow: calm-glow.css', () => {
  const css = readFileSync(path.join(mac, 'fork', 'calm', 'calm-glow.css'), 'utf8');
  const body = css.replace(/\/\*[\s\S]*?\*\//g, '');

  it('defines the two tokens under :root[data-calm] only, and is imported by calm.css', () => {
    expect(body).toMatch(/:root\[data-calm\] \{[^}]*--calm-ring: 2px;[^}]*--calm-ring-alpha: 60%;[^}]*--calm-glow-off: 0 0 0 0 transparent;/);
    expect(readFileSync(path.join(mac, 'fork', 'calm', 'calm.css'), 'utf8')).toContain("@import './calm-glow.css';");
  });

  it('is clean by the same rules as fork/calm: gated, no keyframes, no scaling, no motion over 200ms', () => {
    expect(css).not.toMatch(/@keyframes/);
    expect(css).not.toMatch(/scale\(\s*[1-9]/);
    const durations = [...css.matchAll(/(?:transition|animation)[^;]*?(\d*\.?\d+)(ms|s)\b/g)].map((m) => (m[2] === 's' ? Number(m[1]) * 1000 : Number(m[1])));
    expect(durations.every((d) => d <= 200)).toBe(true);
    const selectors = [...body.matchAll(/([^{}]+)\{/g)].map((m) => m[1]!.trim());
    expect(selectors.filter((sel) => !sel.startsWith(':root[data-calm]'))).toEqual([]);
  });
});
