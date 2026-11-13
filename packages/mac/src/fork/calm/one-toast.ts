import { useLayoutEffect, useSyncExternalStore } from 'react';
import { useCalm } from './index.js';

/**
 * One toast at a time (docs/calm/hooks.md §3). Upstream has two independent notices: the app's
 * toast (App.tsx, its text in the store) and the undo toast (lib/undo-toast.tsx, module state).
 * Under calm mode the later one wins: an earlier one is hidden, not cleared — its own timer runs
 * out as usual, and it never comes back (nothing is revealed when the newer one goes). With calm
 * mode off both show as upstream.
 */

export type ToastKind = 'global' | 'undo';

interface Shown {
  readonly kind: ToastKind;
  readonly id: number;
}

let latest: Shown | undefined;
const listeners = new Set<() => void>();

function notify(): void {
  for (const l of [...listeners]) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => void listeners.delete(l);
}

/** A toast appeared: it is the one on screen from now on. */
function register(kind: ToastKind, id: number): Shown {
  latest = { kind, id };
  notify();
  return latest;
}

/** It went away: only if nothing newer took its place does the screen go quiet. */
function unregister(entry: Shown): void {
  if (latest !== entry) return; // superseded: it stays hidden for good
  latest = undefined;
  notify();
}

/** Whether this toast is the one on screen. */
export function useOneToast(kind: ToastKind, id: number | undefined): boolean {
  const on = useCalm();
  // Registered before the paint: two toasts never share a frame, even for a moment.
  useLayoutEffect(() => {
    if (id === undefined) return;
    const entry = register(kind, id);
    return () => unregister(entry);
  }, [kind, id]);
  const shown = (): boolean => {
    if (!on || id === undefined) return true;
    return latest !== undefined && latest.kind === kind && latest.id === id;
  };
  return useSyncExternalStore(subscribe, shown);
}
