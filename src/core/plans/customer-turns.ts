/**
 * Which conversations have a Synon Studio customer's turn under way (docs/studio-gates.md §5.3).
 *
 * A customer's words reach the plan's head Claude (a message, a milestone sent back, an answer to
 * one of their decisions), but never with the operator's reach: the plan tools a customer turn gets
 * change only the draft, and the runtime's policy refuses everything but reading inside the project.
 * `PlansWork.forRun` asks this module when it builds a run's tools, so the marker has to be up before
 * `askClaude` and down once that run's agent item ends.
 *
 * `started` is set by `forRun` itself: between `begin` and the run starting the channel has no
 * running item, and a watcher (chat.ts) must not mistake that gap for the run being over. A marker
 * whose run never came (an answer that raised no turn) is dropped after GRACE_MS, so it can't
 * restrict the operator's next turn there.
 */

interface Turn {
  /** A run of this turn was built (forRun ran): from here, no running item means it ended. */
  sawRun: boolean;
  /** A safety net for a begin whose run never came. */
  timer?: ReturnType<typeof setTimeout>;
}

/** Long enough for a queued run to be built (the host may wait behind another turn). */
export const GRACE_MS = 30_000;

const turns = new Map<string, Turn>();

export const customerTurns = {
  begin(channel: string): void {
    if (turns.has(channel)) return;
    const turn: Turn = { sawRun: false };
    turn.timer = setTimeout(() => {
      // Nothing ran: this wasn't a turn (or the answer was dropped). Take the marker away.
      if (!turn.sawRun) turns.delete(channel);
    }, GRACE_MS);
    turn.timer.unref?.();
    turns.set(channel, turn);
  },
  /** `forRun` built this turn: it is a customer's, and it has started. */
  started(channel: string): void {
    const turn = turns.get(channel);
    if (!turn) return;
    turn.sawRun = true;
    if (turn.timer) clearTimeout(turn.timer);
    turn.timer = undefined;
  },
  end(channel: string): void {
    const turn = turns.get(channel);
    if (turn?.timer) clearTimeout(turn.timer);
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
