import { describe, expect, it } from 'vitest';
import { Store, initialState } from '../src/core/store.js';
import type { Plan } from '../src/core/plans/model.js';
import type { PilotDeps } from '../src/core/plans/pilot.js';
import { PlanFixer } from '../src/fork/plans/fixer.js';
import { choiceOf, nextOfTier, sameLimit, tierOf } from '../src/fork/plans/same-tier.js';
import type { AgentRef } from '../src/protocol.js';
import type { RuntimeChoice } from '../src/shared/agent-runtimes.js';
import type { AutoRoute } from '../src/shared/auto-route.js';
import { failureTitle } from '../src/shared/run-failure.js';

/** A task stopped by a usage limit goes on with the next model of the same auto route list (fork/plans/same-tier.ts, fixer.ts sidestep). */

const local = (model: string): AgentRef => ({ runtime: 'local', label: 'Local model', model });
const GLM = local('bigmodel/glm-5.3[1m]');
const GLM_AIR = local('bigmodel/glm-air');
const DEEPSEEK = local('deepseek/deepseek-flash[1m]');
const HAIKU: AgentRef = { runtime: 'claude', label: 'Claude', model: 'haiku' };
const model = (value: string, why?: string) => ({ value, label: value, description: '', ...(why ? { why } : {}) });
const runtimes = (down: readonly string[] = []): RuntimeChoice[] => [
  { id: 'claude', label: 'Claude', available: true },
  { id: 'local', label: 'Local model', available: true, models: ['bigmodel/glm-5.3[1m]', 'bigmodel/glm-air', 'deepseek/deepseek-flash[1m]', 'anthropic/claude-opus-5-5'].map((m) => model(m, down.includes(m) ? 'Its endpoint doesn’t answer' : undefined)) },
];
const ROUTE: AutoRoute = { on: true, build: ['local:bigmodel/glm-5.3[1m]', 'local:bigmodel/glm-air', 'local:deepseek/deepseek-flash[1m]', 'claude:haiku'], hard: ['local:anthropic/claude-opus-5-5', 'claude:opus'] };
const T0 = 1_000_000;

describe('the next model of the same list', () => {
  it('knows which list a model is on, and none for one that is on no list', () => {
    expect(tierOf(GLM, ROUTE)).toBe('build');
    expect(tierOf(local('anthropic/claude-opus-5-5'), ROUTE)).toBe('hard');
    expect(tierOf(local('ollama/qwen'), ROUTE)).toBeUndefined();
    expect(choiceOf({ runtime: 'claude', label: 'Claude' })).toBe('claude:');
  });

  it('GLM at its limit hands over to DeepSeek: the next that runs here, never another model of the same endpoint', () => {
    expect(sameLimit('local:bigmodel/glm-5.3[1m]', 'local:bigmodel/glm-air')).toBe(true);
    expect(sameLimit('local:bigmodel/glm-5.3[1m]', 'local:deepseek/deepseek-flash[1m]')).toBe(false);
    expect(sameLimit('claude:haiku', 'claude:opus')).toBe(true);
    expect(nextOfTier(GLM, ROUTE, runtimes())).toEqual(DEEPSEEK);
  });

  it('skips one that doesn’t run here or is at a limit itself, and wraps to those before it', () => {
    expect(nextOfTier(GLM, ROUTE, runtimes(['deepseek/deepseek-flash[1m]']))).toEqual(HAIKU);
    expect(nextOfTier(GLM, ROUTE, runtimes(), (v) => v === 'local:deepseek/deepseek-flash[1m]')).toEqual(HAIKU);
    expect(nextOfTier(DEEPSEEK, ROUTE, runtimes())).toEqual(HAIKU);
    expect(nextOfTier(HAIKU, ROUTE, runtimes())).toEqual(GLM);
  });

  it('stays in its tier: nothing else of its list, or a model on no list, waits for the reset', () => {
    expect(nextOfTier(GLM, { ...ROUTE, build: ['local:bigmodel/glm-5.3[1m]', 'local:bigmodel/glm-air'] }, runtimes())).toBeUndefined();
    expect(nextOfTier(GLM, ROUTE, runtimes(), () => true)).toBeUndefined();
    expect(nextOfTier(local('ollama/qwen'), ROUTE, runtimes())).toBeUndefined();
  });
});

function make(opts: { readonly on?: AgentRef; readonly route?: AutoRoute } = {}) {
  let now = T0;
  const store = new Store(initialState('room'));
  store.dispatch({ type: 'prefs', prefs: { autoRoute: opts.route ?? ROUTE } } as never);
  store.dispatch({ type: 'runtimes', runtimes: runtimes() });
  const put = (agent: AgentRef | undefined): void =>
    store.dispatch({ type: 'projects', projects: [{ id: 'api', name: 'api', root: 'api', base: 'main', workspaces: [{ id: 'w9', projectId: 'api', name: 'w9', path: 'w9', kind: 'worktree', ...(agent ? { agent: { runtime: agent.runtime, label: agent.label }, model: agent.model } : {}) }] }] as never });
  put('on' in opts ? opts.on : GLM);
  const switched: Array<AgentRef | undefined> = [];
  const notes: string[] = [];
  const deps = {
    store,
    now: () => now,
    switchAgent: (_c: string, a: AgentRef | undefined) => (switched.push(a), put(a)),
    plans: { note: (_id: string, _kind: string, text: string) => void notes.push(text) },
  } as unknown as PilotDeps;
  const plan = { id: 'p', home: 'ws:home', activity: [], runs: { safe: { agent: { worktree: 'w9', at: 0, tasks: ['t1'] } } }, body: { milestones: [{ id: 'safe', title: 'Safe payments', tasks: [] }] } } as unknown as Plan;
  return { plan, switched, notes, fixer: new PlanFixer(deps), later: (ms: number) => (now += ms) };
}

describe('a plan’s task stopped by a usage limit (fixer.ts sidestep)', () => {
  it('goes to the next model of its list at once, and the plan says so', () => {
    const t = make();
    expect(t.fixer.sidestep(t.plan, 'ws:w9', T0 + 3_600_000)).toBe('Local model (DeepSeek flash[1m])');
    expect(t.switched).toEqual([DEEPSEEK]);
    expect(t.notes).toEqual(['Local model (GLM 5.3[1m]) is at its usage limit: handed its work in “Safe payments” to Local model (DeepSeek flash[1m]), the next of its list']);
  });

  it('the one it moved to hits a limit too: on to the next, never back to one still at its limit; the list used up, it waits', () => {
    const t = make();
    const until = T0 + 3_600_000;
    t.fixer.sidestep(t.plan, 'ws:w9', until);
    expect(t.fixer.sidestep(t.plan, 'ws:w9', until)).toBe('Claude (Haiku)');
    expect(t.fixer.sidestep(t.plan, 'ws:w9', until)).toBeUndefined();
    expect(t.switched).toEqual([DEEPSEEK, HAIKU]);
    // Once GLM's limit has reset, it can take work again.
    t.later(3_600_001);
    expect(t.fixer.sidestep(t.plan, 'ws:w9', T0 + 2 * 3_600_000)).toBe('Local model (GLM 5.3[1m])');
  });

  it('auto route off, a model on no list, or your default agent: it waits for the reset, as before', () => {
    const off = make({ route: { ...ROUTE, on: false } });
    expect(off.fixer.sidestep(off.plan, 'ws:w9', T0 + 1)).toBeUndefined();
    const other = make({ on: local('ollama/qwen') });
    expect(other.fixer.sidestep(other.plan, 'ws:w9', T0 + 1)).toBeUndefined();
    const mine = make({ on: undefined });
    expect(mine.fixer.sidestep(mine.plan, 'ws:w9', T0 + 1)).toBeUndefined();
    expect([...off.switched, ...other.switched, ...mine.switched]).toEqual([]);
  });

  it('a milestone that starts while auto route’s model is at its limit starts on the next of its list', () => {
    const t = make();
    t.fixer.sidestep(t.plan, 'ws:w9', T0 + 3_600_000);
    const got = t.fixer.workAgent(t.plan, 'Refunds', false, { labels: [], priority: 'none' });
    expect(got).toEqual({ agent: DEEPSEEK, via: 'auto' });
    expect(t.notes.at(-1)).toBe('“Refunds” starts on Local model (DeepSeek flash[1m]): Local model (GLM 5.3[1m]) is at its usage limit');
    t.later(3_600_001);
    expect(t.fixer.workAgent(t.plan, 'Receipts', false, { labels: [], priority: 'none' }).agent).toEqual(GLM);
  });
});

describe('what the card says', () => {
  it('an endpoint’s limit is the endpoint’s, not your Claude plan’s', () => {
    expect(failureTitle({ kind: 'usage_limit', detail: '429', endpoint: true })).toBe('This model’s endpoint is at its usage limit');
    expect(failureTitle({ kind: 'usage_limit', detail: 'limit' })).toBe('You hit your Claude plan usage limit');
  });
});

// ---- the watchdog asks, and the task goes on (the plan's own parts, as tests/run-errors.test.ts builds them)

import { Board } from '../src/core/board/board.js';
import { BoardWork } from '../src/core/board/work.js';
import type { BodyInput } from '../src/core/plans/edit.js';
import { Plans } from '../src/core/plans/plans.js';
import { PlansWork } from '../src/core/plans/work.js';
import type { WorkspaceController } from '../src/core/workspace-controller.js';
import { classifyRun, encodeFailure } from '../src/shared/run-failure.js';
import type { Project, Workspace } from '../src/workspaces/types.js';
import { waitFor } from './helpers.js';

const MIN = 60_000;
const BODY: BodyInput = { title: 'Payments', goal: 'Take payments', milestones: [{ id: 'safe', title: 'Safe payments', criteria: ['works'], tasks: [{ id: 'auth', title: 'Auth on payment routes', acceptance: ['401 without session'] }] }] };
const space = (id: string, name: string, kind: Workspace['kind'], extra: Record<string, unknown> = {}): Workspace => ({ id, projectId: 'api', name, path: name, kind, projectRoot: 'p', branch: `beluga/${name}`, createdAt: 0, external: false, ...extra }) as unknown as Workspace;

/** A plan on auto route with one task at work on GLM, a clock passed in, and what was asked of whom. */
async function running(route: AutoRoute) {
  const store = new Store(initialState('room'));
  const project: Project = { id: 'api', name: 'bob-api', root: 'bob-api', base: 'main', workspaces: [space('main', 'bob-api', 'chat', { askOnly: true })] };
  store.dispatch({ type: 'projects', projects: [project] });
  store.dispatch({ type: 'prefs', prefs: { autoRoute: route } } as never);
  store.dispatch({ type: 'runtimes', runtimes: runtimes() });
  const setAgent = (id: string, agent: AgentRef | undefined): void =>
    store.dispatch({ type: 'projects', projects: store.getState().projects.map((p) => ({ ...p, workspaces: p.workspaces.map((w) => (w.id === id ? ({ ...w, agent: agent ? { runtime: agent.runtime, label: agent.label } : undefined, model: agent?.model } as unknown as Workspace) : w)) })) });
  let n = 0;
  const controller = {
    onWorktree: () => () => undefined,
    newWorktree: async (_projectId: string, name: string, opts?: { agent?: AgentRef }) => {
      const w = space(`w${++n}`, name, 'worktree');
      store.dispatch({ type: 'projects', projects: store.getState().projects.map((p) => ({ ...p, workspaces: [...p.workspaces, w] })) });
      setAgent(w.id, opts?.agent);
      return w;
    },
  } as unknown as WorkspaceController;
  const asked: Array<{ prompt: string; channel: string }> = [];
  const switched: Array<{ channel: string; agent: AgentRef | undefined }> = [];
  const board = new Board({ store, dir: null, projectName: () => 'bob-api' });
  const boardWork = new BoardWork({ store, board, controller, selfId: () => 'p-me', selfName: () => 'Kay', askClaude: (prompt, channel) => void asked.push({ prompt, channel }) });
  const plans = new Plans({ store, dir: null });
  let now = new Date(2026, 10, 16, 12).getTime();
  const work = new PlansWork({
    store,
    plans,
    board: boardWork,
    controller,
    git: null,
    askClaude: (prompt, channel) => void asked.push({ prompt, channel }),
    intend: () => undefined,
    alive: () => false,
    takeOver: async () => [],
    followAgent: (channel, agent) => (switched.push({ channel, agent }), setAgent(channel.slice(3), agent)),
    now: () => now,
    delayMs: 0,
  });
  const plan = plans.create({ projectId: 'api', home: 'ws:main', autonomy: 'gated' }, boardWork.myClaude());
  work.forRun('ws:main', 'p-me')!.tools!.write(BODY);
  work.approve(plan.id);
  const issue = () => store.getState().board.issues.find((i) => i.title === 'Auth on payment routes');
  await waitFor(() => issue()?.worktrees.length);
  const channel = `ws:${issue()!.worktrees.at(-1)}`;
  const event = (requestId: string, kind: 'started' | 'tool' | 'error', text = ''): void => store.dispatch({ type: 'agent_event', owner: 'p-me', requestId, requester: 'p-me', event: kind, text, ts: now, channel });
  const later = (ms: number): void => {
    now += ms;
    work.pilot.tick();
  };
  const wakes = () => asked.filter((a) => a.channel === channel && a.prompt.startsWith('You stopped before handing off'));
  const notes = () => plans.need(plan.id).activity.map((e) => e.text);
  const watching = () => Object.values(plans.need(plan.id).watch ?? {}).map((w) => w?.line ?? '');
  return { channel, event, later, wakes, notes, watching, switched, now: () => now, stop: () => work.pilot.stop() };
}

describe('the watchdog, on a task stopped by a usage limit', () => {
  const limit = (now: number, resetsAt: number): string => encodeFailure({ ...classifyRun({ rejectedUntil: resetsAt, error: 'API Error: 429' }), endpoint: true }, now);

  it('auto route on: its conversation goes to the next model of its list and is resumed now, not at the reset', async () => {
    const t = await running(ROUTE);
    const resetsAt = t.now() + 180 * MIN;
    t.event('r1', 'started');
    t.event('r1', 'tool', 'Edit src/auth.ts');
    t.event('r1', 'error', limit(t.now(), resetsAt));
    t.later(MIN);
    await waitFor(() => t.wakes().length === 1);
    expect(t.switched).toEqual([{ channel: t.channel, agent: DEEPSEEK }]);
    expect(t.notes().some((n) => n.includes('is at its usage limit: handed its work in “Safe payments” to Local model (DeepSeek flash[1m]), the next of its list'))).toBe(true);
    // Resumed once: the same stopped run isn't handed on again.
    t.later(MIN);
    t.later(MIN);
    expect(t.switched).toHaveLength(1);
    expect(t.wakes()).toHaveLength(1);
    t.stop();
  });

  it('nothing else of its list can take it: it waits for the reset, as before', async () => {
    const t = await running({ ...ROUTE, build: ['local:bigmodel/glm-5.3[1m]', 'local:bigmodel/glm-air'] });
    const resetsAt = t.now() + 180 * MIN;
    t.event('r1', 'started');
    t.event('r1', 'error', limit(t.now(), resetsAt));
    t.later(MIN);
    await waitFor(() => t.watching().some((n) => n.includes('paused: usage limit')));
    expect(t.switched).toEqual([]);
    expect(t.wakes()).toHaveLength(0);
    t.stop();
  });
});
