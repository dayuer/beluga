import './calm.css';
import { calmOn, onCalmChange } from './calm-state.js';

/**
 * Calm mode (docs/calm-ui.md): the window stays still, motion is short and quiet, and only one
 * thing loops. The choice is this window's own, kept apart from the shared preferences
 * (lib/prefs.ts), and put on <html> as `data-calm` before the first frame so nothing plays on the
 * way in. Every rule lives in fork/calm/*.css; upstream files have one import (main.tsx).
 *
 * Only this module touches the document and loads the overlay. The choice itself is in
 * calm-state.ts, which other windows (the sharer's call overlay) may read without either.
 */
export { CALM_KEY, calmOn, setCalm, useCalm } from './calm-state.js';

function paint(on: boolean): void {
  if (typeof document === 'undefined') return;
  if (on) document.documentElement.dataset.calm = '1';
  else delete document.documentElement.dataset.calm;
}

paint(calmOn());
onCalmChange(() => paint(calmOn()));
