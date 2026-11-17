# 模型编队与全自动驾驶 开发计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 计划可以选"自动"，由规划、执行、审查三个角色按本机已有的模型分工；再加一档 Full Autopilot，agent 的提问由规划角色代答。

**Architecture:** 一个纯函数模块（`src/shared/model-tiers.ts`）把可用模型归成强、中、快三档并搭出三个角色的候选；计划上只存 `team`（"自动"或指定的模型），每次开工时现算。全自动是 `Autonomy` 的第四个值，`QuestionBroker` 出卡片前先交给 `AutoAnswers`，由计划主对话用两个新工具作答或退回。

**Tech Stack:** TypeScript、zod、vitest、Playwright（Mac）、React Native（手机）。

**设计文档:** `docs/superpowers/specs/2026-11-16-model-team-design.md`。下文的 §n 指它的章节。

---

## 怎么读这份计划

- 分三期，**每期一个 PR、一个 worktree**，互不依赖，按顺序做：
  1. 第一期 Full Autopilot（任务 1–8），分支 `fork/full-autopilot`。
  2. 第二期 模型编队（任务 9–17），分支 `fork/model-team`；上游对应更新 #546 的 `upstream-pr/model-tiers`。
  3. 第三期 endpoint 检查拆分（任务 18），只涉及上游 PR。
- 本分叉里 #546 的实现已经在 `main`：`src/shared/auto-route.ts`、`src/fork/plans/{roles,ladder,fixer}.ts`、
  `src/fork/failing-models.ts`、`Plan.checkAgent/archAgent/fixAgent`。第二期是**改造**它，不是从零写。
- 每个任务先写失败的测试，再实现，再提交。测试遵守 CLAUDE.md "Tests that pass everywhere"：
  用 `waitFor`（`tests/helpers.ts`）等条件；时钟和定时器传进去；路径用 `path.join`。
- 每期最后一个任务跑完整的 `npx vitest run`，把结尾的 `Tested-on: macOS <tree>` 一行原样放进最后一次提交。
  本机 git 说中文时用 `LC_ALL=C npx vitest run`。
- 与设计文档的一处出入：§10 写 `escalate.ts` 取代 `fixer.ts` 和 `ladder.ts`。实际只让 `escalate.ts` 给出
  升级顺序，`fixer.ts`（怎么换人、怎么换回来）和 `ladder.ts` 的 `nextRung`、`modelFailed`、`modelGone` 保留。
  这样改动小，现有 `fork-model-ladder*.test.ts` 大部分还能用。

## 文件一览

| 文件 | 期 | 职责 |
|---|---|---|
| `src/core/plans/model.ts` | 1、2 | `full`、`runsItself`、`AutoAnswer`、`PlanDecision.onlyYou`；`PlanTeam` |
| `src/core/plans/auto-answer.ts`（新） | 1 | 代答：谁能代答、等多久、几次后退回、留痕 |
| `src/core/questions.ts` | 1 | 出卡片前先问 `first` |
| `src/agent/plan-tools.ts`、`src/agent/types.ts` | 1 | `plan_answer`、`plan_defer` |
| `src/core/plans/decisions.ts` | 1 | 带选项的决定在 `full` 下交给代答 |
| `src/shared/model-tiers.ts`（新） | 2 | 能力表、搭配、角色取人 |
| `src/fork/plans/escalate.ts`（新） | 2 | 升级顺序：执行 → 审查 → 规划 |
| `src/shared/settings-schema.ts` | 2 | `team` 取代 `autoRoute`，读取时换算 |
| `src/core/plans/plans.ts`、`src/ipc/plans-api.ts` | 2 | `setTeam` 取代三个 `set*Agent` |
| `src/shared/auto-route.ts` | 2 | 删除 |
| `packages/mac/src/plans/`、`packages/mac/src/fork/plans/` | 1、2 | 第四张自主卡片、"替你做的决定"；"自动"与自定义表 |
| `packages/companion/` | 1、2 | 自主程度多一档；计划的"模型" |

---

# 第一期：Full Autopilot

开工前：`git worktree add ../beluga-full-autopilot -b fork/full-autopilot main`，之后都在那个目录里做。

### Task 1: `full` 这一档和 `runsItself`

现在有 13 处写着 `=== 'autopilot'`。先收成一个函数，再加新值，后面就不会漏。

**Files:**
- Modify: `src/core/plans/model.ts:13-24`
- Modify: `src/agent/plan-tools.ts:20`
- Modify: `src/core/notify.ts:173`、`src/core/plans/prompt.ts:177,237,377`、`src/core/plans/progress.ts:384`、`src/core/plans/work.ts:401,700,820,851`、`src/core/plans/pilot.ts:166,681,1081,1105`、`src/studio/gates.ts:309,315`、`packages/mac/src/plans/plans-model.ts:333`
- Test: `tests/plan-full-autonomy.test.ts`

- [ ] **Step 1: 写失败的测试**

```ts
import { describe, expect, it } from 'vitest';
import { AUTONOMIES, AUTONOMY_INFO, answersItself, runsItself } from '../src/core/plans/model.js';

describe('Full Autopilot, the fourth autonomy', () => {
  it('is listed last, after Autopilot', () => {
    expect(AUTONOMIES).toEqual(['step', 'gated', 'autopilot', 'full']);
    expect(AUTONOMY_INFO.full.label).toBe('Full Autopilot');
  });

  it('runs milestone to milestone as Autopilot does', () => {
    expect(AUTONOMIES.filter(runsItself)).toEqual(['autopilot', 'full']);
  });

  it('is the only one that answers its own questions', () => {
    expect(AUTONOMIES.filter(answersItself)).toEqual(['full']);
  });
});
```

- [ ] **Step 2: 跑一次，确认失败**

Run: `npx vitest run tests/plan-full-autonomy.test.ts`
Expected: FAIL，`answersItself` 和 `runsItself` 没有导出。

- [ ] **Step 3: 实现**

`src/core/plans/model.ts`，替换第 13 行并在 `AUTONOMY_INFO` 里加一项，后面加两个函数：

```ts
export const AUTONOMIES = ['step', 'gated', 'autopilot', 'full'] as const;
```

```ts
  full: { label: 'Full Autopilot', summary: 'Runs to the end and answers its own questions', hint: 'As Autopilot, and when an agent asks something your plan’s agent answers for you; it stops only for what needs you in person' },
```

```ts
/** Milestone to milestone on its own (Autopilot and Full Autopilot): checks pass by themselves. */
export const runsItself = (a: Autonomy | undefined): boolean => a === 'autopilot' || a === 'full';

/** Its agents' questions go to the plan's own agent first, not to you (Full Autopilot). */
export const answersItself = (a: Autonomy | undefined): boolean => a === 'full';
```

`src/agent/plan-tools.ts:20`：

```ts
const AUTONOMY = z.enum(['step', 'gated', 'autopilot', 'full']);
```

- [ ] **Step 4: 把 13 处比较换成 `runsItself`**

每一处的规则相同：`X === 'autopilot'` 改成 `runsItself(X)`，`X !== 'autopilot'` 改成 `!runsItself(X)`，并在该文件
从 `./model.js`（或对应的相对路径）导入 `runsItself`。例如 `src/core/plans/pilot.ts:681`：

```ts
    const autopilot = runsItself(m?.autonomy ?? plan.autonomy);
```

`src/core/plans/work.ts:401` 和 `src/studio/gates.ts:309,315` 也照此改：共享给 Synon Studio 的计划同样不能用
`full`（§9）。`work.ts:401` 的报错改成：

```ts
      throw new Error('A plan shared with Synon Studio can’t run on its own: it runs gated.');
```

改完后确认没有漏：

Run: `grep -rn "'autopilot'" src packages/mac/src --include='*.ts' --include='*.tsx' | grep -v "model.ts\|plan-tools.ts\|protocol.ts\|copilot/\|auto-route.ts\|calls.ts\|plans-model.ts:351\|PlanSheets.tsx"`
Expected: 没有输出。

- [ ] **Step 5: 补 Studio 的测试**

在 `tests/plan-full-autonomy.test.ts` 里加（`setup()` 照抄 `tests/plan-decisions.test.ts:41` 起的那个，
它给出 `store`、`work`）：

```ts
  it('is refused on a plan shared with Synon Studio', () => {
    const { store, work } = setup();
    const plan = work.create({ projectId: 'api', goal: 'x' });
    store.dispatch({ type: 'studio_shared', shared: ['api'] });
    expect(() => work.setAutonomy(plan.id, 'full')).toThrow(/runs gated/);
  });
```

先 `grep -n "studio" src/core/store.ts | head` 确认把项目标成共享的 action 名字，按实际的写。

- [ ] **Step 6: 跑测试和类型检查**

Run: `npx vitest run tests/plan-full-autonomy.test.ts tests/plans.test.ts tests/plan-decisions.test.ts && npm run typecheck`
Expected: PASS。类型检查会指出 `Record<Autonomy, …>` 缺 `full` 的地方（`packages/mac/src/plans/PlanSheets.tsx:22`
的 `AUTONOMY_ICON`），那里先补 `full: 'sparkles'`，没有这个图标名就用 `'wand'`。

- [ ] **Step 7: 提交**

```bash
git add -A && git commit -m "Plans: Full Autopilot as a fourth autonomy (runs as Autopilot for now)"
```

### Task 2: 代答的规则（纯逻辑）

**Files:**
- Create: `src/core/plans/auto-answer.ts`
- Modify: `src/core/plans/model.ts`（`AutoAnswer`、`Plan.autoAnswers`）
- Modify: `src/core/plans/plans.ts`（`recordAutoAnswer`）
- Test: `tests/plan-auto-answer.test.ts`

- [ ] **Step 1: 数据**

`src/core/plans/model.ts`，在 `PlanEvent` 后面：

```ts
/** A question the plan's own agent answered for you (Full Autopilot), kept so you can read it and change it. */
export interface AutoAnswer {
  readonly id: string;
  readonly at: number;
  /** The conversation that asked (`ws:<id>`). */
  readonly channel: string;
  /** Its task's id in the plan, when it was a task's agent. */
  readonly task?: string;
  readonly question: string;
  readonly answer: string;
  readonly why: string;
}

/** Most answers a plan keeps (the oldest go). */
export const MAX_AUTO_ANSWERS_KEPT = 200;
```

`Plan` 里加：

```ts
  /** What its agent answered for you, oldest first. */
  readonly autoAnswers?: readonly AutoAnswer[];
```

`src/core/plans/plans.ts`，照 `note()`（第 515 行）的写法加：

```ts
  recordAutoAnswer(id: string, answer: AutoAnswer): Plan {
    const plan = this.need(id);
    return this.put({ ...plan, autoAnswers: [...(plan.autoAnswers ?? []), answer].slice(-MAX_AUTO_ANSWERS_KEPT) });
  }
```

`put` 用这个类里其他 setter 实际用的那个保存方法（看 `setPaused` 的最后一行）。

- [ ] **Step 2: 写失败的测试**

```ts
import { describe, expect, it } from 'vitest';
import type { ClaudeAnswer, ClaudeQuestion } from '../src/protocol.js';
import { AutoAnswers, MAX_PER_CHANNEL, questionText } from '../src/core/plans/auto-answer.js';

const Q = (text: string): ClaudeQuestion => ({ kind: 'question', questions: [{ question: text, header: '', options: [{ label: 'A', description: '' }, { label: 'B', description: '' }], multiSelect: false }] });

function setup(autonomy: 'autopilot' | 'full' = 'full') {
  const asked: Array<{ prompt: string; channel: string }> = [];
  const kept: Array<{ question: string; answer: string; why: string }> = [];
  const timers: Array<() => void> = [];
  const auto = new AutoAnswers({
    placeOf: (channel) => (channel === 'ws:task' ? { planId: 'p1', home: 'ws:home', autonomy, task: 't1' } : undefined),
    askHome: (prompt, channel) => void asked.push({ prompt, channel }),
    record: (_plan, a) => void kept.push(a),
    timer: (fn) => {
      timers.push(fn);
      return () => undefined;
    },
    now: () => 1000,
    id: () => `q${asked.length + 1}`,
  });
  return { auto, asked, kept, timers };
}

describe('a Full Autopilot plan answers its own questions', () => {
  it('sends a task’s question to the plan’s home and resolves with its answer', async () => {
    const { auto, asked, kept } = setup();
    const waiting = auto.offer('ws:task', Q('Which database?'));
    expect(asked).toHaveLength(1);
    expect(asked[0]!.channel).toBe('ws:home');
    expect(asked[0]!.prompt).toContain('Which database?');
    expect(auto.answer('p1', 'q1', { 'Which database?': 'A' }, 'The plan says Postgres')).toMatch(/answered/i);
    expect(await waiting).toEqual<ClaudeAnswer>({ kind: 'answers', answers: { 'Which database?': 'A' } });
    expect(kept).toEqual([expect.objectContaining({ question: 'Which database?', answer: 'A', why: 'The plan says Postgres' })]);
  });

  it('leaves it to you on a plan that isn’t Full Autopilot, outside a plan, and for a plan to approve', async () => {
    expect(await setup('autopilot').auto.offer('ws:task', Q('x'))).toBeUndefined();
    expect(await setup().auto.offer('ws:other', Q('x'))).toBeUndefined();
    expect(await setup().auto.offer('ws:task', { kind: 'plan', plan: 'do it' })).toBeUndefined();
  });

  it('never asks the home its own question', async () => {
    const { auto } = setup();
    // The home's own questions are yours: there is no one above it.
    expect(await auto.offer('ws:home', Q('x'))).toBeUndefined();
  });

  it('gives it back to you when the home defers', async () => {
    const { auto, kept } = setup();
    const waiting = auto.offer('ws:task', Q('Which Apple account?'));
    auto.defer('p1', 'q1', 'Only the owner has the account');
    expect(await waiting).toBeUndefined();
    expect(kept).toEqual([]);
  });

  it('gives it back to you when the home doesn’t answer in time', async () => {
    const { auto, timers } = setup();
    const waiting = auto.offer('ws:task', Q('x'));
    timers[0]!();
    expect(await waiting).toBeUndefined();
    expect(auto.answer('p1', 'q1', { x: 'A' }, 'late')).toMatch(/no longer/i);
  });

  it('gives the same question, asked again, to you', async () => {
    const { auto } = setup();
    const first = auto.offer('ws:task', Q('x'));
    auto.answer('p1', 'q1', { x: 'A' }, 'w');
    await first;
    expect(await auto.offer('ws:task', Q('x'))).toBeUndefined();
  });

  it(`stops answering for one conversation after ${MAX_PER_CHANNEL}`, async () => {
    const { auto } = setup();
    for (let i = 1; i <= MAX_PER_CHANNEL; i++) {
      const w = auto.offer('ws:task', Q(`q ${i}`));
      auto.answer('p1', `q${i}`, { [`q ${i}`]: 'A' }, 'w');
      expect(await w).toBeDefined();
    }
    expect(await auto.offer('ws:task', Q('one more'))).toBeUndefined();
  });

  it('refuses an answer from another plan', async () => {
    const { auto } = setup();
    void auto.offer('ws:task', Q('x'));
    expect(auto.answer('p2', 'q1', { x: 'A' }, 'w')).toMatch(/isn’t this plan’s/i);
  });

  it('says a question in one line', () => {
    expect(questionText(Q('Which database?'))).toBe('Which database?');
  });
});
```

- [ ] **Step 3: 跑一次，确认失败**

Run: `npx vitest run tests/plan-auto-answer.test.ts`
Expected: FAIL，找不到 `auto-answer.js`。

- [ ] **Step 4: 实现**

`src/core/plans/auto-answer.ts`：

```ts
import type { ClaudeAnswer, ClaudeQuestion } from '../../protocol.js';
import { type Autonomy, type AutoAnswer, answersItself } from './model.js';

/**
 * Full Autopilot: a question from one of a plan's agents goes to the plan's own agent (its home
 * conversation) before it goes to you. The home answers with plan_answer, or hands it to you with
 * plan_defer; silence for WAIT_MS hands it to you too. Each answer is kept on the plan. It never
 * answers the home's own questions, a plan to approve, the same question twice, or more than
 * MAX_PER_CHANNEL for one conversation: those are yours, so two agents can't go round in circles.
 * Approvals of what a tool may do never come here (they aren't questions).
 */

/** How long the home has to answer before the question is yours. */
export const WAIT_MS = 120_000;
/** Most questions answered for one conversation; the next is yours. */
export const MAX_PER_CHANNEL = 5;

/** Where a conversation sits in a plan. */
export interface AnswerPlace {
  readonly planId: string;
  readonly home: string;
  /** The autonomy in force there: its milestone's, else the plan's. */
  readonly autonomy: Autonomy;
  readonly task?: string;
}

export interface AutoAnswerDeps {
  readonly placeOf: (channel: string) => AnswerPlace | undefined;
  /** Ask the plan's home (queued behind its current turn). */
  readonly askHome: (prompt: string, home: string) => void;
  readonly record: (planId: string, answer: AutoAnswer) => void;
  /** Run `fn` after `ms`; returns how to cancel it. */
  readonly timer: (fn: () => void, ms: number) => () => void;
  readonly now: () => number;
  readonly id: () => string;
}

interface Open {
  readonly place: AnswerPlace;
  readonly channel: string;
  readonly text: string;
  readonly resolve: (a: ClaudeAnswer | undefined) => void;
  readonly cancel: () => void;
}

/** A question in one line, as the plan keeps it. */
export const questionText = (q: ClaudeQuestion): string => (q.kind === 'question' ? q.questions.map((x) => x.question).join(' · ') : 'A plan to approve');

function homePrompt(qid: string, place: AnswerPlace, q: Extract<ClaudeQuestion, { kind: 'question' }>): string {
  const body = q.questions
    .map((x) => `- ${x.question}${x.multiSelect ? ' (several allowed)' : ''}\n${x.options.map((o) => `    - ${o.label}${o.description ? `: ${o.description}` : ''}`).join('\n')}`)
    .join('\n');
  return [
    `This plan runs on Full Autopilot, so you answer for the user. ${place.task ? `The agent on task "${place.task}"` : 'One of its agents'} asks (question id ${qid}):`,
    body,
    'Answer from the plan and what the user has said, with plan_answer (each question’s text → the option’s label, or your own words) and one sentence of why.',
    'If only the user can answer (an account, a key, a payment, publishing something, or a choice the plan gives no ground for), call plan_defer with why. Don’t guess those.',
  ].join('\n\n');
}

export class AutoAnswers {
  private readonly open = new Map<string, Open>();
  private readonly count = new Map<string, number>();
  private readonly seen = new Map<string, Set<string>>();

  constructor(private readonly deps: AutoAnswerDeps) {}

  /** Try to have the plan answer it. Undefined: it's yours (show the card as before). */
  offer(channel: string, question: ClaudeQuestion): Promise<ClaudeAnswer | undefined> {
    if (question.kind !== 'question') return Promise.resolve(undefined);
    const place = this.deps.placeOf(channel);
    if (!place || !answersItself(place.autonomy) || place.home === channel) return Promise.resolve(undefined);
    const text = questionText(question);
    const seen = this.seen.get(channel) ?? new Set<string>();
    if (seen.has(text) || (this.count.get(channel) ?? 0) >= MAX_PER_CHANNEL) return Promise.resolve(undefined);
    seen.add(text);
    this.seen.set(channel, seen);
    const qid = this.deps.id();
    return new Promise((resolve) => {
      const cancel = this.deps.timer(() => this.close(qid, undefined), WAIT_MS);
      this.open.set(qid, { place, channel, text, resolve, cancel });
      this.deps.askHome(homePrompt(qid, place, question), place.home);
    });
  }

  /** plan_answer, from the plan's home. */
  answer(planId: string, qid: string, answers: Readonly<Record<string, string>>, why: string): string {
    const o = this.open.get(qid);
    if (!o) return 'That question is no longer waiting (it went to the user, or was answered).';
    if (o.place.planId !== planId) return 'That question isn’t this plan’s.';
    this.count.set(o.channel, (this.count.get(o.channel) ?? 0) + 1);
    this.deps.record(planId, { id: qid, at: this.deps.now(), channel: o.channel, ...(o.place.task ? { task: o.place.task } : {}), question: o.text, answer: Object.values(answers).join(' · '), why });
    this.close(qid, { kind: 'answers', answers: { ...answers } });
    return 'Answered: its agent carries on. The user can see and change it on the plan’s page.';
  }

  /** plan_defer, from the plan's home: it's the user's. */
  defer(planId: string, qid: string, _why: string): string {
    const o = this.open.get(qid);
    if (!o) return 'That question is no longer waiting.';
    if (o.place.planId !== planId) return 'That question isn’t this plan’s.';
    this.close(qid, undefined);
    return 'Left for the user: they’ve been asked.';
  }

  /** A conversation was stopped: nothing of it waits on the home any more. */
  cancelChannel(channel: string): void {
    for (const [qid, o] of [...this.open]) if (o.channel === channel) this.close(qid, undefined);
  }

  private close(qid: string, answer: ClaudeAnswer | undefined): void {
    const o = this.open.get(qid);
    if (!o) return;
    this.open.delete(qid);
    o.cancel();
    o.resolve(answer);
  }
}
```

- [ ] **Step 5: 跑测试**

Run: `npx vitest run tests/plan-auto-answer.test.ts && npm run typecheck`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add -A && git commit -m "Plans: the rules for a plan answering its own agents' questions"
```

### Task 3: `QuestionBroker` 出卡片前先问

**Files:**
- Modify: `src/core/questions.ts:5-12,72-90,130-140`
- Test: `tests/question-first.test.ts`

- [ ] **Step 1: 写失败的测试**

```ts
import { describe, expect, it } from 'vitest';
import { QuestionBroker } from '../src/core/questions.js';
import { Store, initialState } from '../src/core/store.js';
import type { ClaudeAnswer, ClaudeQuestion } from '../src/protocol.js';

const Q: ClaudeQuestion = { kind: 'question', questions: [{ question: 'Which?', header: '', options: [{ label: 'A', description: '' }], multiSelect: false }] };

function setup(first: (channel: string, q: ClaudeQuestion) => Promise<ClaudeAnswer | undefined>) {
  const store = new Store(initialState('room'));
  const broker = new QuestionBroker({ store, selfId: () => 'me', send: () => true, timeoutMs: () => 60_000, toast: () => undefined, first });
  return { store, broker };
}

describe('a question can be answered before it reaches your screen', () => {
  it('resolves with that answer and shows no card', async () => {
    const { store, broker } = setup(async () => ({ kind: 'answers', answers: { 'Which?': 'A' } }));
    expect(await broker.ask('me', 'r1', 'ws:task', Q)).toEqual({ kind: 'answers', answers: { 'Which?': 'A' } });
    expect(store.getState().questions).toEqual([]);
  });

  it('shows the card as before when nobody answered first', async () => {
    const { store, broker } = setup(async () => undefined);
    const waiting = broker.ask('me', 'r1', 'ws:task', Q);
    await Promise.resolve();
    await Promise.resolve();
    const card = store.getState().questions[0]!;
    expect(card.channel).toBe('ws:task');
    broker.answer(card.qid, { kind: 'skip' });
    expect(await waiting).toEqual({ kind: 'skip' });
  });

  it('never asks first for a friend’s request', async () => {
    let called = 0;
    const { broker } = setup(async () => {
      called++;
      return undefined;
    });
    void broker.ask('friend', 'r1', 'ws:task', Q);
    await Promise.resolve();
    expect(called).toBe(0);
    broker.cancelAll();
  });
});
```

- [ ] **Step 2: 跑一次，确认失败**

Run: `npx vitest run tests/question-first.test.ts`
Expected: FAIL，`first` 不是 `QuestionDeps` 的字段，第一条断言拿到的是挂起的 Promise。

- [ ] **Step 3: 实现**

`src/core/questions.ts`，`QuestionDeps` 里加：

```ts
  /** Asked before a card for you is shown: an answer here is the answer (a Full Autopilot plan's own agent). Undefined: it's yours. */
  readonly first?: (channel: string, question: ClaudeQuestion) => Promise<ClaudeAnswer | undefined>;
```

把现在的 `ask` 改名为 `private show(...)`（函数体不动），新的 `ask`：

```ts
  /** On the computer running Claude: ask `requester` and wait for their answer. */
  async ask(requester: string, requestId: string, channel: string, question: ClaudeQuestion): Promise<ClaudeAnswer> {
    if (this.deps.first && requester === this.deps.selfId()) {
      const answered = await this.deps.first(channel, question).catch(() => undefined);
      if (answered) return answered;
    }
    return this.show(requester, requestId, channel, question);
  }
```

- [ ] **Step 4: 跑测试**

Run: `npx vitest run tests/question-first.test.ts tests/plan-decisions.test.ts && npm run typecheck`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add -A && git commit -m "Questions: something can answer before the card is shown"
```

### Task 4: 两个工具，并接进会话

**Files:**
- Modify: `src/agent/types.ts:255-273`（`PlanTools`）
- Modify: `src/agent/plan-tools.ts:14,180-222`
- Modify: `src/core/session-parts.ts:177`（建 `QuestionBroker` 处）
- Modify: 建 `PlanTools` 实现的地方（`grep -rn "design: (" src/core | head` 找到给主对话装 `design`/`review` 的那个文件，在它旁边装）
- Test: `tests/plan-auto-answer-tools.test.ts`

- [ ] **Step 1: 写失败的测试**

```ts
import { describe, expect, it } from 'vitest';
import { PLAN_TOOL_NAMES, createPlanToolDefs } from '../src/agent/plan-tools.js';
import type { PlanTools } from '../src/agent/types.js';

const base: PlanTools = { get: () => '', write: () => '', update: () => '', gate: () => '', start: async () => '', message: () => '' };

describe('plan_answer and plan_defer', () => {
  it('are the home’s alone, on a plan that answers for itself', () => {
    const without = createPlanToolDefs(base).map((d) => d.name);
    expect(without).not.toContain('plan_answer');
    expect(without).not.toContain('plan_defer');
    const withThem = createPlanToolDefs({ ...base, answer: () => 'ok', defer: () => 'ok' }).map((d) => d.name);
    expect(withThem).toEqual(expect.arrayContaining(['plan_answer', 'plan_defer']));
    expect(PLAN_TOOL_NAMES).toEqual(expect.arrayContaining(['mcp__beluga_plan__plan_answer', 'mcp__beluga_plan__plan_defer']));
  });

  it('pass what the agent said through', async () => {
    const got: unknown[] = [];
    const defs = createPlanToolDefs({ ...base, answer: (qid, answers, why) => (got.push([qid, answers, why]), 'Answered'), defer: (qid, why) => (got.push([qid, why]), 'Left') });
    await defs.find((d) => d.name === 'plan_answer')!.handler({ question: 'q1', answers: [{ question: 'Which?', answer: 'A' }], why: 'the plan says so' });
    await defs.find((d) => d.name === 'plan_defer')!.handler({ question: 'q1', why: 'needs an account' });
    expect(got).toEqual([
      ['q1', { 'Which?': 'A' }, 'the plan says so'],
      ['q1', 'needs an account'],
    ]);
  });
});
```

`handler` 是 `tool()` 返回对象上实际的字段名；先看 `src/agent/tool-kit.ts` 里 `tool` 的返回类型，名字不同就按实际的改。

- [ ] **Step 2: 跑一次，确认失败**

Run: `npx vitest run tests/plan-auto-answer-tools.test.ts`
Expected: FAIL，`answer` 不在 `PlanTools` 上。

- [ ] **Step 3: 实现工具**

`src/agent/types.ts` 的 `PlanTools` 里加：

```ts
  /** Full Autopilot: the plan's home answers a question one of its agents asked (`plan_answer`). */
  answer?(qid: string, answers: Readonly<Record<string, string>>, why: string): string;
  /** Full Autopilot: that question is the user's after all (`plan_defer`). */
  defer?(qid: string, why: string): string;
```

`src/agent/plan-tools.ts`：`PLAN_TOOL_NAMES` 的数组里加 `'plan_answer', 'plan_defer'`；在 `plan_design` 后面加：

```ts
    tool(
      'plan_answer',
      'Answer, for the user, a question one of this plan’s agents asked (the plan runs on Full Autopilot). Only what the plan and the user’s own words give ground for.',
      {
        question: z.string().min(1).max(80).describe('The question id you were given'),
        answers: z.array(z.object({ question: z.string().min(1).max(1000).describe('The question, word for word'), answer: z.string().min(1).max(4000).describe('An option’s label, or your own words') })).min(1).max(4),
        why: z.string().min(1).max(600).describe('One sentence: what in the plan decides it'),
      },
      (a) => guarded(() => (plan.answer ? plan.answer(a.question, Object.fromEntries(a.answers.map((x) => [x.question, x.answer])), a.why) : 'Answering isn’t yours here')),
    ),
    tool(
      'plan_defer',
      'Leave a question one of this plan’s agents asked to the user: an account, a key, a payment, publishing something, or a choice the plan gives no ground for.',
      { question: z.string().min(1).max(80).describe('The question id you were given'), why: z.string().min(1).max(600) },
      (a) => guarded(() => (plan.defer ? plan.defer(a.question, a.why) : 'Answering isn’t yours here')),
    ),
```

过滤那一行（第 219 行）改成：

```ts
  const mine = defs.filter((d) => (d.name !== 'plan_review' || plan.review) && (d.name !== 'plan_design' || plan.design) && (d.name !== 'plan_answer' || plan.answer) && (d.name !== 'plan_defer' || plan.defer));
```

- [ ] **Step 4: 接进会话**

`src/core/session-parts.ts`，建 `QuestionBroker` 之前建 `AutoAnswers`，`placeOf` 用 `planOfChannel`
（`src/core/notify.ts:137`）：

```ts
    const autoAnswers = new AutoAnswers({
      placeOf: (channel) => {
        const state = store.getState();
        const place = planOfChannel(state, channel);
        if (!place || place.plan.status !== 'active' || place.plan.paused) return undefined;
        const milestone = place.task ? place.plan.body?.milestones.find((m) => m.tasks.some((t) => t.id === place.task)) : undefined;
        return { planId: place.plan.id, home: place.plan.home, autonomy: milestone?.autonomy ?? place.plan.autonomy, ...(place.task ? { task: place.task } : {}) };
      },
      askHome: (prompt, home) => void askClaude(prompt, home, false),
      record: (planId, answer) => void plans.recordAutoAnswer(planId, answer),
      timer: (fn, ms) => {
        const t = setTimeout(fn, ms);
        t.unref();
        return () => clearTimeout(t);
      },
      now: () => Date.now(),
      id: () => randomUUID().slice(0, 8),
    });
```

`'active'` 是 `PlanStatus` 里"已批准、在跑"的那个值，按 `model.ts` 里实际的名字写。`askClaude` 用这个文件里已经
传给 `PlansPilot` 的同一个函数（`pilot.ts:52` 的 `askClaude` 依赖）。然后给 `QuestionBroker` 传：

```ts
      first: (channel, question) => autoAnswers.offer(channel, question),
```

在给计划主对话装 `PlanTools` 的地方（装 `design`、`review` 的同一处），当 `answersItself(plan.autonomy)` 或它任一
里程碑的 `autonomy` 是 `full` 时加：

```ts
      answer: (qid, answers, why) => autoAnswers.answer(plan.id, qid, answers, why),
      defer: (qid, why) => autoAnswers.defer(plan.id, qid, why),
```

`QuestionBroker.cancelChannel` 被调用的地方（停掉某个对话的 Claude）同时调 `autoAnswers.cancelChannel(channel)`。

- [ ] **Step 5: 主对话的提示词**

`src/core/plans/prompt.ts:177` 那一行后面加一行（数组里的下一个元素）：

```ts
    plan.body && answersItself(plan.autonomy) ? 'It runs on Full Autopilot: when one of its agents asks the user something, you are asked instead. Answer with plan_answer from the plan and the user’s words; leave accounts, keys, payments, publishing and anything the plan gives no ground for to the user with plan_defer.' : '',
```

- [ ] **Step 6: 端到端的一条测试**

在 `tests/plan-auto-answer-tools.test.ts` 加一条，用真实的 `Store`、`Plans`、`QuestionBroker`、`AutoAnswers`
（`setup()` 照 `tests/plan-decisions.test.ts`，计划建成 `full` 并批准、有一个已开工的任务 `ws:w1`）：

```ts
  it('a task’s question on a Full Autopilot plan is answered by its home and kept on the plan', async () => {
    const { store, plans, broker, auto, sentToHome, planId } = setupFull();
    const waiting = broker.ask('me', 'r1', 'ws:w1', Q);
    const prompt = await waitFor(() => sentToHome[0]);
    const qid = /question id (\w+)/.exec(prompt)![1]!;
    auto.answer(planId, qid, { 'Which?': 'A' }, 'the plan says A');
    expect(await waiting).toEqual({ kind: 'answers', answers: { 'Which?': 'A' } });
    expect(store.getState().questions).toEqual([]);
    expect(plans.need(planId).autoAnswers).toEqual([expect.objectContaining({ question: 'Which?', answer: 'A', task: expect.any(String) })]);
  });
```

`setupFull()` 写在同一个文件里：`setup()` 的内容，加上 Step 4 那段 `AutoAnswers` 构造（`askHome` 把 prompt 推进
`sentToHome`），`waitFor` 从 `./helpers.js` 导入。

- [ ] **Step 7: 跑测试**

Run: `npx vitest run tests/plan-auto-answer-tools.test.ts tests/plan-auto-answer.test.ts tests/question-first.test.ts && npm run typecheck`
Expected: PASS。

- [ ] **Step 8: 提交**

```bash
git add -A && git commit -m "Plans: on Full Autopilot the plan's home answers its agents' questions (plan_answer, plan_defer)"
```

### Task 5: 带选项的"你来决定"任务

§8.3：`assignee: 'me'` 且带 `decision` 的任务在 `full` 下由主对话代答，除非标了 `onlyYou`；不带 `decision` 的
（账号、密钥）永远等你。Synon Studio 里 `audience: 'customer'` 的决定不受影响（共享的计划本来就不能是 `full`）。

**Files:**
- Modify: `src/core/plans/model.ts:70-74`（`PlanDecision`）
- Modify: `src/agent/plan-tools.ts:44-51`（`decision` 的 schema）、`src/core/plans/edit.ts`（`DecisionInput` 透传）
- Modify: `src/core/plans/decisions.ts`（出卡片处）
- Test: `tests/plan-decisions.test.ts`

- [ ] **Step 1: 写失败的测试**

在 `tests/plan-decisions.test.ts` 的 `BODY` 里给 `providers` 之外再加一个任务，并加两条测试：

```ts
        { id: 'price', title: 'Pick the price', assignee: 'me', decision: { question: 'Monthly price?', options: [{ label: '$5' }, { label: '$9' }], onlyYou: true } },
```

```ts
  it('on Full Autopilot a decision with options goes to the plan’s home, one marked onlyYou stays yours', async () => {
    const { store, work, sentToHome, planId } = setupApproved('full');
    await waitFor(() => sentToHome.some((p) => p.includes('Which providers at launch?')));
    const cards = store.getState().questions.map((q) => q.qid);
    expect(cards).toContain(decisionQid(planId, 'price'));
    expect(cards).not.toContain(decisionQid(planId, 'providers'));
    void work;
  });

  it('a task that’s yours with no decision always waits for you', async () => {
    const { planId, store } = setupApproved('full');
    const view = planView(store.getState().plans.plans.find((p) => p.id === planId)!, store.getState().board);
    expect(awaitingYou(view).map((t) => t.task.id)).toContain('keys');
  });
```

`setupApproved(autonomy)`：现有 `setup()` 加上建计划、写 `BODY`、`work.approve`，并把 `AutoAnswers`（Task 4 Step 4
的构造）接上；`sentToHome` 收 `askHome` 的 prompt。`awaitingYou` 的参数按它在 `decisions.ts` 里的签名传。

- [ ] **Step 2: 跑一次，确认失败**

Run: `npx vitest run tests/plan-decisions.test.ts`
Expected: FAIL，`onlyYou` 不是 `PlanDecision` 的字段；`providers` 的卡片还在。

- [ ] **Step 3: 实现**

`PlanDecision` 加：

```ts
  /** Full Autopilot never answers it for you: it's yours even there. */
  readonly onlyYou?: boolean;
```

`plan-tools.ts` 的 `decision` 对象里加：

```ts
      only_you: z.boolean().optional().describe('true: even on Full Autopilot only the user decides it (money, a name, anything they’d mind you choosing)'),
```

`taskInput`（同文件，把工具输入转成 `TaskInput`）里把 `only_you` 映射成 `onlyYou`；`edit.ts` 的 `DecisionInput` 加
`readonly onlyYou?: boolean` 并在 `normalizeBody` 里原样带过去。

`decisions.ts`：`PlanDecisions` 的依赖里加

```ts
  /** Full Autopilot: have the plan's home decide it. Undefined answer: it's yours after all. */
  readonly offer?: (plan: Plan, task: PlanTask, question: ClaudeQuestion) => Promise<ClaudeAnswer | undefined>;
```

在它调 `questions.pose(qid, …, onAnswer)` 之前：

```ts
      const mine = !answersItself(milestone.autonomy ?? plan.autonomy) || !task.decision || task.decision.onlyYou || !this.deps.offer;
      if (!mine) {
        if (this.offered.has(qid)) continue;
        this.offered.add(qid);
        void this.deps.offer!(plan, task, question).then((a) => (a ? onAnswer(a) : this.deps.questions.pose(qid, plan.home, question, onAnswer)));
        continue;
      }
```

类里加 `private readonly offered = new Set<string>();`。`session-parts.ts` 里给 `PlanDecisions` 传：

```ts
      offer: (plan, task, question) => autoAnswers.offerDecision(plan.id, plan.home, task.id, question),
```

`AutoAnswers` 加这个方法（主对话问自己，所以不走 `offer` 里"主对话的问题归你"那条）：

```ts
  /** A decision the plan wrote for the user (a task of theirs with options): on Full Autopilot its home decides. */
  offerDecision(planId: string, home: string, task: string, question: ClaudeQuestion): Promise<ClaudeAnswer | undefined> {
    if (question.kind !== 'question') return Promise.resolve(undefined);
    const place: AnswerPlace = { planId, home, autonomy: 'full', task };
    const qid = this.deps.id();
    return new Promise((resolve) => {
      const cancel = this.deps.timer(() => this.close(qid, undefined), WAIT_MS);
      this.open.set(qid, { place, channel: `decide:${planId}:${task}`, text: questionText(question), resolve, cancel });
      this.deps.askHome(homePrompt(qid, place, question), home);
    });
  }
```

- [ ] **Step 4: 跑测试**

Run: `npx vitest run tests/plan-decisions.test.ts tests/plan-auto-answer.test.ts && npm run typecheck`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add -A && git commit -m "Plans: on Full Autopilot the home decides a task's choice for you, unless it's marked yours"
```

### Task 6: Mac 上的第四张卡片和"替你做的决定"

**Files:**
- Modify: `packages/mac/src/plans/PlanSheets.tsx:22`（图标）、`packages/mac/src/plans/plans-model.ts:351`（切换时的提示）
- Create: `packages/mac/src/plans/DecidedForYou.tsx`、`packages/mac/src/plans/decided-for-you.module.css`
- Modify: `packages/mac/src/plans/PlanDetails.tsx`（放这一栏）
- Modify: `packages/mac/src/i18n/zh-CN.json`
- Test: `packages/mac/e2e/full-autopilot.spec.ts`

- [ ] **Step 1: 卡片**

`AutonomyCards` 和 New Plan 都是遍历 `AUTONOMIES`，Task 1 之后第四张卡片已经出现。检查四张并排不挤：四张时改成
两行两列（`AutonomyCards` 的容器加 `grid-template-columns: repeat(2, 1fr)`），三张时的样子不能变，所以用
`data-count={AUTONOMIES.length}` 选择。`plans-model.ts:351` 的 `if (to === 'autopilot')` 改成 `if (runsItself(to))`，
并在 `to === 'full'` 时返回的说明后面加一句：`Its agent answers questions for you; you can read and change each one on this page.`

- [ ] **Step 2: "替你做的决定"**

`DecidedForYou.tsx`：

```tsx
import type { AutoAnswer } from '@beluga/core/plans/model.js';
import { t } from '../i18n/index.js';
import { openChat } from '../lib/navigate.js';
import styles from './decided-for-you.module.css';

/** What a Full Autopilot plan's agent answered for you, newest first, folded. Nothing answered: nothing shown. */
export function DecidedForYou({ answers }: { readonly answers: readonly AutoAnswer[] | undefined }) {
  if (!answers?.length) return null;
  return (
    <details className={styles.box}>
      <summary>{t('Decided for You')} · {answers.length}</summary>
      <ul>
        {[...answers].reverse().map((a) => (
          <li key={a.id}>
            <div className={styles.q}>{a.question}</div>
            <div className={styles.a}>{a.answer}</div>
            <div className={styles.why}>{a.why}</div>
            {a.channel.startsWith('ws:') && (
              <button type="button" className={styles.change} onClick={() => openChat(a.channel, { draft: t('About “{q}”: ', { q: a.question }) })}>
                {t('Change…')}
              </button>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}
```

`openChat` 和 `t` 用 Mac 包里现有的导航和 i18n 函数（`grep -rn "export function t\b\|export const t\b" packages/mac/src/i18n` 和
`grep -rn "draft:" packages/mac/src/lib | head` 找到能打开对话并预填输入框的那个）。没有新的 API 方法："改…"只是
打开那个任务的对话，你自己把话说给它。样式照 `milestone-roles.module.css` 的折叠块写，不加新的颜色。

`PlanDetails.tsx` 里计划级内容的末尾放 `<DecidedForYou answers={plan.autoAnswers} />`。

- [ ] **Step 3: 中文**

`zh-CN.json` 加：`"Full Autopilot": "全自动驾驶"`、`"Runs to the end and answers its own questions": "一路跑到底，问题由你的 agent 代答"`、
Task 1 里的 `hint` 全句、`"Decided for You": "替你做的决定"`、`"Change…": "改…"`、`"About “{q}”: ": "关于“{q}”："`、
Step 1 那句说明。然后 `npx vitest run tests/plan-roles-i18n.test.ts tests/i18n*`，它会指出漏掉的词条。

- [ ] **Step 4: Playwright**

`packages/mac/e2e/full-autopilot.spec.ts`，照 `plan-settings.spec.ts` 的开头（同一个演示数据的启动方式）：

```ts
test('New Plan offers Full Autopilot, and a plan shows what was decided for you', async ({ page }) => {
  await openNewPlan(page);
  await expect(page.getByRole('radio', { name: /Full Autopilot/ })).toBeVisible();
  await page.screenshot({ path: 'e2e/shots/full-autopilot-new-plan.png' });
  await openPlanWithAnswers(page);
  await page.getByText(/Decided for You/).click();
  await expect(page.getByText('Which database?')).toBeVisible();
  await page.screenshot({ path: 'e2e/shots/full-autopilot-decided.png' });
});
```

`openNewPlan`、`openPlanWithAnswers` 写在同一个文件里：前者照 `plan-roles.spec.ts` 打开 New Plan 的那几行；后者用该
spec 里往演示计划写状态的同一个办法，给计划放一条 `autoAnswers`（question `Which database?`）。

Run: `cd packages/mac && npx playwright test e2e/full-autopilot.spec.ts`
Expected: PASS，两张截图生成。暗色再跑一遍（`colorScheme: 'dark'`），留作 PR 用图。

- [ ] **Step 5: 提交**

```bash
git add -A && git commit -m "Mac: Full Autopilot in How it runs, and Decided for You on a plan's page"
```

### Task 7: 手机

**Files:**
- Modify: `src/companion/protocol.ts:171`（`SINCE`）、`src/companion/views.ts`（计划视图）
- Modify: `packages/companion/app/plan/[id].tsx:27-31,174`、`packages/companion/lib/link/calls.ts:71`
- Create: `packages/companion/components/DecidedForYou.tsx`
- Modify: `docs/companion.md`
- Test: `tests/companion-full-autopilot.test.ts`

- [ ] **Step 1: 先确认老手机收到 `full` 会怎样**

`src/companion/protocol.ts:804` 的 `PlanAutonomy` 已经接受任意短字符串，协议层不会失败。问题在已发布的手机 App：
`packages/companion/app/plan/[id].tsx:174` 附近用 `AUTONOMY[a]` 取标签，未知的 key 取不到。看 `git show v1.7.0:packages/companion/app/plan/[id].tsx | grep -n "AUTONOMY\["`
（用最近一个手机发布的 tag）：

- 如果老代码对未知值有兜底（`?? …`）：直接发 `full`。
- 如果没有（会崩或显示空白）：`views.ts` 需要知道对端版本。`grep -n "proto\|minor" src/companion/link*.ts src/companion/session*.ts | head`
  找到握手时记下的手机协议版本；计划视图对低于 `SINCE.fullAutopilot` 的手机把 `full` 写成 `autopilot`，另带
  `full: true`。

两种情况都要做下面的测试，第二种多一条"老手机"的断言。

- [ ] **Step 2: 写失败的测试**

```ts
import { describe, expect, it } from 'vitest';
import { SINCE } from '../src/companion/protocol.js';
import { planPageView } from '../src/companion/views.js';

describe('Full Autopilot on the phone', () => {
  it('has its own version gate', () => {
    expect(SINCE.fullAutopilot).toBeGreaterThan(SINCE.rolesSeen);
  });

  it('a plan’s page says full and lists what was decided, code stripped', () => {
    const view = planPageView(stateWith({ autonomy: 'full', autoAnswers: [{ id: 'a', at: 1, channel: 'ws:w1', question: 'Which db?', answer: 'Use `pg`\n```sql\nselect 1\n```', why: 'plan' }] }), 'p1');
    expect(view.autonomy).toBe('full');
    expect(view.decided).toEqual([{ id: 'a', at: 1, question: 'Which db?', answer: expect.not.stringContaining('select 1'), why: 'plan' }]);
  });
});
```

`planPageView` 和 `stateWith` 用 `tests/fork-companion-roles.test.ts` 里建计划视图的同一个函数和同一个夹具写法。

- [ ] **Step 3: 实现**

`SINCE` 末尾加 `fullAutopilot: 64`（比现在最大的 `rolesSeen: 63` 大 1；合并时若被占用就顺延），并把
`COMPANION_PROTO.minor` 提到同一个数。`protocol.ts` 的计划页视图 schema 加可选的：

```ts
  /** What its agent answered for you on Full Autopilot, oldest first (SINCE.fullAutopilot). Code stripped. */
  decided: z.array(z.object({ id: z.string().max(40), at: z.number(), question: z.string().max(1000), answer: z.string().max(4000), why: z.string().max(600) })).max(200).optional(),
```

`views.ts` 里填它，`answer` 和 `question` 过 `stripCode`（这个文件里别的 Claude 文本用的同一个函数）。

手机：`AUTONOMY` 表加

```tsx
  full: { label: 'Full Autopilot', sub: 'Runs to the end and answers its own questions', Icon: Sparkles },
```

取标签处统一改成 `AUTONOMY[a] ?? AUTONOMY.autopilot`；这一行只在 `supports('fullAutopilot')` 时列出（这个文件里别的
`SINCE` 判断用的同一个函数）。`calls.ts:71` 的类型加 `'full'`。`DecidedForYou.tsx` 照
`packages/companion/components/MilestoneRoles.tsx` 的折叠卡片写，只读，没有按钮（手机不改答案：那要打字给任务的
对话，从任务页去）。颜色只用 `lib/theme.ts` 里的。

`docs/companion.md` 的版本表加一行 1.64：`full` 自主程度、计划页的 `decided`。

代答不产生 `NeedsYou`，这不用写代码（卡片根本没出现），但加一条断言：在 `tests/plan-auto-answer-tools.test.ts` 的
端到端测试末尾 `expect(needsYou(store.getState())).toEqual([])`，`needsYou` 用 `tests/companion-*` 里取 NeedsYou 列表
的同一个函数。

- [ ] **Step 4: 跑测试**

Run: `npx vitest run tests/companion-* && npm run typecheck && (cd packages/companion && npm install && npm run typecheck)`
Expected: PASS。

- [ ] **Step 5: 在模拟器上看一眼并截图**

用 `ios-build-verify`（或 `packages/companion` 的 `npx expo run:ios`）打开一个 `full` 的演示计划，截两张：自主程度
的选择表、计划页的"Decided for You"。存到 PR 用图的目录。

- [ ] **Step 6: 提交**

```bash
git add -A && git commit -m "Phone: Full Autopilot in how a plan runs, and what was decided for you (protocol 1.64)"
```

### Task 8: 文档、全量测试、PR

**Files:**
- Modify: `docs/tasks-and-plans.md`、`docs/tasks-and-plans.fork.md`、`docs/parity.md`、`docs/studio-gates.md`

- [ ] **Step 1: 文档**

- `docs/tasks-and-plans.md` 讲自主程度的那一节加第四档：三句话，说清它在 Autopilot 之上多了什么、仍然等你的六种
  情况（§8.3 的列表）、在哪里看和改代答。
- `docs/parity.md`：`plan_answer`、`plan_defer` 两行（Mac 上显示在"Decided for You"）；自主程度那一行加 Full Autopilot。
  跑 `npx vitest run tests/parity.test.ts`，它会指出缺的行。
- `docs/studio-gates.md` §3.6：共享的计划拒绝 `autopilot` 的那句改成"拒绝 `autopilot` 和 `full`"。

- [ ] **Step 2: 全量**

Run: `npm run typecheck && LC_ALL=C npx vitest run && (cd packages/companion && npm run typecheck)`
Expected: 全部通过，结尾有 `Tested-on: macOS <tree>`。

- [ ] **Step 3: 提交**

```bash
git add -A && git commit -m "Docs: Full Autopilot" -m "Tested-on: macOS <上一步输出的那一行原样>" -m "Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>"
```

- [ ] **Step 4: 录一段 GIF**

Mac 上：新建计划 → 选 Full Autopilot → 任务的 agent 提问 → 主对话代答 → 计划页"Decided for You"出现一条。
用演示工作区（`createDemoWorkspaces`）和脚本化的 agent，录屏转 GIF，控制在 20 秒内。

- [ ] **Step 5: PR**

本分叉：`gh pr create --repo dayuer/beluga --base main --head fork/full-autopilot`。说明里放 Task 6、7 的截图
（亮、暗）、GIF、"仍然等你的"列表、没跑的东西（如实写）。合并和推送按 CLAUDE.md：主人说了才做。上游的 PR 只在
主人在当次会话里要求时才开。

---

# 第二期：模型编队

开工前：第一期已合进 `main`。`git worktree add ../beluga-model-team -b fork/model-team main`。

### Task 9: 能力表和搭配

**Files:**
- Create: `src/shared/model-tiers.ts`
- Test: `tests/model-tiers.test.ts`

- [ ] **Step 1: 写失败的测试**

```ts
import { describe, expect, it } from 'vitest';
import type { RuntimeChoice } from '../src/shared/agent-runtimes.js';
import { Team, agentFor, lineup, lineupWords, tierOf } from '../src/shared/model-tiers.js';

const CLAUDE = ['fable', 'opus', 'sonnet', 'haiku'];
const rt = (local: string[] = [], claude = true): RuntimeChoice[] =>
  [
    { id: 'claude', label: 'Claude', available: claude },
    { id: 'local', label: 'Local model', available: local.length > 0, models: local.map((v) => ({ value: v, label: v })) },
  ] as unknown as RuntimeChoice[];
const names = (l: ReturnType<typeof lineup>) => (l ? { plan: l.plan[0]?.model, build: l.build[0]?.model, review: l.review[0]?.model } : undefined);

describe('a model’s tier, from its name', () => {
  it.each([
    ['fable', 'strong'],
    ['claude-opus-5-5', 'strong'],
    ['sonnet', 'mid'],
    ['bigmodel/glm-5.3[1m]', 'mid'],
    ['zhipu/glm-5.3', 'mid'],
    ['moonshot/kimi-k3', 'mid'],
    ['haiku', 'fast'],
    ['deepseek/deepseek-flash[1m]', 'fast'],
    ['openai/gpt-5-mini', 'fast'],
    ['google/gemini-3-pro', 'mid'],
    ['ollama/qwerty-7b', undefined],
  ])('%s is %s', (model, tier) => {
    expect(tierOf(model, undefined)).toBe(tier);
  });

  it('yours wins over the table', () => {
    expect(tierOf('ollama/qwerty-7b', { tiers: { 'ollama/qwerty-7b': 'fast' } })).toBe('fast');
    expect(tierOf('haiku', { tiers: { haiku: 'mid' } })).toBe('mid');
  });
});

describe('who plans, builds and reviews, from what runs here', () => {
  it('Claude alone: the strongest plans, Haiku builds, Sonnet reviews', () => {
    expect(names(lineup(undefined, rt(), CLAUDE))).toEqual({ plan: 'fable', build: 'haiku', review: 'sonnet' });
  });

  it('without Fable, Opus plans', () => {
    expect(names(lineup(undefined, rt(), ['opus', 'sonnet', 'haiku']))).toEqual({ plan: 'opus', build: 'haiku', review: 'sonnet' });
  });

  it('strong and fast only: the strong one reviews too', () => {
    expect(names(lineup(undefined, rt(), ['opus', 'haiku']))).toEqual({ plan: 'opus', build: 'haiku', review: 'opus' });
  });

  it('strong and mid only: the mid one builds, the strong one reviews', () => {
    expect(names(lineup(undefined, rt(), ['opus', 'sonnet']))).toEqual({ plan: 'opus', build: 'sonnet', review: 'opus' });
  });

  it('mid and fast only: the mid one plans and reviews', () => {
    expect(names(lineup(undefined, rt(), ['sonnet', 'haiku']))).toEqual({ plan: 'sonnet', build: 'haiku', review: 'sonnet' });
  });

  it('one tier only: no team (one model does everything, as before)', () => {
    expect(lineup(undefined, rt(), ['sonnet'])).toBeUndefined();
    expect(lineup(undefined, rt(['bigmodel/glm-5.3', 'moonshot/kimi-k3'], false), [])).toBeUndefined();
  });

  it('your default agent’s runtime comes first in a tier, the others are its fallbacks', () => {
    const l = lineup(undefined, rt(['deepseek/deepseek-flash', 'bigmodel/glm-5.3']), CLAUDE, 'local')!;
    expect(l.build.map((a) => a.model)).toEqual(['deepseek/deepseek-flash', 'haiku']);
    expect(l.review.map((a) => a.model)).toEqual(['bigmodel/glm-5.3', 'sonnet']);
    expect(l.plan.map((a) => a.model)).toEqual(['fable', 'opus']);
  });

  it('a model it doesn’t know only builds, and only when nothing fast is here', () => {
    expect(names(lineup(undefined, rt(['ollama/qwerty-7b']), ['opus', 'sonnet']))).toEqual({ plan: 'opus', build: 'ollama/qwerty-7b', review: 'sonnet' });
    expect(lineup(undefined, rt(['ollama/qwerty-7b']), CLAUDE)!.build.map((a) => a.model)).toEqual(['haiku']);
  });

  it('a greyed model is skipped', () => {
    const runtimes = [{ id: 'claude', label: 'Claude', available: true }, { id: 'local', label: 'Local model', available: true, models: [{ value: 'deepseek/deepseek-flash', label: 'd', why: 'not answering' }] }] as unknown as RuntimeChoice[];
    expect(lineup(undefined, runtimes, CLAUDE, 'local')!.build.map((a) => a.model)).toEqual(['haiku']);
  });

  it('your own list for a role replaces the table’s, skipping what doesn’t run here', () => {
    const team: Team = { build: ['local:moonshot/kimi-k3', 'local:gone/model', 'claude:sonnet'] };
    const l = lineup(team, rt(['moonshot/kimi-k3']), CLAUDE)!;
    expect(l.build.map((a) => a.model)).toEqual(['moonshot/kimi-k3', 'sonnet']);
    expect(l.plan[0]!.model).toBe('fable');
  });

  it('your lists make a team even where the table finds one tier', () => {
    expect(names(lineup({ plan: ['claude:sonnet'], build: ['claude:sonnet'], review: ['claude:sonnet'] }, rt(), ['sonnet']))).toEqual({ plan: 'sonnet', build: 'sonnet', review: 'sonnet' });
  });
});

describe('a plan’s pick for a role', () => {
  const l = lineup(undefined, rt(), CLAUDE)!;
  it('auto is the lineup’s first; a model of your own is that model; no team is none', () => {
    expect(agentFor('build', { plan: 'auto', build: 'auto', review: 'auto' }, l)?.model).toBe('haiku');
    expect(agentFor('review', { review: { runtime: 'claude', label: 'Claude', model: 'opus' } }, l)?.model).toBe('opus');
    expect(agentFor('plan', { build: 'auto' }, l)).toBeUndefined();
    expect(agentFor('build', undefined, l)).toBeUndefined();
    expect(agentFor('build', { build: 'auto' }, undefined)).toBeUndefined();
  });

  it('says the lineup in one line', () => {
    expect(lineupWords(l)).toBe('Fable plans · Haiku builds · Sonnet reviews');
  });
});

describe('the setting', () => {
  it('takes lists of runtime:model and tiers by model', () => {
    expect(Team.safeParse({ byDefault: true, build: ['local:deepseek/deepseek-flash[1m]'], tiers: { 'ollama/x': 'fast' } }).success).toBe(true);
    expect(Team.safeParse({ build: ['not a choice'] }).success).toBe(false);
    expect(Team.safeParse({ tiers: { x: 'huge' } }).success).toBe(false);
  });
});
```

- [ ] **Step 2: 跑一次，确认失败**

Run: `npx vitest run tests/model-tiers.test.ts`
Expected: FAIL，找不到 `model-tiers.js`。

- [ ] **Step 3: 实现**

`src/shared/model-tiers.ts`：

```ts
/**
 * A model team: who plans, who builds and who reviews, worked out from the models that run on this
 * computer now. Each model is put in a tier by its name (strong, mid, fast); the strongest plans
 * (and takes over what's hard), a fast one builds, one between reviews. Fewer tiers here: see
 * `lineup`. One tier, or one model: no team, and everything runs on one model as it always did.
 * Worked out when work starts and never kept on a plan or task, so a teammate's computer never
 * sees an endpoint only yours has. Browser-safe: the daemon, the Mac app and the phone import it.
 */
import { z } from 'zod';
import type { AgentRef } from '../protocol.js';
import type { RuntimeChoice } from './agent-runtimes.js';
import { modelName } from './agent-label.js';

export const TIERS = ['strong', 'mid', 'fast'] as const;
export type Tier = (typeof TIERS)[number];
export const ROLES = ['plan', 'build', 'review'] as const;
export type Role = (typeof ROLES)[number];

/** A candidate, as the agent pickers value one: `runtime:model`. */
const CHOICE = /^[a-z][a-z0-9-]{0,19}:\S{0,64}$/;
export const MAX_CANDIDATES = 8;

/** Settings › Agent › model team, kept in settings.json. Every field unset: worked out from what runs here. */
export const Team = z.object({
  /** New plans use a team. Unset: off. */
  byDefault: z.boolean().optional(),
  plan: z.array(z.string().regex(CHOICE)).max(MAX_CANDIDATES).optional(),
  build: z.array(z.string().regex(CHOICE)).max(MAX_CANDIDATES).optional(),
  review: z.array(z.string().regex(CHOICE)).max(MAX_CANDIDATES).optional(),
  /** A model's tier as you set it, by its value (a local one: "<endpoint id>/<model>"). */
  tiers: z.record(z.string().max(64), z.enum(TIERS)).optional(),
});
export type Team = z.infer<typeof Team>;

/**
 * Families by name, the first that matches. The fast ones come before the families they belong
 * to ("gpt-5-mini" is fast, "gpt-5" mid). A name none matches has no tier: see `lineup`.
 */
const FAMILIES: ReadonlyArray<readonly [RegExp, Tier]> = [
  [/fable/i, 'strong'],
  [/opus/i, 'strong'],
  [/gpt-[5-9][\w.]*-pro|\bo[3-9]-pro/i, 'strong'],
  [/haiku/i, 'fast'],
  // "mini" on its own, not the one inside "gemini".
  [/flash|(?<![a-z])mini|nano|(?<![a-z])lite|turbo/i, 'fast'],
  [/sonnet/i, 'mid'],
  [/gpt-[5-9]|glm|kimi|deepseek|qwen|gemini|grok|mistral/i, 'mid'],
];

const familyOf = (model: string): number => FAMILIES.findIndex(([re]) => re.test(model));

/** A model's tier: yours, else by its name; undefined when the name says nothing. */
export function tierOf(model: string, team: Pick<Team, 'tiers'> | undefined): Tier | undefined {
  const mine = team?.tiers?.[model];
  if (mine) return mine;
  const at = familyOf(model);
  return at < 0 ? undefined : FAMILIES[at]![1];
}

/** Whether a runtime's model runs here now, as the pickers say (a greyed one doesn't). */
export function runsHere(runtimes: readonly RuntimeChoice[], runtime: string, model: string): boolean {
  const r = runtimes.find((x) => x.id === runtime);
  if (!r?.available) return false;
  if (!model || runtime === 'claude' || !r.models) return true;
  const m = r.models.find((x) => x.value === model);
  return Boolean(m && !m.why);
}

const refOf = (runtimes: readonly RuntimeChoice[], runtime: string, model: string): AgentRef => ({ runtime, label: runtimes.find((r) => r.id === runtime)?.label ?? runtime, ...(model ? { model } : {}) });

/** Every model that runs here now. Claude's are its own list (`claudeModels`: the pickers' `state.models` values). */
function runnable(runtimes: readonly RuntimeChoice[], claudeModels: readonly string[]): AgentRef[] {
  const out: AgentRef[] = [];
  for (const r of runtimes) {
    if (!r.available) continue;
    const models = r.id === 'claude' ? claudeModels.filter(Boolean) : (r.models ?? []).filter((m) => m.value && !m.why).map((m) => m.value);
    for (const model of models) out.push(refOf(runtimes, r.id, model));
  }
  return out;
}

/** Each role's candidates, in order: the first works it, the rest stand in when it can't. */
export type Lineup = Readonly<Record<Role, readonly AgentRef[]>>;

function mine(list: readonly string[], runtimes: readonly RuntimeChoice[]): AgentRef[] {
  const out: AgentRef[] = [];
  for (const value of list) {
    const at = value.indexOf(':');
    if (at <= 0) continue;
    const runtime = value.slice(0, at);
    const model = value.slice(at + 1);
    if (runsHere(runtimes, runtime, model)) out.push(refOf(runtimes, runtime, model));
  }
  return out;
}

/**
 * Who plans, builds and reviews here. By tier: strong plans, fast builds, mid reviews. A tier
 * missing: with no mid the planner reviews; with no fast the mid builds (and the planner
 * reviews); with no strong the mid plans. Within a tier your default agent's runtime comes first,
 * then the table's order. A model with no tier only builds, and only when nothing fast is here.
 * A list of your own replaces a role's. Undefined: fewer than two tiers and no lists of yours.
 */
export function lineup(team: Team | undefined, runtimes: readonly RuntimeChoice[], claudeModels: readonly string[], defaultRuntime = 'claude'): Lineup | undefined {
  const all = runnable(runtimes, claudeModels);
  const order = (a: AgentRef, b: AgentRef): number => Number(b.runtime === defaultRuntime) - Number(a.runtime === defaultRuntime) || familyOf(a.model ?? '') - familyOf(b.model ?? '');
  const of = (tier: Tier): AgentRef[] => all.filter((a) => tierOf(a.model ?? '', team) === tier).sort(order);
  const strong = of('strong');
  const mid = of('mid');
  const fast = of('fast');
  const unknown = all.filter((a) => tierOf(a.model ?? '', team) === undefined);
  const tiers = [strong, mid, fast].filter((t) => t.length).length;
  const table: Lineup | undefined =
    tiers >= 2 || (tiers === 1 && unknown.length && !fast.length)
      ? {
          plan: strong.length ? strong : mid,
          build: fast.length ? fast : unknown.length ? unknown : mid.length && strong.length ? mid : fast,
          review: mid.length && (fast.length || unknown.length) ? mid : strong.length ? strong : mid,
        }
      : undefined;
  const own = { plan: team?.plan ? mine(team.plan, runtimes) : undefined, build: team?.build ? mine(team.build, runtimes) : undefined, review: team?.review ? mine(team.review, runtimes) : undefined };
  const pick = (role: Role): readonly AgentRef[] => (own[role]?.length ? own[role]! : (table?.[role] ?? []));
  const out: Lineup = { plan: pick('plan'), build: pick('build'), review: pick('review') };
  return ROLES.every((r) => out[r].length) ? out : undefined;
}

/** A plan's pick for a role: a model of its own, or 'auto' (the lineup's). */
export type RoleChoice = 'auto' | AgentRef;
export type PlanTeam = Readonly<Partial<Record<Role, RoleChoice>>>;
export const AUTO_TEAM: PlanTeam = { plan: 'auto', build: 'auto', review: 'auto' };

/** Who a plan's role goes to now. Undefined: the plan has no pick for it (its one agent, as before), or auto finds no team here. */
export function agentFor(role: Role, team: PlanTeam | undefined, here: Lineup | undefined): AgentRef | undefined {
  const pick = team?.[role];
  if (!pick) return undefined;
  return pick === 'auto' ? here?.[role][0] : pick;
}

const short = (a: AgentRef | undefined): string => (a?.model ? modelName(a.model).replace(/\[1m\]/gi, '').replace(/\s[\d.]+$/, '').trim() : (a?.label ?? '—'));

/** "Opus plans · Haiku builds · Sonnet reviews": the one line a picker and a plan's page show. */
export const lineupWords = (l: Lineup): string => `${short(l.plan[0])} plans · ${short(l.build[0])} builds · ${short(l.review[0])} reviews`;
```

- [ ] **Step 4: 跑测试，按失败调表**

Run: `npx vitest run tests/model-tiers.test.ts`
Expected: PASS。两处最可能要调：`lineupWords` 依赖 `modelName('fable')` 的输出（先 `grep -n "export function modelName" -A20 src/shared/agent-label.ts`
看它对别名返回什么，再定 `short` 里要不要去版本号）；"a model it doesn't know only builds"那条里只有强、中两档加一个
未知模型的分支。以测试为准改实现，不改测试里的期望。

- [ ] **Step 5: 浏览器安全**

Run: `npx vitest run tests/browser-safe.test.ts tests/boundaries.test.ts`
Expected: PASS（新文件只依赖 zod 和 `shared/` 里的文件）。

- [ ] **Step 6: 提交**

```bash
git add -A && git commit -m "Model team: tiers by model name, and who plans, builds and reviews from what runs here"
```

### Task 10: 设置 `team`，旧的 `autoRoute` 读取时换算

**Files:**
- Modify: `src/shared/settings-schema.ts:137`
- Create: `src/shared/team-migrate.ts`
- Modify: `src/core/store.ts`、`src/machines/sync.ts`、`src/ipc/api.ts`（凡是写着 `autoRoute` 的地方）
- Test: `tests/team-migrate.test.ts`

- [ ] **Step 1: 写失败的测试**

```ts
import { describe, expect, it } from 'vitest';
import { teamFromAutoRoute } from '../src/shared/team-migrate.js';

describe('auto route’s settings become the team’s', () => {
  it('on → byDefault; hard, build, review → plan, build, review; the rest is dropped', () => {
    expect(teamFromAutoRoute({ on: true, hard: ['claude:opus'], build: ['local:deepseek/deepseek-flash'], review: ['claude:sonnet'], ladder: ['claude:haiku'], hardLabel: 'tough', urgentIsHard: false, hardEstimate: 3 })).toEqual({
      byDefault: true,
      plan: ['claude:opus'],
      build: ['local:deepseek/deepseek-flash'],
      review: ['claude:sonnet'],
    });
  });

  it('nothing set is nothing set', () => {
    expect(teamFromAutoRoute(undefined)).toBeUndefined();
    expect(teamFromAutoRoute({})).toBeUndefined();
  });

  it('a team already there wins', () => {
    expect(teamFromAutoRoute({ on: true }, { byDefault: false })).toEqual({ byDefault: false });
  });
});
```

- [ ] **Step 2: 跑一次，确认失败**

Run: `npx vitest run tests/team-migrate.test.ts`
Expected: FAIL，找不到模块。

- [ ] **Step 3: 实现**

`src/shared/team-migrate.ts`：

```ts
import type { Team } from './model-tiers.js';

/** What settings.json's `autoRoute` held before the model team replaced it (fork, builds up to 24). */
export interface OldAutoRoute {
  readonly on?: boolean;
  readonly hard?: readonly string[];
  readonly build?: readonly string[];
  readonly review?: readonly string[];
  readonly ladder?: readonly string[];
  readonly hardLabel?: string;
  readonly urgentIsHard?: boolean;
  readonly hardEstimate?: number;
}

/** The team an old `autoRoute` says, unless there's a team already. Its ladder and its hard-task rules have no place any more. */
export function teamFromAutoRoute(old: OldAutoRoute | undefined, team?: Team): Team | undefined {
  if (team) return team;
  if (!old) return undefined;
  const out: Team = {
    ...(old.on !== undefined ? { byDefault: old.on } : {}),
    ...(old.hard ? { plan: [...old.hard] } : {}),
    ...(old.build ? { build: [...old.build] } : {}),
    ...(old.review ? { review: [...old.review] } : {}),
  };
  return Object.keys(out).length ? out : undefined;
}
```

`settings-schema.ts:137`：`autoRoute` 留着只为读旧文件，改成宽松的 `z.record(z.string(), z.unknown()).optional()`，并加
`team: Team.optional()`。读设置的地方（`src/core/store.ts` 里把 settings.json 变成 `prefs` 的那个函数）最后做一次：

```ts
  const team = teamFromAutoRoute(raw.autoRoute as OldAutoRoute | undefined, raw.team);
  // …prefs 里放 team，不再放 autoRoute；下次保存时文件里就没有 autoRoute 了。
```

`src/machines/sync.ts` 里同步 `autoRoute` 的那一行改成同步 `team`；`src/ipc/api.ts` 的 `session.setPrefs` 类型里
`autoRoute` 改成 `team`。

- [ ] **Step 4: 跑测试**

Run: `npx vitest run tests/team-migrate.test.ts && npm run typecheck`
Expected: 测试 PASS；类型检查在每个还读 `prefs.autoRoute` 的文件报错（`src/fork/plans/*.ts`、`src/core/plans/work.ts`、
`src/core/board/work.ts`、`src/companion/views.ts`、Mac 的几个文件）。这些留给 Task 12–15 逐个改，这一步先不提交。

### Task 11: 计划的 `team` 和 `plans.setTeam`

**Files:**
- Modify: `src/core/plans/model.ts:352-363`、`src/core/plans/plans.ts:157,300-333`
- Modify: `src/ipc/plans-api.ts`、`src/ipc/plans-handlers.ts`、`src/core/plans/work.ts`
- Modify: `src/companion/coverage.ts`、`src/fork/coverage.ts`、`src/external/coverage.ts`、`src/machines/coverage.ts`、`src/external/domain/tools.ts`
- Test: `tests/plan-team.test.ts`（新），删 `tests/plan-check-agent.test.ts`、`plan-arch-agent.test.ts`、`plan-fix-agent.test.ts` 里只测三个 setter 的用例

- [ ] **Step 1: 写失败的测试**

```ts
import { describe, expect, it } from 'vitest';
import { teamOfOldPlan } from '../src/core/plans/model.js';

const opus = { runtime: 'claude', label: 'Claude', model: 'opus' };
const sonnet = { runtime: 'claude', label: 'Claude', model: 'sonnet' };
const haiku = { runtime: 'claude', label: 'Claude', model: 'haiku' };

describe('a plan’s old roles become its team', () => {
  it('architecture → plan, checks → review, its agent → build; the fix agent is dropped', () => {
    expect(teamOfOldPlan({ agent: haiku, archAgent: opus, checkAgent: sonnet, fixAgent: opus })).toEqual({ plan: opus, build: haiku, review: sonnet });
  });

  it('a plan with only an agent keeps it and has no team', () => {
    expect(teamOfOldPlan({ agent: haiku })).toBeUndefined();
    expect(teamOfOldPlan({})).toBeUndefined();
  });

  it('roles without an agent leave building to auto', () => {
    expect(teamOfOldPlan({ checkAgent: sonnet })).toEqual({ build: 'auto', review: sonnet });
  });
});
```

再加三条走 `PlansWork` 的（`setup()` 照 `tests/plan-check-agent.test.ts` 现有的）：

```ts
  it('setTeam sets it, null clears it, and it’s said in the plan’s feed', () => {
    const { work, plans } = setup();
    const plan = work.create({ projectId: 'api', goal: 'x' });
    work.setTeam(plan.id, { plan: 'auto', build: 'auto', review: 'auto' });
    expect(plans.need(plan.id).team).toEqual({ plan: 'auto', build: 'auto', review: 'auto' });
    expect(plans.need(plan.id).activity.at(-1)!.text).toMatch(/team/i);
    work.setTeam(plan.id, null);
    expect(plans.need(plan.id).team).toBeUndefined();
  });

  it('create takes a team', () => {
    const { work, plans } = setup();
    expect(plans.need(work.create({ projectId: 'api', goal: 'x', team: { build: 'auto' } }).id).team).toEqual({ build: 'auto' });
  });

  it('a plan saved with the old roles is read with a team', () => {
    const { plans } = setup();
    const p = plans.adopt({ ...plans.need(plans.create({ projectId: 'api', home: 'ws:h' }, { kind: 'me' } as never).id), checkAgent: sonnet } as never);
    expect(p.team).toEqual({ build: 'auto', review: sonnet });
    expect('checkAgent' in p).toBe(false);
  });
```

`activity` 是 `Plan` 上放 `PlanEvent[]` 的字段名，按 `model.ts` 实际的写。

- [ ] **Step 2: 跑一次，确认失败**

Run: `npx vitest run tests/plan-team.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现**

`model.ts`：删掉 `checkAgent`、`archAgent`、`fixAgent` 三个字段，加：

```ts
  /** Who plans, builds and reviews it, each a model of its own or 'auto' (shared/model-tiers.ts). Set: `agent` is not used. None: `agent` does it all, as before. */
  readonly team?: PlanTeam;
```

```ts
/** A plan saved before teams (the fork's four roles): what its roles say as a team. Undefined: it had none. */
export function teamOfOldPlan(old: { readonly agent?: AgentRef; readonly archAgent?: AgentRef; readonly checkAgent?: AgentRef; readonly fixAgent?: AgentRef }): PlanTeam | undefined {
  if (!old.archAgent && !old.checkAgent && !old.fixAgent) return undefined;
  return { ...(old.archAgent ? { plan: old.archAgent } : {}), build: old.agent ?? 'auto', ...(old.checkAgent ? { review: old.checkAgent } : {}) };
}
```

`checkerAgentOf`、`homeAgentOf`（`model.ts:571,574`）删掉，调用处在 Task 12 换成 `agentFor`。

`plans.ts`：`setCheckAgent`、`setArchAgent`、`setFixAgent` 三个方法删掉，加：

```ts
  setTeam(id: string, team: PlanTeam | undefined, by: Actor): Plan {
    const plan = this.need(id);
    const { team: _old, ...rest } = plan;
    const next = this.put(team ? { ...rest, team } : rest);
    return this.note(next.id, 'agent', team ? 'Its work goes to a team: one model plans, one builds, one reviews' : 'Its work goes to one agent again', by);
  }
```

`'agent'` 用 `setWorkAgent` 记事件时用的同一个 `PlanEventKind`。`create` 的参数里 `PlanRoles` 换成 `{ readonly team?: PlanTeam }`。
读存档的地方（`adopt` 和从磁盘加载计划的函数）对每个计划做：

```ts
    const team = plan.team ?? teamOfOldPlan(plan as never);
    const { checkAgent: _c, archAgent: _a, fixAgent: _f, ...clean } = plan as Plan & { checkAgent?: unknown; archAgent?: unknown; fixAgent?: unknown };
    return team ? { ...clean, team } : clean;
```

`plans-api.ts`：三个 `plans.set*Agent` 换成一个

```ts
  'plans.setTeam': { args: z.tuple([z.string(), PlanTeamSchema.nullable()]), result: PlanSchema },
```

`PlanTeamSchema` 写在 `src/shared/model-tiers.ts` 里（`z.object({ plan, build, review })`，每个是
`z.union([z.literal('auto'), AgentRef]).optional()`），按这个文件里别的方法的声明格式写。`plans-handlers.ts` 对应一个
handler，调 `work.setTeam(id, team ?? undefined)`。四个 coverage 文件里三行换成一行 `'plans.setTeam': 'phone'`
（external 和 machines 的表按它们各自的取值）。`src/external/domain/tools.ts` 的 `plan_set_check_agent`、
`plan_set_arch_agent`、`plan_set_fix_agent` 换成一个 `plan_set_team`。

- [ ] **Step 4: 跑测试**

Run: `npx vitest run tests/plan-team.test.ts`
Expected: PASS。类型检查仍有 Task 10 留下的错，继续。

### Task 12: 每个角色开工时用谁

**Files:**
- Modify: `src/fork/plans/roles.ts`（`workAgentFor`、`RoleKey`、`milestoneRoles`）
- Modify: `src/core/plans/pilot.ts`、`src/core/plans/work.ts`、`src/core/plans/draft-review.ts`（取 checker、architect、work agent 的地方）
- Modify: `src/core/board/work.ts`（不在计划里的任务）
- Test: `tests/plan-team-roles.test.ts`，改 `tests/plan-roles.test.ts`、`tests/fork-plan-roles-visible.test.ts`

- [ ] **Step 1: 写失败的测试**

```ts
import { describe, expect, it } from 'vitest';
import type { RuntimeChoice } from '../src/shared/agent-runtimes.js';
import { roleAgent, taskAgent } from '../src/fork/plans/roles.js';

const RUNTIMES = [{ id: 'claude', label: 'Claude', available: true }] as unknown as RuntimeChoice[];
const st = (team?: object) => ({ prefs: { ...(team ? { team } : {}) }, runtimes: RUNTIMES, models: [{ value: 'opus' }, { value: 'sonnet' }, { value: 'haiku' }] }) as never;
const claude = (model: string) => ({ runtime: 'claude', label: 'Claude', model });

describe('who a plan’s role goes to when work starts', () => {
  it('a plan with a team on auto: Opus plans, Haiku builds, Sonnet reviews', () => {
    const plan = { team: { plan: 'auto', build: 'auto', review: 'auto' } } as never;
    expect(roleAgent('plan', plan, st())).toEqual(claude('opus'));
    expect(roleAgent('build', plan, st())).toEqual(claude('haiku'));
    expect(roleAgent('review', plan, st())).toEqual(claude('sonnet'));
  });

  it('a plan with one agent: every role is that agent', () => {
    const plan = { agent: claude('sonnet') } as never;
    expect(roleAgent('plan', plan, st())).toEqual(claude('sonnet'));
    expect(roleAgent('review', plan, st())).toEqual(claude('sonnet'));
  });

  it('a plan with neither: undefined (your default agent, as before), whatever the setting', () => {
    expect(roleAgent('build', {} as never, st({ byDefault: true }))).toBeUndefined();
  });

  it('a task’s own agent, and the one you start it with, beat the team', () => {
    const plan = { team: { build: 'auto' } } as never;
    expect(taskAgent(plan, { agent: claude('opus') }, st())).toEqual(claude('opus'));
    expect(taskAgent(plan, {}, st(), claude('sonnet'))).toEqual(claude('sonnet'));
    expect(taskAgent(plan, {}, st())).toEqual(claude('haiku'));
  });

  it('a task in no plan builds on the team’s builder only when new plans use a team', () => {
    expect(taskAgent(undefined, {}, st({ byDefault: true }))).toEqual(claude('haiku'));
    expect(taskAgent(undefined, {}, st())).toBeUndefined();
  });
});
```

- [ ] **Step 2: 跑一次，确认失败**

Run: `npx vitest run tests/plan-team-roles.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现**

`src/fork/plans/roles.ts`，`workAgentFor` 换成：

```ts
/** What of the app's state a role's pick reads. */
export interface TeamState {
  readonly prefs: { readonly team?: Team; readonly defaultRuntime?: string };
  readonly runtimes: readonly RuntimeChoice[];
  /** Claude Code's own models (the pickers' `state.models`). */
  readonly models: ReadonlyArray<{ readonly value: string }>;
}

/** Who plans, builds and reviews here now (undefined: no team to be had here). */
export const lineupOf = (st: TeamState): Lineup | undefined => lineup(st.prefs.team, st.runtimes, st.models.map((m) => m.value), st.prefs.defaultRuntime);

/** Who a plan's role goes to: its team's pick, else its one agent; undefined: your default agent. */
export function roleAgent(role: Role, plan: Pick<Plan, 'agent' | 'team'>, st: TeamState): AgentRef | undefined {
  return plan.team ? (agentFor(role, plan.team, lineupOf(st)) ?? plan.agent) : plan.agent;
}

/** Who works a task: the agent you start it with, its own, its plan's builder; in no plan, the team's builder when new plans use a team. */
export function taskAgent(plan: Pick<Plan, 'agent' | 'team'> | undefined, task: { readonly agent?: AgentRef }, st: TeamState, pick?: AgentRef): AgentRef | undefined {
  if (pick ?? task.agent) return pick ?? task.agent;
  if (plan) return roleAgent('build', plan, st);
  return st.prefs.team?.byDefault ? lineupOf(st)?.build[0] : undefined;
}
```

`prefs.defaultRuntime` 用 prefs 里实际存默认 agent 的那个字段（`grep -n "defaultAgent\|defaultRuntime" src/shared/settings-schema.ts`），
`TeamState` 里按实际的名字和形状取 runtime id。

调用处，逐个替换：

| 现在 | 换成 |
|---|---|
| `checkerAgentOf(plan)`、`autoChecker(st)`（pilot 的里程碑检查、`draft-review.ts`） | `roleAgent('review', plan, st)` |
| `homeAgentOf(plan)`、`plan.archAgent`（pilot 第 872 行附近的设计步骤、主对话的 agent） | `roleAgent('plan', plan, st)`；设计步骤的条件从"有 `archAgent`"改成"`plan.team?.plan` 有值" |
| `workAgentFor(plan, task, st, pick, fixer)` | `taskAgent(plan, task, st, pick)`（`fixer` 参数在 Task 13 处理） |
| `routedAgent(task, st)`（`src/core/board/work.ts`） | `taskAgent(planOfTask, task, st)`，项目自己的 agent 仍然排在它前面 |
| `autoAutonomy(st)`、`use-default-autonomy.ts` | 删掉：新计划的自主程度不再跟着设置变，默认回到 `DEFAULT_AUTONOMY` |

`RoleKey` 从 `'arch' | 'work' | 'check' | 'fix'` 改成 `Role`（`'plan' | 'build' | 'review'`），`milestoneRoles` 返回三项；
原来 `fix` 那一项里的 handoff 列表并到 `build` 上。

- [ ] **Step 4: 改旧测试**

`tests/plan-roles.test.ts`、`tests/fork-plan-roles-visible.test.ts`、`tests/plan-check-agent.test.ts`、
`tests/plan-arch-agent.test.ts`：把建计划时的 `checkAgent: X` 换成 `team: { review: X }`，`archAgent: X` 换成
`team: { plan: X }`，四项的断言换成三项。断言的行为不变的就不动。

- [ ] **Step 5: 跑测试**

Run: `npx vitest run tests/plan-team-roles.test.ts tests/plan-roles.test.ts tests/fork-plan-roles-visible.test.ts tests/plan-check-agent.test.ts tests/plan-arch-agent.test.ts`
Expected: PASS。

### Task 13: 升级顺序

**Files:**
- Create: `src/fork/plans/escalate.ts`
- Modify: `src/fork/plans/ladder.ts:34`（`ladderAgents`）、`src/fork/plans/fixer.ts`、`src/core/plans/pilot.ts`（`autoFixer` 的调用处）、`src/core/plans/watchdog.ts`
- Test: `tests/plan-escalate.test.ts`，改 `tests/fork-model-ladder.test.ts`、`tests/fork-model-ladder-fixer.test.ts`、`tests/plan-fix-agent.test.ts`

- [ ] **Step 1: 写失败的测试**

```ts
import { describe, expect, it } from 'vitest';
import type { Lineup } from '../src/shared/model-tiers.js';
import { chainOf, fixerFor, standIn } from '../src/fork/plans/escalate.js';

const c = (model: string) => ({ runtime: 'claude', label: 'Claude', model });
const L: Lineup = { plan: [c('opus')], build: [c('haiku'), { runtime: 'local', label: 'Local model', model: 'bigmodel/glm-5.3' }], review: [c('sonnet')] };

describe('where work goes when it can’t go on', () => {
  it('up the chain: builder, reviewer, planner', () => {
    expect(chainOf(L)).toEqual([c('haiku'), c('sonnet'), c('opus')]);
  });

  it('a model in two roles is one step', () => {
    expect(chainOf({ plan: [c('opus')], build: [c('haiku')], review: [c('opus')] })).toEqual([c('haiku'), c('opus')]);
  });

  it('a failed check’s fixes: the builder the first time, the planner from the second', () => {
    expect(fixerFor(L, 1)).toEqual(c('haiku'));
    expect(fixerFor(L, 2)).toEqual(c('opus'));
    expect(fixerFor(L, 3)).toEqual(c('opus'));
  });

  it('a conflict goes straight to the planner', () => {
    expect(fixerFor(L, 'conflict')).toEqual(c('opus'));
  });

  it('a model that can’t run is stood in for by the next of its role, then nobody', () => {
    expect(standIn(L, 'build', c('haiku'))).toEqual({ runtime: 'local', label: 'Local model', model: 'bigmodel/glm-5.3' });
    expect(standIn(L, 'build', { runtime: 'local', label: 'Local model', model: 'bigmodel/glm-5.3' })).toBeUndefined();
    expect(standIn(L, 'review', c('sonnet'))).toBeUndefined();
  });
});
```

- [ ] **Step 2: 跑一次，确认失败**

Run: `npx vitest run tests/plan-escalate.test.ts`
Expected: FAIL，找不到模块。

- [ ] **Step 3: 实现**

`src/fork/plans/escalate.ts`：

```ts
import type { AgentRef } from '../../protocol.js';
import type { Lineup, Role } from '../../shared/model-tiers.js';
import { modelKey } from '../failing-models.js';

/**
 * Where a plan's work goes when it can't go on (a plan with a team; without one nothing moves, as
 * before). Sideways first: a model that can't run (its quota, its key, no such model) is stood in
 * for by the next candidate of the same role. Then up: builder, reviewer, planner, one step each
 * time a task stops twice. A failed check's fix tasks go to the builder the first time and to the
 * planner from the second; a conflict goes straight to the planner. Above the planner: you.
 */

/** Builder, reviewer, planner: each role's first, a model in two roles once. */
export function chainOf(l: Lineup): AgentRef[] {
  const out: AgentRef[] = [];
  for (const a of [l.build[0], l.review[0], l.plan[0]]) if (a && !out.some((x) => modelKey(x) === modelKey(a))) out.push(a);
  return out;
}

/** Who takes a milestone's fix tasks after its `round`-th failed check, or a conflict. */
export function fixerFor(l: Lineup, round: number | 'conflict'): AgentRef | undefined {
  return round === 'conflict' || round >= 2 ? l.plan[0] : l.build[0];
}

/** The next candidate of a role after `current` (undefined: it was the last, or isn't one of them). */
export function standIn(l: Lineup, role: Role, current: AgentRef): AgentRef | undefined {
  const at = l[role].findIndex((a) => modelKey(a) === modelKey(current));
  return at >= 0 ? l[role][at + 1] : undefined;
}
```

接线：

- `ladder.ts` 的 `ladderAgents(route, runtimes)` 改成 `ladderAgents(l: Lineup | undefined): AgentRef[]`，函数体
  `return l ? chainOf(l) : [];`。`nextRung`、`rungKnown`、`modelFailed`、`modelGone` 不动。调用处传 `lineupOf(st)`，
  并且只在 `plan.team` 有值时传（没有编队的计划拿到空梯子，不升级）。
- `pilot.ts` 里 `autoFixer(st)` / `plan.fixAgent` 的地方（第 98 行的依赖和第 976 行附近）：检查没过时用
  `fixerFor(lineupOf(st), round)`，`round` 是这个里程碑已经失败的检查次数（`m.run` 上记检查轮次的字段；
  `newRound`（`plans.ts:369`）每轮加一，就用它）；冲突用 `fixerFor(l, 'conflict')`。
- `fixer.ts` 的 `EscalateHow` 不变。模型"彻底不行"（`modelGone`）时先 `standIn(l, 'build', current)`，有就换它；
  没有再走 `nextRung`。用额度用完时换下一个候选的现成逻辑（分支 `fork/limit-next-model` 的
  `fb2fe2682`，先 `git cherry-pick fb2fe2682` 再把它读 `tierList` 的地方换成 `standIn`）。

- [ ] **Step 4: 改旧测试**

`tests/fork-model-ladder.test.ts`：第一条（默认梯子是 Haiku、Sonnet、Opus、Fable，`AutoRoute` 解析）删掉，换成
"梯子就是 `chainOf` 的结果"；`nextRung` 的几条不动。`tests/fork-model-ladder-fixer.test.ts`、`tests/plan-fix-agent.test.ts`：
建计划时的 `fixAgent: X` 换成 `team: { plan: X, build: 'auto' }`，"第一次检查没过就交给 fix agent"的断言改成
"第一次给执行、第二次给规划"。

- [ ] **Step 5: 跑测试**

Run: `npx vitest run tests/plan-escalate.test.ts tests/fork-model-ladder.test.ts tests/fork-model-ladder-fixer.test.ts tests/plan-fix-agent.test.ts`
Expected: PASS。

### Task 14: 删掉自动路由，收尾类型检查

**Files:**
- Delete: `src/shared/auto-route.ts`、`docs/auto-route.md`、`tests/auto-route.test.ts`、`tests/auto-route-paths.test.ts`、`tests/auto-route-plans.test.ts`、`tests/companion-supports-fix-agent.test.ts`
- Modify: `src/companion/views.ts`（`TaskPageView.autoAgent`）、其余 `grep -rl "auto-route" src packages` 列出的文件

- [ ] **Step 1: 删文件，跟着类型错误改**

```bash
git rm src/shared/auto-route.ts docs/auto-route.md tests/auto-route.test.ts tests/auto-route-paths.test.ts tests/auto-route-plans.test.ts tests/companion-supports-fix-agent.test.ts
npm run typecheck
```

每个报错按下表改：

| 用到的 | 换成 |
|---|---|
| `runsHere`、`firstRunning`、`parseChoice` | `model-tiers.ts` 的 `runsHere`；另两个只在被删的逻辑里用，连同调用一起删 |
| `autoAgentName(ref)` | `lineupWords` 里的 `short`，从 `model-tiers.ts` 导出为 `shortModel` |
| `routedAgent`、`autoAgentFor` | `taskAgent`（Task 12） |
| `planRoleDefaults` | `lineupOf(st)` |
| `Routable`、`autoTierOf`、`HARD_LABEL`、`tierList` | 删：不再按难度分流（§1） |

`src/companion/views.ts` 的 `TaskPageView.autoAgent` 保留字段（协议只增不减），值改成：任务没有自己的 agent 且
`taskAgent(...)` 有结果时填它。`src/core/plans/prompt.ts` 里让写计划的 agent 给难任务打 `hard` 标签、按估点分档的
句子（#546 加的那 83 行里）删掉。

- [ ] **Step 2: 全部类型检查通过**

Run: `npm run typecheck && npx vitest run tests/plan-* tests/fork-* tests/model-tiers.test.ts tests/team-migrate.test.ts tests/browser-safe.test.ts tests/boundaries.test.ts`
Expected: PASS。

- [ ] **Step 3: 提交（Task 10–14 一起）**

```bash
git add -A && git commit -m "Plans: a team of three roles (plan, build, review) replaces the four roles, auto route and its ladder"
```

### Task 15: Mac 界面

**Files:**
- Create: `packages/mac/src/plans/TeamPicker.tsx`、`packages/mac/src/plans/TeamSheet.tsx`、`packages/mac/src/dialogs/TeamSettings.tsx`
- Delete: `packages/mac/src/dialogs/AutoRouteSettings.tsx`、`packages/mac/src/plans/PlanSettingsSheet.tsx`、`packages/mac/src/plans/PlanRoles.tsx`、`packages/mac/src/plans/plan-roles-model.ts`、`packages/mac/src/plans/use-default-autonomy.ts`、`packages/mac/src/tasks/use-auto-agent.ts`、`packages/mac/e2e/plan-settings.spec.ts`
- Modify: `packages/mac/src/fork/plans/NewPlanSheet.tsx`、`packages/mac/src/fork/plans/MilestoneRoles.tsx`、`packages/mac/src/plans/PlanDetails.tsx`、`packages/mac/src/dialogs/Settings.tsx`、`packages/mac/src/dialogs/settings-index.ts`、`packages/mac/src/tasks/parts.tsx`、`packages/mac/src/i18n/zh-CN.json`
- Test: `tests/mac-team-picker.test.ts`、`packages/mac/e2e/plan-team.spec.ts`

- [ ] **Step 1: 选择器的模型（纯函数，先测）**

`tests/mac-team-picker.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { teamPickerItems } from '../packages/mac/src/plans/team-picker-model.js';
import { lineup } from '../src/shared/model-tiers.js';

const RUNTIMES = [{ id: 'claude', label: 'Claude', available: true }] as never;

describe('New Plan’s Agent pop-up with a team to offer', () => {
  it('lists Automatic first with its lineup, then the models, then Customize…', () => {
    const items = teamPickerItems(lineup(undefined, RUNTIMES, ['opus', 'sonnet', 'haiku']), [{ value: 'claude:opus', label: 'Opus' }]);
    expect(items[0]).toEqual({ kind: 'auto', label: 'Automatic', hint: 'Opus plans · Haiku builds · Sonnet reviews' });
    expect(items.at(-1)).toEqual({ kind: 'customize', label: 'Customize…' });
    expect(items.slice(1, -1)).toEqual([{ kind: 'model', value: 'claude:opus', label: 'Opus' }]);
  });

  it('with no team to be had here it’s the pop-up it always was', () => {
    const models = [{ value: 'claude:sonnet', label: 'Sonnet' }];
    expect(teamPickerItems(lineup(undefined, RUNTIMES, ['sonnet']), models)).toEqual([{ kind: 'model', value: 'claude:sonnet', label: 'Sonnet' }]);
  });
});
```

`packages/mac/src/plans/team-picker-model.ts`：

```ts
import { type Lineup, lineupWords } from '@beluga/shared/model-tiers.js';

export type TeamPickerItem =
  | { readonly kind: 'auto'; readonly label: string; readonly hint: string }
  | { readonly kind: 'model'; readonly value: string; readonly label: string }
  | { readonly kind: 'customize'; readonly label: string };

/** New Plan's Agent pop-up: Automatic (when a team can be had here), the models as before, Customize… */
export function teamPickerItems(here: Lineup | undefined, models: ReadonlyArray<{ readonly value: string; readonly label: string }>): TeamPickerItem[] {
  const list: TeamPickerItem[] = models.map((m) => ({ kind: 'model', value: m.value, label: m.label }));
  if (!here) return list;
  return [{ kind: 'auto', label: 'Automatic', hint: lineupWords(here) }, ...list, { kind: 'customize', label: 'Customize…' }];
}
```

导入路径的别名（`@beluga/shared/…`）按 Mac 包里别的文件导入 `src/shared` 的写法。

Run: `npx vitest run tests/mac-team-picker.test.ts`
Expected: 先 FAIL（没有文件），写完 PASS。

- [ ] **Step 2: New Plan**

`NewPlanSheet.tsx`：四个角色下拉框（`PlanRoles`）换回**一个** Agent 下拉框，选项来自 `teamPickerItems`。状态：

```ts
type Pick = { kind: 'agent'; agent?: AgentRef } | { kind: 'team'; team: PlanTeam };
const [pick, setPick] = useState<Pick>(prefs.team?.byDefault && here ? { kind: 'team', team: AUTO_TEAM } : { kind: 'agent' });
```

选"Automatic" → `{ kind: 'team', team: AUTO_TEAM }`；选模型 → `{ kind: 'agent', agent }`；选"Customize…" → 打开
`TeamSheet`，它返回一个 `PlanTeam`。提交时 `plans.create` 带 `pick.kind === 'team' ? { team: pick.team } : { agent: pick.agent }`。
下拉框下面一行小字：选了编队时显示当前搭配（`lineupWords`，自定义过的按自定义的显示）。
`useDefaultAutonomy()` 换回 `DEFAULT_AUTONOMY`。

- [ ] **Step 3: 自定义表**

`TeamSheet.tsx`：三行，标签 Plans、Builds、Reviews，每行一个现有的 agent 下拉框组件（`PlanRoles.tsx` 里用的那个，
先把它用到的下拉框组件留下再删 `PlanRoles.tsx`），第一个选项 "Automatic · <这个角色现在是谁>"。Done 返回 `PlanTeam`。
计划页 ••• 菜单里现有的 "Agent…" 一项打开同一个 Agent 下拉框，保存调 `plans.setTeam` 或原来的 `plans.setWorkAgent`。
`PlanSettingsSheet` 连同它在 ••• 里的入口删掉（How it runs、When to run tests 在 ••• 里本来就各有一项）。

- [ ] **Step 4: 计划页**

- `PlanDetails.tsx`：`plan.team` 有值时标题下一行 `lineupWords(...)`（灰色小字，现有的副标题样式）。没有就什么都不加。
- `MilestoneRoles.tsx`：整个组件在 `!plan.team` 时返回 `null`；四行改三行（Plans、Builds、Reviews），默认折叠。
  Design 一节同样只在 `plan.team?.plan` 有值时出现。
- `tasks/parts.tsx`：任务卡的模型小标只在 `taskAgentSeen(...)` 的模型和 `roleAgent('build', plan, st)` 不同时显示。

- [ ] **Step 5: 设置**

`TeamSettings.tsx` 取代 `AutoRouteSettings.tsx`，放在 Settings › Agent：

- 一行开关 "New plans use a model team"，下面小字是 `lineupWords(here)`；`here` 是 `undefined` 时开关置灰，小字
  "Needs two kinds of model on this Mac (say, Opus and Haiku)"。
- 一个 "Customize…" 按钮，展开三张列表（Plans、Builds、Reviews）。列表行的组件直接用 `AutoRouteSettings.tsx` 里的
  那个（模型下拉、上移、删除、Add、Back to Default），所以先把它挪出来成 `CandidateList.tsx` 再删旧文件。
  "Back to Default" 把那个角色的列表设回 `undefined`。
- 列表下面 "Models Beluga doesn’t know"：每个没有档的可用模型一行，一个下拉框（Builds only / Fast / Mid / Strong），
  写进 `team.tiers`。一个都没有时这一栏不出现。
- `settings-index.ts`：搜索词从 Auto Route 的那几条换成 "model team"、"plans builds reviews"、"fallback models"。

- [ ] **Step 6: 中文和 i18n 测试**

`zh-CN.json`：删掉 Auto Route、四个角色、Plan Settings 的词条（#546 加的 129 行里用不到的），加：Automatic → 自动、
Customize… → 自定义…、Plans/Builds/Reviews → 规划/写代码/审查、"{a} plans · {b} builds · {c} reviews" →
"{a} 规划 · {b} 写代码 · {c} 审查"、设置里的三句。`lineupWords` 的英文是拼出来的，Mac 上显示时用带占位符的词条翻译，
不要直接显示英文串。

Run: `npx vitest run tests/plan-roles-i18n.test.ts tests/mac-settings-search.test.ts`
Expected: PASS（`plan-roles-i18n.test.ts` 里列的英文词条按新的改）。

- [ ] **Step 7: Playwright 和截图**

`packages/mac/e2e/plan-team.spec.ts`（`plan-roles.spec.ts`、`roles-visible.spec.ts` 改写合并成它）：

```ts
test('New Plan: Automatic is first, says who does what, and makes a plan with a team', async ({ page }) => {
  await openNewPlan(page);
  await page.getByLabel('Agent').click();
  await expect(page.getByRole('option').first()).toContainText('Automatic');
  await page.screenshot({ path: 'e2e/shots/team-new-plan-picker.png' });
  await page.getByRole('option', { name: /Automatic/ }).click();
  await expect(page.getByText(/plans · .* builds · .* reviews/)).toBeVisible();
  await page.screenshot({ path: 'e2e/shots/team-new-plan.png' });
});

test('Customize… has three rows and nothing else', async ({ page }) => {
  await openNewPlan(page);
  await page.getByLabel('Agent').click();
  await page.getByRole('option', { name: 'Customize…' }).click();
  await expect(page.getByRole('combobox')).toHaveCount(3);
  await page.screenshot({ path: 'e2e/shots/team-customize.png' });
});

test('a plan with one agent shows no team line and no Who did it', async ({ page }) => {
  await openPlan(page, 'plain');
  await expect(page.getByText(/plans · .* builds/)).toHaveCount(0);
  await expect(page.getByText('Who did it')).toHaveCount(0);
});

test('a plan with a team shows its line, and Who did it folded', async ({ page }) => {
  await openPlan(page, 'team');
  await expect(page.getByText(/plans · .* builds · .* reviews/)).toBeVisible();
  await page.getByText('Who did it').click();
  await page.screenshot({ path: 'e2e/shots/team-who-did-it.png' });
});
```

`openNewPlan`、`openPlan` 用旧 spec 里已有的辅助函数；演示数据里加一个带 `team: AUTO_TEAM` 的计划和一个不带的。
再加一条设置页的截图（开关、展开的三张列表）。亮、暗各跑一遍。

Run: `cd packages/mac && npx tsc --noEmit && npx playwright test e2e/plan-team.spec.ts`
Expected: PASS。

- [ ] **Step 8: 提交**

```bash
git add -A && git commit -m "Mac: Automatic in New Plan's Agent pop-up, Customize… for the three roles, one switch in Settings"
```

### Task 16: 手机和 Studio

**Files:**
- Modify: `src/companion/protocol.ts`、`src/companion/views.ts`、`src/fork/companion/*`、`src/companion/calls.ts`
- Modify: `packages/companion/app/plan/[id].tsx`、`packages/companion/components/MilestoneRoles.tsx`、`packages/companion/components/AgentPicker.tsx`、`packages/companion/lib/link/calls.ts`、`packages/companion/lib/fork/roles-words.ts`
- Modify: `src/studio/`（`plan.create` 的 zod）、`src/studio/view.ts`
- Test: `tests/fork-companion-roles.test.ts`（改）、`tests/companion-team.test.ts`（新）、Studio 现有的 gate 测试加一条

- [ ] **Step 1: 写失败的测试**

`tests/companion-team.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { SINCE } from '../src/companion/protocol.js';
import { planPageView } from '../src/companion/views.js';

describe('a plan’s team on the phone', () => {
  it('has its gate, after Full Autopilot’s', () => {
    expect(SINCE.team).toBeGreaterThan(SINCE.fullAutopilot);
  });

  it('a plan with a team says so, with its one line; its agent stays the builder for an older phone', () => {
    const view = planPageView(stateWith({ team: { plan: 'auto', build: 'auto', review: 'auto' } }), 'p1');
    expect(view.team).toEqual({ plan: 'auto', build: 'auto', review: 'auto' });
    expect(view.teamLine).toBe('Opus plans · Haiku builds · Sonnet reviews');
    expect(view.agent?.model).toBe('haiku');
  });

  it('a plan without one has neither field', () => {
    const view = planPageView(stateWith({}), 'p1');
    expect('team' in view).toBe(false);
    expect('teamLine' in view).toBe(false);
  });
});
```

Studio（加在测 `plan.create` 拒收多余字段的那个测试文件里，`grep -rln "thenApprove" tests | head -3` 找到它）：

```ts
  it('refuses a team from a customer', () => {
    expect(runGate({ kind: 'plan.create', goal: 'x', platforms: ['ios'], team: { build: 'auto' } })).toMatchObject({ error: 'bad-args' });
  });
```

`runGate` 用那个文件里现有的调用方式。Studio 的 zod 已经是 `.strict()`，这条应当直接通过；它是为了以后有人给 schema
加 `team` 时会红。

- [ ] **Step 2: 实现**

- `SINCE` 加 `team: 65`，`COMPANION_PROTO.minor` 同步。计划页视图加可选的 `team`（`PlanTeamSchema`）和
  `teamLine: z.string().max(200).optional()`。`checkAgent`、`archAgent`、`fixAgent` 三个视图字段**保留为可选并不再填**
  （只增不减），`SINCE.checkAgent/archAgent/fixAgent/rolesSeen` 留着不动。
- `src/companion/calls.ts` 和手机的 `calls.ts`：加 `setTeam`，删手机这边的三个旧调用。
- 手机计划页 ••• ：三项 "Agent for its architecture / checks / hard fixes" 换成一项 **Models**（`supports('team')` 才有）。
  点开是一张表：Automatic（下面一行 `teamLine`）、各个模型（原来的 `AgentPicker`）、最下面 "Advanced" 展开三行角色。
  选 Automatic 调 `setTeam(AUTO_TEAM)`，选模型调原来的 `setWorkAgent` 并 `setTeam(null)`。
- `MilestoneRoles.tsx`、`roles-words.ts`：四行改三行，`plan.team` 没有时不渲染。
- 任务页的 "Auto · <model>"（`app/task/[id].tsx`）不动，它读的 `autoAgent` 在 Task 14 已经换了来源。
- `src/studio/view.ts`：确认白名单里没有 `team`、`teamLine`、`decided`、`autoAnswers`（白名单构造，默认就没有；
  加一条测试断言客户视图的 JSON 里不含这四个 key，也不含任何模型名）。

- [ ] **Step 3: 跑测试**

Run: `npx vitest run tests/companion-* tests/fork-companion-roles.test.ts tests/studio-* && (cd packages/companion && npm run typecheck)`
Expected: PASS。

- [ ] **Step 4: 模拟器截图**

计划页 ••• › Models 的表（收起和展开 Advanced 各一张）、带编队的里程碑的 "Who did it"。

- [ ] **Step 5: 提交**

```bash
git add -A && git commit -m "Phone: a plan's Models (Automatic, one model, or each role), protocol 1.65; Studio customers never see or send a team"
```

### Task 17: 文档、全量测试、PR

**Files:**
- Create: `docs/model-team.md`
- Modify: `docs/tasks-and-plans.md`、`docs/tasks-and-plans.fork.md`、`docs/parity.md`、`docs/parity.fork.md`、`docs/companion.md`、`docs/fork.md`

- [ ] **Step 1: 文档**

`docs/model-team.md`（中文，取代 `auto-route.md`），五节，每节几句话：三个角色各做什么；怎么按已有模型搭配（§4.2 的
表原样放进去）；后备与升级（§5 的表）；在哪里设置；从自动路由升级上来的变化（§6.3 的表，加一句"按难度分流取消了"）。
`docs/parity.md`：三行 `plans.set*Agent` 换成 `plans.setTeam`，`plan_set_*_agent` 换成 `plan_set_team`，Auto Route 设置页的
行换成 model team 的。`docs/companion.md` 加 1.65。`docs/fork.md` 里指向 `auto-route.md` 的链接改掉。

Run: `npx vitest run tests/parity.test.ts`
Expected: PASS。

- [ ] **Step 2: 全量**

Run: `npm run typecheck && LC_ALL=C npx vitest run && (cd packages/companion && npm run typecheck) && (cd packages/mac && npx tsc --noEmit)`
Expected: 全部通过，结尾有 `Tested-on: macOS <tree>`。

- [ ] **Step 3: 提交**

```bash
git add -A && git commit -m "Docs: the model team" -m "Tested-on: macOS <上一步输出的那一行原样>" -m "Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>"
```

- [ ] **Step 4: GIF**

Mac：新建计划 → Agent 选 Automatic → 批准 → 里程碑设计（规划）→ 任务开工（执行）→ 检查（审查）→ 检查没过两次后
改由规划修复。演示工作区加脚本化的 agent，30 秒内。

- [ ] **Step 5: 本分叉的 PR**

`gh pr create --repo dayuer/beluga --base main --head fork/model-team`。说明的结构：一句话讲清（"一个新选项：自动"）；
什么都不选时没有任何变化；截图（New Plan 下拉、自定义表、计划页、设置、手机，亮暗各一）；GIF；相对 #546 删了什么；
没跑的东西。

- [ ] **Step 6: 更新上游的 #546（主人说了才做）**

上游没有 `src/fork/`，文件在 `src/core/` 下。做法：在 `upstream-pr/model-tiers` 上重做一个提交，内容是
`upstream/main` 加上这一期的最终状态（不含第一期，那是另一个上游 PR；不含 endpoint 检查，见 Task 18），
`src/fork/plans/*` 放到 `src/core/plans/`，`src/fork/failing-models.ts` 放到 `src/core/`，`docs/model-team.md` 用英文。
PR 标题改成 "Plans: a model team (plan, build, review), picked from the models you have"，转回草稿
（`gh pr ready 546 --repo beluga-labs/beluga --undo`），说明整篇重写，改完由主人决定何时标记可评审。
推送和改上游 PR 都是对外的动作：**没有主人在当次会话里的明确要求不做**。

---

# 第三期：endpoint 检查拆出去

### Task 18: 从 #546 拆成单独的上游 PR

本分叉里它已经在 `main`（`src/fork/endpoint-check.ts`、`src/ipc/endpoint-save.ts`、`tests/endpoint-check.test.ts`），
不用再做什么。只有上游需要一个新分支。

- [ ] **Step 1: 建分支**

```bash
git fetch upstream && git worktree add ../beluga-endpoint-check -b upstream-pr/endpoint-check upstream/main
```

- [ ] **Step 2: 取那几个文件**

从 #546 的提交 `ebb651f6d` 里取：`src/core/endpoint-check.ts`、`src/ipc/endpoint-save.ts`、`tests/endpoint-check.test.ts`，
以及 `src/core/env-vars.ts`、`src/ipc/handlers.ts` 里和保存 endpoint 有关的那几行、Mac 上 Local models 的保存提示、
`zh-CN.json` 里对应的词条：

```bash
git checkout ebb651f6d -- src/core/endpoint-check.ts src/ipc/endpoint-save.ts tests/endpoint-check.test.ts
git diff upstream/main ebb651f6d -- src/core/env-vars.ts src/ipc/handlers.ts packages/mac/src/i18n/zh-CN.json
```

第二条命令的输出里，只把和 endpoint 保存有关的块手工应用过来。

- [ ] **Step 3: 检查**

Run: `npm run typecheck && LC_ALL=C npx vitest run`
Expected: 全部通过。

- [ ] **Step 4: 提交；PR 等主人的话**

```bash
git add -A && git commit -m "Local models: an endpoint is checked before it's saved"
```

PR 说明里放 "Not saved: …" 提示的截图，以及 #546 里"Changes for everyone"的第一条（保存要等检查，最多 20 秒，
每个模型花一个 token）。开上游 PR 之前问主人。

---

## 自查记录

- **设计覆盖**：§3 → Task 11、12；§4 → Task 9；§5 → Task 13；§6.1 → Task 11；§6.2、§6.3 → Task 10、11；
  §7.1–7.3 → Task 15；§7.4 → Task 16；§8.1 → Task 1；§8.2 → Task 2–4；§8.3 → Task 2（次数、重复、主对话自己）、
  Task 5（决定）、Task 1（Studio）；§8.4 → Task 2（记录）、Task 6、7（显示）；§9 → Task 1、16；§11 → 各任务的测试；
  §12 → Task 8、17、18。
- **§8.3 "危险操作的授权"**：没有单独的任务，因为授权走的是 approval，不经过 `QuestionBroker.ask`，代答碰不到它。
  Task 2 的类注释写明了这一点。
- **§4.2 第 3 条"审查尽量不和执行同一个模型"**：按档搭配时两者本来就在不同的档，不需要额外代码；用户自己把两个
  角色设成同一个模型时照他的来。
- **名字一致**：`Team`（设置）、`PlanTeam`（计划）、`Lineup`（当前搭配）、`Role`、`lineup()`、`lineupOf(st)`、
  `agentFor()`、`roleAgent()`、`taskAgent()`、`chainOf()`、`fixerFor()`、`standIn()`、`AutoAnswers.offer/answer/defer/offerDecision`
  在各任务里写法相同。
- **没读到源码、需要执行时按实际改的地方**（每处都给了找它的命令）：`tool()` 返回对象的字段名（Task 4 Step 1）；
  `PlanStatus` 的取值和 `Plans` 的保存方法名（Task 2、4）；prefs 里默认 agent 的字段（Task 12）；Mac 的 `t`、`openChat`
  （Task 6）；手机握手里的协议版本（Task 7 Step 1）。
