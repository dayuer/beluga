import { describe, expect, it } from 'vitest';
import type { AgentRef } from '../src/protocol.js';
import { taskAgentSeen, taskAgentWords } from '../src/fork/plans/task-agent.js';

/** Fork: the model a plan's task card names (src/fork/plans/task-agent.ts), on upstream's plan roles. */

const HAIKU: AgentRef = { runtime: 'claude', label: 'Claude', model: 'haiku' };
const CLAUDE: AgentRef = { runtime: 'claude', label: 'Claude' };
const CODEX: AgentRef = { runtime: 'codex', label: 'Codex' };
const OPUS: AgentRef = { runtime: 'claude', label: 'Claude', model: 'opus' };

// As the store keeps a workspace: its agent without the model, the model beside it.
const st = (opts: { worktree?: AgentRef; projectAgent?: AgentRef } = {}) => ({
  projects: [
    {
      id: 'api',
      name: 'bob-api',
      workspaces: [{ id: 'w1', ...(opts.worktree ? { agent: { runtime: opts.worktree.runtime, label: opts.worktree.label }, ...(opts.worktree.model ? { model: opts.worktree.model } : {}) } : {}) }],
    },
  ],
  prefs: opts.projectAgent ? { projectAgents: { 'bob-api': opts.projectAgent } } : {},
});
const plan = (agent?: AgentRef) => ({ projectId: 'api', ...(agent ? { agent } : {}) });

describe('a task card’s model', () => {
  it('at work: its worktree’s agent and model, whatever the plan says', () => {
    expect(taskAgentSeen(plan(CODEX), { worktree: 'w1' }, st({ worktree: HAIKU }))).toEqual({ agent: HAIKU, ran: true });
    // On your default agent there: nothing to name.
    expect(taskAgentSeen(plan(CODEX), { worktree: 'w1' }, st())).toEqual({ ran: true });
  });

  it('not yet: the task’s own agent, else the plan’s builder, else the project’s agent, else nothing', () => {
    expect(taskAgentSeen(plan(CODEX), { issue: { agent: OPUS } }, st({ projectAgent: CLAUDE }))).toEqual({ agent: OPUS, ran: false });
    expect(taskAgentSeen(plan(CODEX), {}, st({ projectAgent: CLAUDE }))).toEqual({ agent: CODEX, ran: false });
    expect(taskAgentSeen(plan(), {}, st({ projectAgent: HAIKU }))).toEqual({ agent: HAIKU, ran: false });
    expect(taskAgentSeen(plan(), {}, st())).toEqual({ ran: false });
  });

  it('a task that’s yours to do names no agent', () => {
    expect(taskAgentSeen(plan(CODEX), { forYou: true }, st())).toEqual({ ran: false });
  });

  it('without the plan (the canvas), only one at work shows', () => {
    expect(taskAgentSeen(undefined, {}, st({ projectAgent: HAIKU }))).toEqual({ ran: false });
    expect(taskAgentSeen(undefined, { worktree: 'w1' }, st({ worktree: HAIKU }))).toEqual({ agent: HAIKU, ran: true });
  });

  it('is named as upstream names a plan’s agents: the agent, with its model when one is known', () => {
    expect(taskAgentWords(HAIKU)).toBe('Claude (Haiku)');
    expect(taskAgentWords(CODEX)).toBe('Codex');
  });
});
