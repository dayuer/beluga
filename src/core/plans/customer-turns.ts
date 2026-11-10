/**
 * Which conversations have a Synon Studio customer's turn under way (docs/studio-gates.md §5.3).
 *
 * A customer's message runs as the plan's head Claude, but not with the operator's reach: the plan
 * tools a customer turn gets change only the draft, and the runtime's policy refuses everything but
 * reading inside the project. `PlansWork.forRun` asks this module when it builds a run's tools, so
 * the marker has to be up before `askClaude` and down once that run's agent item ends.
 *
 * `started` is set by `forRun` itself: between `begin` and the run starting the channel has no
 * running item, and a watcher (chat.ts) must not mistake that gap for the run being over.
 */

interface Turn {
  /** A run of this turn was built (forRun ran): from here, no running item means it ended. */
  sawRun: boolean;
}

const turns = new Map<string, Turn>();

export const customerTurns = {
  begin(channel: string): void {
    if (!turns.has(channel)) turns.set(channel, { sawRun: false });
  },
  /** `forRun` built this turn: it is a customer's, and it has started. */
  started(channel: string): void {
    const turn = turns.get(channel);
    if (turn) turn.sawRun = true;
  },
  end(channel: string): void {
    turns.delete(channel);
  },
  active(channel: string): boolean {
    return turns.has(channel);
  },
  /** A run was built for it: a watcher may now end it when nothing runs there. */
  sawRun(channel: string): boolean {
    return turns.get(channel)?.sawRun ?? false;
  },
  channels(): string[] {
    return [...turns.keys()];
  },
};
