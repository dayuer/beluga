import { describe, expect, it } from 'vitest';
import { Board } from '../src/core/board/board.js';
import { BoardWork } from '../src/core/board/work.js';
import { DEFAULT_AUTONOMY } from '../src/core/plans/model.js';
import { Plans } from '../src/core/plans/plans.js';
import { PlansWork } from '../src/core/plans/work.js';
import { Store, initialState } from '../src/core/store.js';
import type { WorkspaceController } from '../src/core/workspace-controller.js';
import type { RuntimeChoice } from '../src/shared/agent-runtimes.js';
import { AutoRoute, autoAutonomy, autoChecker, autoTierOf } from '../src/shared/auto-route.js';
import type { Workspace } from '../src/workspaces/types.js';

/** Auto route (fork) for plans: a plan's big tasks go hard, Opus checks its milestones, and a new plan runs on autopilot. */

const model = (value: string) => ({ value, label: value, description: '' });
const LOCAL: RuntimeChoice = { id: 'local', label: 'Local model', available: true, models: [model('bigmodel/glm-5.3[1m]'), model('anthropic/claude-opus-5-5')] };
const CLAUDE: RuntimeChoice = { id: 'claude', label: 'Claude', available: true };

describe('a plan’s big tasks are hard', () => {
  it('5 points or more (a plan writer’s sizes are 1, 2, 3 and 5); your own threshold, or 0 for never', () => {
    expect(autoTierOf({ labels: [], priority: 'none', estimate: 5 }, undefined)).toBe('hard');
    expect(autoTierOf({ labels: [], priority: 'none', estimate: 3 }, undefined)).toBe('build');
    expect(autoTierOf({ labels: [], priority: 'none' }, undefined)).toBe('build');
    expect(autoTierOf({ labels: [], priority: 'none', estimate: 3 }, { hardEstimate: 3 })).toBe('hard');
    expect(autoTierOf({ labels: [], priority: 'none', estimate: 8 }, { hardEstimate: 0 })).toBe('build');
    expect(AutoRoute.safeParse({ hardEstimate: 9 }).success).toBe(false);
  });
});

describe('who checks a plan nobody named a checker for', () => {
  it('the hard list’s first that runs here (Opus); auto route off or nothing runs: none (as before)', () => {
    expect(autoChecker({ prefs: {}, runtimes: [CLAUDE, LOCAL] })).toEqual({ runtime: 'local', label: 'Local model', model: 'anthropic/claude-opus-5-5' });
    expect(autoChecker({ prefs: { autoRoute: { on: true } }, runtimes: [CLAUDE] })).toEqual({ runtime: 'claude', label: 'Claude', model: 'opus' });
    expect(autoChecker({ prefs: { autoRoute: { on: false } }, runtimes: [CLAUDE, LOCAL] })).toBeUndefined();
    expect(autoChecker({ prefs: {}, runtimes: [CLAUDE] })).toBeUndefined();
  });
});

describe('a new plan runs on autopilot', () => {
  const ws = (id: string, projectId: string, name: string): Workspace => ({ id, projectId, name, path: `/tmp/${name}`, kind: 'chat', projectRoot: '/tmp/p', createdAt: 0, external: false, askOnly: true }) as unknown as Workspace;
  function setup(runtimes: readonly RuntimeChoice[]) {
    const store = new Store(initialState('room'));
    store.dispatch({ type: 'projects', projects: [{ id: 'api', name: 'bob-api', root: '/tmp/bob-api', base: 'main', workspaces: [ws('home', 'api', 'bob-api'), ws('home2', 'api', 'bob-api-2')] }] });
    store.dispatch({ type: 'runtimes', runtimes });
    const controller = { onWorktree: () => () => undefined, manager: { setAgent: () => undefined } } as unknown as WorkspaceController;
    const board = new Board({ store, dir: null, projectName: () => 'bob-api' });
    const boardWork = new BoardWork({ store, board, controller, selfId: () => 'p-me', selfName: () => 'Kay', askClaude: () => undefined });
    const plans = new Plans({ store, dir: null });
    const work = new PlansWork({ store, plans, board: boardWork, controller, askClaude: () => 'ask', intend: () => undefined, delayMs: 0, git: null });
    return { store, work };
  }

  it('with auto route on: autopilot unless you asked for another; off: the plans’ default', () => {
    expect(autoAutonomy({ prefs: {}, runtimes: [CLAUDE, LOCAL] })).toBe('autopilot');
    const on = setup([CLAUDE, LOCAL]);
    expect(on.work.here('ws:home').autonomy).toBe('autopilot');
    expect(on.work.here('ws:home2', 'step').autonomy).toBe('step');
    const off = setup([CLAUDE]);
    expect(off.work.here('ws:home').autonomy).toBe(DEFAULT_AUTONOMY);
  });
});
