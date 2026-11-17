import { calmOn } from './index.js';

/**
 * Only one thing loops in calm mode (docs/calm/hooks.md §4): a mark moved by the live clock
 * (lib/live-motion.ts) moves only while it sits inside the current step row (`[data-current]`,
 * chat/steps/StepRow.tsx). Dot matrices, plan marks and the working dots rest at their still
 * frame. With calm mode off every mark moves, exactly as upstream.
 */
export function calmLive(el: Element): boolean {
  return !calmOn() || el.closest('[data-current]') !== null;
}
