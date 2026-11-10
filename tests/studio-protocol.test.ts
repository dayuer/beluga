import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ACTION_KINDS, DaemonFrame, STUDIO_PROTO, StudioAction, StudioPlanView, StudioPlanViewLoose, StudioReceipt } from '../src/studio/protocol.js';

const OP = '6f1c2a5e-3b7d-4c8e-9f0a-1b2c3d4e5f60';

export const sampleView = (): StudioPlanView => ({
  planRef: 'p1',
  draftRev: 3,
  title: '会员登录',
  goal: '让客户用邮箱登录',
  stage: 'drafting',
  waitingOn: 'customer',
  headline: '计划在写',
  progress: { done: 0, total: 1 },
  milestones: [{ ref: 'm0', title: '登录', criteria: ['能登录'], status: 'planned', tasks: [{ ref: 'm0-t0', title: '登录页', acceptance: [], status: 'planned' }] }],
  decisions: [{ decisionId: 'd-m0-t0', question: '用哪种登录？', options: [{ id: 'o0', label: '邮箱' }], multi: false, open: true }],
  turns: [{ id: 't1', who: 'ai', text: '你好', at: 1 }],
  typing: false,
  moreTurns: false,
  activity: [],
});

describe('STUDIO_PROTO', () => {
  it('has a major and a minor', () => {
    expect(STUDIO_PROTO).toEqual({ major: 1, minor: 0 });
  });

  it('imports nothing but zod', () => {
    const src = readFileSync('src/studio/protocol.ts', 'utf8');
    const specs = [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
    expect(specs).toEqual(['zod']);
  });
});

describe('StudioPlanView', () => {
  it('parses a good view', () => {
    expect(StudioPlanView.parse(sampleView())).toEqual(sampleView());
  });

  it('refuses any field not named, at every level', () => {
    expect(StudioPlanView.safeParse({ ...sampleView(), needsYou: [] }).success).toBe(false);
    const v = sampleView();
    expect(StudioPlanView.safeParse({ ...v, milestones: [{ ...v.milestones[0], agent: 'claude' }] }).success).toBe(false);
    expect(StudioPlanView.safeParse({ ...v, milestones: [{ ...v.milestones[0], tasks: [{ ...v.milestones[0]!.tasks[0], key: 'BLG-1' }] }] }).success).toBe(false);
    expect(StudioPlanView.safeParse({ ...v, turns: [{ ...v.turns[0], topic: 'conv:ws:1' }] }).success).toBe(false);
  });

  it('caps strings and lists', () => {
    expect(StudioPlanView.safeParse({ ...sampleView(), title: 'x'.repeat(201) }).success).toBe(false);
    expect(StudioPlanView.safeParse({ ...sampleView(), goal: 'x'.repeat(4001) }).success).toBe(false);
    expect(StudioPlanView.safeParse({ ...sampleView(), turns: Array.from({ length: 51 }, (_, i) => ({ id: `t${i}`, who: 'ai', text: 'a', at: i })) }).success).toBe(false);
  });

  it('the loose parse drops what a newer daemon added', () => {
    const r = StudioPlanViewLoose.parse({ ...sampleView(), previews: [] });
    expect('previews' in r).toBe(false);
  });
});

describe('StudioAction', () => {
  const create = { t: 'action', opId: OP, kind: 'plan.create', payload: { goal: '做个 App', platforms: ['ios', 'web'] } };

  it('parses each kind', () => {
    const good = [
      create,
      { t: 'action', opId: OP, kind: 'chat.send', planRef: 'p1', payload: { text: '你好' } },
      { t: 'action', opId: OP, kind: 'plan.verify', planRef: 'p1', payload: {} },
      { t: 'action', opId: OP, kind: 'plan.requestStart', planRef: 'p1', payload: { draftRev: 3 } },
      { t: 'action', opId: OP, kind: 'decision.answer', planRef: 'p1', payload: { decisionId: 'd-m0-t0', picks: ['o0'] } },
      { t: 'action', opId: OP, kind: 'milestone.pass', planRef: 'p1', payload: { milestoneRef: 'm0', draftRev: 3 } },
      { t: 'action', opId: OP, kind: 'milestone.sendBack', planRef: 'p1', payload: { milestoneRef: 'm0', draftRev: 3, reason: '按钮点了没有反应，请再看看' } },
      { t: 'action', opId: OP, kind: 'draft.apply', planRef: 'p1', payload: { draftRev: 3 } },
      { t: 'action', opId: OP, kind: 'draft.discard', planRef: 'p1', payload: { draftRev: 3 } },
    ];
    for (const a of good) expect(StudioAction.safeParse(a).success, a.kind).toBe(true);
    expect(new Set(good.map((a) => a.kind))).toEqual(new Set(ACTION_KINDS));
  });

  it('refuses what the operator decides, and anything not named', () => {
    for (const extra of [{ autonomy: 'autopilot' }, { agent: { runtime: 'claude' } }, { testsAt: 'end' }, { projectId: 'x' }])
      expect(StudioAction.safeParse({ ...create, payload: { ...create.payload, ...extra } }).success).toBe(false);
    expect(StudioAction.safeParse({ t: 'action', opId: OP, kind: 'plan.verify', planRef: 'p1', payload: { thenApprove: true } }).success).toBe(false);
    expect(StudioAction.safeParse({ t: 'action', opId: OP, kind: 'plan.verify', planRef: 'p1', payload: { thenApprove: false } }).success).toBe(false);
    expect(StudioAction.safeParse({ ...create, customerId: 'c1' }).success).toBe(false);
  });

  it('refuses unknown kinds, mixed case and internal method names', () => {
    for (const kind of ['plans.approve', 'Plan.Create', 'PLAN.VERIFY', 'host.answerApproval', 'questions.answer'])
      expect(StudioAction.safeParse({ ...create, kind }).success, kind).toBe(false);
  });

  it('refuses bad shapes', () => {
    expect(StudioAction.safeParse({ ...create, opId: 'not-a-uuid' }).success).toBe(false);
    expect(StudioAction.safeParse({ ...create, payload: { goal: '', platforms: ['ios'] } }).success).toBe(false);
    expect(StudioAction.safeParse({ ...create, payload: { goal: 'a', platforms: [] } }).success).toBe(false);
    expect(StudioAction.safeParse({ ...create, payload: { goal: 'a', platforms: ['ios', 'ios'] } }).success).toBe(false);
    expect(StudioAction.safeParse({ t: 'action', opId: OP, kind: 'chat.send', payload: { text: 'hi' } }).success).toBe(false);
    expect(StudioAction.safeParse({ t: 'action', opId: OP, kind: 'decision.answer', planRef: 'p1', payload: { decisionId: 'd' } }).success).toBe(false);
    expect(StudioAction.safeParse({ t: 'action', opId: OP, kind: 'milestone.sendBack', planRef: 'p1', payload: { milestoneRef: 'm0', draftRev: 1, reason: '不行' } }).success).toBe(false);
  });
});

describe('frames', () => {
  it('a receipt carries a code only when refused', () => {
    expect(StudioReceipt.safeParse({ t: 'receipt', opId: OP, state: 'refused', code: 'stale' }).success).toBe(true);
    expect(StudioReceipt.safeParse({ t: 'receipt', opId: OP, state: 'refused' }).success).toBe(false);
    expect(StudioReceipt.safeParse({ t: 'receipt', opId: OP, state: 'done', code: 'stale' }).success).toBe(false);
    expect(StudioReceipt.safeParse({ t: 'receipt', opId: OP, state: 'refused', code: 'ENOENT /Users/x' }).success).toBe(false);
  });

  it('daemon frames parse strictly', () => {
    expect(DaemonFrame.safeParse({ t: 'plan', rev: 1, view: sampleView() }).success).toBe(true);
    expect(DaemonFrame.safeParse({ t: 'plan', rev: 1, view: { ...sampleView(), branch: 'plan/x' } }).success).toBe(false);
    expect(DaemonFrame.safeParse({ t: 'hello', proto: { major: 1, minor: 0 }, daemon: 'd1', projects: [{ id: 'pr1', name: 'App' }] }).success).toBe(true);
  });
});
