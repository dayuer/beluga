import { describe, expect, it } from 'vitest';
import type { Plan } from '../src/core/plans/model.js';
import { Store, initialState } from '../src/core/store.js';
import { DaemonUp } from '../src/net/studio/handler.js';
import { alwaysAllow, type Deps } from '../src/net/studio/handler.js';
import { ingestPatch, ingestPlan, readView } from '../src/net/studio/views.js';
import { memoryHub, memoryStudio, type HubStore, type StudioStore } from '../src/net/studio/store.js';
import { refOf, type StudioConfig } from '../src/studio/keys.js';
import { StudioPublisher, keyPrefixesOf, type PublishTimers } from '../src/studio/publish.js';
import type { Project } from '../src/workspaces/types.js';

/**
 * BLG-68: what the daemon publishes to Studio. The store is the real one, the clock and the
 * timers are the test's, and every frame is checked with the hub's own `DaemonUp` and then fed to
 * the hub's real `ingestPlan`/`ingestPatch`, so an accepted frame is one the customer can read.
 */

const REF_KEY = Buffer.alloc(32, 7).toString('base64url');

const project = (id: string, name: string): Project => ({ id, name, root: `/tmp/${name}`, base: 'main', workspaces: [] }) as Project;

const BODY = {
  title: 'Parser',
  goal: 'A faster parser.',
  milestones: [
    {
      id: 'm1',
      title: 'Fast',
      criteria: ['fast'],
      tasks: [
        { id: 't1', title: 'Lexer', acceptance: [], blockedBy: [], issueId: 'i1' },
        { id: 't2', title: 'Tree', acceptance: [], blockedBy: ['t1'], issueId: 'i2' },
      ],
    },
  ],
};

const planOf = (over: Partial<Plan> = {}): Plan => ({
  id: 'pl1',
  projectId: 'p1',
  home: 'ws:home',
  status: 'active',
  body: BODY,
  draftRev: 1,
  autonomy: 'gated',
  maxParallel: 3,
  paused: false,
  testsAt: 'end',
  runs: {},
  activity: [],
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

// --- Fake time ---

function clock(): { timers: PublishTimers; advance(ms: number): void; now(): number } {
  let now = 1_000;
  let nextId = 1;
  const jobs = new Map<number, { at: number; fn: () => void }>();
  const timers: PublishTimers = {
    setTimeout: (fn, ms) => {
      const id = nextId++;
      jobs.set(id, { at: now + Math.max(0, ms), fn });
      return id;
    },
    clearTimeout: (id) => void jobs.delete(id as number),
  };
  const advance = (ms: number): void => {
    const until = now + ms;
    for (;;) {
      let due: [number, { at: number; fn: () => void }] | undefined;
      for (const entry of jobs) if (entry[1].at <= until && (!due || entry[1].at < due[1].at)) due = entry;
      if (!due) break;
      const [id, job] = due;
      now = job.at;
      jobs.delete(id);
      job.fn();
    }
    now = until;
  };
  return { timers, advance, now: () => now };
}

function world(): Store {
  const store = new Store(initialState('room'));
  store.dispatch({ type: 'projects', projects: [project('p1', 'bob-api'), project('p2', 'shop')] });
  store.dispatch({ type: 'board_meta', projects: { p1: { prefix: 'BOB', next: 1 }, p2: { prefix: 'SHP', next: 1 } }, autoTasks: false });
  store.dispatch({ type: 'plans_init', state: { enabled: true, plans: [planOf()], style: '' } });
  return store;
}

function config(shared: string[] = ['p1']): StudioConfig {
  return {
    v: 1,
    hub: 'http://localhost:8787',
    studioId: 'st1',
    daemonId: 'dn1',
    name: 'Mac',
    linkedAt: 0,
    key: 'unused',
    refKey: REF_KEY,
    projects: Object.fromEntries(shared.map((id) => [id, { since: 0 }])),
  };
}

interface Harness {
  readonly store: Store;
  readonly publisher: StudioPublisher;
  readonly sent: DaemonUp[];
  readonly full: DaemonUp[];
  readonly time: ReturnType<typeof clock>;
  cfg(next?: StudioConfig): StudioConfig;
  setOnline(v: boolean): void;
}

function harness(store: Store, start = config()): Harness {
  const time = clock();
  const sent: DaemonUp[] = [];
  const full: DaemonUp[] = [];
  let cfg = start;
  let online = true;
  const publisher = new StudioPublisher({
    store,
    config: () => cfg,
    send: (frame) => {
      if (!online) return false;
      sent.push(frame);
      return true;
    },
    timers: time.timers,
    now: time.now,
  });
  publisher.start();
  full.push(...publisher.snapshot());
  publisher.onOnline();
  return {
    store,
    publisher,
    sent,
    full,
    time,
    cfg: (next) => {
      if (next) cfg = next;
      return cfg;
    },
    setOnline: (v) => void (online = v),
  };
}

const patchOf = (frame: DaemonUp | undefined): Extract<DaemonUp, { t: 'patch' }> => {
  if (!frame || frame.t !== 'patch') throw new Error(`not a patch: ${JSON.stringify(frame)}`);
  return frame;
};

const projectRef = (cfg: StudioConfig, id = 'p1'): string => refOf(cfg.refKey, 'project', id);

describe('StudioPublisher', () => {
  it('sends one patch for a title change within a second, and only the title', () => {
    const store = world();
    const h = harness(store);
    store.dispatch({ type: 'plan_put', plan: planOf({ body: { ...BODY, title: 'Parser 2' } }) });
    h.time.advance(250);
    expect(h.sent).toHaveLength(1);
    const patch = patchOf(h.sent[0]);
    expect(patch.t).toBe('patch');
    expect(Object.keys(patch.set ?? {})).toEqual(['title']);
    expect((patch.set as { title: string }).title).toBe('Parser 2');
    expect(patch.turns).toBeUndefined();
    h.time.advance(2_000);
    expect(h.sent).toHaveLength(1);
    h.publisher.stop();
  });

  it('coalesces a burst of changes into one frame', () => {
    const store = world();
    const h = harness(store);
    store.dispatch({ type: 'plan_put', plan: planOf({ body: { ...BODY, title: 'A' } }) });
    h.time.advance(100);
    store.dispatch({ type: 'plan_put', plan: planOf({ body: { ...BODY, title: 'B' } }) });
    h.time.advance(100);
    store.dispatch({ type: 'plan_put', plan: planOf({ body: { ...BODY, title: 'C' } }) });
    h.time.advance(250);
    expect(h.sent).toHaveLength(1);
    expect((patchOf(h.sent[0]).set as { title: string }).title).toBe('C');
    h.publisher.stop();
  });

  it('never publishes a plan of a project nobody shared', () => {
    const store = world();
    store.dispatch({ type: 'plan_put', plan: planOf({ id: 'pl2', projectId: 'p2', body: { ...BODY, title: 'Secret shop' } }) });
    const h = harness(store, config(['p1']));
    expect(h.full).toHaveLength(1);
    const text = JSON.stringify(h.full);
    expect(text).not.toContain('Secret shop');
    expect(text).not.toContain(projectRef(config(), 'p2'));
    h.time.advance(1_000);
    expect(JSON.stringify(h.sent)).not.toContain('Secret shop');
    h.publisher.stop();
  });

  it('sends frames the hub parses, with paths, task keys and model names taken out', () => {
    const store = world();
    const leaky = {
      ...BODY,
      title: 'Fix BLG-12 in src/auth.ts with claude-opus-5-5',
      goal: 'The login in /Users/me/app/src/auth.ts fails; see plan/synon-studio-p1 and API_KEY=abc',
    };
    store.dispatch({ type: 'plan_put', plan: planOf({ body: leaky }) });
    const h = harness(store);
    store.dispatch({ type: 'plan_put', plan: planOf({ body: { ...leaky, title: 'Fix BLG-13 in src/login.tsx with claude-opus-5-5' } }) });
    h.time.advance(250);
    const frames = [...h.full, ...h.sent];
    expect(frames).not.toHaveLength(0);
    for (const frame of frames) expect(DaemonUp.safeParse(frame).success).toBe(true);
    const text = JSON.stringify(frames);
    for (const secret of ['BLG-12', 'BLG-13', 'src/auth.ts', 'src/login.tsx', '/Users/me', 'plan/synon-studio-p1', 'claude-opus-5-5', 'API_KEY']) {
      expect(text).not.toContain(secret);
    }
    h.publisher.stop();
  });

  it('pushes the whole view again when the hub asks for a resync, at most every five seconds', () => {
    const store = world();
    const h = harness(store);
    const ref = projectRef(h.cfg());
    const first = h.full[0] as Extract<DaemonUp, { t: 'for' }>;
    const planRef = first.frame.t === 'plan' ? first.frame.view.planRef : first.frame.planRef;
    h.publisher.onResync(ref, planRef);
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]!.t).toBe('for');
    expect((h.sent[0] as Extract<DaemonUp, { t: 'for' }>).frame.t).toBe('plan');
    h.publisher.onResync(ref);
    expect(h.sent).toHaveLength(1); // throttled
    h.time.advance(5_000);
    h.publisher.onResync(ref);
    expect(h.sent).toHaveLength(2);
    h.publisher.stop();
  });

  it('says plan-gone for a deleted plan and for one whose project was unshared', () => {
    const store = world();
    const h = harness(store);
    store.dispatch({ type: 'plan_remove', id: 'pl1' });
    h.time.advance(250);
    expect(h.sent).toHaveLength(1);
    const gone = h.sent[0] as Extract<DaemonUp, { t: 'for' }>;
    expect(gone.t).toBe('for');
    expect(gone.frame.t).toBe('plan-gone');

    const again = harness(world());
    again.cfg(config([]));
    again.publisher.projectsChanged();
    const types = again.sent.map((f) => (f.t === 'for' ? `for:${f.frame.t}` : f.t));
    expect(types[0]).toBe('hello');
    expect(types).toContain('for:plan-gone');
    expect(JSON.parse(JSON.stringify(again.sent[0]))).toMatchObject({ projects: [] });
    h.publisher.stop();
    again.publisher.stop();
  });

  it('sends the whole plan again when an optional field goes away', () => {
    const store = world();
    store.dispatch({ type: 'plan_put', plan: planOf({ draft: BODY }) });
    const h = harness(store);
    expect((h.full[0] as Extract<DaemonUp, { t: 'for' }>).frame.t).toBe('plan');
    expect(JSON.stringify(h.full[0])).toContain('draftDiff');
    store.dispatch({ type: 'plan_put', plan: planOf() });
    h.time.advance(250);
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]!.t).toBe('for');
    expect(JSON.stringify(h.sent[0])).not.toContain('draftDiff');
    h.publisher.stop();
  });

  it('keeps missing while offline and catches up after onOnline', () => {
    const store = world();
    const h = harness(store);
    h.setOnline(false);
    store.dispatch({ type: 'plan_put', plan: planOf({ body: { ...BODY, title: 'While offline' } }) });
    h.time.advance(1_000);
    expect(h.sent).toHaveLength(0);
    // The link would push a new full snapshot on reconnect; without one, the next refresh diffs.
    h.setOnline(true);
    h.publisher.onOnline();
    h.time.advance(1_000);
    expect(h.sent).toHaveLength(1);
    expect((patchOf(h.sent[0]).set as { title: string }).title).toBe('While offline');
    h.publisher.stop();
  });

  it('a patch is readable through the hub’s real ingestPatch', async () => {
    const store = world();
    const hub: HubStore = memoryHub();
    const studio: StudioStore = memoryStudio();
    const deps: Deps & { studio: StudioStore } = {
      hub,
      studio,
      now: 5_000,
      random: (n) => crypto.getRandomValues(new Uint8Array(n)),
      mailer: { send: async () => {} },
      ent: alwaysAllow,
      operatorTokenHash: '',
      origin: 'https://hub.test',
    };
    const ref = projectRef(config());
    await hub.createProject({ id: 'stp1', studioId: 'st1', name: 'App', now: 0 });
    await hub.bindProject({ projectId: 'stp1', daemonId: 'dn1', daemonProjectId: ref, now: 0 });

    const h = harness(store);
    const first = h.full[0] as Extract<DaemonUp, { t: 'for' }>;
    expect(first.project).toBe(ref);
    const ingested = await ingestPlan('dn1', { project: ref, frame: first.frame }, deps);
    expect(ingested.ok).toBe(true);
    const planRef = ingested.ok ? ingested.planRef : '';

    store.dispatch({ type: 'plan_put', plan: planOf({ body: { ...BODY, title: 'Parser, hardened' } }) });
    h.time.advance(250);
    const patch = patchOf(h.sent[0]);
    const applied = await ingestPatch('dn1', { project: ref, planRef: patch.planRef, rev: patch.rev, ...(patch.set ? { set: patch.set } : {}) }, deps);
    expect(applied.ok).toBe(true);
    const shown = await readView('stp1', planRef, deps);
    expect(shown?.view.title).toBe('Parser, hardened');
    h.publisher.stop();
  });

  it('moves a plan between shared projects: gone under the old one, full under the new', () => {
    const store = world();
    const h = harness(store, config(['p1', 'p2']));
    expect(h.full).toHaveLength(1);
    store.dispatch({ type: 'plan_put', plan: planOf({ projectId: 'p2' }) });
    h.time.advance(250);
    expect(h.sent).toHaveLength(2);
    const [gone, full] = h.sent as [Extract<DaemonUp, { t: 'for' }>, Extract<DaemonUp, { t: 'for' }>];
    expect(gone.project).toBe(projectRef(h.cfg(), 'p1'));
    expect(gone.frame.t).toBe('plan-gone');
    expect(full.project).toBe(projectRef(h.cfg(), 'p2'));
    expect(full.frame.t).toBe('plan');
    h.publisher.stop();
  });

  it('says plan-gone for everything it published when it leaves (unlinking)', () => {
    const store = world();
    store.dispatch({ type: 'plan_put', plan: planOf({ id: 'pl2', body: { ...BODY, title: 'Second' } }) });
    const h = harness(store);
    expect(h.full).toHaveLength(2);
    h.publisher.leave();
    expect(h.sent).toHaveLength(2);
    for (const frame of h.sent) {
      expect(frame.t).toBe('for');
      expect((frame as Extract<DaemonUp, { t: 'for' }>).frame.t).toBe('plan-gone');
    }
    h.publisher.stop();
  });

  it('takes the project’s board prefixes with it', () => {
    const prefixes = keyPrefixesOf({ enabled: true, issues: [], projects: { p1: { prefix: 'BOB', next: 1 }, both: { prefix: 'TWO', next: 1, repos: ['p1', 'p2'] } }, autoTasks: false }, 'p1');
    expect(prefixes.sort()).toEqual(['BOB', 'TWO']);
    expect(keyPrefixesOf({ enabled: true, issues: [], projects: {}, autoTasks: false }, 'p1')).toEqual([]);
  });
});
