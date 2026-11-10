import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { asActingAgent } from '../src/core/acting-agent.js';
import { Board } from '../src/core/board/board.js';
import { BoardWork } from '../src/core/board/work.js';
import type { Autonomy, Plan, PlanBody } from '../src/core/plans/model.js';
import { Plans } from '../src/core/plans/plans.js';
import { passable } from '../src/core/plans/progress.js';
import { PlansWork } from '../src/core/plans/work.js';
import { Store, initialState } from '../src/core/store.js';
import type { WorkspaceController } from '../src/core/workspace-controller.js';
import type { Project, Workspace } from '../src/workspaces/types.js';
import { allNeeds } from '../src/companion/needs-you.js';
import { callRefusal } from '../src/studio/actions.js';
import { START_DECLINED, STALE_DECLINED, StudioGates } from '../src/studio/gates.js';
import { refOf, type StudioConfig } from '../src/studio/keys.js';

/**
 * BLG-74: the start Gate (docs/studio-gates.md §3). `approve` is a spy: the Gate must call it
 * exactly once, only after the operator says yes, only for the draft the customer confirmed, and
 * never on its own. The source scan at the end proves no other file in `src/studio/` can reach it.
 */

const REF_KEY = Buffer.alloc(32, 7).toString('base64url');

const DRAFT: PlanBody = {
  title: 'Shop',
  goal: 'Sell coffee online.',
  milestones: [
    {
      id: 'm1',
      title: 'Sign in',
      criteria: ['works'],
      tasks: [{ id: 't1', title: 'Sign-in form', acceptance: ['works'], blockedBy: [], estimate: 3 }],
    },
  ],
};

const project = (id: string, name: string, workspaces: Workspace[] = []): Project => ({ id, name, root: `/tmp/${name}`, base: 'main', workspaces }) as Project;
const ws = (id: string, name: string): Workspace => ({ id, projectId: 'api', name, path: `/tmp/${name}`, kind: 'chat', projectRoot: '/tmp/p', branch: `beluga/${name}`, createdAt: 0, external: false }) as Workspace;

const planOf = (over: Partial<Plan> = {}): Plan => ({
  id: 'pl1',
  projectId: 'p1',
  home: 'ws:home',
  status: 'active',
  draft: DRAFT,
  draftRev: 3,
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

function config(shared = ['p1']): StudioConfig {
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
  readonly gates: StudioGates;
  readonly approved: string[];
  readonly demoted: Array<{ id: string; autonomy: Autonomy; milestone?: string }>;
  readonly touched: Array<string | undefined>;
  plan(): Plan;
  setPlan(over: Partial<Plan>): void;
}

function harness(over: Partial<Plan> = {}): Harness {
  const store = new Store(initialState('room'));
  store.dispatch({ type: 'projects', projects: [project('p1', 'shop')] });
  store.dispatch({ type: 'plans_init', state: { enabled: true, plans: [planOf(over)], style: '' } });
  const approved: string[] = [];
  const demoted: Harness['demoted'] = [];
  const touched: Array<string | undefined> = [];
  const setPlan = (next: Partial<Plan>): void => {
    const plans = store.getState().plans;
    store.dispatch({ type: 'plans_init', state: { ...plans, plans: plans.plans.map((p) => (p.id === 'pl1' ? { ...p, ...next } : p)) } });
  };
  const gates = new StudioGates({
    store,
    config: () => config(),
    // What PlansWork.approve does to the store, short of the board: a body and one more revision.
    approve: (id) => {
      approved.push(id);
      setPlan({ body: DRAFT, draftRev: 4 });
    },
    setAutonomy: (id, autonomy, milestone) => {
      demoted.push({ id, autonomy, ...(milestone ? { milestone } : {}) });
      const plan = store.getState().plans.plans.find((p) => p.id === id);
      if (!plan) return;
      if (milestone) {
        const patch = (b: PlanBody | undefined) => (b ? { ...b, milestones: b.milestones.map((m) => (m.id === milestone ? { ...m, autonomy } : m)) } : b);
        setPlan({ body: patch(plan.body), draft: patch(plan.draft) });
      } else setPlan({ autonomy });
    },
    persist: () => undefined,
    touch: (planId) => void touched.push(planId),
    now: () => 1_000,
  });
  return {
    store,
    gates,
    approved,
    demoted,
    touched,
    plan: () => store.getState().plans.plans.find((p) => p.id === 'pl1')!,
    setPlan,
  };
}

const opId = (): string => crypto.randomUUID();

describe('the start Gate (BLG-74)', () => {
  it('raises a pending card with the plan’s numbers and calls no approve', () => {
    const h = harness();
    const op = opId();
    expect(h.gates.request(h.plan(), 'start', 3, op, 'Mia')).toBeUndefined();
    expect(h.approved).toEqual([]);
    expect(h.gates.viewGate('pl1')).toEqual({ kind: 'start', state: 'pending', draftRev: 3 });
    expect(h.gates.needs()).toEqual([
      {
        id: `g-${op.slice(0, 8)}`,
        planId: 'pl1',
        kind: 'start',
        draftRev: 3,
        askedAt: 1_000,
        by: 'Mia',
        title: 'Shop',
        milestones: 1,
        points: 3,
      },
    ]);
    expect(h.touched).toEqual(['pl1']);
  });

  it('refuses to raise a start Gate with no milestones, or while a fresh review is running', () => {
    const empty = harness({ draft: { ...DRAFT, milestones: [] } });
    expect(empty.gates.request(empty.plan(), 'start', 3, opId())).toBe('not-open');
    const reviewing = harness({ status: 'draft', review: { rev: 3, at: 0, state: 'reviewing', findings: [] } });
    expect(reviewing.gates.request(reviewing.plan(), 'start', 3, opId())).toBe('not-open');
  });

  it('keeps one Gate per plan: the same draft keeps it, a moved draft replaces it', () => {
    const h = harness();
    const first = opId();
    h.gates.request(h.plan(), 'start', 3, first);
    expect(h.gates.request(h.plan(), 'start', 3, opId())).toBeUndefined();
    expect(h.gates.needs()).toHaveLength(1);
    expect(h.gates.needs()[0]?.id).toBe(`g-${first.slice(0, 8)}`);

    // The draft moved (the old card is no longer for this draft), then the customer confirms again.
    h.setPlan({ draftRev: 4 });
    h.gates.request(h.plan(), 'start', 4, opId());
    const cards = h.gates.needs();
    expect(cards).toHaveLength(1);
    expect(cards[0]?.draftRev).toBe(4);
    expect(h.gates.viewGate('pl1')).toMatchObject({ state: 'pending', draftRev: 4 });
  });

  it('approves with exactly one call, and the plan starts', () => {
    const h = harness();
    const op = opId();
    h.gates.request(h.plan(), 'start', 3, op);
    const id = `g-${op.slice(0, 8)}`;
    expect(h.gates.answer(id, { approve: true })).toEqual({ ok: true, state: 'approved' });
    expect(h.approved).toEqual(['pl1']);
    expect(h.plan().body).toEqual(DRAFT);
    expect(h.gates.viewGate('pl1')).toMatchObject({ kind: 'start', state: 'approved', draftRev: 3 });
    expect(h.gates.needs()).toEqual([]);
    // A second answer changes nothing (the plan is not approved twice).
    expect(h.gates.answer(id, { approve: true })).toEqual({ ok: false, error: 'settled' });
    expect(h.approved).toEqual(['pl1']);
  });

  it('declines with the operator’s reason and leaves the plan as it was', () => {
    const h = harness();
    const op = opId();
    h.gates.request(h.plan(), 'start', 3, op);
    expect(h.gates.answer(`g-${op.slice(0, 8)}`, { approve: false, reason: '预算还不够' })).toEqual({ ok: true, state: 'declined' });
    expect(h.plan()).toMatchObject({ draftRev: 3, autonomy: 'gated' });
    expect(h.plan().body).toBeUndefined();
    expect(h.gates.viewGate('pl1')).toMatchObject({ state: 'declined', reason: '预算还不够' });
    expect(h.approved).toEqual([]);
  });

  it('uses the default sentence when a decline has no reason', () => {
    const h = harness();
    const op = opId();
    h.gates.request(h.plan(), 'start', 3, op);
    h.gates.answer(`g-${op.slice(0, 8)}`, { approve: false });
    expect(h.gates.viewGate('pl1')?.reason).toBe(START_DECLINED);
  });

  it('will not approve a draft that moved after the customer confirmed it (the answer-time check)', () => {
    const h = harness();
    const op = opId();
    h.gates.request(h.plan(), 'start', 3, op);
    // No store subscription between the change and the answer: the Gate's own check is what sees it.
    h.gates.stop();
    h.setPlan({ draftRev: 4 });
    expect(h.gates.answer(`g-${op.slice(0, 8)}`, { approve: true })).toEqual({ ok: false, error: 'stale' });
    expect(h.approved).toEqual([]);
    expect(h.gates.viewGate('pl1')).toMatchObject({ state: 'declined', reason: STALE_DECLINED });
  });

  it('declines by itself when the draft moves under a waiting Gate', () => {
    const h = harness();
    const op = opId();
    h.gates.request(h.plan(), 'start', 3, op);
    h.setPlan({ draftRev: 4 });
    expect(h.gates.viewGate('pl1')).toMatchObject({ state: 'declined', reason: STALE_DECLINED });
    expect(h.gates.answer(`g-${op.slice(0, 8)}`, { approve: true })).toEqual({ ok: false, error: 'settled' });
    expect(h.approved).toEqual([]);
  });

  it('records approved, without calling approve, when the plan started elsewhere', () => {
    const h = harness();
    const op = opId();
    h.gates.request(h.plan(), 'start', 3, op);
    h.setPlan({ body: DRAFT });
    expect(h.gates.viewGate('pl1')).toMatchObject({ state: 'approved' });
    expect(h.approved).toEqual([]);
  });

  it('voids a Gate whose plan is gone', () => {
    const h = harness();
    const op = opId();
    h.gates.request(h.plan(), 'start', 3, op);
    h.store.dispatch({ type: 'plans_init', state: { ...h.store.getState().plans, plans: [] } });
    expect(h.gates.viewGate('pl1')).toBeUndefined();
    expect(h.gates.answer(`g-${op.slice(0, 8)}`, { approve: true })).toEqual({ ok: false, error: 'gone' });
  });

  it('shows the plan as the customer view’s gate, and hides a void one', () => {
    const h = harness();
    h.gates.request(h.plan(), 'start', 3, opId());
    expect(h.gates.viewGate('pl1')).toEqual({ kind: 'start', state: 'pending', draftRev: 3 });
    h.gates.unlink();
    expect(h.gates.viewGate('pl1')).toBeUndefined();
  });

  it('brings an autopilot plan back to gated when it is shared, saying why', () => {
    const h = harness({ autonomy: 'autopilot' });
    h.store.dispatch({ type: 'studio_state', shared: ['p1'], gates: [] });
    expect(h.demoted).toEqual([{ id: 'pl1', autonomy: 'gated' }]);
    expect(h.plan().autonomy).toBe('gated');
    expect(h.store.getState().log.some((item) => JSON.stringify(item).includes('autopilot was turned off'))).toBe(true);
  });

  it('brings an autopilot milestone back too', () => {
    const h = harness({ draft: { ...DRAFT, milestones: [{ ...DRAFT.milestones[0]!, autonomy: 'autopilot' }] } });
    h.store.dispatch({ type: 'studio_state', shared: ['p1'], gates: [] });
    expect(h.demoted).toEqual([{ id: 'pl1', autonomy: 'gated', milestone: 'm1' }]);
  });

  it('plans.setAutonomy refuses autopilot for a shared plan', () => {
    const store = new Store(initialState('room'));
    store.dispatch({ type: 'projects', projects: [project('api', 'bob-api', [ws('main', 'bob-api')])] });
    const controller = { onWorktree: () => () => undefined } as unknown as WorkspaceController;
    const board = new Board({ store, dir: null, projectName: () => 'bob-api' });
    const boardWork = new BoardWork({ store, board, controller, selfId: () => 'p-me', selfName: () => 'Kay', askClaude: () => undefined });
    const plans = new Plans({ store, dir: null });
    const work = new PlansWork({ store, plans, board: boardWork, git: null, askClaude: () => 'ask', intend: () => undefined, delayMs: 0 });
    const plan = plans.create({ projectId: 'api', home: 'ws:main', autonomy: 'gated' }, boardWork.myClaude());
    store.dispatch({ type: 'studio_state', shared: ['api'], gates: [] });
    expect(() => work.setAutonomy(plan.id, 'autopilot')).toThrow(/autopilot/);
    expect(store.getState().plans.plans.find((p) => p.id === plan.id)?.autonomy).toBe('gated');
  });

  it('an external agent can’t approve, or verify-then-approve, a shared plan', async () => {
    const store = new Store(initialState('room'));
    store.dispatch({ type: 'projects', projects: [project('api', 'bob-api', [ws('main', 'bob-api')])] });
    const controller = { onWorktree: () => () => undefined } as unknown as WorkspaceController;
    const board = new Board({ store, dir: null, projectName: () => 'bob-api' });
    const boardWork = new BoardWork({ store, board, controller, selfId: () => 'p-me', selfName: () => 'Kay', askClaude: () => undefined });
    const plans = new Plans({ store, dir: null });
    const work = new PlansWork({ store, plans, board: boardWork, git: null, askClaude: () => 'ask', intend: () => undefined, delayMs: 0 });
    const plan = plans.create({ projectId: 'api', home: 'ws:main', autonomy: 'gated' }, boardWork.myClaude());
    store.dispatch({ type: 'studio_state', shared: ['api'], gates: [] });
    await expect(work.verify(plan.id, true)).rejects.toThrow(/Synon Studio/);
    expect(() => asActingAgent({ id: 'ext', name: 'Ext' }, () => work.approve(plan.id))).toThrow(/Synon Studio/);
  });

  it('replaces the native approve card in Needs You with the studio card (the pass card stays)', () => {
    const h = harness();
    const op = opId();
    h.gates.request(h.plan(), 'start', 3, op, 'Mia');
    h.store.dispatch({ type: 'studio_state', shared: ['p1'], gates: h.gates.needs() });
    const needs = allNeeds(h.store.getState());
    const studio = needs.find((n) => n.kind === 'studio-start');
    expect(studio).toMatchObject({
      id: `studio:g-${op.slice(0, 8)}`,
      title: 'Approve start of “Shop”?',
      detail: '1 milestone · 3 pts',
      from: 'Mia',
      gate: { kind: 'start', plan: 'Shop', milestones: 1, points: 3, by: 'Mia' },
    });
    expect(studio?.actions.map((a) => a.method)).toEqual(['studio.answerGate', 'studio.answerGate']);
    expect(studio?.actions.some((a) => a.method.startsWith('plans.'))).toBe(false);
    expect(needs.some((n) => n.id.startsWith('plan:pl1:'))).toBe(false);
  });

  it('keeps the native approve card for a plan that is not shared', () => {
    const h = harness();
    h.store.dispatch({ type: 'studio_state', shared: [], gates: [] });
    const native = allNeeds(h.store.getState()).find((n) => n.id === 'plan:pl1:approve:3');
    expect(native).toBeDefined();
    expect(native?.actions.some((a) => a.method === 'plans.approve')).toBe(true);
  });

  it('gives two plans’ Gates different ids even when one opId names both, and answers the right plan', () => {
    const store = new Store(initialState('room'));
    store.dispatch({ type: 'projects', projects: [project('p1', 'shop')] });
    store.dispatch({ type: 'plans_init', state: { enabled: true, plans: [planOf(), planOf({ id: 'pl2', home: 'ws:home2' })], style: '' } });
    const approved: string[] = [];
    const gates = new StudioGates({ store, config: () => config(), approve: (id) => void approved.push(id), persist: () => undefined, touch: () => undefined, now: () => 1_000 });
    const op = crypto.randomUUID();
    expect(gates.request(store.getState().plans.plans.find((p) => p.id === 'pl1')!, 'start', 3, op)).toBeUndefined();
    expect(gates.request(store.getState().plans.plans.find((p) => p.id === 'pl2')!, 'start', 3, op)).toBeUndefined();
    const cards = gates.needs();
    expect(cards.map((c) => c.planId)).toEqual(['pl1', 'pl2']);
    expect(cards[0]!.id).not.toBe(cards[1]!.id);
    const second = cards.find((c) => c.planId === 'pl2')!;
    expect(gates.answer(second.id, { approve: true })).toEqual({ ok: true, state: 'approved' });
    expect(approved).toEqual(['pl2']);
    expect(gates.viewGate('pl1')).toMatchObject({ state: 'pending' });
  });

  it('drops the cards of a project that is no longer shared, and starts nothing from them', () => {
    const store = new Store(initialState('room'));
    store.dispatch({ type: 'projects', projects: [project('p1', 'shop')] });
    store.dispatch({ type: 'plans_init', state: { enabled: true, plans: [planOf()], style: '' } });
    const shared = ['p1'];
    const approved: string[] = [];
    const gates = new StudioGates({ store, config: () => config(shared), approve: (id) => void approved.push(id), persist: () => undefined, touch: () => undefined, now: () => 1_000 });
    const op = crypto.randomUUID();
    gates.request(store.getState().plans.plans[0]!, 'start', 3, op);
    expect(gates.needs()).toHaveLength(1);
    shared.length = 0;
    expect(gates.needs()).toEqual([]);
    expect(gates.answer(`g-${op.slice(0, 8)}`, { approve: true })).toEqual({ ok: false, error: 'gone' });
    expect(approved).toEqual([]);
  });

  it('never shows or answers a Gate left by another studio', () => {
    const store = new Store(initialState('room'));
    store.dispatch({ type: 'projects', projects: [project('p1', 'shop')] });
    store.dispatch({ type: 'plans_init', state: { enabled: true, plans: [planOf()], style: '' } });
    const other = () => ({ ...config(), studioId: 'st2' });
    const first = new StudioGates({ store, config: () => config(), approve: () => undefined, persist: () => undefined, touch: () => undefined, now: () => 1_000 });
    const op = crypto.randomUUID();
    first.request(store.getState().plans.plans[0]!, 'start', 3, op);
    const saved = first.dump() as Array<{ id: string }>;
    const second = new StudioGates({ store, config: other, approve: () => undefined, persist: () => undefined, touch: () => undefined, now: () => 1_000 });
    second.restore(saved);
    expect(second.needs()).toEqual([]);
    expect(second.answer(saved[0]!.id, { approve: true })).toEqual({ ok: false, error: 'gone' });
  });
});

describe('a milestone is passable (BLG-77)', () => {
  it('only once its check came back, or when there is nothing to check', () => {
    const milestone = (over: Record<string, unknown>) => ({ state: 'gate', milestone: { criteria: ['works'] }, run: {}, autonomy: 'gated', ...over }) as never;
    expect(passable(milestone({}))).toBe(false);
    expect(passable(milestone({ run: { check: {} } }))).toBe(true);
    expect(passable(milestone({ milestone: { criteria: [] } }))).toBe(true);
    expect(passable(milestone({ state: 'checking' }))).toBe(false);
  });
});

describe('the Gate is the only way to plans.approve (BLG-74)', () => {
  it('the whitelist refuses a customer’s plans.verify with thenApprove and any plans.approve', () => {
    expect(callRefusal('plans.verify', ['pl1', { thenApprove: true }])).toBeDefined();
    expect(callRefusal('plans.verify', ['pl1', { thenApprove: false }])).toBeDefined();
    expect(callRefusal('plans.verify', ['pl1'])).toBeUndefined();
    expect(callRefusal('plans.approve', ['pl1'])).toBeDefined();
    expect(callRefusal('host.answerApproval', ['yes', 'a1'])).toBeDefined();
  });

  it('no file under src/studio can reach approve except gates.ts (and the service’s one injection line)', () => {
    const dir = join(process.cwd(), 'src/studio');
    const hits = readdirSync(dir)
      .filter((file) => file.endsWith('.ts'))
      .flatMap((file) =>
        readFileSync(join(dir, file), 'utf8')
          .split('\n')
          .map((line, i) => ({ file, line: line.trim(), at: i + 1 }))
          // Comments may name the method; only a line of code can call it.
          .filter(({ line }) => !line.startsWith('//') && !line.startsWith('*') && !line.startsWith('/*'))
          .filter(({ line }) => /\.approve\(|plans\.approve/.test(line)),
      );
    // actions.ts names it only to refuse it (its callRefusal arm); no line there calls it.
    expect(hits.filter(({ file }) => file !== 'gates.ts' && file !== 'service.ts' && file !== 'actions.ts')).toEqual([]);
    expect(hits.filter(({ file, line }) => file === 'actions.ts' && /\.approve\(/.test(line))).toEqual([]);
    expect(hits.filter(({ file, line }) => file !== 'actions.ts' && line.includes('plans.approve'))).toEqual([]);
    expect(hits.filter(({ file }) => file === 'gates.ts')).toHaveLength(1);
  });
});
