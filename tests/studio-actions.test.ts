import { describe, expect, it } from 'vitest';
import { PLANS_API } from '../src/ipc/plans-api.js';
import { type ActionContext, type ActionVerdict, OPID_KEEP_MS, OpLog, type PlanFacts, callRefusal, checkAction, opKey } from '../src/studio/actions.js';
import { ACTION_KINDS, type StudioReceipt } from '../src/studio/protocol.js';

const OP = '6f1c2a5e-3b7d-4c8e-9f0a-1b2c3d4e5f60';
const OP2 = '7a2d3b6f-4c8e-4d9f-8a1b-2c3d4e5f6071';
const DAY = 24 * 60 * 60 * 1000;

const plan = (over: Partial<PlanFacts> = {}): PlanFacts => ({
  id: 'pl_abc',
  started: false,
  draftRev: 5,
  home: 'ws:home1',
  milestones: { m0: { id: 'core', awaitingReview: true }, m1: { id: 'later', awaitingReview: false } },
  decisions: {
    'd-m0-t0': { audience: 'customer', open: true, qid: 'decide:pl_abc:login', question: '用哪种登录？', options: { o0: '邮箱', o1: '手机' } },
    'd-m0-t1': { audience: 'operator', open: true, qid: 'decide:pl_abc:keys', question: '填 AWS 密钥', options: {} },
    'd-m0-t2': { open: true, qid: 'decide:pl_abc:pay', question: '付款账号？', options: {} },
    'd-m0-t3': { audience: 'customer', open: false, qid: 'decide:pl_abc:done', question: '颜色？', options: { o0: '蓝' } },
  },
  ...over,
});

const ctx = (over: Partial<ActionContext> = {}): ActionContext => ({ scope: { studio: 's1', plan: 'p1' }, projectId: 'proj1', plan: plan(), seen: () => undefined, ...over });
const act = (kind: string, payload: unknown, planRef: string | null = 'p1', opId = OP) => ({ t: 'action', opId, kind, ...(planRef ? { planRef } : {}), payload });

const refused = (v: ActionVerdict): string | undefined => (v.ok ? undefined : v.code);
const callOf = (v: ActionVerdict) => (v.ok && 'call' in v ? v.call : undefined);

/** Every internal call the checker may hand the daemon. */
const CUSTOMER_PLANS = new Set(['plans.create', 'plans.verify', 'plans.pass', 'plans.sendBack', 'plans.discard']);

describe('callRefusal: the plans.* table', () => {
  const methods = Object.keys(PLANS_API).filter((m) => m.startsWith('plans.'));

  it('covers the whole table', () => {
    expect(methods.length).toBeGreaterThan(20);
    expect(methods).toEqual(expect.arrayContaining(['plans.approve', 'plans.setAutonomy', 'plans.mergePr', 'plans.startTask', 'plans.edit']));
  });

  for (const m of methods.filter((x) => !CUSTOMER_PLANS.has(x)))
    it(`refuses ${m}, saying why`, () => {
      for (const args of [[], ['pl_abc'], ['pl_abc', 'core'], ['pl_abc', {}]]) {
        const why = callRefusal(m, args);
        expect(why, `${m} ${JSON.stringify(args)}`).toBeTypeOf('string');
        expect(why!.length).toBeGreaterThan(5);
      }
    });

  it('plans.approve only from the Gate, and host.answerApproval never', () => {
    expect(callRefusal('plans.approve', ['pl_abc'])).toMatch(/Gate/);
    expect(callRefusal('host.answerApproval', ['ws:home1', 'ap1', true])).toMatch(/never/);
  });

  it('plans.verify never with thenApprove', () => {
    expect(callRefusal('plans.verify', ['pl_abc'])).toBeUndefined();
    expect(callRefusal('plans.verify', ['pl_abc', {}])).toBeUndefined();
    expect(callRefusal('plans.verify', ['pl_abc', { thenApprove: true }])).toBeTypeOf('string');
    expect(callRefusal('plans.verify', ['pl_abc', { thenApprove: false }])).toBeTypeOf('string');
  });

  it('plans.create never with autonomy, agent or testsAt', () => {
    expect(callRefusal('plans.create', [{ projectId: 'p', goal: 'g' }])).toBeUndefined();
    for (const extra of [{ autonomy: 'autopilot' }, { agent: { runtime: 'claude' } }, { testsAt: 'end' }])
      expect(callRefusal('plans.create', [{ projectId: 'p', goal: 'g', ...extra }])).toBeTypeOf('string');
  });

  it('anything else is refused too', () => {
    for (const m of ['session.remove', 'files.write', 'board.update', 'questions.pick', 'git.push']) expect(callRefusal(m, [])).toBeTypeOf('string');
  });
});

describe('checkAction', () => {
  it('refuses unknown kinds, mixed case and internal method names', () => {
    for (const kind of ['plans.approve', 'plans.create', 'Plan.Create', 'PLAN.VERIFY', 'chat.Send', 'host.answerApproval', 'questions.answer', 'plan.approve'])
      expect(refused(checkAction(act(kind, {}), ctx())), kind).toBe('not-allowed');
  });

  it('plan.verify with thenApprove is refused, without it no approval', () => {
    expect(refused(checkAction(act('plan.verify', { thenApprove: true }), ctx()))).toBe('bad-args');
    expect(refused(checkAction(act('plan.verify', { thenApprove: false }), ctx()))).toBe('bad-args');
    expect(callOf(checkAction(act('plan.verify', {}), ctx()))).toEqual({ method: 'plans.verify', args: ['pl_abc'] });
  });

  it('plan.create with autonomy, agent, testsAt or projectId is refused; the project comes from the binding', () => {
    for (const extra of [{ autonomy: 'autopilot' }, { agent: { runtime: 'codex' } }, { testsAt: 'end' }, { projectId: 'someone-else' }, { checkAgent: 'x' }])
      expect(refused(checkAction(act('plan.create', { goal: '做个 App', platforms: ['ios'], ...extra }, null), ctx())), JSON.stringify(extra)).toBe('bad-args');
    const call = callOf(checkAction(act('plan.create', { goal: '做个 App', platforms: ['ios', 'web'] }, null), ctx()));
    expect(call?.method).toBe('plans.create');
    expect(call?.args[0]).toEqual({ projectId: 'proj1', goal: '做个 App\n\n涉及平台：iOS、Web' });
    expect(refused(checkAction(act('plan.create', { goal: 'x', platforms: ['ios'] }, null), ctx({ projectId: undefined })))).toBe('not-yours');
  });

  it('asking to start raises a Gate and never calls plans.approve', () => {
    const v = checkAction(act('plan.requestStart', { draftRev: 5 }), ctx());
    expect(v).toEqual({ ok: true, gate: { kind: 'start', draftRev: 5 } });
    expect(JSON.stringify(v)).not.toContain('plans.approve');
    const apply = checkAction(act('draft.apply', { draftRev: 5 }), ctx({ plan: plan({ started: true }) }));
    expect(apply).toEqual({ ok: true, gate: { kind: 'changes', draftRev: 5 } });
    expect(JSON.stringify(apply)).not.toContain('plans.approve');
  });

  it('no action of any kind ever yields plans.approve or a call outside the whitelist', () => {
    const payloads: Record<string, unknown> = {
      'plan.create': { goal: 'g', platforms: ['web'] },
      'chat.send': { text: 'hi' },
      'plan.verify': {},
      'plan.requestStart': { draftRev: 5 },
      'decision.answer': { decisionId: 'd-m0-t0', picks: ['o0'] },
      'milestone.pass': { milestoneRef: 'm0', draftRev: 5 },
      'milestone.sendBack': { milestoneRef: 'm0', draftRev: 5, reason: '按钮点了没反应，再看看' },
      'draft.apply': { draftRev: 5 },
      'draft.discard': { draftRev: 5 },
    };
    for (const kind of ACTION_KINDS)
      for (const started of [false, true]) {
        const v = checkAction(act(kind, payloads[kind], kind === 'plan.create' ? null : 'p1'), ctx({ plan: plan({ started }) }));
        const call = callOf(v);
        if (call) expect(callRefusal(call.method, call.args), `${kind} → ${call.method}`).toBeUndefined();
        expect(JSON.stringify(v)).not.toContain('plans.approve');
      }
  });

  it('a stale draftRev is refused for starting, applying, discarding, passing and sending back', () => {
    const started = ctx({ plan: plan({ started: true }) });
    expect(refused(checkAction(act('plan.requestStart', { draftRev: 4 }), ctx()))).toBe('stale');
    expect(refused(checkAction(act('draft.apply', { draftRev: 4 }), started))).toBe('stale');
    expect(refused(checkAction(act('draft.discard', { draftRev: 6 }), started))).toBe('stale');
    expect(refused(checkAction(act('milestone.pass', { milestoneRef: 'm0', draftRev: 4 }), ctx()))).toBe('stale');
    expect(refused(checkAction(act('milestone.sendBack', { milestoneRef: 'm0', draftRev: 4, reason: '和我说的不一样，请重做' }), ctx()))).toBe('stale');
  });

  it('discarding a plan never started is refused (it would throw the plan away)', () => {
    expect(refused(checkAction(act('draft.discard', { draftRev: 5 }), ctx()))).toBe('not-allowed');
    expect(callOf(checkAction(act('draft.discard', { draftRev: 5 }), ctx({ plan: plan({ started: true }) })))).toEqual({ method: 'plans.discard', args: ['pl_abc'] });
  });

  it('passing only a milestone that waits for the customer', () => {
    expect(callOf(checkAction(act('milestone.pass', { milestoneRef: 'm0', draftRev: 5 }), ctx()))).toEqual({ method: 'plans.pass', args: ['pl_abc', 'core'] });
    expect(refused(checkAction(act('milestone.pass', { milestoneRef: 'm1', draftRev: 5 }), ctx()))).toBe('not-open');
    expect(refused(checkAction(act('milestone.pass', { milestoneRef: 'm9', draftRev: 5 }), ctx()))).toBe('bad-args');
  });

  it('a message goes only to the plan’s own conversation', () => {
    expect(callOf(checkAction(act('chat.send', { text: '你好' }), ctx()))).toEqual({ method: 'session.submit', args: ['你好', { channel: 'ws:home1' }] });
    expect(refused(checkAction(act('chat.send', { text: 'x', channel: 'ws:other' }), ctx()))).toBe('bad-args');
    expect(refused(checkAction(act('chat.send', { text: 'x' }), ctx({ plan: undefined })))).toBe('unknown-plan');
  });

  it('a frame with fields not named is refused', () => {
    expect(refused(checkAction({ ...act('chat.send', { text: 'x' }), customerId: 'c2' }, ctx()))).toBe('bad-args');
    expect(refused(checkAction(null, ctx()))).toBe('not-allowed');
  });
});

describe('decision.answer (questions.answer, its own whitelist)', () => {
  const answer = (payload: unknown) => checkAction(act('decision.answer', payload), ctx());

  it('answers a customer decision through questions.answer', () => {
    expect(callOf(answer({ decisionId: 'd-m0-t0', picks: ['o1'] }))).toEqual({ method: 'questions.answer', args: ['decide:pl_abc:login', { kind: 'answers', answers: { '用哪种登录？': '手机' } }] });
    expect(callOf(answer({ decisionId: 'd-m0-t0', picks: ['o0'], text: '先做邮箱' }))?.args[1]).toEqual({ kind: 'answers', answers: { '用哪种登录？': '邮箱; 先做邮箱' } });
  });

  it('refuses the operator’s, those with no audience, answered ones and unknown ones', () => {
    expect(refused(answer({ decisionId: 'd-m0-t1', text: 'AKIA…' }))).toBe('not-open');
    expect(refused(answer({ decisionId: 'd-m0-t2', text: '我的卡号' }))).toBe('not-open');
    expect(refused(answer({ decisionId: 'd-m0-t3', picks: ['o0'] }))).toBe('not-open');
    expect(refused(answer({ decisionId: 'nope', text: 'x' }))).toBe('not-open');
    expect(refused(answer({ decisionId: '__proto__', text: 'x' }))).toBe('not-open');
  });

  it('refuses unknown options, several picks on a single choice, and an empty answer', () => {
    expect(refused(answer({ decisionId: 'd-m0-t0', picks: ['o7'] }))).toBe('bad-args');
    expect(refused(answer({ decisionId: 'd-m0-t0', picks: ['o0', 'o1'] }))).toBe('bad-args');
    expect(refused(answer({ decisionId: 'd-m0-t0' }))).toBe('bad-args');
  });

  it('never answers a tool approval, nor names the question directly', () => {
    expect(refused(checkAction(act('host.answerApproval', { id: 'ap1', allow: true }), ctx()))).toBe('not-allowed');
    expect(refused(checkAction(act('questions.answer', { qid: 'decide:pl_abc:keys' }), ctx()))).toBe('not-allowed');
    expect(callRefusal('questions.answer', ['ask:123', { kind: 'answers', answers: {} }])).toBeTypeOf('string');
    expect(callRefusal('questions.answer', ['decide:pl_abc:login', { kind: 'plan', approve: true }])).toBeTypeOf('string');
  });
});

describe('opIds run once', () => {
  const done: StudioReceipt = { t: 'receipt', opId: OP, state: 'done', planRef: 'p1' };

  it('the second time an opId comes, its first receipt comes back and nothing runs', () => {
    const log = new OpLog();
    const scope = { studio: 's1', plan: 'p1' };
    const c = ctx({ seen: log.seen, scope });
    const first = checkAction(act('chat.send', { text: 'hi' }), c);
    expect(callOf(first)).toBeDefined();
    log.record(opKey(scope, OP), done, 0);
    const again = checkAction(act('chat.send', { text: 'hi' }), c);
    expect(again).toEqual({ ok: true, replay: done });
    expect(callOf(again)).toBeUndefined();
    // Even a different action under the same opId isn't run.
    expect(checkAction(act('milestone.pass', { milestoneRef: 'm0', draftRev: 5 }), c)).toEqual({ ok: true, replay: done });
    // Another opId runs.
    expect(callOf(checkAction(act('chat.send', { text: 'hi' }, 'p1', OP2), c))).toBeDefined();
  });

  it('is scoped by studio and plan', () => {
    const log = new OpLog();
    log.record(opKey({ studio: 's1', plan: 'p1' }, OP), done, 0);
    expect(callOf(checkAction(act('chat.send', { text: 'hi' }), ctx({ seen: log.seen, scope: { studio: 's1', plan: 'p2' } })))).toBeDefined();
    expect(callOf(checkAction(act('chat.send', { text: 'hi' }), ctx({ seen: log.seen, scope: { studio: 's2', plan: 'p1' } })))).toBeDefined();
  });

  it('a replay on day 8 (after the 7-day queue) is still answered, not run; kept at least 14 days', () => {
    const log = new OpLog();
    const key = opKey({ studio: 's1', plan: 'p1' }, OP);
    log.record(key, done, 0);
    log.prune(8 * DAY);
    expect(log.seen(key)).toEqual(done);
    log.prune(13 * DAY, 1);
    expect(log.seen(key)).toEqual(done);
    log.prune(OPID_KEEP_MS + 1);
    expect(log.seen(key)).toBeUndefined();
  });

  it('survives a restart from its entries, and keeps the first receipt', () => {
    const log = new OpLog();
    const key = opKey({ studio: 's1', plan: 'p1' }, OP);
    log.record(key, done, 0);
    log.record(key, { t: 'receipt', opId: OP, state: 'refused', code: 'stale' }, 1);
    const back = new OpLog(JSON.parse(JSON.stringify(log.entries())));
    expect(back.seen(key)).toEqual(done);
  });
});
