import { describe, expect, it } from 'vitest';
import type { RuntimeChoice } from '../src/shared/agent-runtimes.js';
import { AutoRoute, LADDER_DEFAULT, tierList } from '../src/shared/auto-route.js';
import { ladderAgents, modelFailed, nextRung } from '../src/fork/plans/ladder.js';
import type { AgentRef } from '../src/protocol.js';
import { Store, initialState } from '../src/core/store.js';
import type { Plan } from '../src/core/plans/model.js';
import type { PilotDeps } from '../src/core/plans/pilot.js';
import type { MilestoneView } from '../src/core/plans/progress.js';
import { PlanFixer } from '../src/fork/plans/fixer.js';

/** The failure ladder's own rules (fork/plans/ladder.ts); the watchdog's use of it is in plan-fix-agent.test.ts. */

const claude = (model: string): AgentRef => ({ runtime: 'claude', label: 'Claude', model });
const RUNTIMES = [
  { id: 'claude', label: 'Claude', available: true },
  { id: 'local', label: 'Local model', available: true, models: [{ value: 'deepseek/deepseek-v4-1-flash-261017', label: 'DeepSeek' }] },
] as unknown as RuntimeChoice[];

describe('the failure ladder', () => {
  it('defaults to Haiku, Sonnet, Opus, Fable; yours replaces it; an empty one is none', () => {
    expect(LADDER_DEFAULT).toEqual(['claude:haiku', 'claude:sonnet', 'claude:opus', 'claude:fable']);
    expect(tierList('ladder', undefined)).toEqual(LADDER_DEFAULT);
    expect(tierList('ladder', { ladder: ['claude:opus'] })).toEqual(['claude:opus']);
    expect(ladderAgents({ ladder: [] }, RUNTIMES)).toEqual([]);
    expect(AutoRoute.safeParse({ ladder: ['local:deepseek/deepseek-v4-1-flash-261017', 'claude:haiku'] }).success).toBe(true);
    expect(AutoRoute.safeParse({ ladder: ['not a choice'] }).success).toBe(false);
  });

  it('keeps only the rungs that run here, in order', () => {
    const ladder = ladderAgents({ ladder: ['local:deepseek/deepseek-v4-1-flash-261017', 'local:deepseek/gone', 'codex:gpt', 'claude:haiku'] }, RUNTIMES);
    expect(ladder).toEqual([{ runtime: 'local', label: 'Local model', model: 'deepseek/deepseek-v4-1-flash-261017' }, claude('haiku')]);
  });

  it('goes one rung up; a model not on it counts as below them all; the top has none above', () => {
    const ladder = [claude('haiku'), claude('sonnet'), claude('opus'), claude('fable')];
    expect(nextRung(ladder, undefined)).toEqual(claude('haiku'));
    expect(nextRung(ladder, { runtime: 'local', label: 'Local model', model: 'deepseek/deepseek-flash' })).toEqual(claude('haiku'));
    expect(nextRung(ladder, claude('haiku'))).toEqual(claude('sonnet'));
    // Claude's alias and its full id are the same rung.
    expect(nextRung(ladder, claude('claude-sonnet-5-5'))).toEqual(claude('opus'));
    expect(nextRung(ladder, claude('fable'))).toBeUndefined();
    expect(nextRung([], claude('haiku'))).toBeUndefined();
  });

  it('Claude with no model of its own is on your default model; a Claude model off the ladder only goes up, never down', () => {
    const ladder = [claude('haiku'), claude('sonnet'), claude('opus'), claude('fable')];
    const yourDefault: AgentRef = { runtime: 'claude', label: 'Claude' };
    expect(nextRung(ladder, yourDefault, 'sonnet')).toEqual(claude('opus'));
    expect(nextRung(ladder, yourDefault, 'claude-opus-5-5')).toEqual(claude('fable'));
    // Its strength unknown (no default model set): it stays, not sent down to Haiku.
    expect(nextRung(ladder, yourDefault)).toBeUndefined();
    // A ladder without Opus: Opus goes to the first stronger rung, not back to Haiku.
    expect(nextRung([claude('haiku'), claude('sonnet'), claude('fable')], claude('opus'))).toEqual(claude('fable'));
    expect(nextRung([claude('haiku'), claude('sonnet')], claude('opus'))).toBeUndefined();
  });

  it('a local model on the ladder is a rung of its own, by its exact model', () => {
    const deepseek: AgentRef = { runtime: 'local', label: 'Local model', model: 'deepseek/deepseek-v4-1-flash-261017' };
    const ladder = [deepseek, claude('haiku')];
    expect(nextRung(ladder, deepseek)).toEqual(claude('haiku'));
    expect(nextRung(ladder, { ...deepseek, model: 'deepseek/other' })).toEqual(deepseek);
  });

  it('climbed to the fix agent’s own model, it isn’t handed back to the model that failed once the task is done', () => {
    const CHEAP: AgentRef = { runtime: 'local', label: 'Local model', model: 'deepseek/deepseek-flash' };
    const make = () => {
      const store = new Store(initialState('room'));
      store.dispatch({ type: 'prefs', prefs: { autoRoute: { ladder: ['claude:opus'] } } });
      const put = (agent: AgentRef | undefined): void =>
        store.dispatch({ type: 'projects', projects: [{ id: 'api', name: 'api', root: '/tmp/api', base: 'main', workspaces: [{ id: 'w9', projectId: 'api', name: 'w9', path: '/tmp/w9', kind: 'worktree', ...(agent ? { agent: { runtime: agent.runtime, label: agent.label }, model: agent.model } : {}) }] }] as never });
      put(CHEAP);
      const switched: Array<AgentRef | undefined> = [];
      const fixer = new PlanFixer({ store, fixer: () => claude('opus'), switchAgent: (_c: string, a: AgentRef | undefined) => (switched.push(a), put(a)), plans: { note: () => undefined } } as unknown as PilotDeps);
      return { fixer, switched };
    };
    const plan = { id: 'p', agent: CHEAP, activity: [], watch: { t1: { escalated: true } }, runs: { safe: { agent: { worktree: 'w9', at: 0, tasks: ['t1'] } } }, body: { milestones: [{ id: 'safe', title: 'Safe payments' }] } } as unknown as Plan;
    const done = { agent: { worktree: 'w9', at: 0, tasks: ['t1'], via: 'plan' }, milestone: { id: 'safe', title: 'Safe payments' }, tasks: [{ task: { id: 't1' }, state: 'done', issue: { labels: [], priority: 'none' } }], run: {} } as unknown as MilestoneView;
    const climbing = make();
    expect(climbing.fixer.escalate(plan, 'ws:w9', 't1', { first: true, stall: 'Anthropic\'s API failed: no such model' })).toBe('Claude (Opus)');
    climbing.fixer.settle(plan, done, () => true);
    expect(climbing.switched).toEqual([claude('opus')]);
    // The same worktree on the fix agent's model by a handoff (not a climb) is handed back, as before.
    const handed = make();
    handed.fixer.toFixer(plan, 'ws:w9', 'a task that stopped twice', ['t1']);
    handed.fixer.settle(plan, done, () => true);
    expect(handed.switched).toEqual([claude('opus'), CHEAP]);
  });

  it('a failed model is an API refusal or a sign-in; a usage limit, a lost connection or an overloaded API isn’t', () => {
    expect(modelFailed('Anthropic\'s API failed: There’s an issue with the selected model (deepseek-flash). It may not exist')).toBe(true);
    expect(modelFailed('Claude Code isn’t signed in on this Mac')).toBe(true);
    expect(modelFailed('Claude Code’s sign-in on this Mac expired')).toBe(true);
    expect(modelFailed('Anthropic\'s API failed: overloaded')).toBe(false);
    expect(modelFailed('You hit your Claude plan usage limit · resets at 15:00')).toBe(false);
    expect(modelFailed('Claude Code lost its connection to Anthropic')).toBe(false);
    expect(modelFailed('it ended its turn without handing off')).toBe(false);
    expect(modelFailed(undefined)).toBe(false);
  });
});
