import { useSyncExternalStore } from 'react';
import { reducedMotion } from '../../lib/reduced-motion.js';

/**
 * Calm mode's choice, with no side effects at import: safe in a window that must not load the
 * overlay (the sharer's call overlay, which reuses call/PointerMark.tsx). `index.ts` owns the
 * overlay itself — the CSS import and `data-calm` on <html> — and re-exports everything here.
 */

export const CALM_KEY = 'beluga.fork.calm.v1';

interface CalmPref {
  readonly calm?: boolean;
}

const listeners = new Set<() => void>();

function read(): boolean {
  try {
    const saved = JSON.parse(localStorage.getItem(CALM_KEY) ?? '{}') as CalmPref;
    // On unless turned off: a missing or older value keeps the calm look.
    return saved.calm !== false;
  } catch {
    return true;
  }
}

let current = read();

/** Whether calm mode is on (the default). */
export function calmOn(): boolean {
  return current;
}

/** Turns calm mode on or off and saves it; listeners (the overlay's paint) run at once. */
export function setCalm(on: boolean): void {
  current = on;
  try {
    localStorage.setItem(CALM_KEY, JSON.stringify({ calm: on } satisfies CalmPref));
  } catch {
    // Storage full or unavailable: the choice still applies until the app quits.
  }
  for (const l of [...listeners]) l();
}

/** Told after every change; the overlay uses it to set or clear `data-calm`. */
export function onCalmChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** The switch in Settings › Appearance › Layout. */
export function useCalm(): boolean {
  return useSyncExternalStore(onCalmChange, calmOn);
}

/**
 * A JS animation's length in calm mode (docs/calm-ui.md §2): the --dur token's 160 ms at most, 0
 * under reduced motion; as it was otherwise. For the few that `element.animate()` instead of CSS
 * (calm-motion.css can't reach those): KeyPasteCard's height easing (3.5.0).
 */
export function calmMs(ms: number): number {
  if (reducedMotion()) return 0;
  return calmOn() ? Math.min(ms, 160) : ms;
}
