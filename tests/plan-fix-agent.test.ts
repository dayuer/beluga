import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Board } from '../src/core/board/board.js';
import { BoardWork } from '../src/core/board/work.js';
import type { BodyInput } from '../src/core/plans/edit.js';
import { homeAgentOf } from '../src/core/plans/model.js';
import { Plans } from '../src/core/plans/plans.js';
import { PlansWork, type PlansWorkDeps } from '../src/core/plans/work.js';
import { Store, initialState } from '../src/core/store.js';
import type { WorkspaceController, WorktreeEvent } from '../src/core/workspace-controller.js';
import { PLANS_API } from '../src/ipc/plans-api.js';
import { PLANS_HANDLERS } from '../src/ipc/plans-handlers.js';
import { PhoneCalls } from '../src/companion/calls.js';
import { PHONE } from '../src/companion/coverage.js';
import { COMPANION_PROTO, PlanView, SINCE } from '../src/companion/protocol.js';
import { planPageView } from '../src/companion/views.js';
import { EXTERNAL_ACCESS } from '../src/external/coverage.js';
import { STATE_ROWS } from '../src/external/adapters/tools/state-rows.js';
import { MACHINE } from '../src/machines/coverage.js';
import type { AgentRef } from '../src/protocol.js';
import type { CombineResult } from '../src/workspaces/git.js';
import type { Project, Workspace } from '../src/workspaces/types.js';
import { waitFor } from './helpers.js';

/** A plan's agent for hard fixes (fork): fix tasks after a failed check, conflicts and a task that stopped twice go to a stronger model. */

const CHEAP: AgentRef = { runtime: 'local', label: 'Local model', model: 'deepseek/deepseek-flash' };
const STRONG: AgentRef = { runtime: 'claude', label: 'Claude', model: 'opus' };
const MID: AgentRef = { runtime: 'claude', label: 'Claude', model: 'sonnet' };
const MIN = 60_000;

const ws = (id: string, projectId: string, name: string, kind: Workspace['kind'] = 'worktree'): Workspace => ({ id, projectId, name, path: `/tmp/${name}`, kind, projectRoot: '/tmp/p', branch: `beluga/${name}`, createdAt: 0, external: false, askOnly: kind === 'chat' }) as unknown as Workspace;
const project = (id: string, name: string, workspaces: Workspace[] = []): Project => ({ id, name, root: `/tmp/${name}`, base: 'main', workspaces });

function setup(opts: { workers?: 'milestone' | 'task'; combine?: PlansWorkDeps['combine']; dir?: string; now?: () => number } = {}) {
  const store = new Store(initialState('room'));
  store.dispatch({ type: 'projects', projects: [project('api', 'bob-api', [ws('main', 'api', 'bob-api', 'chat')])] });
  const listeners: Array<(e: WorktreeEvent) => void> = [];
  const made: Array<{ id: string; agent?: AgentRef }> = [];
  const asked: Array<{ prompt: string; channel: string }> = [];
  // Every switch of a conversation's agent, in order with what it was asked (`at`: how many asks came before).
  const switched: Array<{ channel: string; agent: AgentRef | undefined; at: number }> = [];
  const setAgent: Array<{ id: string; agent: AgentRef | undefined }> = [];
  let n = 0;
  const add = (w: Workspace): void => store.dispatch({ type: 'projects', projects: store.getState().projects.map((p) => (p.id === w.projectId ? { ...p, workspaces: [...p.workspaces, w] } : p)) });
  const controller = {
    onWorktree: (l: (e: WorktreeEvent) => void) => (listeners.push(l), () => undefined),
    newWorktree: async (projectId: string, name: string, o: { agent?: AgentRef } = {}) => {
      const w = ws(`w${++n}`, projectId, name);
      made.push({ id: w.id, ...(o.agent ? { agent: o.agent } : {}) });
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
    manager: { setAgent: (id: string, agent: AgentRef | undefined) => void setAgent.push({ id, agent }) },
  } as unknown as WorkspaceController;
  const board = new Board({ store, dir: null, projectName: () => 'bob-api' });
  const boardWork = new BoardWork({ store, board, controller, selfId: () => 'p-me', selfName: () => 'Kay', askClaude: (prompt, channel) => void asked.push({ prompt, channel }) });
  const plans = new Plans({ store, dir: opts.dir ?? null });
  const work = new PlansWork({
    store,
    plans,
    board: boardWork,
    controller,
    git: null,
    askClaude: (prompt, channel) => `ask-${asked.push({ prompt, channel })}`,
    intend: () => undefined,
    delayMs: 0,
    followAgent: (channel, agent) => void switched.push({ channel, agent, at: asked.length }),
    rescueMs: Number.POSITIVE_INFINITY,
    ...(opts.workers ? { workers: opts.workers } : {}),
    ...(opts.combine ? { combine: opts.combine } : {}),
    ...(opts.now ? { now: opts.now } : {}),
  });
  const claude = boardWork.myClaude();
  const me = boardWork.me();
  const issue = (title: string) => store.getState().board.issues.find((i) => i.title === title)!;
  const run = (channel: string, status: 'started' | 'done', id: string, ts = Date.now()): void => store.dispatch({ type: 'agent_event', owner: 'p-me', requestId: id, requester: 'p-me', event: status, text: '', ts, channel });
  return { store, board, boardWork, plans, work, made, asked, switched, setAgent, claude, me, issue, run };
}

type T = ReturnType<typeof setup>;

/** An approved plan on CHEAP, with STRONG for its hard fixes (unless `fix` is null). */
async function approved(t: T, body: BodyInput, opts: { fix?: AgentRef | null; autonomy?: 'gated' | 'autopilot' } = {}) {
  const plan = t.plans.create({ projectId: 'api', home: 'ws:main', autonomy: opts.autonomy ?? 'autopilot', agent: CHEAP, ...(opts.fix === null ? {} : { fixAgent: opts.fix ?? STRONG }) }, t.claude);
  t.plans.setMaxParallel(plan.id, 5, t.me);
  t.work.forRun('ws:main', 'p-me')!.tools!.write(body);
  t.work.approve(plan.id);
  return plan;
}

const ONE: BodyInput = {
  title: 'Payments',
  goal: 'Take card payments safely.',
  milestones: [{ id: 'safe', title: 'Safe payments', criteria: ['A replayed webhook charges once'], tasks: [{ id: 'retries', title: 'Idempotent webhooks' }] }],
};

describe('a plan’s agent for hard fixes', () => {
  it('kept on the plan with a line in its activity; null gives it back; the same pick changes nothing', () => {
    const t = setup();
    const plan = t.plans.create({ projectId: 'api', home: 'ws:main' }, t.claude);
    expect(t.work.setFixAgent(plan.id, STRONG)).toBe('Claude (Opus) takes over what’s hard in this plan: fix tasks after a failed check, conflicts, a task that stopped twice');
    expect(t.plans.need(plan.id).fixAgent).toEqual(STRONG);
    const lines = t.plans.need(plan.id).activity.length;
    t.work.setFixAgent(plan.id, STRONG);
    expect(t.plans.need(plan.id).activity.length).toBe(lines);
    t.work.setFixAgent(plan.id, null);
    expect('fixAgent' in t.plans.need(plan.id)).toBe(false);
    expect(t.plans.need(plan.id).activity.at(-1)!.text).toBe('gave what’s hard back to whoever is at it');
  });

  it('a new plan takes every role at once, saved and read back; its conversation plans on its architect', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'plan-fix-agent-'));
    const t = setup({ dir });
    const plan = await t.work.create({ projectId: 'api', goal: 'Take payments', agent: CHEAP, checkAgent: MID, archAgent: STRONG, fixAgent: STRONG }, { quiet: true });
    expect(t.plans.need(plan.id)).toMatchObject({ agent: CHEAP, checkAgent: MID, archAgent: STRONG, fixAgent: STRONG });
    expect(t.setAgent.at(-1)).toEqual({ id: plan.home.slice('ws:'.length), agent: STRONG });
    expect(homeAgentOf({ agent: CHEAP })).toEqual(CHEAP);
    // Another architect later: the plan's conversation follows it; none, back on the work's agent.
    t.work.setArchAgent(plan.id, MID);
    expect(t.switched.at(-1)).toMatchObject({ channel: plan.home, agent: MID });
    t.work.setArchAgent(plan.id, null);
    expect(t.switched.at(-1)).toMatchObject({ channel: plan.home, agent: CHEAP });
    t.plans.flush();
    const again = new Plans({ store: new Store(initialState('room')), dir });
    expect(again.need(plan.id)).toMatchObject({ agent: CHEAP, checkAgent: MID, fixAgent: STRONG });
  });

  it('what Plan Settings saves (BLG-123) is still there after the daemon restarts', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'plan-settings-'));
    const t = setup({ dir });
    const plan = await t.work.create({ projectId: 'api', goal: 'Take payments', agent: CHEAP }, { quiet: true });
    t.work.setAutonomy(plan.id, 'gated');
    t.work.setTestsAt(plan.id, 'end');
    t.work.setWorkAgent(plan.id, MID);
    t.work.setCheckAgent(plan.id, STRONG);
    t.work.setArchAgent(plan.id, STRONG);
    t.work.setFixAgent(plan.id, MID);
    t.plans.flush();
    const again = new Plans({ store: new Store(initialState('room')), dir });
    expect(again.need(plan.id)).toMatchObject({ autonomy: 'gated', testsAt: 'end', agent: MID, checkAgent: STRONG, archAgent: STRONG, fixAgent: MID });
  });

  it('fix tasks after a failed check: the milestone’s worktree goes to the fix agent before it’s told about them, once', async () => {
    const t = setup({ workers: 'milestone' });
    const plan = await approved(t, ONE);
    const agent = await waitFor(() => t.plans.need(plan.id).runs.safe?.agent);
    const w = `ws:${agent.worktree}`;
    expect(t.made[0]!.agent).toEqual(CHEAP);
    t.run(w, 'started', 'm-1');
    t.board.update(t.issue('Idempotent webhooks').id, { status: 'in_review' }, t.claude);
    t.run(w, 'done', 'm-1');
    const head = t.work.forRun('ws:main', 'p-me')!.tools!;
    await waitFor(() => t.plans.need(plan.id).runs.safe?.checkAsked !== undefined);
    head.gate('safe', 'fail', 'a replay charges twice');
    head.update([
      { op: 'add_task', milestone: 'safe', task: { id: 'fix', title: 'Charge once on replay' } },
      { op: 'add_task', milestone: 'safe', task: { id: 'fix2', title: 'Test the replay' } },
    ]);
    const told = await waitFor(() => t.asked.findIndex((a) => a.channel === w && a.prompt.includes('More tasks for “Safe payments”')) + 1);
    const toFixer = t.switched.filter((s) => s.channel === w);
    expect(toFixer).toEqual([{ channel: w, agent: STRONG, at: expect.any(Number) }]);
    expect(toFixer[0]!.at).toBeLessThan(told);
    expect(t.plans.need(plan.id).activity.some((e) => e.text === 'handed the fix tasks for “Safe payments” to Claude (Opus)')).toBe(true);
    expect(t.made).toHaveLength(1);
  });

  it('without a fix agent (and auto route off), the milestone keeps its agent, as before', async () => {
    const t = setup({ workers: 'milestone' });
    const plan = await approved(t, ONE, { fix: null });
    const agent = await waitFor(() => t.plans.need(plan.id).runs.safe?.agent);
    const w = `ws:${agent.worktree}`;
    t.run(w, 'started', 'm-1');
    t.board.update(t.issue('Idempotent webhooks').id, { status: 'in_review' }, t.claude);
    t.run(w, 'done', 'm-1');
    await waitFor(() => t.plans.need(plan.id).runs.safe?.checkAsked !== undefined);
    const head = t.work.forRun('ws:main', 'p-me')!.tools!;
    head.gate('safe', 'fail', 'a replay charges twice');
    head.update([{ op: 'add_task', milestone: 'safe', task: { id: 'fix', title: 'Charge once on replay' } }]);
    await waitFor(() => t.asked.some((a) => a.channel === w && a.prompt.includes('More tasks for “Safe payments”')));
    expect(t.switched.filter((s) => s.channel === w)).toEqual([]);
  });

  it('a conflict: the plan’s conversation goes to the fix agent while it fixes it, and back once it’s gone', async () => {
    let fixed = false;
    const conflict = (key: string): CombineResult => (fixed ? { ok: true, branch: `beluga/${key.toLowerCase()}-base` } : { ok: false, branch: `beluga/${key.toLowerCase()}-base`, dir: '/tmp/.bases/p/two-base', merging: 'beluga/b', files: ['shared.txt'] });
    const t = setup({ workers: 'task', combine: async (_p, key) => conflict(key) });
    const plan = await approved(t, { title: 'Stack', goal: '', milestones: [{ id: 'm', title: 'Everything', criteria: ['works'], tasks: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }, { id: 'two', title: 'Two', blockedBy: ['a', 'b'] }] }] }, { autonomy: 'gated' });
    await waitFor(() => t.issue('A').worktrees.length && t.issue('B').worktrees.length);
    for (const title of ['A', 'B']) t.board.update(t.issue(title).id, { status: 'in_review' }, t.claude);
    const fixup = await waitFor(() => t.asked.findIndex((a) => a.channel === 'ws:main' && a.prompt.includes('/tmp/.bases/p/two-base')) + 1);
    expect(t.switched[0]).toEqual({ channel: 'ws:main', agent: STRONG, at: fixup - 1 });
    expect(t.plans.need(plan.id).activity.some((e) => e.text === 'handed the conflict to Claude (Opus)')).toBe(true);
    // Its fix-up run comes and goes, the combine works: the plan's conversation plans on its work agent again.
    fixed = true;
    t.run('ws:main', 'started', 'fix-1');
    t.run('ws:main', 'done', 'fix-1');
    await waitFor(() => t.issue('Two').status === 'in_progress');
    expect(t.switched.at(-1)).toMatchObject({ channel: 'ws:main', agent: CHEAP });
  });

  it('two conflicts at once (BLG-131): one gone keeps the conversation on the fix agent; both gone, it goes back', async () => {
    const fixed = new Set<string>();
    const dirOf = (key: string) => `/tmp/.bases/p/${key.toLowerCase()}-base`;
    const t = setup({ workers: 'task', combine: async (_p, key) => (fixed.has(key) ? { ok: true, branch: `beluga/${key.toLowerCase()}-base` } : { ok: false, branch: `beluga/${key.toLowerCase()}-base`, dir: dirOf(key), merging: 'beluga/b', files: ['shared.txt'] }) });
    await approved(t, { title: 'Stack', goal: '', milestones: [{ id: 'm', title: 'Everything', criteria: ['works'], tasks: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }, { id: 'c', title: 'C' }, { id: 'd', title: 'D' }, { id: 'two', title: 'Two', blockedBy: ['a', 'b'] }, { id: 'four', title: 'Four', blockedBy: ['c', 'd'] }] }] }, { autonomy: 'gated' });
    await waitFor(() => ['A', 'B', 'C', 'D'].every((x) => t.issue(x).worktrees.length));
    for (const title of ['A', 'B', 'C', 'D']) t.board.update(t.issue(title).id, { status: 'in_review' }, t.claude);
    const [two, four] = [t.issue('Two').key, t.issue('Four').key];
    await waitFor(() => t.asked.some((a) => a.prompt.includes(dirOf(two))) && t.asked.some((a) => a.prompt.includes(dirOf(four))));
    expect(t.switched).toEqual([{ channel: 'ws:main', agent: STRONG, at: expect.any(Number) }]);
    // Two's conflict is fixed; Four's is still there: no handing back.
    fixed.add(two);
    t.run('ws:main', 'started', 'fix-1');
    t.run('ws:main', 'done', 'fix-1');
    await waitFor(() => t.issue('Two').status === 'in_progress');
    expect(t.switched.map((s) => s.agent)).toEqual([STRONG]);
    // Four's too: back on the work's agent.
    fixed.add(four);
    t.run('ws:main', 'started', 'fix-2');
    t.run('ws:main', 'done', 'fix-2');
    await waitFor(() => t.issue('Four').status === 'in_progress');
    expect(t.switched.map((s) => s.agent)).toEqual([STRONG, CHEAP]);
  });

  it('put on the fix agent before a restart (BLG-131): no second handover, and back on the work’s agent once the conflict is gone', async () => {
    let fixed = false;
    const t = setup({ workers: 'task', combine: async (_p, key) => (fixed ? { ok: true, branch: `beluga/${key.toLowerCase()}-base` } : { ok: false, branch: `beluga/${key.toLowerCase()}-base`, dir: '/tmp/.bases/p/two-base', merging: 'beluga/b', files: ['shared.txt'] }) });
    // What the daemon kept on the plan's conversation from before: it's on the fix agent (this session never switched it).
    t.store.dispatch({ type: 'projects', projects: t.store.getState().projects.map((p) => ({ ...p, workspaces: p.workspaces.map((w) => (w.id === 'main' ? ({ ...w, agent: STRONG } as Workspace) : w)) })) });
    const plan = await approved(t, { title: 'Stack', goal: '', milestones: [{ id: 'm', title: 'Everything', criteria: ['works'], tasks: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }, { id: 'two', title: 'Two', blockedBy: ['a', 'b'] }] }] }, { autonomy: 'gated' });
    await waitFor(() => t.issue('A').worktrees.length && t.issue('B').worktrees.length);
    for (const title of ['A', 'B']) t.board.update(t.issue(title).id, { status: 'in_review' }, t.claude);
    await waitFor(() => t.asked.some((a) => a.channel === 'ws:main' && a.prompt.includes('/tmp/.bases/p/two-base')));
    expect(t.switched).toEqual([]);
    expect(t.plans.need(plan.id).activity.some((e) => e.text === 'handed the conflict to Claude (Opus)')).toBe(false);
    fixed = true;
    t.run('ws:main', 'started', 'fix-1');
    t.run('ws:main', 'done', 'fix-1');
    await waitFor(() => t.issue('Two').status === 'in_progress');
    expect(t.switched).toEqual([{ channel: 'ws:main', agent: CHEAP, at: expect.any(Number) }]);
  });

  it('a task that stops twice goes to the fix agent and is woken once more; a third time, it waits for you', async () => {
    let now = Date.now();
    const t = setup({ workers: 'task', now: () => now });
    const plan = await approved(t, ONE, { autonomy: 'gated' });
    const channel = `ws:${await waitFor(() => t.issue('Idempotent webhooks').worktrees.at(-1))}`;
    const wakes = () => t.asked.filter((a) => a.channel === channel && a.prompt.startsWith('You stopped before handing off'));
    const stop = async (id: string, wakesBefore: number) => {
      now += MIN;
      t.run(channel, 'started', id, now);
      t.run(channel, 'done', id, now);
      now += 1000;
      t.work.pilot.tick();
      return waitFor(() => (wakes().length > wakesBefore ? true : t.plans.need(plan.id).watch?.retries?.needsYou));
    };
    await stop('r1', 0);
    expect(wakes()).toHaveLength(1);
    expect(t.switched).toEqual([]);
    await stop('r2', 1);
    expect(wakes()).toHaveLength(2);
    expect(t.switched).toEqual([{ channel, agent: STRONG, at: expect.any(Number) }]);
    expect(t.plans.need(plan.id).watch?.retries).toMatchObject({ escalated: true });
    expect(t.plans.need(plan.id).activity.some((e) => e.text.includes('stopped again: gave it to Claude (Opus)'))).toBe(true);
    await stop('r3', 2);
    expect(wakes()).toHaveLength(2);
    expect(t.plans.need(plan.id).watch?.retries).toMatchObject({ needsYou: true });
  });

  it('the API, the phone’s calls and coverage, external agents, machines, and the plan page on the phone', () => {
    const args = PLANS_API['plans.setFixAgent'].args;
    expect(args.parse(['p1', STRONG])[1]).toEqual(STRONG);
    expect(args.parse(['p1', null])[1]).toBeNull();
    expect(PLANS_API['plans.create'].args.parse([{ projectId: 'api', goal: 'x', archAgent: STRONG, checkAgent: MID, fixAgent: STRONG }])[0]).toMatchObject({ archAgent: STRONG, checkAgent: MID, fixAgent: STRONG });
    expect(typeof PLANS_HANDLERS['plans.setFixAgent']).toBe('function');
    expect(PHONE['plans.setFixAgent']).toBe('phone');
    expect(PhoneCalls['plans.setFixAgent'].result.parse('x')).toBe('x');
    expect(SINCE.fixAgent).toBe(54);
    expect(COMPANION_PROTO.minor).toBeGreaterThanOrEqual(SINCE.fixAgent);
    expect(EXTERNAL_ACCESS['plans.setFixAgent']).toBe('covered');
    expect(STATE_ROWS.find((r) => r.method === 'plans.setFixAgent')?.name).toBe('plan_set_fix_agent');
    expect(MACHINE['plans.setFixAgent']).toBe(MACHINE['plans.setArchAgent']);
    const t = setup();
    const plan = t.plans.create({ projectId: 'api', home: 'ws:main' }, t.claude);
    expect(planPageView(t.store.getState(), plan.id)!.fixAgent).toBeUndefined();
    t.work.setFixAgent(plan.id, STRONG);
    const view = planPageView(t.store.getState(), plan.id)!;
    expect(PlanView.parse(view).fixAgent).toEqual(STRONG);
  });
});

/** The agent for the work, changed while a milestone is at work (TRC-179: paused on a usage limit, picking another agent changed nothing). */
describe('the agent for the work, changed while a milestone is at work', () => {
  it('one mid-turn keeps its agent; paused on a usage limit, it goes to the new agent now and goes on there', async () => {
    const t = setup();
    const plan = await approved(t, ONE, { fix: null });
    const channel = `ws:${await waitFor(() => t.issue('Idempotent webhooks').worktrees.at(-1))}`;
    const toIt = () => t.switched.filter((s) => s.channel === channel);
    const asks = () => t.asked.filter((a) => a.channel === channel).length;
    // Mid-turn: switching would cut the turn, so it keeps its agent.
    t.run(channel, 'started', 'r1');
    expect(t.work.setWorkAgent(plan.id, MID)).toBe('Claude (Sonnet) works what starts next; the milestone already at work keeps its agent');
    expect(toIt()).toEqual([]);
    // Its turn ended on your usage limit: paused until the reset.
    t.run(channel, 'done', 'r1');
    const now = Date.now();
    t.plans.setWatch(plan.id, 'retries', { at: now, reason: 'You hit your Claude plan usage limit', run: 'r1', limitUntil: now + 60 * MIN, line: 'paused: usage limit · resumes at 16:45' });
    const before = asks();
    expect(t.work.setWorkAgent(plan.id, MID)).toBe('Claude (Sonnet) works this plan’s milestones and tasks, the milestone already at work included');
    expect(toIt()).toEqual([{ channel, agent: MID, at: expect.any(Number) }]);
    // It goes on now, on the new agent, instead of waiting for the reset.
    await waitFor(() => asks() > before);
    expect(t.plans.need(plan.id).watch?.retries?.limitUntil).toBeUndefined();
  });
});
