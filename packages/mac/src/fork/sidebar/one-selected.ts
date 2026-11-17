import { type RefObject, useEffect } from 'react';
import './sidebar-look.css';

/**
 * The sidebar shows one selected row, never two (fork; docs/fork.md, "侧边栏").
 *
 * Upstream lets each row decide on its own whether it is selected, so the same plan lit up under
 * Work, in Unread and under its project at once, and Work itself stayed lit over the plan you had
 * opened. Here nothing upstream changes: whenever a row gains or loses upstream's selected class,
 * the rows that call themselves selected are looked at together, one keeps the highlight and the
 * others are marked `data-fork-dup` (sidebar-look.css draws them plain). The one kept is the row
 * you clicked, while it is still selected; otherwise the most specific one (the deepest indent,
 * then the first). The kept row gets `aria-current="page"` and the others lose theirs, so VoiceOver
 * names one place. Chats you Shift-clicked into a selection are a selection of several on purpose:
 * they are left alone.
 */

/** A row that says it is selected: how deep it sits, and whether it is the one you clicked. */
export interface SelectedRow {
  readonly indent: number;
  readonly clicked: boolean;
}

/** Which of the selected rows keeps the highlight (-1: none are selected). */
export function ownerOf(rows: readonly SelectedRow[]): number {
  if (!rows.length) return -1;
  const clicked = rows.findIndex((r) => r.clicked);
  if (clicked >= 0) return clicked;
  let best = 0;
  rows.forEach((r, i) => {
    if (r.indent > rows[best]!.indent) best = i;
  });
  return best;
}

/**
 * Upstream's anchors (tests/fork-sidebar-anchors.test.ts checks they still exist): a sidebar Row
 * is `role="button"` (layout/sidebar-parts.tsx), selected through Sidebar.module.css's `.selected`
 * (CSS modules: `_selected_<hash>`); a chat in a Shift-click selection carries `data-chat-selected`
 * (layout/workspace-row.tsx).
 */
export const ROW = "[role='button']";
export const SELECTED_CLASS = '_selected_';
export const IN_CHAT_SELECTION = 'data-chat-selected';

/** What settle needs of a row: a DOM element has all of it (the test hands it plain objects). */
export interface RowLike {
  readonly className: string;
  readonly style: { readonly paddingLeft: string };
  hasAttribute(name: string): boolean;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

/** The row you clicked, and whether it has been selected since (only then can it go stale). */
export interface Clicked<T> {
  readonly row: T;
  readonly seen: boolean;
}

/** Row's own left padding is 8 + 14 per level of indent (layout/sidebar-parts.tsx). */
const indentOf = (row: RowLike): number => Number.parseFloat(row.style.paddingLeft || '8') || 8;
const isSelected = (row: RowLike): boolean => typeof row.className === 'string' && row.className.includes(SELECTED_CLASS);
const inChatSelection = (row: RowLike): boolean => row.hasAttribute(IN_CHAT_SELECTION) || row.getAttribute('aria-pressed') === 'true';

/**
 * One pass over the sidebar's rows: marks the duplicates, names the current one, and returns what
 * to remember of the click (dropped once the clicked row has been selected and no longer is).
 */
export function settleRows<T extends RowLike>(rows: readonly T[], clicked: Clicked<T> | null): Clicked<T> | null {
  // Take back what the last pass put on.
  for (const row of rows) {
    row.removeAttribute('data-fork-dup');
    if (row.hasAttribute('data-fork-current')) {
      row.removeAttribute('data-fork-current');
      row.removeAttribute('aria-current');
    }
  }
  const selected = rows.filter((r) => isSelected(r) && !inChatSelection(r));
  const owner = ownerOf(selected.map((r) => ({ indent: indentOf(r), clicked: r === clicked?.row })));
  selected.forEach((row, i) => {
    if (i === owner) {
      row.setAttribute('data-fork-current', '');
      row.setAttribute('aria-current', 'page');
    } else {
      row.setAttribute('data-fork-dup', '');
      // Some rows set their own (Sentinel's): one current place, whoever set it.
      row.removeAttribute('aria-current');
    }
  });
  if (!clicked) return null;
  if (selected.includes(clicked.row)) return clicked.seen ? clicked : { row: clicked.row, seen: true };
  return clicked.seen ? null : clicked;
}

/** Whether a change in the sidebar can change which rows are selected. */
function touchesSelection(m: MutationRecord): boolean {
  if (m.type === 'attributes') return (m.oldValue ?? '').includes(SELECTED_CLASS) !== (m.target as Element).className.toString().includes(SELECTED_CLASS);
  const nodes = [...m.addedNodes, ...m.removedNodes];
  return nodes.some((n) => n instanceof Element && (n.className.toString().includes(SELECTED_CLASS) || n.querySelector(`[class*='${SELECTED_CLASS}']`) !== null));
}

/** One line in Sidebar.tsx: `useOneSelected(drop.ref)`. Also turns on sidebar-look.css for this nav. */
export function useOneSelected(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const nav = ref.current;
    if (!nav) return;
    nav.setAttribute('data-fork-sidebar', '');
    let clicked: Clicked<HTMLElement> | null = null;
    let frame = 0;
    const run = (): void => {
      frame = 0;
      clicked = settleRows([...nav.querySelectorAll<HTMLElement>(ROW)], clicked);
    };
    const later = (): void => {
      if (!frame) frame = requestAnimationFrame(run);
    };
    const pick = (e: Event): void => {
      const row = (e.target as Element | null)?.closest?.<HTMLElement>(ROW);
      if (row && nav.contains(row)) {
        clicked = { row, seen: false };
        later();
      }
    };
    const keys = (e: KeyboardEvent): void => {
      if (e.key === 'Enter' || e.key === ' ') pick(e);
    };
    nav.addEventListener('click', pick, true);
    nav.addEventListener('keydown', keys, true);
    // Only a row gaining or losing the selected class, or selected rows coming and going: live
    // marks and loaders change classes all the time and don't wake this.
    const watch = new MutationObserver((list) => {
      if (list.some(touchesSelection)) later();
    });
    watch.observe(nav, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'], attributeOldValue: true });
    run();
    return () => {
      watch.disconnect();
      nav.removeEventListener('click', pick, true);
      nav.removeEventListener('keydown', keys, true);
      if (frame) cancelAnimationFrame(frame);
      nav.removeAttribute('data-fork-sidebar');
    };
  }, [ref]);
}
