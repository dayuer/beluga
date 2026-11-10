import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Plan, PlanBody, PlanTask } from '../src/core/plans/model.js';
import { planView } from '../src/core/plans/progress.js';
import { Store, initialState } from '../src/core/store.js';
import type { Project } from '../src/workspaces/types.js';
import { changesSummary } from '../src/studio/draft.js';
import { STALE_DECLINED, StudioGates } from '../src/studio/gates.js';
import { StudioInbox, type GatePlug, type InboxExec } from '../src/studio/inbox.js';
import { refOf, type StudioConfig } from '../src/studio/keys.js';
import type { StudioReceipt } from '../src/studio/protocol.js';
import { studioPlanView } from '../src/studio/view.js';

/**
 * BLG-80: the draft, as the customer sees it and as it is applied or thrown away
 * (docs/studio-gates.md §3.3, §6). The diff is built by the real view; the inbox and the Gate are
 * the real ones with a fake executor. What this proves: the numbers and the words are the
 * customer's (sanitized, with your own tasks out), and apply/discard only ever happen for the
 * draftRev the customer was looking at (an apply is an "apply the changes" Gate, never a start).
 */

const REF_KEY = Buffer.alloc(32, 7).toString('base64url');
const PLAN_REF = refOf(REF_KEY, 'plan', 'pl1');

const task = (id: string, title: string, over: Partial<PlanTask> = {}): PlanTask => ({ id, title, acceptance: [], blockedBy: [], ...over });

const BODY: PlanBody = {
  title: 'Shop',
  goal: 'Sell coffee.',
  milestones: [
    { id: 'm1', title: 'Sign in', criteria: ['works'], tasks: [task('t1', 'Sign-in form', { goal: 'An email and a password', estimate: 2 })] },
    { id: 'm2', title: 'Pay', criteria: ['paid'], tasks: [task('t2', 'Checkout', { estimate: 3 })] },
  ],
};

const DRAFT: PlanBody = {
  ...BODY,
  milestones: [
    {
      id: 'm1',
      title: 'Sign in, done right',
      criteria: ['works'],
      tasks: [
        task('t1', 'Sign-in form', { goal: 'An email and a password, see /Users/kay/app/auth.ts with claude-opus', acceptance: ['works'] }),
        task('t3', 'Apple sign-in', { estimate: 3 }),
        // Yours, not the customer's: not in the numbers or the words they see.
        task('t5', 'Secret keys', { assignee: 'me' }),
      ],
    },
    { id: 'm3', title: 'Notifications', criteria: [], tasks: [task('t4', 'Email digest', { estimate: 2 })] },
  ],
};

const project = (): Project => ({ id: 'p1', name: 'shop', root: '/tmp/shop', base: 'main', workspaces: [] }) as Project;

const planOf = (over: Partial<Plan> = {}): Plan => ({
  id: 'pl1',
  projectId: 'p1',
  home: 'ws:home',
  status: 'active',
  body: BODY,
  draft: DRAFT,
  draftRev: 5,
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

const config = (): StudioConfig => ({ v: 1, hub: 'http://localhost:8787', studioId: 'st1', daemonId: 'dn1', name: 'Mac', linkedAt: 0, key: 'unused', refKey: REF_KEY, projects: { p1: { since: 0 } } });

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const tempFile = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'beluga-studio-draft-'));
  dirs.push(dir);
  return join(dir, 'studio-inbox.json');
};

function storeWith(plans: Plan[]): Store {
  const store = new Store(initialState('room'));
  store.dispatch({ type: 'projects', projects: [project()] });
  store.dispatch({ type: 'plans_init', state: { enabled: true, plans, style: '' } });
  return store;
}

describe('the draft a customer sees and applies (BLG-80)', () => {
  it('counts what it adds, changes and removes — without your own tasks', () => {
    expect(changesSummary(planOf())).toEqual({
      added: { milestones: 1, tasks: 2, points: 5 },
      changed: { milestones: 1, tasks: 1 },
      removed: { milestones: 1, tasks: 1 },
    });
    // No draft, or no body: nothing to compare.
    expect(changesSummary(planOf({ draft: undefined }))).toBeUndefined();
    expect(changesSummary(planOf({ body: undefined }))).toBeUndefined();
  });

  it('shows it in the customer’s view, sanitized, with the draft’s revision', () => {
    const store = storeWith([planOf()]);
    const plan = store.getState().plans.plans[0]!;
    const view = studioPlanView({ planRef: 'p1', view: planView(plan, store.getState().board) });
    expect(view.draftDiff).toMatchObject({ draftRev: 5 });
    const diff = view.draftDiff!;
    expect(diff.added.map((a) => a.title)).toEqual(['Notifications', 'Apple sign-in', 'Email digest']);
    expect(diff.added.find((a) => a.title === 'Apple sign-in')?.under).toBe('Sign in, done right');
    expect(diff.changed.map((c) => c.title)).toEqual(['Sign in, done right', 'Sign-in form']);
    expect(diff.removed.map((r) => r.title)).toEqual(['Pay', 'Checkout']);
    const words = JSON.stringify(diff);
    expect(words).not.toContain('/Users/kay');
    expect(words).not.toContain('claude-opus');
    expect(words).not.toContain('Secret keys');
    // The customer sees the change, not the file that was touched.
    expect(diff.changed.find((c) => c.title === 'Sign-in form')?.after).toContain('email');
  });

  it('applies only the draftRev the customer saw: stale ones are refused with a code', async () => {
    const requests: Array<{ kind: string; draftRev: number; opId: string }> = [];
    const discarded: string[] = [];
    const receipts: StudioReceipt[] = [];
    const store = storeWith([planOf(), planOf({ id: 'pl2', body: undefined, draftRev: 2 })]);
    const exec: InboxExec = {
      createPlan: async () => ({ planId: 'x' }),
      verify: async () => undefined,
      pass: () => undefined,
      sendBack: () => undefined,
      discard: (id) => void discarded.push(id),
      answer: () => undefined,
    };
    const gates: GatePlug = {
      request(_plan, kind, draftRev, opId) {
        requests.push({ kind, draftRev, opId });
        return undefined;
      },
    };
    const inbox = new StudioInbox({ store, config, exec, plugs: { gates }, send: (f) => (receipts.push(f as StudioReceipt), true), file: tempFile(), now: () => 1_000 });
    let seq = 0;
    const deliver = (action: unknown) => inbox.deliver({ t: 'deliver', seq: seq++, project: refOf(REF_KEY, 'project', 'p1'), action } as never);
    const action = (kind: string, payload: Record<string, unknown>, planRef = PLAN_REF) => ({ t: 'action', opId: crypto.randomUUID(), kind, planRef, payload });

    deliver(action('draft.apply', { draftRev: 5 }));
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(requests).toEqual([{ kind: 'changes', draftRev: 5, opId: expect.any(String) }]);
    expect(receipts[0]).toMatchObject({ state: 'done' });

    deliver(action('draft.apply', { draftRev: 4 }));
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(receipts[1]).toMatchObject({ state: 'refused', code: 'stale' });
    expect(requests).toHaveLength(1);

    deliver(action('draft.discard', { draftRev: 5 }));
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(discarded).toEqual(['pl1']);
    expect(receipts[2]).toMatchObject({ state: 'done' });

    deliver(action('draft.discard', { draftRev: 4 }));
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(receipts[3]).toMatchObject({ state: 'refused', code: 'stale' });
    expect(discarded).toEqual(['pl1']);

    // A plan that never started has no changes to discard: that would throw the plan away.
    deliver(action('draft.discard', { draftRev: 2 }, refOf(REF_KEY, 'plan', 'pl2')));
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(receipts[4]).toMatchObject({ state: 'refused', code: 'not-allowed' });
    expect(discarded).toEqual(['pl1']);
  });

  it('raises an “apply the changes” Gate with the added numbers, and one that a moved draft never approves', () => {
    const store = storeWith([planOf()]);
    const approved: string[] = [];
    const demoted: unknown[] = [];
    const setPlan = (over: Partial<Plan>): void => {
      const plans = store.getState().plans;
      store.dispatch({ type: 'plans_init', state: { ...plans, plans: plans.plans.map((p) => (p.id === 'pl1' ? { ...p, ...over } : p)) } });
    };
    const gates = new StudioGates({
      store,
      config,
      approve: (id) => {
        approved.push(id);
        setPlan({ body: DRAFT, draft: undefined, draftRev: 6 });
      },
      setAutonomy: (id, autonomy, milestone) => void demoted.push({ id, autonomy, ...(milestone ? { milestone } : {}) }),
      persist: () => undefined,
      touch: () => undefined,
      now: () => 1_000,
    });
    const plan = store.getState().plans.plans[0]!;
    expect(plan.draft).toBeDefined();
    const op = crypto.randomUUID();
    expect(gates.request(plan, 'changes', 5, op)).toBeUndefined();
    expect(gates.needs()).toEqual([
      {
        id: `g-${op.slice(0, 8)}`,
        planId: 'pl1',
        kind: 'changes',
        draftRev: 5,
        askedAt: 1_000,
        by: 'shop',
        title: 'Shop',
        milestones: 2,
        points: 5,
        added: { milestones: 1, tasks: 2, points: 5 },
      },
    ]);
    expect(gates.viewGate('pl1')).toEqual({ kind: 'changes', state: 'pending', draftRev: 5 });
    expect(approved).toEqual([]);

    // The draft moves while the operator is looking: this Gate can't approve what the customer saw.
    setPlan({ draftRev: 6 });
    expect(gates.viewGate('pl1')).toMatchObject({ state: 'declined', reason: STALE_DECLINED });
    expect(gates.answer(`g-${op.slice(0, 8)}`, { approve: true })).toEqual({ ok: false, error: 'settled' });
    expect(approved).toEqual([]);
  });
});
