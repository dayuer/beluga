import { THIS_COMPUTER } from './assistant.js';

/**
 * The agent pickers' runtimes beyond the ones Beluga knows by name (BLG-ACP): this computer's ACP
 * agents (Cursor, Grok Build, a Registry agent, a command of yours), listed after Local model.
 * Browser-safe and dependency-free, as agent-runtimes.ts is.
 */

/** A runtime this computer offers besides the known ones, by its id and name. */
export interface ExtraRuntime {
  readonly id: string;
  readonly label: string;
  readonly missing?: string;
}

/** The known runtimes, then each extra one they don't already have, with what's missing when it isn't set up. */
export function withExtraRuntimes(known: ReadonlyArray<{ readonly id: string; readonly label: string; readonly missing: string }>, extra: readonly ExtraRuntime[]): Array<{ readonly id: string; readonly label: string; readonly missing: string }> {
  const ids = new Set(known.map((r) => r.id));
  return [...known, ...extra.filter((e) => !ids.has(e.id)).map((e) => ({ id: e.id, label: e.label, missing: e.missing ?? `${e.label} isn't set up on ${THIS_COMPUTER} yet` }))];
}
