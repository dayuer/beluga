import { isImeComposing } from '../lib/ime.js';

/**
 * Fork (BLG-118, BLG-187): Enter that picks an input method's words (Chinese, Japanese, Korean…)
 * never reaches the app's own key handlers, so no box sends, submits or closes on it. One place
 * instead of a check in every box: a keydown listener on the window, capture phase, installed in
 * main.tsx before anything else listens. It runs before React (whose listeners sit on the root)
 * and before every other window listener (dictation's ↩, the sheets'), and only stops the event's
 * propagation: never preventDefault, which would also drop the characters the IME is committing.
 *
 * Left alone: the terminal (xterm reads keyCode 229 itself to pick up what the IME typed) and any
 * key but Enter (arrows and Escape move through the IME's candidates as before).
 */
export interface GuardedKey {
  readonly key: string;
  readonly isComposing?: boolean;
  readonly keyCode?: number;
  readonly target?: EventTarget | null;
}

/** Does this keydown pick an IME's words with Enter, outside the terminal? */
export function swallowsImeEnter(e: GuardedKey): boolean {
  if (e.key !== 'Enter' || !isImeComposing(e)) return false;
  const el = e.target as { closest?: (sel: string) => unknown } | null | undefined;
  return !(typeof el?.closest === 'function' && el.closest('.xterm'));
}

/** Install once, first thing (main.tsx). Returns how to take it off (tests). */
export function installImeGuard(win: Pick<Window, 'addEventListener' | 'removeEventListener'> = window): () => void {
  const guard = (e: KeyboardEvent): void => {
    if (swallowsImeEnter(e)) e.stopImmediatePropagation();
  };
  win.addEventListener('keydown', guard, true);
  return () => win.removeEventListener('keydown', guard, true);
}
