import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The sidebar's held order (fork/calm/hold-order.ts, docs/calm/hooks.md §1): the state machine
 * behind useSidebarHold/useHeldEntries. The hooks themselves need a real window and are covered by
 * packages/mac/e2e/fork-calm-sidebar.spec.ts; here are the timer rules they rely on.
 */

/** A stand-in for the window: the <html> data-calm sets, and the menus the page has open. */
function windowish(menuOpen = false): { menuOpen: boolean } {
  const state = { menuOpen };
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined });
  vi.stubGlobal('document', {
    documentElement: { dataset: {} as Record<string, string | undefined> },
    activeElement: null,
    querySelector: (selector: string) => (selector === '[role="menu"]' && state.menuOpen ? {} : null),
  });
  return state;
}

const load = async () => import('../packages/mac/src/fork/calm/hold-order.js');

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetModules();
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the sidebar holds its order while it is being used', () => {
  it('freezes while the pointer is over it, and lets go 600 ms after it leaves', async () => {
    windowish();
    const { holdBegin, holdEnd, holdHeld, HOLD_MS } = await load();
    expect(HOLD_MS).toBe(600);
    expect(holdHeld()).toBe(false);

    holdBegin('pointer');
    expect(holdHeld()).toBe(true);
    holdEnd('pointer');
    expect(holdHeld()).toBe(true); // still inside the grace period
    vi.advanceTimersByTime(HOLD_MS - 1);
    expect(holdHeld()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(holdHeld()).toBe(false);
  });

  it('stays frozen while keyboard focus is still inside it', async () => {
    windowish();
    const { holdBegin, holdEnd, holdHeld, HOLD_MS } = await load();
    holdBegin('pointer');
    holdBegin('keys');
    holdEnd('pointer');
    vi.advanceTimersByTime(HOLD_MS * 2);
    expect(holdHeld()).toBe(true);
    holdEnd('keys');
    vi.advanceTimersByTime(HOLD_MS);
    expect(holdHeld()).toBe(false);
  });

  it('cancels a pending release when you use the sidebar again inside the grace period', async () => {
    windowish();
    const { holdBegin, holdEnd, holdHeld, HOLD_MS } = await load();
    holdBegin('pointer');
    holdEnd('pointer');
    vi.advanceTimersByTime(HOLD_MS - 100);
    holdBegin('keys');
    vi.advanceTimersByTime(HOLD_MS * 3);
    expect(holdHeld()).toBe(true);
    holdEnd('keys');
    vi.advanceTimersByTime(HOLD_MS);
    expect(holdHeld()).toBe(false);
  });

  it('a drag freezes it for as long as data-arranging is on <html>', async () => {
    windowish();
    const { holdBegin, holdEnd, holdHeld, HOLD_MS } = await load();
    holdBegin('drag');
    holdEnd('pointer'); // other reasons ending say nothing about the drag
    vi.advanceTimersByTime(HOLD_MS);
    expect(holdHeld()).toBe(true);
    holdEnd('drag');
    vi.advanceTimersByTime(HOLD_MS);
    expect(holdHeld()).toBe(false);
  });

  it('a menu opened from a row keeps the order until it closes', async () => {
    const state = windowish(true);
    const { holdBegin, holdEnd, holdHeld, HOLD_MS } = await load();
    holdBegin('pointer');
    holdEnd('pointer');
    vi.advanceTimersByTime(HOLD_MS);
    expect(holdHeld()).toBe(true); // the menu is still up: the release waits another grace period
    state.menuOpen = false;
    vi.advanceTimersByTime(HOLD_MS);
    expect(holdHeld()).toBe(false);
  });
});
