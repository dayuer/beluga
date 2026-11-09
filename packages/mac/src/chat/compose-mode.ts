/**
 * How Claude takes what you send: right away, planning first (Claude Code's plan mode, which you
 * approve), or planning with tasks (a plan of milestones and tasks that goes on the board when you
 * approve it; see core/plans).
 */
import { t } from '../i18n/index.js';

export type ComposeMode = 'act' | 'plan' | 'tasks';

/** A mode's words, in the language shown now. */
export const modeInfo = (mode: ComposeMode): { readonly label: string; readonly hint: string; readonly banner: string } => ({
  label: t(`chat.composeMode.${mode}Label`),
  hint: t(`chat.composeMode.${mode}Hint`),
  banner: mode === 'act' ? '' : t(`chat.composeMode.${mode}Banner`),
});

/** ⇧⇥: acting ↔ planning first, as in Claude Code. (Plan with Tasks makes a plan: it's picked from the menu, never a keystroke away.) */
export function nextMode(mode: ComposeMode): ComposeMode {
  return mode === 'act' ? 'plan' : 'act';
}
