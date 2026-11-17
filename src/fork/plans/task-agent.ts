import type { AgentRef } from '../../protocol.js';
import { agentName } from '../../shared/agent-label.js';

/**
 * Fork: the model a plan's task card shows (Mac, packages/mac/src/fork/plans/TaskAgentChip.tsx).
 * Read from what upstream's plans already keep, nothing of its own: the builder (`Plan.agent`,
 * BLG-982), a task's own agent, and the workspace a task runs in. Browser-safe.
 */

/** A workspace as the store keeps it: its agent without the model, the model beside it (the manager's agentFields). */
type SeenWorkspace = { readonly id: string; readonly agent?: AgentRef; readonly model?: string };

export interface TaskAgentState {
  readonly projects: ReadonlyArray<{ readonly id: string; readonly name: string; readonly workspaces: ReadonlyArray<SeenWorkspace> }>;
  readonly prefs: { readonly projectAgents?: Readonly<Record<string, AgentRef>> };
}

export interface TaskAgentSeen {
  /** The agent and model; none: nothing to show (your default agent works it, or it's yours to do). */
  readonly agent?: AgentRef;
  /** It's at work (its worktree's agent), or not yet (who will work it). */
  readonly ran: boolean;
}

/** A workspace's agent with its model put back (none: your default agent). */
export const workspaceAgent = (w: SeenWorkspace | undefined): AgentRef | undefined => (w?.agent ? { ...w.agent, ...(w.model ? { model: w.model } : {}) } : undefined);

/**
 * Who a task card names. At work: its worktree's agent now (changing it in that conversation shows
 * here). Not yet: the agent it will start on, in upstream's order (`PlanPilot`: the task's own, else
 * the plan's builder), else its project's agent; none of those: nothing (your default). A task that's
 * yours to do (`forYou`) names no agent. Without `plan` (the canvas), only one at work shows.
 */
export function taskAgentSeen(
  plan: { readonly agent?: AgentRef; readonly projectId: string } | undefined,
  t: { readonly worktree?: string; readonly forYou?: boolean; readonly issue?: { readonly agent?: AgentRef } },
  st: TaskAgentState,
): TaskAgentSeen {
  if (t.forYou) return { ran: false };
  if (t.worktree) {
    const w = st.projects.flatMap((p) => p.workspaces).find((x) => x.id === t.worktree);
    if (w) {
      const agent = workspaceAgent(w);
      return { ...(agent ? { agent } : {}), ran: true };
    }
  }
  if (!plan) return { ran: false };
  const project = st.projects.find((p) => p.id === plan.projectId)?.name;
  const own = t.issue?.agent ?? plan.agent ?? (project ? st.prefs.projectAgents?.[project] : undefined);
  return { ...(own ? { agent: own } : {}), ran: false };
}

/** Its words on the card: the agent, with its model when one is known ("Claude (Haiku)"), as upstream names a plan's agents. */
export const taskAgentWords = (agent: AgentRef): string => agentName(agent, { model: true });
