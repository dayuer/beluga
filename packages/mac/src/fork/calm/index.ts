import { useSyncExternalStore } from 'react';
import './calm.css';

/**
 * Calm mode (docs/calm-ui.md): the window stays still, motion is short and quiet, and only one
 * thing loops. The choice is this window's own, kept apart from the shared preferences
 * (lib/prefs.ts), and put on <html> as `data-calm` before the first frame so nothing plays on the
 * way in. Every rule lives in fork/calm/*.css; upstream files have one import (main.tsx).
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

function paint(on: boolean): void {
  if (typeof document === 'undefined') return;
  if (on) document.documentElement.dataset.calm = '1';
  else delete document.documentElement.dataset.calm;
}

let current = read();
paint(current);

/** Whether calm mode is on (the default). */
export function calmOn(): boolean {
  return current;
}

/** Turns calm mode on or off, saves it, and tells the window. */
export function setCalm(on: boolean): void {
  current = on;
  try {
    localStorage.setItem(CALM_KEY, JSON.stringify({ calm: on } satisfies CalmPref));
  } catch {
    // Storage full or unavailable: the choice still applies until the app quits.
  }
  paint(on);
  for (const l of [...listeners]) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => void listeners.delete(l);
}

/** The switch in Settings › Appearance › Layout. */
export function useCalm(): boolean {
  return useSyncExternalStore(subscribe, calmOn);
}
