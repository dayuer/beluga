import { describe, expect, it } from 'vitest';
import { Board } from '../src/core/board/board.js';
import type { Actor } from '../src/core/board/model.js';
import type { Plan, PlanBody } from '../src/core/plans/model.js';
import { applyOps, normalizeBody } from '../src/core/plans/edit.js';
import { planView } from '../src/core/plans/progress.js';
import { Store, initialState } from '../src/core/store.js';
import type { Project } from '../src/workspaces/types.js';
import { checkAction, type ActionContext, type PlanFacts } from '../src/studio/actions.js';
import { StudioDecisions, customerDecisions, operatorOnly, studioDecisions } from '../src/studio/decisions.js';
import { studioPlanView } from '../src/studio/view.js';

/**
 * BLG-79: whose decision it is (docs/studio-gates.md §6, decisions-audience). A decision reaches a
 * customer only when it says so and doesn't touch an account, a key or money; the view and the
 * answer path share this one filter, and a customer can never answer another plan question by
 * naming its qid.
 */

const BODY: PlanBody = {
  title: 'Shop',
  goal: 'Sell coffee online.',
  decisions: [{ id: 'd1', text: 'Internal: use our own accounts.' }],
  milestones: [
    {
      id: 'm1',
      title: 'Launch',
      criteria: ['shipped'],
      tasks: [
        {
          id: 't0',
          title: 'Brand colour',
          acceptance: [],
          blockedBy: [],
          assignee: 'me',
          audience: 'customer',
          decision: { question: 'Which brand colour?', options: [{ label: 'Blue' }, { label: 'Green', description: 'calm' }] },
        },
        {
          id: 't1',
          title: 'Keys',
          acceptance: [],
          blockedBy: [],
          assignee: 'me',
          decision: { question: 'Which API key?', options: [{ label: 'Ours' }] },
        },
        {
          id: 't2',
          title: 'Payments',
          acceptance: [],
          blockedBy: [],
          assignee: 'me',
          audience: 'customer',
          decision: { question: '支付密钥用哪个？', options: [{ label: 'Stripe' }] },
        },
        {
          id: 't3',
          title: 'Launch date',
          acceptance: [],
          blockedBy: [],
          assignee: 'me',
          audience: 'customer',
          decision: { question: 'When do we launch?', options: [{ label: 'May' }, { label: 'June' }], multi: true },
        },
        { id: 't4', title: 'Build it', acceptance: [], blockedBy: [], assignee: 'claude' },
      ],
    },
  ],
};

const project = (): Project => ({ id: 'p1', name: 'shop', root: '/tmp/shop', base: 'main', workspaces: [] }) as Project;

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

function world(over: Partial<Plan> = {}) {
  const store = new Store(initialState('room'));
  store.dispatch({ type: 'projects', projects: [project()] });
  store.dispatch({ type: 'board_meta', projects: { p1: { prefix: 'SHP', next: 1 } }, autoTasks: false });
  const board = new Board({ store, dir: null, projectName: () => 'shop' });
  const me: Actor = { kind: 'person', id: 'p-me', name: 'Kay' };
  const body = over.body ?? BODY;
  // Approved plans have their tasks on the board; a decision is open while its task is open.
  let n = 0;
  const withIssues: PlanBody = {
    ...body,
    milestones: body.milestones.map((m) => ({ ...m, tasks: m.tasks.map((t) => ({ ...t, issueId: board.create({ projectId: 'p1', title: `${t.title} ${++n}` }, me).id })) })),
  };
  store.dispatch({ type: 'plans_init', state: { enabled: true, plans: [planOf({ ...over, body: withIssues })], style: '' } });
  const plan = store.getState().plans.plans[0]!;
  const view = planView(plan, store.getState().board);
  return { store, plan, view };
}

describe('which decisions reach the customer (BLG-79)', () => {
  it('only a decision marked for the customer, and not a sensitive one, is theirs', () => {
    const { view } = world();
    const decisions = customerDecisions(view);
    expect(Object.keys(decisions)).toEqual(['d-m0-t0', 'd-m0-t3']);
    expect(decisions['d-m0-t0']).toMatchObject({
      audience: 'customer',
      open: true,
      qid: 'decide:pl1:t0',
      question: 'Which brand colour?',
      options: { o0: 'Blue', o1: 'Green' },
    });
    expect(decisions['d-m0-t3']).toMatchObject({ multi: true, qid: 'decide:pl1:t3' });
    // The plan's own decisions, and the operator's, never appear.
    expect(JSON.stringify(decisions)).not.toContain('Internal');
    expect(operatorOnly(BODY.milestones[0]!.tasks[0]!)).toBe(false);
    expect(operatorOnly(BODY.milestones[0]!.tasks[1]!)).toBe(true);
    expect(operatorOnly(BODY.milestones[0]!.tasks[2]!)).toBe(true);
  });

  it('the view uses the same numbering, with option descriptions, sanitized', () => {
    const { store, plan } = world({
      body: {
        ...BODY,
        milestones: [{ ...BODY.milestones[0]!, tasks: BODY.milestones[0]!.tasks.map((t) => (t.id === 't0' ? { ...t, decision: { ...t.decision!, question: 'Which colour, see /Users/kay/app/theme.ts?' } } : t)) }],
      },
    });
    const view = studioPlanView({ planRef: 'p1', view: planView(plan, store.getState().board) });
    expect(view.decisions.map((d) => d.decisionId)).toEqual(['d-m0-t0', 'd-m0-t3']);
    expect(view.decisions[0]?.options.map((o) => o.id)).toEqual(['o0', 'o1']);
    expect(view.decisions[0]?.options[1]?.description).toBe('calm');
    expect(view.decisions[0]?.question).not.toContain('/Users');
    // The sensitive and the operator's are not there, even as an id.
    expect(JSON.stringify(view.decisions)).not.toContain('支付密钥');
    expect(studioDecisions(planView(plan, store.getState().board)).map((d) => d.decisionId)).toEqual(['d-m0-t0', 'd-m0-t3']);
  });

  it('a sensitive decision marked for the customer warns once and stays out', () => {
    const { store, plan, view } = world();
    const decisions = new StudioDecisions({ store });
    const out = decisions.decisions(plan, view);
    expect(Object.keys(out)).toEqual(['d-m0-t0', 'd-m0-t3']);
    const warnings = store.getState().log.filter((item) => item.type === 'system' && item.text.includes('stays with you'));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ channel: 'ws:home', level: 'warn' });
    decisions.decisions(plan, view);
    expect(store.getState().log.filter((item) => item.type === 'system' && item.text.includes('stays with you'))).toHaveLength(1);
  });

  it('answers the customer’s decision through questions.answer, and refuses any other', () => {
    const { store, view } = world();
    const facts: PlanFacts = { id: 'pl1', started: true, draftRev: 1, home: 'ws:home', milestones: {}, decisions: customerDecisions(view) };
    const ctx: ActionContext = { scope: { studio: 'st1', project: 'dp1', plan: 'pl1' }, plan: facts, seen: () => undefined };
    const answer = (decisionId: string, payload: Record<string, unknown>) => checkAction({ t: 'action', opId: crypto.randomUUID(), kind: 'decision.answer', planRef: 'pl1', payload: { decisionId, ...payload } }, ctx);

    const picked = answer('d-m0-t0', { picks: ['o1'] });
    expect(picked).toEqual({ ok: true, call: { method: 'questions.answer', args: ['decide:pl1:t0', { kind: 'answers', answers: { 'Which brand colour?': 'Green' } }] } });

    const words = answer('d-m0-t0', { text: 'A deep navy' });
    expect(words).toMatchObject({ ok: true, call: { method: 'questions.answer' } });
    if (words.ok && 'call' in words) expect(words.call.args[1]).toMatchObject({ kind: 'answers' });

    // The operator's decision, the sensitive one, and one that doesn't exist, are not the customer's to answer.
    expect(answer('d-m0-t1', { picks: ['o0'] })).toMatchObject({ ok: false, code: 'not-open' });
    expect(answer('d-m0-t2', { picks: ['o0'] })).toMatchObject({ ok: false, code: 'not-open' });
    expect(answer('d-m9-t9', { picks: ['o0'] })).toMatchObject({ ok: false, code: 'not-open' });
    // A qid is never named by the customer: an internal qid isn't even a decisionId.
    expect(answer('decide:pl1:t2', { picks: ['o0'] })).toMatchObject({ ok: false, code: 'bad-args' });
    // Options that aren't on the card, and two picks where one is asked for.
    expect(answer('d-m0-t0', { picks: ['o9'] })).toMatchObject({ ok: false, code: 'bad-args' });
    expect(answer('d-m0-t0', { picks: ['o0', 'o1'] })).toMatchObject({ ok: false, code: 'bad-args' });
    // Closed: once the plan is paused, nothing is open.
    const pausedFacts: PlanFacts = { ...facts, decisions: customerDecisions(planView(planOf({ paused: true }), store.getState().board)) };
    const pausedCtx: ActionContext = { ...ctx, plan: pausedFacts };
    const closed = checkAction({ t: 'action', opId: crypto.randomUUID(), kind: 'decision.answer', planRef: 'pl1', payload: { decisionId: 'd-m0-t0', picks: ['o0'] } }, pausedCtx);
    expect(closed).toMatchObject({ ok: false, code: 'not-open' });
  });

  it('carries the audience through the plan writer', () => {
    const body = normalizeBody({
      title: 'Shop',
      goal: 'Go',
      milestones: [{ title: 'M', criteria: ['done'], tasks: [{ title: 'Colour', assignee: 'me', audience: 'customer', decision: { question: 'Which?', options: [{ label: 'Blue' }] } }] }],
    });
    const task = body.milestones[0]!.tasks[0]!;
    expect(task.audience).toBe('customer');
    const changed = applyOps(body, [{ op: 'update_task', id: task.id, patch: { audience: 'operator' } }]);
    expect(changed.milestones[0]!.tasks[0]!.audience).toBe('operator');
    expect(normalizeBody({ title: 'Shop', goal: 'Go', milestones: [{ title: 'M', criteria: [], tasks: [{ title: 'Build' }] }] }).milestones[0]!.tasks[0]!.audience).toBeUndefined();
  });
});
