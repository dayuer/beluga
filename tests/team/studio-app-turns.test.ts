import { describe, expect, it } from 'vitest';
import type { StudioTurn } from '../../src/studio/protocol.js';
import { mergeTurns, unreadTurns } from '../../packages/studio-app/lib/turns.js';

/** BLG-92: the chat's pure merge, without a browser. */

const turn = (id: string, who: StudioTurn['who'], text: string, at: number, opId?: string): StudioTurn => ({
  id,
  who,
  text,
  at,
  ...(opId ? { opId } : {}),
});

describe('mergeTurns', () => {
  it('puts the older page before the view and draws a duplicate id once, with the server copy', () => {
    const older = [turn('t0', 'ai', 'first', 1), turn('t1', 'customer', 'sent', 2)];
    const server = [turn('t1', 'customer', 'sent', 2), turn('t2', 'ai', 'reply', 3)];
    const merged = mergeTurns(server, older, []);
    expect(merged.map((t) => t.id)).toEqual(['t0', 't1', 't2']);
    expect(merged[1]?.text).toBe('sent');
  });

  it('keeps local bubbles after the server turns, in send order', () => {
    const merged = mergeTurns([turn('t0', 'ai', 'hello', 1)], [], [
      { opId: 'op-a', text: 'one', at: 2, state: 'sending' },
      { opId: 'op-b', text: 'two', at: 3, state: 'failed' },
    ]);
    expect(merged.map((t) => t.text)).toEqual(['hello', 'one', 'two']);
    expect(merged[1]?.local).toBe(true);
    expect(merged[2]?.state).toBe('failed');
  });

  it('drops a local bubble once the server turn with its opId is in the view', () => {
    const merged = mergeTurns([turn('t1', 'customer', 'one', 2, 'op-a')], [], [{ opId: 'op-a', text: 'one', at: 2, state: 'queued' }]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.local).toBeUndefined();
  });

  it('does not confuse a server turn without an opId with a local one', () => {
    const merged = mergeTurns([turn('t1', 'customer', 'old', 1)], [], [{ opId: 'op-a', text: 'new', at: 2, state: 'queued' }]);
    expect(merged).toHaveLength(2);
  });
});

describe('unreadTurns', () => {
  it('counts turns from others newer than the last look', () => {
    const turns = [turn('t0', 'ai', 'old', 100), turn('t1', 'customer', 'mine', 200), turn('t2', 'studio', 'new', 300)];
    expect(unreadTurns(turns, 250)).toBe(1);
    expect(unreadTurns(turns, 100)).toBe(1);
    expect(unreadTurns(turns, 300)).toBe(0);
  });
});
