import { type RefObject, useEffect } from 'react';

/**
 * Arrow keys in the sidebar, as in a Mac source list (fork; docs/fork.md, "侧边栏"): ↑ and ↓ move
 * between its rows, → opens and ← closes a row that folds (the project's chevron), Home and End go
 * to the first and last. Return and Space still open the row, as upstream's Row does. Only while a
 * row has the focus: a field (search, a rename) keeps its arrows.
 */
export const ROW = "[class*='_scroll_'] [role='button']";
export const FOLD = "button[class*='_foldButton_']";

/** The step an arrow key takes along the rows (-1: none, 0: this one stays). */
export function stepFor(key: string, index: number, count: number): number {
  if (!count) return -1;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  if (index < 0) return key === 'ArrowUp' ? count - 1 : 0;
  return Math.max(0, Math.min(count - 1, index + (key === 'ArrowDown' ? 1 : -1)));
}

const visible = (el: HTMLElement): boolean => el.getClientRects().length > 0;

export function useSidebarKeys(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const nav = ref.current;
    if (!nav) return;
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const target = e.target as HTMLElement | null;
      // Only a row itself: a button inside it, a field or a menu keeps its keys.
      if (!target?.matches(ROW) || !target.closest(ROW)) return;
      const rows = [...nav.querySelectorAll<HTMLElement>(ROW)].filter(visible);
      const at = rows.indexOf(target);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
        const next = rows[stepFor(e.key, at, rows.length)];
        if (!next) return;
        e.preventDefault();
        next.focus();
        next.scrollIntoView({ block: 'nearest' });
        return;
      }
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        const open = target.getAttribute('aria-expanded');
        if (open === null || (e.key === 'ArrowRight') === (open === 'true')) return;
        const fold = target.querySelector<HTMLElement>(FOLD);
        if (!fold) return;
        e.preventDefault();
        fold.click();
      }
    };
    nav.addEventListener('keydown', onKeyDown);
    return () => nav.removeEventListener('keydown', onKeyDown);
  }, [ref]);
}
