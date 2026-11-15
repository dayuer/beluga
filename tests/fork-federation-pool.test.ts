import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import type { Activity, Actor, Issue } from '../src/core/board/model.js';
import type { Field, SharedTask } from '../src/core/team/crdt.js';
import { TeamBoardSync } from '../src/core/team/board-sync.js';
import { type Crowd, befriend, crowd, settle } from './mesh/helpers.js';
import { type PartsFor, type TeamMac, personOf, teamMac } from './team/helpers.js';
import { type AcceptDeps, FederationAccept } from '../src/fork/federation/accept.js';
import { autoActor, isAutoRunning, isAutoStarted } from '../src/fork/federation/marker.js';
import { type FederationSettings, federationOf } from '../src/fork/federation/settings.js';

/**
 * The pool wired into auto accept (BLG-231): claim, wait on an injected clock, start once if it's
 * still ours. Two Macs at once (BLG-232): one wins, the other, if it started, stops and archives.
 */

const ME = 'me00000000000001';
const BOB = 'bob0000000000002';
const NAMES: Record<string, string> = { [ME]: 'Me', [BOB]: 'Bob' };
const person = (id: string) => ({ kind: 'person' as const, id, name: NAMES[id] ?? id });
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
    labels: ['pool'],
    assignee: undefined,
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
    createdBy: person(BOB),
    origin: 'manual',
    ...over,
  } as Issue;
}

/**
 * A board and its team copy: BOB labelled every task (pool) unless `givenBy` says a teammate gave
 * it outright. `after` and `defer` queue; nothing runs until the test flushes them.
 */
function world(opts: { issues: Issue[]; givenBy?: Record<string, string>; settings?: Partial<FederationSettings> }) {
  let issues = [...opts.issues];
  const shared = new Map<string, SharedTask>();
  for (const i of issues) {
    const fields: Record<string, Field> = { labels: field(i.labels, BOB) };
    const giver = opts.givenBy?.[i.id];
    if (giver) fields.assignee = field(i.assignee, giver);
    shared.set(i.id, { id: i.id, fields, acts: [] });
  }
  const live = new Set<string>(issues.flatMap((i) => i.worktrees));
  let settings: FederationSettings = federationOf({ accept: 'pool', ...opts.settings });
  const starts: Array<{ id: string; by: Actor }> = [];
  const updates: string[] = [];
  const archived: string[] = [];
  const timers: Array<{ ms: number; fn: () => void }> = [];
  const deferred: Array<() => void> = [];
  let reads = 0;
  let ws = 0;
  const set = (id: string, patch: Partial<Issue>): void => {
    issues = issues.map((i) => (i.id === id ? ({ ...i, ...patch } as Issue) : i));
  };
  /** Who it's for, as a peer's change would land: the board and the team copy (Lamport + 1). */
  const assign = (id: string, to: string | undefined, by: string): void => {
    set(id, { assignee: to ? person(to) : undefined });
    const s = shared.get(id)!;
    const l = (s.fields.assignee?.l ?? 5) + 1;
    shared.set(id, { ...s, fields: { ...s.fields, assignee: field(to ? person(to) : null, by, l) } });
  };
  const get = (ref: string) => issues.find((i) => i.id === ref || i.key === ref);
  const deps: AcceptDeps = {
    team: { self: ME, nameOf: (p: string) => NAMES[p] ?? p },
    board: {
      list: () => (reads++, issues),
      get,
      update: (ref, patch) => {
        updates.push(ref);
        assign(ref, patch.assignee?.id, ME);
        return get(ref)!;
      },
    },
    sync: { shared: (id: string) => shared.get(id), onChange: () => {} },
    start: async (id, by) => {
      starts.push({ id, by });
      const w = `ws${++ws}`;
      live.add(w);
      const i = get(id)!;
      const line: Activity = { id: `a${ws}`, at: 2, by, kind: 'status', text: 'moved this to In Progress' };
      set(id, { worktrees: [...i.worktrees, w], status: 'in_progress', activity: [...i.activity, line] });
      return w;
    },
    settings: () => settings,
    trustOf: (p) => (p === ME || p === BOB ? 'full' : 'ask'),
    live: (w) => live.has(w),
    after: (ms, fn) => void timers.push({ ms, fn }),
    random: () => 0,
    defer: (fn) => void deferred.push(fn),
    stopAndArchive: async (w) => {
      archived.push(w);
      live.delete(w);
    },
  };
  return {
    deps,
    starts,
    updates,
    archived,
    timers,
    set,
    get reads() {
      return reads;
    },
    get issues() {
      return issues;
    },
    get: (id: string) => get(id)!,
    assign,
    setSettings: (p: Partial<FederationSettings>) => (settings = { ...settings, ...p }),
    /** Run every confirm waiting on the clock. */
    flush: (): void => {
      for (const t of timers.splice(0)) t.fn();
    },
  };
}

describe('the pool in FederationAccept', () => {
  it('pool: claims a pool task as mine; after the delay, starts it once', async () => {
    const t = task();
    const w = world({ issues: [t] });
    const fa = new FederationAccept(w.deps);
    await fa.reconcile();
    expect(w.updates).toEqual([t.id]);
    expect(w.get(t.id).assignee?.id).toBe(ME);
    expect(w.starts).toHaveLength(0);
    expect(w.timers.map((x) => x.ms)).toEqual([3000]);
    w.flush();
    await fa.settled();
    expect(w.starts.map((s) => s.id)).toEqual([t.id]);
    expect(w.starts[0]!.by).toEqual(autoActor(ME, 'Me', BOB, 'Bob'));
    expect(isAutoStarted(w.get(t.id), ME)).toBe(true);
    await fa.reconcile();
    w.flush();
    await fa.settled();
    expect(w.starts).toHaveLength(1);
  });

  it('a teammate takes it before the delay: no start', async () => {
    const t = task();
    const w = world({ issues: [t] });
    const fa = new FederationAccept(w.deps);
    await fa.reconcile();
    w.assign(t.id, BOB, BOB);
    w.flush();
    await fa.settled();
    expect(w.starts).toEqual([]);
  });

  it('cleared before the delay: no start, and it may be claimed again', async () => {
    const t = task();
    const w = world({ issues: [t] });
    const fa = new FederationAccept(w.deps);
    await fa.reconcile();
    w.assign(t.id, undefined, BOB);
    w.flush();
    await fa.settled();
    expect(w.starts).toEqual([]);
    await fa.reconcile();
    expect(w.updates).toEqual([t.id, t.id]);
  });

  it('restart between claim and confirm: a new instance confirms and starts exactly once', async () => {
    const t = task();
    const w = world({ issues: [t] });
    const old = new FederationAccept(w.deps);
    await old.reconcile();
    old.stop();
    const fresh = new FederationAccept(w.deps);
    await fresh.reconcile();
    // No second claim: the board already says it's mine.
    expect(w.updates).toEqual([t.id]);
    expect(w.timers).toHaveLength(2);
    w.flush();
    await old.settled();
    await fresh.settled();
    expect(w.starts.map((s) => s.id)).toEqual([t.id]);
  });

  it('two passes on one instance: one confirm queued, one start', async () => {
    const t = task();
    const w = world({ issues: [t] });
    const fa = new FederationAccept(w.deps);
    await fa.reconcile();
    await fa.reconcile();
    expect(w.timers).toHaveLength(1);
    w.flush();
    await fa.settled();
    expect(w.starts).toHaveLength(1);
  });

  it('a pending one holds a place: atOnce 1 → nothing new is claimed', async () => {
    const [a, b] = [task(), task()];
    const w = world({ issues: [a, b], settings: { atOnce: 1 } });
    const fa = new FederationAccept(w.deps);
    await fa.reconcile();
    expect(w.updates).toEqual([a.id]);
    await fa.reconcile();
    expect(w.updates).toEqual([a.id]);
    w.flush();
    await fa.settled();
    // Running now holds the place: still nothing new.
    await fa.reconcile();
    expect(w.updates).toEqual([a.id]);
    expect(isAutoRunning(w.get(a.id), ME, (x) => x.startsWith('ws'))).toBe(true);
  });

  it('a pending one holds a place for tasks given to me too', async () => {
    const pooled = task({ priority: 'urgent' });
    const given = task({ labels: [], assignee: person(ME) });
    const w = world({ issues: [pooled, given], givenBy: { [given.id]: BOB }, settings: { atOnce: 1 } });
    w.assign(pooled.id, ME, ME);
    const fa = new FederationAccept(w.deps);
    await fa.reconcile();
    expect(w.starts).toEqual([]);
    w.flush();
    await fa.settled();
    expect(w.starts.map((s) => s.id)).toEqual([pooled.id]);
  });

  it('pool still starts what a teammate gives me, straight away', async () => {
    const given = task({ labels: [], assignee: person(ME) });
    const w = world({ issues: [given], givenBy: { [given.id]: BOB } });
    await new FederationAccept(w.deps).reconcile();
    expect(w.starts.map((s) => s.id)).toEqual([given.id]);
    expect(w.timers).toEqual([]);
  });

  it("assigned: no claims, a self-claimed pool task waits, a teammate's still starts", async () => {
    const free = task();
    const claimed = task();
    const given = task({ labels: [], assignee: person(ME) });
    const w = world({ issues: [free, claimed, given], givenBy: { [given.id]: BOB }, settings: { accept: 'assigned' } });
    w.assign(claimed.id, ME, ME);
    const fa = new FederationAccept(w.deps);
    await fa.reconcile();
    w.flush();
    await fa.settled();
    expect(w.updates).toEqual([]);
    expect(w.timers).toEqual([]);
    expect(w.starts.map((s) => s.id)).toEqual([given.id]);
  });

  it('switched to assigned while a confirm waits: it does not start', async () => {
    const t = task();
    const w = world({ issues: [t] });
    const fa = new FederationAccept(w.deps);
    await fa.reconcile();
    w.setSettings({ accept: 'assigned' });
    w.flush();
    await fa.settled();
    expect(w.starts).toEqual([]);
  });

  it('off: no reads, no claims', async () => {
    const w = world({ issues: [task()], settings: { accept: 'off' } });
    const fa = new FederationAccept(w.deps);
    await fa.reconcile();
    w.flush();
    await fa.settled();
    expect(w.reads).toBe(0);
    expect(w.updates).toEqual([]);
    expect(w.starts).toEqual([]);
  });

  it('a status line for myself counts as auto started', () => {
    const line: Activity = { id: 'a1', at: 2, by: autoActor(ME, 'Me', ME, 'Me'), kind: 'status', text: 'moved this to In Progress' };
    const t = task({ status: 'in_progress', assignee: person(ME), worktrees: ['ws1'] as unknown as Issue['worktrees'], activity: [line] });
    expect(isAutoStarted(t, ME)).toBe(true);
    expect(isAutoRunning(t, ME, () => true)).toBe(true);
    // Started by hand: still not.
    const byHand: Activity = { ...line, by: person(ME) };
    expect(isAutoStarted({ activity: [byHand] }, ME)).toBe(false);
  });

  it('no real timers or waits: time moves only through the injected after', () => {
    const src = readFileSync(new URL(import.meta.url), 'utf8');
    // Built from parts so this line isn't what it finds.
    for (const s of ['setTime' + 'out(', 'sle' + 'ep']) expect(src).not.toContain(s);
  });
});

describe('the pool, two Macs (BLG-232)', () => {
  it('a worktree started by hand stays when the task goes to someone else; one auto accept started goes, once', async () => {
    const handLine: Activity = { id: 'h', at: 2, by: person(ME), kind: 'status', text: 'moved this to In Progress' };
    const byHand = task({ status: 'in_progress', assignee: person(ME), worktrees: ['hand'] as unknown as Issue['worktrees'], activity: [handLine] });
    const auto = task();
    const cleared = task();
    const w = world({ issues: [byHand, auto, cleared] });
    const fa = new FederationAccept(w.deps);
    await fa.reconcile();
    w.flush();
    await fa.settled();
    expect(w.starts.map((x) => x.id).sort()).toEqual([auto.id, cleared.id].sort());
    // The board merges a teammate's claim over ours (and over the one I started by hand); one is cleared.
    w.assign(byHand.id, BOB, BOB);
    w.assign(auto.id, BOB, BOB);
    w.assign(cleared.id, undefined, BOB);
    await fa.reconcile();
    await fa.reconcile();
    expect(w.archived).toEqual([w.get(auto.id).worktrees.at(-1)]);
  });

  it('assigned: a lost pool task is never archived', async () => {
    const t = task();
    const w = world({ issues: [t] });
    const fa = new FederationAccept(w.deps);
    await fa.reconcile();
    w.flush();
    await fa.settled();
    w.setSettings({ accept: 'assigned' });
    w.assign(t.id, BOB, BOB);
    await fa.reconcile();
    expect(w.archived).toEqual([]);
  });

  let net: Crowd | undefined;
  const macs: TeamMac[] = [];
  afterEach(async () => {
    for (const m of macs.splice(0)) await m.close();
    await net?.close();
    net = undefined;
  });

  /** One Mac's auto accept on its real board and sync; its clock, starts and archives kept per Mac. */
  interface Rig {
    fa?: FederationAccept;
    sync?: TeamBoardSync;
    readonly timers: Array<() => void>;
    readonly starts: string[];
    readonly archived: string[];
    readonly live: Set<string>;
  }
  const rigs = new Map<string, Rig>();
  const rigOf = (name: string): Rig => {
    let r = rigs.get(name);
    if (!r) rigs.set(name, (r = { timers: [], starts: [], archived: [], live: new Set() }));
    return r;
  };
  const withPool: PartsFor = ({ team, board, dir, name }) => {
    const r = rigOf(name);
    const sync = new TeamBoardSync(team, { board, live: (id) => r.live.has(id), running: () => false, dir });
    const fa = new FederationAccept({
      team,
      board,
      sync,
      // What work.start does to the board: a worktree linked, In Progress, as the actor it was given.
      start: async (id, by) => {
        r.starts.push(id);
        const ws = `ws-${name}-${r.starts.length}`;
        r.live.add(ws);
        board.linkWorktree(id, ws, { name: ws }, by);
        board.update(id, { status: 'in_progress' }, by);
        return ws;
      },
      settings: () => federationOf({ accept: 'pool' }),
      trustOf: () => 'full',
      live: (w) => r.live.has(w),
      after: (_ms, fn) => void r.timers.push(fn),
      random: () => 0,
      // Passes run only when the test calls reconcile.
      defer: () => {},
      stopAndArchive: async (w) => {
        r.archived.push(w);
        r.live.delete(w);
      },
      log: () => {},
    });
    r.fa = fa;
    r.sync = sync;
    return [sync, fa];
  };
  const flush = async (...names: string[]): Promise<void> => {
    for (const n of names) for (const fn of rigOf(n).timers.splice(0)) fn();
    for (const n of names) await rigOf(n).fa!.settled();
  };

  async function teamUp(a: TeamMac, pa: string, b: TeamMac, pb: string): Promise<void> {
    await settle(() => a.store.getState().team.offers.find((o) => o.peerId === b.id && o.projectId === pa) && b.store.getState().team.offers.find((o) => o.peerId === a.id && o.projectId === pb));
    a.team.answer(b.id, pa, true);
    await settle(() => b.store.getState().team.offers.find((o) => o.peerId === a.id && o.state === 'invited'));
    b.team.answer(a.id, pb, true);
    await settle(() => a.store.getState().team.teams[pa]?.mates.some((m) => m.peerId === b.id) && b.store.getState().team.teams[pb]?.mates.some((m) => m.peerId === a.id));
  }

  async function pair(): Promise<{ ata: TeamMac; kay: TeamMac; id: string }> {
    rigs.clear();
    net = await crowd();
    const ata = await teamMac(net, 'ata', [{ id: 'pa', name: 'api', repo: 'acme/api' }], withPool);
    const kay = await teamMac(net, 'kay', [{ id: 'pk', name: 'api', repo: 'acme/api' }], withPool);
    macs.push(ata, kay);
    const t = ata.board.create({ projectId: 'pa', title: 'From the pool', status: 'todo', labels: ['pool'] }, personOf(ata));
    await befriend(ata.person, kay.person);
    await teamUp(ata, 'pa', kay, 'pk');
    await settle(() => kay.board.get(t.id)?.labels.includes('pool') && rigOf('kay').sync!.shared(t.id)?.fields.labels);
    return { ata, kay, id: t.id };
  }

  const owner = (m: TeamMac, id: string) => m.board.get(id)?.assignee?.id;

  it('both claim at once: the merge keeps one, and only that one starts', async () => {
    const { ata, kay, id } = await pair();
    expect(kay.board.get(id)?.status).toBe('todo');
    // Back to back, no await between: both claim in the same tick.
    const both = [rigOf('ata').fa!.reconcile(), rigOf('kay').fa!.reconcile()];
    await Promise.all(both);
    expect(owner(ata, id)).toBe(ata.id);
    expect(owner(kay, id)).toBe(kay.id);
    await settle(() => owner(ata, id) === owner(kay, id) && rigOf('ata').sync!.shared(id)?.fields.assignee?.a === rigOf('kay').sync!.shared(id)?.fields.assignee?.a);
    const winner = owner(ata, id) === ata.id ? 'ata' : 'kay';
    const loser = winner === 'ata' ? 'kay' : 'ata';
    await flush('ata', 'kay');
    expect(rigOf(winner).starts).toEqual([id]);
    expect(rigOf(loser).starts).toEqual([]);
    expect(rigOf('ata').archived).toEqual([]);
    expect(rigOf('kay').archived).toEqual([]);
  }, 90_000);

  it('partitioned: both start; after the merge the loser stops and archives once, the winner never', async () => {
    const { ata, kay, id } = await pair();
    await kay.stop();
    await settle(() => ata.person.friend(kay.id)?.online === false);
    // Ata, alone, claims and starts as auto accept does.
    await rigOf('ata').fa!.reconcile();
    await flush('ata');
    expect(rigOf('ata').starts).toEqual([id]);
    // Kay, cut off, did the same on its own board: claimed it, then started it as its Claude.
    const by = autoActor(kay.id, kay.name, ata.id, ata.name);
    kay.board.update(id, { assignee: personOf(kay) }, by);
    rigOf('kay').live.add('ws-kay-offline');
    kay.board.linkWorktree(id, 'ws-kay-offline', { name: 'ws-kay-offline' }, by);
    kay.board.update(id, { status: 'in_progress' }, by);
    await kay.start();
    await settle(() => owner(ata, id) !== undefined && owner(ata, id) === owner(kay, id));
    const winner = owner(ata, id) === ata.id ? 'ata' : 'kay';
    const loser = winner === 'ata' ? 'kay' : 'ata';
    for (let i = 0; i < 2; i++) {
      await rigOf('ata').fa!.reconcile();
      await rigOf('kay').fa!.reconcile();
    }
    await flush('ata', 'kay');
    expect(rigOf(loser).archived).toEqual([loser === 'ata' ? 'ws-ata-1' : 'ws-kay-offline']);
    expect(rigOf(winner).archived).toEqual([]);
    // Nobody started it again.
    expect(rigOf('ata').starts).toEqual([id]);
    expect(rigOf('kay').starts).toEqual([]);
  }, 90_000);
});
