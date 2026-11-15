import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Board } from '../src/core/board/board.js';
import type { Issue } from '../src/core/board/model.js';
import type { BoardWork } from '../src/core/board/work.js';
import type { TeamBoardSync, TeamChange } from '../src/core/team/board-sync.js';
import type { SharedTask } from '../src/core/team/crdt.js';
import type { TeamBoards } from '../src/core/team/service.js';
import type { Store } from '../src/core/store.js';
import { FederationAccept } from '../src/fork/federation/accept.js';
import { federationParts } from '../src/fork/federation/parts.js';

/** Auto accept in the daemon (BLG-225): federationParts wires the real deps; launch.ts keeps its parts. */

const ME = 'me00000000000001';
const BOB = 'bob0000000000002';

const issue = { id: 't1', key: 'BLG-1', number: 1, projectId: 'p', title: 'Do it', status: 'todo', priority: 'medium', labels: [], assignee: { kind: 'person', id: ME, name: 'Me' }, blockedBy: [], related: [], rank: 1, brief: {}, revisions: [], worktrees: [], proof: [], activity: [], createdAt: 1, updatedAt: 1, createdBy: { kind: 'person', id: BOB, name: 'Bob' }, origin: 'manual' } as unknown as Issue;
const shared: SharedTask = { id: 't1', fields: { assignee: { v: { kind: 'person', id: ME, name: 'Me' }, a: BOB, l: 3 } }, acts: [] };

function wire(federation: unknown) {
  const subs: Array<(c: TeamChange) => void> = [];
  const calls: Array<{ id: string; opts: unknown }> = [];
  const queue: Array<() => void> = [];
  const state = { prefs: { federation }, policy: 'ask', levels: { [BOB]: 'full' }, self: { peerId: ME } };
  const parts = federationParts(
    {
      team: { self: ME, nameOf: (p: string) => (p === ME ? 'Me' : 'Bob') } as unknown as TeamBoards,
      board: { list: () => [issue], get: (id: string) => (id === 't1' ? issue : undefined) } as unknown as Board,
      sync: { shared: (id: string) => (id === 't1' ? shared : undefined), onChange: (fn: (c: TeamChange) => void) => void subs.push(fn) } as unknown as TeamBoardSync,
      work: { start: async (id: string, opts: unknown) => (calls.push({ id, opts }), 'ws1') } as unknown as Pick<BoardWork, 'start'>,
      store: { getState: () => state } as unknown as Pick<Store, 'getState'>,
      live: () => true,
    },
    { defer: (fn) => void queue.push(fn), log: () => {} },
  );
  return { parts, subs, calls, flush: () => queue.splice(0).forEach((fn) => fn()) };
}

describe('federationParts', () => {
  it('on: a task a teammate gave starts with Claude, quietly', async () => {
    const w = wire({ accept: 'assigned' });
    expect(w.parts).toHaveLength(1);
    expect(w.subs).toHaveLength(1);
    w.flush();
    await (w.parts[0] as FederationAccept).settled();
    expect(w.calls).toHaveLength(1);
    expect(w.calls[0]!.id).toBe('t1');
    expect(w.calls[0]!.opts).toMatchObject({ claude: true, quiet: true, by: { kind: 'claude', owner: ME, for: { id: BOB } } });
  });

  it('off (unset): never subscribes, never starts', async () => {
    const w = wire(undefined);
    expect(w.subs).toHaveLength(0);
    w.flush();
    await (w.parts[0] as FederationAccept).settled();
    expect(w.calls).toEqual([]);
  });

  it('launch.ts keeps its parts and adds federationParts in the same line', () => {
    const src = readFileSync('src/core/board/launch.ts', 'utf8');
    const line = src.split('\n').find((l) => l.includes('...federationParts({'));
    expect(line).toBeDefined();
    for (const part of ['teamSync', 'new TeamAssign(', 'teamPlans', 'new TeamContext(team, board)', 'knocks']) expect(line).toContain(part);
    expect(src).toContain("import { federationParts } from '../../fork/federation/parts.js';");
  });
});
