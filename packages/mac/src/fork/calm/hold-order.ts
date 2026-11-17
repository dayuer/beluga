import { type RefObject, useEffect, useRef, useSyncExternalStore } from 'react';
import { useCalm } from './index.js';

/**
 * The sidebar's order made still while you are working in it (docs/calm/hooks.md §1).
 *
 * Sorting stays exactly where upstream put it (layout/attention-model.ts): this only decides
 * *when* a new order is shown. Hovering, keyboard focus, or dragging a row holds both sidebar
 * lists as they are (both go through EntryRow's useEntryList); 600 ms after the last of those
 * ends, the next render shows the order the app has by then. With calm mode off nothing here
 * matches: useHeldEntries returns the fresh list and useSidebarHold attaches no probe.
 */

export type HoldReason = 'pointer' | 'keys' | 'drag' | 'menu';

/** How long the list waits after the pointer, focus or a drag leaves it. */
export const HOLD_MS = 600;

const reasons = new Set<HoldReason>();
let grace: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

function notify(): void {
  for (const l of [...listeners]) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => void listeners.delete(l);
}

/**
 * A menu, dialog or picker opened from a row: those are portaled to <body>, outside the React
 * root. A listbox that belongs to the page itself (the Changes tab's file list, in the right
 * panel) must not keep the order frozen — that bug left the sidebar held for as long as that tab
 * was open.
 */
function popupOpen(): boolean {
  if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return false;
  for (const el of document.querySelectorAll('[role="menu"], [role="dialog"], [role="listbox"]')) {
    if (el.closest('#root')) continue;
    return true;
  }
  return false;
}

/** Nothing is being used any more: let go unless a menu opened from the sidebar is still up. */
function release(): void {
  grace = undefined;
  // A menu (or a picker's dialog/listbox) opened from a row is a portal outside the sidebar, so
  // moving into it already ended the pointer hold. Ask the page instead: still open keeps the
  // order for another grace period (M3: dialogs and listboxes too, not only menus).
  if (popupOpen()) {
    grace = setTimeout(release, HOLD_MS);
    return;
  }
  notify();
}

/** Something in the sidebar is being used: hold the order, and cancel a pending release. */
export function holdBegin(reason: HoldReason): void {
  if (grace !== undefined) {
    clearTimeout(grace);
    grace = undefined;
  }
  if (reasons.has(reason)) return;
  reasons.add(reason);
  notify();
}

/** That use ended: once nothing is left, the order changes one HOLD_MS later. */
export function holdEnd(reason: HoldReason): void {
  if (!reasons.delete(reason)) return;
  if (reasons.size) {
    notify();
    return;
  }
  if (grace !== undefined) clearTimeout(grace);
  grace = setTimeout(release, HOLD_MS);
  notify();
}

/** Whether the sidebar's order should stay as it is now. */
export function holdHeld(): boolean {
  return reasons.size > 0 || grace !== undefined;
}

/**
 * Watches the sidebar for use: the pointer over it, focus inside it, or a row being dragged
 * (layout/arrange-drag.ts puts data-arranging on <html>). With calm mode off it attaches nothing.
 */
export function useSidebarHold(ref: RefObject<HTMLElement | null>): void {
  const on = useCalm();
  useEffect(() => {
    const el = ref.current;
    if (!on || !el) return;
    const enter = (): void => holdBegin('pointer');
    const leave = (): void => holdEnd('pointer');
    // Only keyboard focus holds: a clicked button keeps focus after the pointer has left, and
    // counting that froze the order until you clicked somewhere else (M4 e2e, unread.spec).
    const focusIn = (ev: FocusEvent): void => {
      const t = ev.target;
      if (t instanceof Element && t.matches(':focus-visible')) holdBegin('keys');
    };
    const focusOut = (): void => {
      // The new focus lands after this event: stay held while it is still inside the sidebar.
      requestAnimationFrame(() => {
        if (!el.contains(document.activeElement)) holdEnd('keys');
      });
    };
    const drag = (): void => {
      if (document.documentElement.dataset.arranging !== undefined) holdBegin('drag');
      else holdEnd('drag');
    };
    el.addEventListener('pointerenter', enter);
    el.addEventListener('pointerleave', leave);
    el.addEventListener('focusin', focusIn);
    el.addEventListener('focusout', focusOut);
    const observer = new MutationObserver(drag);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-arranging'] });
    drag();
    return () => {
      el.removeEventListener('pointerenter', enter);
      el.removeEventListener('pointerleave', leave);
      el.removeEventListener('focusin', focusIn);
      el.removeEventListener('focusout', focusOut);
      observer.disconnect();
      // Never leave a reason behind: StrictMode mounts the sidebar twice, and hiding it unmounts.
      holdEnd('pointer');
      holdEnd('keys');
      holdEnd('drag');
    };
  }, [on, ref]);
}

/**
 * The list as the sidebar should show it: `fresh` while nothing is being used, else the group in
 * the order it had when the hold began. Only the order is frozen (M3 · SH-08): a mark that
 * arrives while the pointer is here still shows on its row. A row that appears during the hold
 * waits for the release — showing it would push the rows under the pointer.
 */
export function useHeldEntries<E extends { readonly channel: string }>(fresh: readonly E[]): readonly E[] {
  const on = useCalm();
  const held = useSyncExternalStore(subscribe, holdHeld, holdHeld);
  const frozen = useRef<readonly string[] | undefined>(undefined);
  if (!on || !held) {
    frozen.current = undefined;
    return fresh;
  }
  frozen.current ??= fresh.map((e) => e.channel);
  const byChannel = new Map(fresh.map((e) => [e.channel, e]));
  return frozen.current.map((channel) => byChannel.get(channel)).filter((e): e is E => e !== undefined);
}
