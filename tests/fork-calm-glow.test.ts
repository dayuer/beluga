import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Colored glows (M8 BLG-245; docs/calm/finish.md §4). A glow is a box-shadow or drop-shadow whose
 * colour is the accent, a status colour or a saturated literal, and whose blur is above 0 or whose
 * spread is above 2px. Neutral shadows, 0.5–2px outlines and insets are not glows. The overlay
 * (fork/calm/calm-glow.css) takes the glows it can reach; the rest are listed in GLOW_EXCEPTIONS
 * with the reason. fork/** must have none outside that list.
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

export interface Glow {
  line: number;
  value: string;
  kind: 'box-shadow' | 'drop-shadow';
  why: string;
}

/** Splits on the commas that are not inside parentheses. */
function layers(value: string): string[] {
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
function lengthsOf(layer: string): number[] {
  return [...stripFns(layer).matchAll(/(?<![\w.-])(-?\d*\.?\d+)(px|rem)?(?![\d.]*%)/g)].map((m) => Number(m[1]) * (m[2] === 'rem' ? 13 : 1));
}

/** Whether one shadow layer is a glow, and why. */
function glowLayer(layer: string, kind: Glow['kind']): string | undefined {
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

/**
 * Glows that stay, with the reason. Keyed by `file` (relative to src) and the first value's text.
 * Upstream files that keep one are the keep-decor list (docs/calm/finish.md §4.2) or the
 * inline/JS-written shadows the overlay cannot reach.
 */
export const GLOW_EXCEPTIONS: ReadonlyArray<{ file: string; match: string; why: string }> = [
  { file: "chat/composer.module.css", match: "0 0 0 3px color-mix(in srgb,", why: "未处理: 非焦点的 3px 光晕，需逐个判定" },
  { file: "chat/edit-prompt.module.css", match: "0 0 0 3px color-mix(in srgb,", why: "未处理: 非焦点的 3px 光晕，需逐个判定" },
  { file: "chat/max.module.css", match: "0 2px 14px color-mix(in srgb", why: "未处理: 大模糊装饰光晕，需决定保留（例外）或改" },
  { file: "chat/max.module.css", match: "0 4px 22px color-mix(in srgb", why: "部分: 鼠标聚焦时仍是原光晕（`:focus`）；键盘聚焦由规则 4 覆盖" },
  { file: "components/form.module.css", match: "0 0 0 3px color-mix(in srgb,", why: "部分: 鼠标聚焦时仍是原光晕（`:focus`）；键盘聚焦由规则 4 覆盖" },
  { file: "components/graph/graph.module.css", match: "0 0 0 5px color-mix(in srgb,", why: "未处理: 非焦点的 3px 光晕，需逐个判定" },
  { file: "components/graph/graph.module.css", match: "0 0 0 5px color-mix(in srgb,", why: "未处理: 非焦点的 3px 光晕，需逐个判定" },
  { file: "components/graph/graph.module.css", match: "0 8px 24px -8px color-mix(in", why: "未处理: 大模糊装饰光晕，需决定保留（例外）或改" },
  { file: "components/graph/graph.module.css", match: "0 0 0 6px color-mix(in srgb,", why: "未处理: 非焦点的 3px 光晕，需逐个判定" },
  { file: "components/graph/graph.module.css", match: "0 0 0 4px color-mix(in srgb,", why: "未处理: 非焦点的 3px 光晕，需逐个判定" },
  { file: "components/graph/graph.module.css", match: "0 1px 2px color-mix(in srgb,", why: "未处理: 大模糊装饰光晕，需决定保留（例外）或改" },
  { file: "components/markdown/code-editor.module.css", match: "0 0 0 3px color-mix(in srgb,", why: "部分: 鼠标聚焦时仍是原光晕（`:focus`）；键盘聚焦由规则 4 覆盖" },
  { file: "components/markdown/code-editor.module.css", match: "0 0 0 3px color-mix(in srgb,", why: "部分: 鼠标聚焦时仍是原光晕（`:focus`）；键盘聚焦由规则 4 覆盖" },
  { file: "components/telemetry-levels.module.css", match: "0 0 0 3px color-mix(in srgb,", why: "未处理: 非焦点的 3px 光晕，需逐个判定" },
  { file: "components/update.module.css", match: "inset 0 0 0 100px color-mix(", why: "未处理: 非焦点的 3px 光晕，需逐个判定" },
  { file: "components/views/views.module.css", match: "0 0 0 3px color-mix(in srgb,", why: "未处理: 非焦点的 3px 光晕，需逐个判定" },
  { file: "components/views/views.module.css", match: "0 0 0 3px color-mix(in srgb,", why: "未处理: 非焦点的 3px 光晕，需逐个判定" },
  { file: "dialogs/env-settings.module.css", match: "0 0 0 3.5px color-mix(in srg", why: "部分: 鼠标聚焦时仍是原光晕（`:focus`）；键盘聚焦由规则 4 覆盖" },
  { file: "dialogs/keyboard.module.css", match: "0 0 0 3px color-mix(in srgb,", why: "未处理: 非焦点的 3px 光晕，需逐个判定" },
  { file: "dialogs/native/person.module.css", match: "0 0 0 3px color-mix(in srgb,", why: "部分: 鼠标聚焦时仍是原光晕（`:focus`）；键盘聚焦由规则 4 覆盖" },
  { file: "dialogs/settings.module.css", match: "0 0 0 3px color-mix(in srgb,", why: "部分: 鼠标聚焦时仍是原光晕（`:focus`）；键盘聚焦由规则 4 覆盖" },
  { file: "dialogs/support.module.css", match: "0 0 0 4px color-mix(in srgb,", why: "未处理: 非焦点的 3px 光晕，需逐个判定" },
  { file: "layout/panel/panel.module.css", match: "0 0 0 3.5px color-mix(in srg", why: "部分: 鼠标聚焦时仍是原光晕（`:focus`）；键盘聚焦由规则 4 覆盖" },
  { file: "network/network.module.css", match: "0 0 0 3px color-mix(in srgb,", why: "部分: 鼠标聚焦时仍是原光晕（`:focus`）；键盘聚焦由规则 4 覆盖" },
  { file: "network/network.module.css", match: "0 0 0 3px color-mix(in srgb,", why: "部分: 鼠标聚焦时仍是原光晕（`:focus`）；键盘聚焦由规则 4 覆盖" },
  { file: "network/network.module.css", match: "0 0 0 3px color-mix(in srgb,", why: "部分: 鼠标聚焦时仍是原光晕（`:focus`）；键盘聚焦由规则 4 覆盖" },
  { file: "network/network.module.css", match: "0 0 0 3px color-mix(in srgb,", why: "部分: 鼠标聚焦时仍是原光晕（`:focus`）；键盘聚焦由规则 4 覆盖" },
  { file: "network/network.module.css", match: "0 0 0 3px color-mix(in srgb,", why: "部分: 鼠标聚焦时仍是原光晕（`:focus`）；键盘聚焦由规则 4 覆盖" },
  { file: "onboarding/onboarding.module.css", match: "0 10px 30px -10px color-mix(", why: "未处理: 大模糊装饰光晕，需决定保留（例外）或改" },
  { file: "onboarding/onboarding.module.css", match: "0 0 10px var(--claude)", why: "未处理: 大模糊装饰光晕，需决定保留（例外）或改" },
  { file: "onboarding/onboarding.module.css", match: "0 18px 40px -18px color-mix(", why: "未处理: 大模糊装饰光晕，需决定保留（例外）或改" },
  { file: "onboarding/onboarding.module.css", match: "inset 0 0 0 4px var(--accent", why: "未处理: 非焦点的 3px 光晕，需逐个判定" },
  { file: "onboarding/onboarding.module.css", match: "0 0 0 3px color-mix(in srgb,", why: "未处理: 非焦点的 3px 光晕，需逐个判定" },
  { file: "onboarding/onboarding.module.css", match: "inset 0 0 0 4px color-mix(in", why: "未处理: 非焦点的 3px 光晕，需逐个判定" },
  { file: "plans/plan-ask.module.css", match: "0 0 0 3px color-mix(in srgb,", why: "未处理: 非焦点的 3px 光晕，需逐个判定" },
  { file: "plans/plans.module.css", match: "0 10px 28px -14px color-mix(", why: "未处理: 大模糊装饰光晕，需决定保留（例外）或改" },
  { file: "plans/plans.module.css", match: "0 0 0 3px color-mix(in srgb,", why: "未处理: 非焦点的 3px 光晕，需逐个判定" },
  { file: "sentinel/sentinel.module.css", match: "0 0 0 3px color-mix(in srgb,", why: "部分: 鼠标聚焦时仍是原光晕（`:focus`）；键盘聚焦由规则 4 覆盖" },
  { file: "sentinel/sentinel.module.css", match: "0 0 0 3px color-mix(in srgb,", why: "部分: 鼠标聚焦时仍是原光晕（`:focus`）；键盘聚焦由规则 4 覆盖" },
  { file: "tasks/NewTaskSheet.module.css", match: "0 0 0 3.5px hsl(var(--hue) v", why: "未处理: 非焦点的 3px 光晕，需逐个判定" },
  { file: "tasks/tasks.module.css", match: "0 0 0 3px color-mix(in srgb,", why: "部分: 鼠标聚焦时仍是原光晕（`:focus`）；键盘聚焦由规则 4 覆盖" },
  { file: "tasks/tasks.module.css", match: "0 0 0 3px color-mix(in srgb,", why: "部分: 鼠标聚焦时仍是原光晕（`:focus`）；键盘聚焦由规则 4 覆盖" },
  { file: "tasks/tasks.module.css", match: "0 0 0 3px color-mix(in srgb,", why: "部分: 鼠标聚焦时仍是原光晕（`:focus`）；键盘聚焦由规则 4 覆盖" },
  { file: "tasks/tasks.module.css", match: "0 0 0 3px color-mix(in srgb,", why: "部分: 鼠标聚焦时仍是原光晕（`:focus`）；键盘聚焦由规则 4 覆盖" },
  { file: "views/history/history.module.css", match: "0 0 0 3px color-mix(in srgb,", why: "部分: 鼠标聚焦时仍是原光晕（`:focus`）；键盘聚焦由规则 4 覆盖" },
  { file: "views/project-home.module.css", match: "0 0 0 3px color-mix(in srgb,", why: "部分: 鼠标聚焦时仍是原光晕（`:focus`）；键盘聚焦由规则 4 覆盖" },
  { file: "views/shared-search.module.css", match: "0 0 0 3px color-mix(in srgb,", why: "部分: 鼠标聚焦时仍是原光晕（`:focus`）；键盘聚焦由规则 4 覆盖" },
  { file: "views/terminal.module.css", match: "0 0 0 3px color-mix(in srgb,", why: "未处理: 非焦点的 3px 光晕，需逐个判定" },
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

  it('prints the whole list (file:line, value, why) so the status table can be kept current', () => {
    const rows = macCss().flatMap(({ rel, css }) => findGlows(css).map((g) => `${rel}:${g.line}  ${g.why.padEnd(14)} ${g.value}`));
    console.log(`fork-calm-glow: ${rows.length} coloured glows under packages/mac/src\n${rows.join('\n')}`);
    expect(rows.length).toBeGreaterThan(0);
  });
});

describe('fork-calm-glow: calm-glow.css is clean by the same rules as fork/calm', () => {
  const css = readFileSync(path.join(mac, 'fork', 'calm', 'calm-glow.css'), 'utf8');
  it('gates every rule under :root[data-calm], with no keyframes, no scaling and no motion over 200ms', () => {
    expect(css).not.toMatch(/@keyframes/);
    expect(css).not.toMatch(/scale\(\s*[1-9]/);
    const durations = [...css.matchAll(/(?:transition|animation)[^;]*?(\d*\.?\d+)(ms|s)\b/g)].map((m) => (m[2] === 's' ? Number(m[1]) * 1000 : Number(m[1])));
    expect(durations.every((d) => d <= 200)).toBe(true);
    const selectors = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{/g)].map((m) => m[1]!.trim());
    expect(selectors.filter((sel) => !sel.startsWith(':root[data-calm]'))).toEqual([]);
  });
});

describe('fork-calm-glow: the focus and drop rules (calm-glow.css §4–5)', () => {
  const css = readFileSync(path.join(mac, 'fork', 'calm', 'calm-glow.css'), 'utf8');
  it('draws focus on the element only, and leaves error and bad fields alone', () => {
    expect(css).toContain(":root[data-calm] :focus-visible:not([class*='_invalid_']):not([class*='_bad_'])");
    expect(css).not.toMatch(/:focus-within\s*\{/);
  });
  it('anchors the composer drop class on an upstream module', () => {
    expect(readFileSync(path.join(mac, 'chat', 'composer.module.css'), 'utf8')).toMatch(/\.dropping\b/);
  });
});
