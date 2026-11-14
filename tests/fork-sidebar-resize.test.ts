import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN, SIDEBAR_STEP, clampSidebarWidth, stepSidebarWidth, widestSidebar, widthAtPointer } from '../packages/mac/src/fork/sidebar/resize-model.js';
import { CENTER_MIN } from '../packages/mac/src/lib/panel-model.js';
import { DEFAULT_PREFS } from '../packages/mac/src/lib/prefs.js';

/** The sidebar's draggable edge (packages/mac/src/fork/sidebar/resize.tsx, resize-model.ts). */
describe('sidebar width', () => {
  it("starts from upstream's default", () => {
    expect(SIDEBAR_DEFAULT).toBe(DEFAULT_PREFS.sidebarWidth);
  });

  it('stays within its bounds, in whole points', () => {
    expect(clampSidebarWidth(120)).toBe(SIDEBAR_MIN);
    expect(clampSidebarWidth(900)).toBe(SIDEBAR_MAX);
    expect(clampSidebarWidth(271.6)).toBe(272);
    expect(clampSidebarWidth(Number.NaN)).toBe(SIDEBAR_DEFAULT);
  });

  it('follows the pointer from the sidebar’s left edge', () => {
    expect(widthAtPointer(300, 0)).toBe(300);
    expect(widthAtPointer(350, 40)).toBe(310);
    expect(widthAtPointer(10, 0)).toBe(SIDEBAR_MIN);
    expect(widthAtPointer(2000, 0)).toBe(SIDEBAR_MAX);
  });

  it('widens and narrows a step with the arrow keys, never past the bounds', () => {
    expect(stepSidebarWidth(248, 1)).toBe(248 + SIDEBAR_STEP);
    expect(stepSidebarWidth(248, -1)).toBe(248 - SIDEBAR_STEP);
    expect(stepSidebarWidth(SIDEBAR_MAX, 1)).toBe(SIDEBAR_MAX);
    expect(stepSidebarWidth(SIDEBAR_MIN, -1)).toBe(SIDEBAR_MIN);
    // A width saved out of bounds (an older version, a hand edit) steps from within them.
    expect(stepSidebarWidth(999, -1)).toBe(SIDEBAR_MAX - SIDEBAR_STEP);
  });

  it('leaves the conversation its minimum beside the right panel', () => {
    // A 1280-point window with a 360-point panel: 1280 - 360 - CENTER_MIN for the sidebar at most.
    expect(widestSidebar(1280, 360, CENTER_MIN)).toBe(1280 - 360 - CENTER_MIN);
    // A narrow window: still the minimum sidebar (the panel gives way, as upstream's clamp does).
    expect(widestSidebar(900, 360, CENTER_MIN)).toBe(SIDEBAR_MIN);
    // No panel: the whole window but the conversation.
    expect(widestSidebar(1440, 0, CENTER_MIN)).toBe(1440 - CENTER_MIN);
  });

  it('is grabbed outside the border only, leaving the sidebar’s scrollbar free', () => {
    const css = readFileSync(path.join('packages', 'mac', 'src', 'fork', 'sidebar', 'resize.module.css'), 'utf8');
    expect(css).toMatch(/\.edge > \[role='separator'\]::before \{\s*inset: 0 -7px 0 0;/);
  });
});

/** A browser's storage and document, just enough for lib/prefs.ts to save and apply. */
function fakeBrowser(storage: Map<string, string>) {
  const vars = new Map<string, string>();
  const el = { dataset: {}, style: { setProperty: (k: string, v: string) => vars.set(k, v) } };
  vi.stubGlobal('localStorage', { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v) });
  vi.stubGlobal('window', { matchMedia: () => ({ matches: false, addEventListener: () => undefined }) });
  vi.stubGlobal('document', { documentElement: el, getElementById: () => ({}), head: { append: () => undefined }, createElement: () => ({}) });
  vi.stubGlobal('CSS', { supports: () => false });
  return vars;
}

describe('sidebar width across launches', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('is saved as the sidebarWidth preference and read back on the next launch', async () => {
    const storage = new Map<string, string>();
    const vars = fakeBrowser(storage);
    vi.resetModules();
    const prefs = await import('../packages/mac/src/lib/prefs.js');
    expect(prefs.getPrefs().sidebarWidth).toBe(SIDEBAR_DEFAULT);
    // What the edge saves when you let go (resize.tsx): a clamped width.
    prefs.setPrefs({ sidebarWidth: widthAtPointer(312, 0) });
    expect(vars.get('--sidebar-w')).toBe('312px');
    expect(JSON.parse(storage.get('beluga.prefs.v1')!).sidebarWidth).toBe(312);

    // Next launch: the module loads afresh from the same storage.
    vi.resetModules();
    const again = await import('../packages/mac/src/lib/prefs.js');
    expect(again.getPrefs().sidebarWidth).toBe(312);
  });
});
