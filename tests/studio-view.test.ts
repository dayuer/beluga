import { describe, expect, it } from 'vitest';
import type { BoardState } from '../src/core/board/model.js';
import type { Plan, PlanBody, PlanMilestone, PlanTask } from '../src/core/plans/model.js';
import { type MilestoneView, type PlanView, type TaskView, planView } from '../src/core/plans/progress.js';
import { StudioPlanView } from '../src/studio/protocol.js';
import { studioPlanView } from '../src/studio/view.js';

/** A plan written the way agents write: paths, branches, models, KEYs, code everywhere. */
const dirtyTask = (id: string, over: Partial<PlanTask> & { audience?: 'customer' | 'operator' } = {}): PlanTask => ({
  id,
  title: `BLG-12 登录页 \`LoginPage.tsx\``,
  goal: '在 /Users/me/app/src/auth/login.ts 里加登录，分支 plan/synon-p1，用 claude-opus-5-5 写',
  acceptance: ['`npm test` 通过', '改 src/studio/view.ts 和 .env', '见 KLD-7 与 ws:abc123def'],
  blockedBy: ['secret-blocker'],
  touches: ['src/auth/login.ts', 'packages/mac/src/plans/PlanPage.tsx'],
  issueId: 'iss_123',
  ...over,
});

const decisionTask = (id: string, audience?: 'customer' | 'operator'): PlanTask =>
  ({
    ...dirtyTask(id),
    title: '选登录方式',
    assignee: 'me',
    decision: { question: '用哪种登录？参考 `auth.ts` 与 BLG-3', options: [{ label: '邮箱', description: '最简单，见 src/a/b/c.ts' }, { label: '手机' }], multi: false },
    ...(audience ? { audience } : {}),
  }) as PlanTask;

const milestone = (id: string, tasks: PlanTask[]): PlanMilestone => ({
  id,
  title: `M1 核心 BLG-40 ~/repo/x`,
  goal: '跑通 Fable 和 Sonnet 的检查\n```ts\nconst key = process.env.SECRET;\n```\n然后交付',
  criteria: ['npx vitest run tests/studio-view.test.ts 通过', '~~~\nrm -rf /\n~~~', 'conv:ws:9f8e7d6c5b4a3921 里确认'],
  tasks,
});

const body = (): PlanBody => ({
  title: 'Synon 会员 BLG-1：plan/abc 分支',
  goal: '用 `src/core/plans/model.ts` 做会员登录，worktree ws:1a2b3c4d5e6f7a8b，Claude Code 负责',
  milestones: [milestone('core-m1', [dirtyTask('auth-api'), decisionTask('pick-login', 'customer'), decisionTask('aws-keys', 'operator'), decisionTask('pay-account')])],
  decisions: [{ id: 'model-choice', text: '用 claude-opus-5-5 写，worktree 在 ~/.beluga/workspaces' }],
});

const plan = (over: Partial<Plan> = {}): Plan => ({
  id: 'pl_secretid1',
  projectId: 'proj-secret',
  home: 'ws:homeSecret',
  status: 'draft',
  draft: body(),
  draftRev: 7,
  autonomy: 'gated',
  maxParallel: 3,
  testsAt: 'end',
  agent: { runtime: 'claude', model: 'claude-opus-5-5' } as Plan['agent'],
  checkAgent: { runtime: 'claude', model: 'claude-fable-5-2' } as Plan['agent'],
  paused: false,
  runs: {},
  branch: 'plan/synon-secret',
  activity: [
    { id: 'e1', at: 10, by: 'claude' as never, kind: 'started', text: 'Started BLG-12 in ws:abc on plan/x with claude-opus' },
    { id: 'e2', at: 20, by: 'claude' as never, kind: 'note', text: 'Edited src/auth.ts' },
  ],
  createdAt: 1,
  updatedAt: 2,
  ...over,
});

/** A running plan's view, as progress.ts would give it. */
function runningView(): PlanView {
  const b = body();
  const p = plan({ status: 'active', body: b, draft: undefined, approvedAt: 3 });
  const m = b.milestones[0]!;
  const tv = (task: PlanTask, state: TaskView['state']): TaskView =>
    ({ task, milestoneId: m.id, state, waitsOn: ['x'], forYou: task.assignee === 'me', worktree: 'ws_wt123', base: 'plan/synon-secret', why: 'waits on BLG-9', issue: { key: 'BLG-12', id: 'iss_1', worktrees: [] } }) as unknown as TaskView;
  const mv = {
    milestone: m,
    index: 0,
    state: 'gate',
    tasks: [tv(m.tasks[0]!, 'running'), tv(m.tasks[1]!, 'ready'), tv(m.tasks[2]!, 'ready'), tv(m.tasks[3]!, 'ready')],
    finished: 1,
    total: 4,
    autonomy: 'gated',
    run: { check: { at: 5, by: 'claude', verdict: 'pass', notes: '检查了 src/auth/login.ts，`npm test` 过了，分支 plan/x，BLG-12 完成' }, checker: 'ws_checker1', agent: { ws: 'ws_agent' } },
    dependsOn: [],
  } as unknown as MilestoneView;
  return { plan: p, body: b, milestones: [mv], open: [mv], current: mv, ready: [], active: [], next: { kind: 'none' }, done: 1, total: 4 } as unknown as PlanView;
}

const FORBIDDEN = [
  /\//, // any path or branch
  /\.(?:ts|tsx|env)\b/,
  /`/,
  /```|~~~/,
  /\b(?:claude|opus|sonnet|haiku|fable|codex)/i,
  /\b[A-Z]{2,}-\d+\b/,
  /\b(?:ws|conv|pl|iss)[:_]/,
  /process\.env|rm -rf|const key/,
  /secret-blocker|auth-api|pick-login|core-m1|model-choice/,
  /proj-secret|homeSecret|secretid/,
  /AWS|付款账号|填 AWS/,
];

const strings = (v: unknown): string[] => (typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(strings) : v && typeof v === 'object' ? Object.values(v).flatMap(strings) : []);
const keys = (v: unknown): string[] => (Array.isArray(v) ? v.flatMap(keys) : v && typeof v === 'object' ? Object.entries(v).flatMap(([k, x]) => [k, ...keys(x)]) : []);

function expectClean(view: unknown): void {
  const json = JSON.stringify(view);
  for (const s of strings(view)) for (const re of FORBIDDEN) expect(s, `${re} in «${s}»`).not.toMatch(re);
  for (const k of ['needsYou', 'topic', 'agent', 'checkAgent', 'agents', 'checker', 'touches', 'blockedBy', 'worktree', 'branch', 'issue', 'key', 'qid', 'method', 'args', 'home', 'projectId', 'why', 'base', 'findings'])
    expect(keys(view), k).not.toContain(k);
  expect(json).not.toMatch(/decide:|questions\.|plans\.|host\./);
}

describe('studioPlanView: a draft', () => {
  const v = studioPlanView({ planRef: 'p1', view: planView(plan(), {} as BoardState) });

  it('carries none of the plan’s paths, branches, agents, models, KEYs, ids or code', () => {
    expectClean(v);
  });

  it('parses with the strict schema; a field not named fails', () => {
    expect(StudioPlanView.parse(v)).toEqual(v);
    expect(StudioPlanView.safeParse({ ...v, branch: 'x' }).success).toBe(false);
    expect(StudioPlanView.safeParse({ ...v, milestones: [{ ...v.milestones[0], touches: [] }] }).success).toBe(false);
  });

  it('keeps what the customer should read', () => {
    expect(v.stage).toBe('drafting');
    expect(v.draftRev).toBe(7);
    expect(v.title).toContain('Synon 会员');
    expect(v.goal).toContain('会员登录');
    expect(v.milestones[0]!.title).toContain('核心');
    expect(v.milestones[0]!.goal).toContain('然后交付');
    expect(v.milestones[0]!.tasks[0]!.title).toBe('登录页');
    expect(v.milestones[0]!.tasks.map((t) => t.ref)).toEqual(['m0-t0', 'm0-t1', 'm0-t2', 'm0-t3']);
  });

  it('only the customer’s decisions, never the operator’s, the unmarked or the plan’s own', () => {
    expect(v.decisions).toHaveLength(1);
    expect(v.decisions[0]!.decisionId).toBe('d-m0-t1');
    expect(v.decisions[0]!.options.map((o) => o.label)).toEqual(['邮箱', '手机']);
    expect(v.decisions[0]!.open).toBe(false); // nothing is asked before the plan runs
  });

  it('activity in fixed words, never the event’s text', () => {
    expect(v.activity).toEqual([{ at: 10, text: '开始了一项工作' }]);
  });

  it('is pure: the same input, the same output', () => {
    expect(studioPlanView({ planRef: 'p1', view: planView(plan(), {} as BoardState) })).toEqual(v);
  });
});

describe('studioPlanView: running, at its gate', () => {
  const turns = [
    { id: 't1', who: 'customer' as const, text: '能加个手机登录吗？', at: 1 },
    { id: 't2', who: 'ai' as const, role: 'Engineering', name: 'Claude', text: '好的，我改了 `src/auth.ts`，在 plan/x 上，BLG-5\n```\ncode\n```', at: 2 },
  ];
  const v = studioPlanView({ planRef: 'p1', view: runningView(), turns, gate: { kind: 'start', state: 'approved', draftRev: 7, reason: '见 /tmp/x.log' }, roles: { Engineering: '工程' } });

  it('is clean everywhere, turns and review included', () => {
    expectClean(v);
  });

  it('waits for the customer’s verdict, with the checker’s words cleaned', () => {
    expect(v.stage).toBe('awaiting-review');
    expect(v.waitingOn).toBe('customer');
    expect(v.headline).toContain('等你验收');
    expect(v.review?.milestoneRef).toBe('m0');
    expect(v.review?.notes).toContain('完成');
    expect(v.milestones[0]!.status).toBe('review');
    expect(v.milestones[0]!.tasks[0]!.status).toBe('doing');
  });

  it('a decision for the customer is open once its task is ready', () => {
    expect(v.decisions.map((d) => [d.decisionId, d.open])).toEqual([['d-m0-t1', true]]);
  });

  it('turns are cleaned, roles mapped, and the AI’s own name dropped', () => {
    expect(v.turns[0]!.text).toBe('能加个手机登录吗？');
    expect(v.turns[1]!.role).toBe('工程');
    expect(v.turns[1]!.name).toBeUndefined();
    expect(v.turns[1]!.text).toContain('好的');
  });
});

describe('studioPlanView: changes to a running plan', () => {
  it('shows the draft’s difference in titles only', () => {
    const b = body();
    const d: PlanBody = {
      ...b,
      milestones: [
        { ...b.milestones[0]!, tasks: [{ ...b.milestones[0]!.tasks[0]!, acceptance: ['新的标准'] }, ...b.milestones[0]!.tasks.slice(2), dirtyTask('new-one', { title: '支付页 BLG-77' })] },
        milestone('m2-new', [dirtyTask('t9', { title: '上线' })]),
      ],
    };
    const p = plan({ status: 'active', body: b, draft: d, draftRev: 9 });
    const v = studioPlanView({ planRef: 'p1', view: planView({ ...p, body: undefined }, {} as BoardState), gate: undefined });
    // planView of a body-less copy is enough for the shape; the diff reads plan.body and plan.draft.
    const withBody = studioPlanView({ planRef: 'p1', view: { ...planView({ ...p, body: undefined }, {} as BoardState), plan: p } });
    expect(v.draftDiff).toBeUndefined();
    const diff = withBody.draftDiff!;
    expect(diff.draftRev).toBe(9);
    expect(diff.added.map((a) => [a.kind, a.title])).toEqual([
      ['milestone', 'M1 核心'],
      ['task', '支付页'],
      ['task', '上线'],
    ]);
    expect(diff.removed.map((r) => r.title)).toEqual(['选登录方式']);
    expect(diff.changed.map((c) => c.title)).toEqual(['登录页']);
    expect(diff.changed[0]!.after).toContain('新的标准');
    expectClean(withBody);
  });
});
