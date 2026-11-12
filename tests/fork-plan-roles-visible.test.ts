import { describe, expect, it } from 'vitest';
import { Board } from '../src/core/board/board.js';
import { BoardWork } from '../src/core/board/work.js';
import type { BodyInput } from '../src/core/plans/edit.js';
import { Plans } from '../src/core/plans/plans.js';
import { PlansWork } from '../src/core/plans/work.js';
import { Store, initialState } from '../src/core/store.js';
import type { WorkspaceController, WorktreeEvent } from '../src/core/workspace-controller.js';
import type { AgentRef } from '../src/protocol.js';
import type { RuntimeChoice } from '../src/shared/agent-runtimes.js';
import type { Project, Workspace } from '../src/workspaces/types.js';
import { waitFor } from './helpers.js';

/**
 * Fork (milestone “让角色分工看得见”): each of a plan's four roles lands on the agent it was set to,
 * in its own workspace, as the store records it (Workspace.agent): what the plan page shows.
 */

const OPUS: AgentRef = { runtime: 'claude', label: 'Claude', model: 'opus' };
const DEEPSEEK: AgentRef = { runtime: 'local', label: 'Local model', model: 'deepseek/deepseek-flash[1m]' };
const GLM: AgentRef = { runtime: 'local', label: 'Local model', model: 'bigmodel/glm-5.3[1m]' };
const SONNET: AgentRef = { runtime: 'claude', label: 'Claude', model: 'sonnet' };
const RUNTIMES = [
  { id: 'claude', label: 'Claude', available: true },
  { id: 'local', label: 'Local model', available: true, models: [{ value: 'deepseek/deepseek-flash[1m]', label: 'DeepSeek Flash', description: '' }, { value: 'bigmodel/glm-5.3[1m]', label: 'GLM 5.3', description: '' }] },
] as unknown as RuntimeChoice[];

const ws = (id: string, projectId: string, name: string, kind: Workspace['kind'] = 'worktree', agent?: AgentRef): Workspace =>
  ({ id, projectId, name, path: `/tmp/${name}`, kind, projectRoot: '/tmp/p', branch: `beluga/${name}`, createdAt: 0, external: false, askOnly: kind === 'chat', ...(agent ? { agent } : {}) }) as unknown as Workspace;
const project = (id: string, name: string, workspaces: Workspace[] = []): Project => ({ id, name, root: `/tmp/${name}`, base: 'main', workspaces });

/** A daemon in small: workspaces keep the agent they were made with or switched to, as the manager does. */
export function setup(opts: { autoRoute?: boolean } = {}) {
  const store = new Store(initialState('room'));
  store.dispatch({ type: 'projects', projects: [project('api', 'bob-api', [ws('main', 'api', 'bob-api', 'chat')])] });
  if (opts.autoRoute) {
    store.dispatch({ type: 'runtimes', runtimes: RUNTIMES });
    store.dispatch({ type: 'prefs', prefs: { autoRoute: { on: true } } } as never);
  }
  const listeners: Array<(e: WorktreeEvent) => void> = [];
  const asked: Array<{ prompt: string; channel: string }> = [];
  let n = 0;
  const patch = (id: string, agent: AgentRef | undefined): void =>
    store.dispatch({ type: 'projects', projects: store.getState().projects.map((p) => ({ ...p, workspaces: p.workspaces.map((w) => (w.id === id ? ({ ...w, agent } as Workspace) : w)) })) });
  const add = (w: Workspace): void => store.dispatch({ type: 'projects', projects: store.getState().projects.map((p) => (p.id === w.projectId ? { ...p, workspaces: [...p.workspaces, w] } : p)) });
  const controller = {
    onWorktree: (l: (e: WorktreeEvent) => void) => (listeners.push(l), () => undefined),
    newWorktree: async (projectId: string, name: string, o: { agent?: AgentRef } = {}) => {
      const w = ws(`w${++n}`, projectId, name, 'worktree', o.agent);
      add(w);
      listeners.forEach((l) => l({ kind: 'created', ws: w }));
      return w;
    },
    newChat: async (projectId: string, title: string) => {
      const w = ws(`c${++n}`, projectId, title, 'chat');
      add(w);
      return w;
    },
    renameChat: async () => undefined,
    archive: async () => true,
    manager: { setAgent: patch },
  } as unknown as WorkspaceController;
  const board = new Board({ store, dir: null, projectName: () => 'bob-api' });
  const boardWork = new BoardWork({ store, board, controller, selfId: () => 'p-me', selfName: () => 'Kay', askClaude: (prompt, channel) => void asked.push({ prompt, channel }) });
  const plans = new Plans({ store, dir: null });
  const work = new PlansWork({
    store,
    plans,
    board: boardWork,
    controller,
    git: null,
    askClaude: (prompt, channel) => `ask-${asked.push({ prompt, channel })}`,
    intend: () => undefined,
    delayMs: 0,
    followAgent: (channel, agent) => patch(channel.replace(/^ws:/, ''), agent),
    rescueMs: Number.POSITIVE_INFINITY,
  });
  const claude = boardWork.myClaude();
  const me = boardWork.me();
  const issue = (title: string) => store.getState().board.issues.find((i) => i.title === title)!;
  const agentOf = (id: string | undefined): AgentRef | undefined => store.getState().projects.flatMap((p) => p.workspaces).find((w) => w.id === id)?.agent;
  const run = (channel: string, status: 'started' | 'done', id: string): void => store.dispatch({ type: 'agent_event', owner: 'p-me', requestId: id, requester: 'p-me', event: status, text: '', ts: Date.now(), channel });
  return { store, board, boardWork, plans, work, asked, claude, me, issue, agentOf, run };
}

export const ONE: BodyInput = {
  title: 'Payments',
  goal: 'Take card payments safely.',
  milestones: [{ id: 'safe', title: 'Safe payments', criteria: ['A replayed webhook charges once'], tasks: [{ id: 'retries', title: 'Idempotent webhooks' }] }],
};

type T = ReturnType<typeof setup>;
async function approved(t: T, roles: { agent?: AgentRef; checkAgent?: AgentRef; archAgent?: AgentRef; fixAgent?: AgentRef }) {
  const plan = t.plans.create({ projectId: 'api', home: 'ws:main', autonomy: 'autopilot', ...roles }, t.claude);
  t.work.forRun('ws:main', 'p-me')!.tools!.write(ONE);
  t.work.approve(plan.id);
  return plan;
}

describe('a plan’s four roles, where each really runs', () => {
  it('architect Opus, work DeepSeek, check GLM, fixes Sonnet: each workspace is on its own', async () => {
    const t = setup();
    const plan = await approved(t, { archAgent: OPUS, agent: DEEPSEEK, checkAgent: GLM, fixAgent: SONNET });
    // Architect: a chat of its own, on Opus, before any work.
    const architect = await waitFor(() => t.plans.need(plan.id).runs.safe?.architect);
    expect(t.agentOf(architect)).toEqual(OPUS);
    t.work.forRun(`ws:${architect}`, 'p-me')!.tools!.design!('safe', 'One table, one lock.');
    // Work: the milestone's one worktree, on DeepSeek.
    const agent = await waitFor(() => t.plans.need(plan.id).runs.safe?.agent);
    expect(t.agentOf(agent.worktree)).toEqual(DEEPSEEK);
    // Check: a chat of its own, on GLM.
    const w = `ws:${agent.worktree}`;
    t.run(w, 'started', 'm-1');
    t.board.update(t.issue('Idempotent webhooks').id, { status: 'in_review' }, t.claude);
    t.run(w, 'done', 'm-1');
    const checker = await waitFor(() => t.plans.need(plan.id).runs.safe?.checker);
    expect(t.agentOf(checker)).toEqual(GLM);
    // Fixes: a failed check's fix tasks move the worktree to Sonnet, with a line in the activity.
    const gate = t.work.forRun(`ws:${checker}`, 'p-me')!.tools!.gate;
    gate('safe', 'fail', 'a replay charges twice');
    t.work.forRun('ws:main', 'p-me')!.tools!.update([{ op: 'add_task', milestone: 'safe', task: { id: 'fix', title: 'Charge once on replay' } }]);
    await waitFor(() => t.asked.some((a) => a.channel === w && a.prompt.includes('More tasks for “Safe payments”')));
    expect(t.agentOf(agent.worktree)).toEqual(SONNET);
    expect(t.plans.need(plan.id).activity.some((e) => e.text === 'handed the fix tasks for “Safe payments” to Claude (Sonnet)')).toBe(true);
  });

  it('no architect set: no design chat is made (the role is off, as set)', async () => {
    const t = setup();
    const plan = await approved(t, { agent: DEEPSEEK, checkAgent: GLM });
    const agent = await waitFor(() => t.plans.need(plan.id).runs.safe?.agent);
    expect(t.plans.need(plan.id).runs.safe?.architect).toBeUndefined();
    expect(t.agentOf(agent.worktree)).toEqual(DEEPSEEK);
  });

  it('no check agent: the work’s agent checks (checkerAgentOf), not your default', async () => {
    const t = setup();
    const plan = await approved(t, { agent: DEEPSEEK });
    const agent = await waitFor(() => t.plans.need(plan.id).runs.safe?.agent);
    t.board.update(t.issue('Idempotent webhooks').id, { status: 'in_review' }, t.claude);
    void agent;
    const checker = await waitFor(() => t.plans.need(plan.id).runs.safe?.checker);
    expect(t.agentOf(checker)).toEqual(DEEPSEEK);
  });

  // BLG-198 found: work on auto route (no agent for the work) starts the milestone's worktree on your
  // default agent: startShared doesn't route, though Plan Settings says “auto route: an everyday model per task”.
  it.fails('work on auto route: the milestone’s worktree goes to the build list’s first (DeepSeek), as a task would', async () => {
    const t = setup({ autoRoute: true });
    const plan = await approved(t, { checkAgent: GLM });
    const agent = await waitFor(() => t.plans.need(plan.id).runs.safe?.agent);
    expect(t.agentOf(agent.worktree)).toEqual(DEEPSEEK);
  });

  // BLG-198 found: a task's own agent is what the task card says works it (PlanOutline: issue.agent ?? plan.agent),
  // but a milestone's worktree starts on the plan's agent regardless.
  it.fails('a task with its own agent: the milestone’s worktree starts on it, as its card says', async () => {
    const t = setup();
    const plan = t.plans.create({ projectId: 'api', home: 'ws:main', autonomy: 'gated', agent: DEEPSEEK }, t.claude);
    t.work.forRun('ws:main', 'p-me')!.tools!.write(ONE);
    t.work.approve(plan.id);
    const issue = await waitFor(() => t.issue('Idempotent webhooks'));
    t.board.setAgent(issue.id, SONNET, t.claude);
    expect(t.issue('Idempotent webhooks').agent).toEqual(SONNET);
    await t.work.startTask(plan.id, 'retries');
    const agent = await waitFor(() => t.plans.need(plan.id).runs.safe?.agent);
    expect(t.agentOf(agent.worktree)).toEqual(SONNET);
  });
});
