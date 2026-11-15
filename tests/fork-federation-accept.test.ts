import { describe, expect, it } from 'vitest';
import type { Activity, Actor, Issue } from '../src/core/board/model.js';
import type { Field, SharedTask } from '../src/core/team/crdt.js';
import type { TeamChange } from '../src/core/team/board-sync.js';
import { type AcceptDeps, FederationAccept } from '../src/fork/federation/accept.js';
import { isAutoRunning, isAutoStarted } from '../src/fork/federation/marker.js';
import { type FederationSettings, federationOf } from '../src/fork/federation/settings.js';
import type { TrustLevel } from '../src/shared/settings-schema.js';

/** Auto accept's pass over the board (BLG-223): who starts, once, within atOnce, across restarts. */

const ME = 'me00000000000001';
const BOB = 'bob0000000000002';
const ANN = 'ann0000000000003';
const NAMES: Record<string, string> = { [ME]: 'Me', [BOB]: 'Bob', [ANN]: 'Ann' };

const field = (v: unknown, a: string, l = 5): Field => ({ v, a, l });

let n = 0;
function task(over: Partial<Issue> = {}): Issue {
  n++;
  return {
    id: `t${n}`,
    key: `BLG-${n}`,
    number: n,
    projectId: 'p',
    title: `Task ${n}`,
    status: 'todo',
    priority: 'medium',
    labels: [],
    assignee: { kind: 'person', id: ME, name: 'Me' },
    blockedBy: [],
    related: [],
    rank: n,
    brief: {},
    revisions: [],
    worktrees: [],
    proof: [],
    activity: [],
    createdAt: 1,
    updatedAt: 1,
    createdBy: { kind: 'person', id: BOB, name: 'Bob' },
    origin: 'manual',
    ...over,
  } as Issue;
}

/** A board, its team copy and a start that does what work.start does to the board. */
function world(opts: { issues: Issue[]; by?: Record<string, string>; settings?: Partial<FederationSettings>; levels?: Record<string, TrustLevel>; fail?: Set<string> }) {
  let issues = [...opts.issues];
  const shared = new Map<string, SharedTask>();
  const giveBy = (id: string, from: string, l = 5): void => {
    shared.set(id, { id, fields: { assignee: field({ kind: 'person', id: ME, name: 'Me' }, from, l) }, acts: [] });
  };
  for (const i of issues) giveBy(i.id, opts.by?.[i.id] ?? BOB);
  const live = new Set<string>(issues.flatMap((i) => i.worktrees));
  let settings: FederationSettings = federationOf({ accept: 'assigned', ...opts.settings });
  const starts: Array<{ id: string; by: Actor }> = [];
  let reads = 0;
  let ws = 0;
  const set = (id: string, patch: Partial<Issue>): void => {
    issues = issues.map((i) => (i.id === id ? ({ ...i, ...patch } as Issue) : i));
  };
  const listeners: Array<(c: TeamChange) => void> = [];
  const deps: AcceptDeps = {
    team: { self: ME, nameOf: (p: string) => NAMES[p] ?? p },
    board: {
      list: () => (reads++, issues),
      get: (ref: string) => issues.find((i) => i.id === ref || i.key === ref),
    },
    sync: { shared: (id: string) => shared.get(id), onChange: (fn: (c: TeamChange) => void) => void listeners.push(fn) },
    start: async (id, by) => {
      starts.push({ id, by });
      if (opts.fail?.has(id)) throw new Error('already being worked on');
      const w = `ws${++ws}`;
      live.add(w);
      const i = issues.find((x) => x.id === id)!;
      const line: Activity = { id: `a${ws}`, at: 2, by, kind: 'status', text: 'moved this to In Progress' };
      set(id, { worktrees: [...i.worktrees, w], status: 'in_progress', activity: [...i.activity, line] });
      return w;
    },
    settings: () => settings,
    trustOf: (p) => (p === ME ? 'full' : (opts.levels ?? { [BOB]: 'full', [ANN]: 'trusted' })[p] ?? 'ask'),
    live: (w) => live.has(w),
  };
  return {
    deps,
    starts,
    get reads() {
      return reads;
    },
    get issues() {
      return issues;
    },
    set,
    giveBy,
    add: (i: Issue): void => {
      issues = [...issues, i];
      giveBy(i.id, BOB);
    },
    setSettings: (p: Partial<FederationSettings>) => (settings = { ...settings, ...p }),
    listeners,
    live,
  };
}

describe('FederationAccept.reconcile', () => {
  it('starts a task given to me exactly once, as my Claude for the giver; twice over the same board still once', async () => {
    const t = task();
    const w = world({ issues: [t] });
    const fa = new FederationAccept(w.deps);
    await fa.reconcile();
    await fa.reconcile();
    expect(w.starts.map((s) => s.id)).toEqual([t.id]);
    expect(w.starts[0]!.by).toEqual({ kind: 'claude', owner: ME, ownerName: 'Me', for: { id: BOB, name: 'Bob' } });
    expect(isAutoStarted(w.issues[0]!, ME)).toBe(true);
  });

  it('keeps the rest in Ready past atOnce; a place freed lets the next start', async () => {
    const ts = [task({ priority: 'high' }), task(), task({ priority: 'low' })];
    const w = world({ issues: ts, settings: { atOnce: 2 } });
    const fa = new FederationAccept(w.deps);
    await fa.reconcile();
    expect(w.starts.map((s) => s.id)).toEqual([ts[0]!.id, ts[1]!.id]);
    expect(w.issues[2]!.status).toBe('todo');
    await fa.reconcile();
    expect(w.starts).toHaveLength(2);
    w.set(ts[0]!.id, { status: 'in_review' });
    await fa.reconcile();
    expect(w.starts.map((s) => s.id)).toEqual([ts[0]!.id, ts[1]!.id, ts[2]!.id]);
  });

  it('leaves a task from someone trusted less than `from`, and one I gave myself', async () => {
    const fromAnn = task();
    const mine = task();
    const w = world({ issues: [fromAnn, mine], by: { [fromAnn.id]: ANN, [mine.id]: ME }, settings: { from: 'full' } });
    await new FederationAccept(w.deps).reconcile();
    expect(w.starts).toEqual([]);
    w.setSettings({ from: 'trusted' });
    await new FederationAccept(w.deps).reconcile();
    expect(w.starts.map((s) => s.id)).toEqual([fromAnn.id]);
  });

  it('off: no start, and the board is never read', async () => {
    const w = world({ issues: [task()], settings: { accept: 'off' } });
    await new FederationAccept(w.deps).reconcile();
    expect(w.starts).toEqual([]);
    expect(w.reads).toBe(0);
  });

  it('a start that throws: reconcile still returns, no retry until it is given again', async () => {
    const t = task();
    const logs: string[] = [];
    const w = world({ issues: [t], fail: new Set([t.id]) });
    const fa = new FederationAccept({ ...w.deps, log: (l) => logs.push(l) });
    await expect(fa.reconcile()).resolves.toBeUndefined();
    await fa.reconcile();
    expect(w.starts).toHaveLength(1);
    expect(logs.some((l) => l.includes("couldn't start"))).toBe(true);
    w.giveBy(t.id, BOB, 9);
    await fa.reconcile();
    expect(w.starts).toHaveLength(2);
  });

  it('a new instance over a board that already has the worktree starts nothing (a restart)', async () => {
    const t = task();
    const w = world({ issues: [t] });
    await new FederationAccept(w.deps).reconcile();
    await new FederationAccept(w.deps).reconcile();
    expect(w.starts).toHaveLength(1);
  });

  it('after a restart it still knows what it started and counts them: atOnce 2, 2 running, no third', async () => {
    const ts = [task(), task(), task()];
    const w = world({ issues: ts, settings: { atOnce: 2 } });
    await new FederationAccept(w.deps).reconcile();
    expect(w.starts).toHaveLength(2);
    const fresh = new FederationAccept(w.deps);
    expect(w.issues.filter((i) => isAutoRunning(i, ME, (x) => w.live.has(x)))).toHaveLength(2);
    await fresh.reconcile();
    expect(w.starts).toHaveLength(2);
  });

  it('a worktree started by hand takes no place', async () => {
    const byHand = task({ status: 'in_progress', worktrees: ['mine'], activity: [{ id: 'h', at: 1, by: { kind: 'person', id: ME, name: 'Me' }, kind: 'status', text: 'moved this to In Progress' }] });
    const mineClaude = task({ status: 'in_progress', worktrees: ['mine2'], activity: [{ id: 'c', at: 1, by: { kind: 'claude', owner: ME, ownerName: 'Me' }, kind: 'status', text: 'moved this to In Progress' }] });
    const t = task();
    const w = world({ issues: [byHand, mineClaude, t], settings: { atOnce: 1 } });
    await new FederationAccept(w.deps).reconcile();
    expect(w.starts.map((s) => s.id)).toEqual([t.id]);
  });

  it('never two passes at once: a call during one runs once more after it', async () => {
    const a = task();
    const b = task();
    const w = world({ issues: [a] });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let inside = 0;
    let most = 0;
    const start = w.deps.start;
    const fa = new FederationAccept({
      ...w.deps,
      start: async (id, by) => {
        inside++;
        most = Math.max(most, inside);
        await gate;
        const r = await start(id, by);
        inside--;
        return r;
      },
    });
    const first = fa.reconcile();
    // Given while the first pass waits on its start.
    w.add(b);
    const second = fa.reconcile();
    expect(second).toBe(first);
    release();
    await fa.settled();
    expect(most).toBe(1);
    expect(w.starts.map((s) => s.id)).toEqual([a.id, b.id]);
  });
});
