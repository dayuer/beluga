import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/** fork/calm/calm-tabs.css: the right panel's views keep a fixed width under calm mode. */

const mac = path.join('packages', 'mac', 'src');
const read = (...parts: string[]): string => readFileSync(path.join(mac, ...parts), 'utf8');
const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

describe('calm-tabs.css', () => {
  const css = stripComments(read('fork', 'calm', 'calm-tabs.css'));

  it('is calm-gated and imported by calm.css', () => {
    const selectors = [...css.matchAll(/([^{}]+)\{/g)].flatMap((m) => m[1]!.split(',').map((x) => x.trim()));
    expect(selectors.length).toBeGreaterThan(0);
    expect(selectors.filter((sel) => !sel.startsWith(':root[data-calm]'))).toEqual([]);
    expect(read('fork', 'calm', 'calm.css')).toContain("@import './calm-tabs.css';");
  });

  it('anchors on classes the panel module still defines, and the strip is still a tablist', () => {
    const anchors = [...new Set([...css.matchAll(/\[class\*='_([A-Za-z][\w-]*)_'\]/g)].map((m) => m[1]!))].sort();
    expect(anchors).toEqual(['tab', 'tabOn', 'tabs', 'tabsFolded']);
    const panel = read('layout', 'panel', 'panel.module.css');
    for (const name of anchors) expect(panel).toMatch(new RegExp(`\\.${name}\\b`));
    expect(read('layout', 'RightPanel.tsx')).toContain('role="tablist"');
  });

  it('gives each tab its own width instead of a share of the strip', () => {
    expect(css).toMatch(/width:\s*auto/);
    expect(css).toMatch(/flex:\s*0 0 auto/);
  });
});
