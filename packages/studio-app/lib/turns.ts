import type { StudioTurn } from '../../../src/studio/protocol';

export type LocalTurnState = 'sending' | 'queued' | 'failed';

/** A message the customer just sent, before the server has it in its turns. */
export interface OptimisticTurn {
  readonly opId: string;
  readonly text: string;
  readonly at: number;
  readonly state: LocalTurnState;
  /** The hub's opId is terminal (refused/expired): a retry must use a new one. */
  readonly refused?: boolean;
}

/** What the chat draws: a server turn or a local bubble. */
export interface ChatTurn {
  readonly id: string;
  readonly who: 'customer' | 'ai' | 'studio';
  readonly text: string;
  readonly at: number;
  readonly role?: string;
  readonly name?: string;
  readonly opId?: string;
  readonly state?: LocalTurnState;
  readonly local?: boolean;
}

const asChatTurn = (turn: StudioTurn): ChatTurn => ({
  id: turn.id,
  who: turn.who,
  text: turn.text,
  at: turn.at,
  ...(turn.role ? { role: turn.role } : {}),
  ...(turn.name ? { name: turn.name } : {}),
  ...(turn.opId ? { opId: turn.opId } : {}),
});

/**
 * The conversation, oldest first: the older page, then the view's newest turns, then local
 * bubbles. A turn id appears once (the server's copy wins over the older page); a server turn with
 * the same opId as a local bubble replaces it, so a sent message never shows twice.
 */
export function mergeTurns(server: readonly StudioTurn[], older: readonly StudioTurn[], optimistic: readonly OptimisticTurn[]): ChatTurn[] {
  const byId = new Map<string, StudioTurn>();
  for (const turn of older) byId.set(turn.id, turn);
  for (const turn of server) byId.set(turn.id, turn);

  const order: string[] = [];
  const seen = new Set<string>();
  for (const turn of [...older, ...server]) {
    if (seen.has(turn.id)) continue;
    seen.add(turn.id);
    order.push(turn.id);
  }

  const replaced = new Set(server.flatMap((turn) => (turn.opId ? [turn.opId] : [])));
  const local: ChatTurn[] = optimistic
    .filter((turn) => !replaced.has(turn.opId))
    .map((turn) => ({ id: turn.opId, who: 'customer', text: turn.text, at: turn.at, opId: turn.opId, state: turn.state, local: true }));

  return [...order.map((id) => asChatTurn(byId.get(id)!)), ...local];
}

/** The number of turns from others newer than the last time the customer looked. */
export function unreadTurns(turns: readonly StudioTurn[], seenAt: number): number {
  return turns.filter((turn) => turn.who !== 'customer' && turn.at > seenAt).length;
}
