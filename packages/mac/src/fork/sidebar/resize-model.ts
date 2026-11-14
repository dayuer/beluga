/**
 * How wide the sidebar may be when you drag its edge (fork; docs/fork.md, "侧边栏"). The width is
 * upstream's own `sidebarWidth` preference (lib/prefs.ts, the `--sidebar-w` variable), the one
 * Settings' slider sets, so the bounds are that slider's: 200 to 360 points.
 */

export const SIDEBAR_MIN = 200;
export const SIDEBAR_MAX = 360;
/** Upstream's default (`DEFAULT_PREFS.sidebarWidth`, `--sidebar-w` in styles/tokens.css). */
export const SIDEBAR_DEFAULT = 248;
/** One arrow-key press, the slider's step twice over. */
export const SIDEBAR_STEP = 8;

/** A width the sidebar can take: whole points within the bounds (anything else: the default). */
export function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return SIDEBAR_DEFAULT;
  return Math.round(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, width)));
}

/** The width while dragging: from the sidebar's left edge to the pointer. */
export function widthAtPointer(pointerX: number, sidebarLeft: number): number {
  return clampSidebarWidth(pointerX - sidebarLeft);
}

/**
 * The widest the sidebar may get in this window: the conversation between it and the right panel
 * keeps upstream's minimum (`CENTER_MIN`, lib/panel-model.ts). `panelWidth` is what the panel
 * takes beside it (0 when it's closed). Never under the minimum sidebar.
 */
export function widestSidebar(windowWidth: number, panelWidth: number, centerMin: number): number {
  return Math.max(SIDEBAR_MIN, Math.floor(windowWidth - panelWidth - centerMin));
}

/** An arrow key: → widens (dir 1), ← narrows (dir -1). */
export function stepSidebarWidth(width: number, dir: 1 | -1): number {
  return clampSidebarWidth(clampSidebarWidth(width) + dir * SIDEBAR_STEP);
}
