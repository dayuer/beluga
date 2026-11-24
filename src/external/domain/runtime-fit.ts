/**
 * Which runtimes a run at a grant's level may go on, without I/O. At ask each step shows a card: a
 * runtime that asks before each step. At trusted the run stays in its folders: a runtime that asks
 * before each step, or one whose own sandbox holds every step there (Codex). A runtime with neither
 * reads your home and secrets unasked, so it is refused below Full. At full the run is you.
 */
import type { Level } from './decide.js';

export interface RuntimeFit {
  /** It stops at Beluga's gate before each step. */
  readonly asksEachStep: boolean;
  /** Its own sandbox keeps each step in the run's folders, secrets out. */
  readonly confined?: boolean;
}

export const fitsLevel = (level: Level, r: RuntimeFit): boolean => level === 'full' || r.asksEachStep || (level === 'trusted' && r.confined === true);

/** Why a runtime doesn't fit a level, in the agent's words. */
export const unfitWhy = (level: Level, runtime = 'this agent'): string =>
  level === 'ask'
    ? `At level ask each step needs a card, and ${runtime} cannot ask before each step. Use a Claude agent or raise this agent's level.`
    : `Below Full trust a run stays in its folders, and ${runtime} reads files without asking. Use a Claude or Codex agent or raise this agent's level.`;
