import { describe, expect, it } from 'vitest';
import { Board } from '../src/core/board/board.js';
import { BoardWork } from '../src/core/board/work.js';
import type { BodyInput } from '../src/core/plans/edit.js';
import type { PlanMilestone } from '../src/core/plans/model.js';
import { Plans } from '../src/core/plans/plans.js';
import { PlansWork } from '../src/core/plans/work.js';
import { Store, initialState } from '../src/core/store.js';
import type { WorkspaceController, WorktreeEvent } from '../src/core/workspace-controller.js';
import { PLANS_API } from '../src/ipc/plans-api.js';
import type { AgentRef } from '../src/protocol.js';
import type { Project, Workspace } from '../src/workspaces/types.js';
import { waitFor } from './helpers.js';

/**
 * A model picked for a part of a plan from its page (the Agents menu's model submenus: plans.setRoleAgent
 * with a model) is the model that part runs on: the planner's conversation, the builder's worktrees,
 * the checker's conversations. (That a conversation's model reaches the run: agent-per-place.test.ts.)
 */

const OPUS: AgentRef = { runtime: 'claude', label: 'Claude', model: 'opus' };
const SONNET: AgentRef = { runtime: 'claude', label: 'Claude', model: 'sonnet' };
const GPT: AgentRef = { runtime: 'codex', label: 'Codex', model: 'gpt-5.5' };

const ws = (id: string, projectId: string, name: string, kind: Workspace['kind']): Workspace => ({ id, projectId, name, path: `/tmp/${name}`, kind, projectRoot: '/tmp/p', branch: `b/${name}`, createdAt: 0, external: false }) as unknown as Workspace;
const project = (id: string, name: string): Project => ({ id, name, root: `/tmp/${name}`, base: 'main', workspaces: [] });

const BODY: BodyInput = {
  title: 'Parser',
  goal: 'A faster parser.',
  milestones: [{ id: 'm1', title: 'Fast', criteria: ['fast'], tasks: [{ id: 'a', title: 'Lexer' }] }],
};

function setup() {
  const store = new Store(initialState('room'));
  store.dispatch({ type: 'projects', projects: [project('api', 'bob-api')] });
  const add = (w: Workspace): void => store.dispatch({ type: 'projects', projects: store.getState().projects.map((p) => (p.id === w.projectId ? { ...p, workspaces: [...p.workspaces, w] } : p)) });
  const patch = (id: string, fields: Partial<Workspace>): void =>
    store.dispatch({ type: 'projects', projects: store.getState().projects.map((p) => ({ ...p, workspaces: p.workspaces.map((w) => (w.id === id ? ({ ...w, ...fields } as Workspace) : w)) })) });
  const listeners: Array<(e: WorktreeEvent) => void> = [];
  const worktrees: Array<AgentRef | undefined> = [];
  const chats: Array<{ id: string; agent: AgentRef | undefined }> = [];
  const followed: Array<AgentRef | undefined> = [];
  let n = 0;
  const controller = {
    onWorktree: (l: (e: WorktreeEvent) => void) => {
      listeners.push(l);
      return () => undefined;
    },
    newChat: async (projectId: string, title: string) => {
      const w = ws(`c${++n}`, projectId, title, 'chat');
      add(w);
      return w;
    },
    newWorktree: async (projectId: string, name: string, o: { agent?: AgentRef } = {}) => {
      worktrees.push(o.agent);
      const w = ws(`w${++n}`, projectId, name, 'worktree');
      add(w);
      listeners.forEach((l) => l({ kind: 'created', ws: w }));
      return w;
    },
    renameChat: async () => undefined,
    archive: async () => true,
    manager: {
      // As the manager keeps it: the agent, with its model apart (agentFields).
      setAgent: (id: string, agent: AgentRef | undefined) => {
        chats.push({ id, agent });
        const { model, ...ref } = agent ?? ({} as AgentRef);
        patch(id, { agent: agent ? ref : undefined, model } as Partial<Workspace>);
      },
      find: (id: string) => store.getState().projects.flatMap((p) => p.workspaces).find((w) => w.id === id),
    },
  } as unknown as WorkspaceController;
  const board = new Board({ store, dir: null, projectName: () => 'bob-api' });
  const boardWork = new BoardWork({ store, board, controller, selfId: () => 'p-me', selfName: () => 'Kay', askClaude: () => undefined });
  const plans = new Plans({ store, dir: null, saveDelayMs: 0 });
  const work = new PlansWork({ store, plans, board: boardWork, controller, askClaude: () => 'ask', intend: () => undefined, delayMs: 0, git: null, workers: 'milestone', followAgent: (_channel, agent) => void followed.push(agent) });
  return { store, plans, work, worktrees, chats, followed };
}

describe('a model picked for a part of a plan is the one it runs on', () => {
  it('the API takes a model with the part’s agent, and the plan keeps it', async () => {
    expect(PLANS_API['plans.setRoleAgent'].args.parse(['p1', 'checker', GPT])[2]).toEqual(GPT);
    const t = setup();
    const plan = await t.work.create({ projectId: 'api', goal: 'A faster parser.' });
    t.work.setRoleAgent(plan.id, 'planner', SONNET);
    t.work.setRoleAgent(plan.id, 'builder', OPUS);
    t.work.setRoleAgent(plan.id, 'checker', GPT);
    expect(t.plans.need(plan.id)).toMatchObject({ planner: SONNET, agent: OPUS, checker: GPT });
  });

  it('the planner: the plan’s conversation moves to that model, and a model change on the same agent moves it too', async () => {
    const t = setup();
    const plan = await t.work.create({ projectId: 'api', goal: 'A faster parser.', planner: { runtime: 'claude', label: 'Claude' } });
    expect(t.work.setRoleAgent(plan.id, 'planner', SONNET)).toBe('Claude (Sonnet) plans with you here from now on');
    expect(t.followed.at(-1)).toEqual(SONNET);
    // The conversation now runs Sonnet; picking Opus on the same agent moves it again.
    const home = plan.home.slice(3);
    const chat = t.store.getState().projects.flatMap((p) => p.workspaces).find((w) => w.id === home)!;
    expect(chat).toBeDefined();
    (t.work as unknown as { deps: { controller: WorkspaceController } }).deps.controller.manager.setAgent(home, SONNET);
    t.work.setRoleAgent(plan.id, 'planner', OPUS);
    expect(t.followed.at(-1)).toEqual(OPUS);
  });

  it('the builder: the plan’s worktrees start on that model', async () => {
    const t = setup();
    const plan = await t.work.create({ projectId: 'api', goal: 'A faster parser.', autonomy: 'autopilot' });
    expect(t.work.setRoleAgent(plan.id, 'builder', OPUS)).toContain('Claude (Opus) works this plan');
    t.work.forRun(plan.home, 'p-me')!.tools!.write(BODY);
    t.work.approve(plan.id);
    await waitFor(() => t.worktrees.length > 0);
    expect(t.worktrees).toEqual([OPUS]);
  });

  it('the checker: a milestone’s check and the draft’s review run on that model', async () => {
    const t = setup();
    const plan = await t.work.create({ projectId: 'api', goal: 'A faster parser.' });
    t.work.setRoleAgent(plan.id, 'checker', GPT);
    t.work.forRun(plan.home, 'p-me')!.tools!.write(BODY);
    await t.work.verify(plan.id);
    const review = t.plans.need(plan.id).review!.chat!;
    expect(t.chats).toContainEqual({ id: review, agent: GPT });
    const pilot = (t.work as unknown as { pilot: { deps: { checkerChat: (plan: unknown, m: PlanMilestone) => Promise<string | undefined> } } }).pilot;
    const milestone = t.plans.need(plan.id).draft!.milestones[0]!;
    const check = await pilot.deps.checkerChat(t.plans.need(plan.id), milestone);
    expect(t.chats).toContainEqual({ id: check, agent: GPT });
  });
});
