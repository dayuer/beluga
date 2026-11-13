import type { AgentRef } from '../../protocol.js';
import { agentName } from '../../shared/agent-label.js';
import type { Plan } from '../../core/plans/model.js';
import type { PilotDeps } from '../../core/plans/pilot.js';

/**
 * Fork (plan roles, PR #17 and #20): what's hard in a plan goes to its fix agent (PilotDeps.fixer):
 * fix tasks after a failed check, a conflict, a task that stopped twice. Moved out of pilot.ts as it
 * was (docs/fork.md, min-conflict): the pilot keeps one of these and calls it where a conflict comes
 * and goes, where fix tasks are handed over, and for the watchdog's escalation.
 */

const WS_PREFIX = 'ws:';

/** An agent as one string (its runtime and model), to tell whether a conversation is on it already. */
const agentKey = (a: AgentRef): string => `${a.runtime}:${a.model ?? ''}`;

export class PlanFixer {
  /** Conversations put on the plan's fix agent this session (by channel: the agent's key), so each is switched once. */
  private readonly onFixer = new Map<string, string>();
  /** Conflicts the plan's conversation is fixing (by plan: their folders), so one gone doesn't hand it back while another is still there. */
  private readonly fixing = new Map<string, Set<string>>();

  constructor(private readonly deps: PilotDeps) {}

  /**
   * What's hard goes to the plan's fix agent (see PilotDeps.fixer): `channel` is put on it from its
   * next message on, once (it stays there). → the fixer's name when it was switched now.
   */
  toFixer(plan: Plan, channel: string, what: string): string | undefined {
    const fixer = this.deps.fixer?.(plan);
    if (!fixer || !this.deps.switchAgent || this.onFixer.get(channel) === agentKey(fixer)) return undefined;
    this.onFixer.set(channel, agentKey(fixer));
    // Already on it (it was switched before the daemon restarted): nothing to hand over.
    if (this.agentOn(channel) === agentKey(fixer)) return undefined;
    this.deps.switchAgent(channel, fixer);
    const name = agentName(fixer, { model: true });
    this.deps.plans.note(plan.id, 'note', `handed ${what} to ${name}`, { kind: 'beluga' });
    return name;
  }

  /** The plan's conversation may fix a conflict in `dir` (it goes to the fix agent). */
  fixupIn(plan: Plan, dir: string): void {
    const open = this.fixing.get(plan.id) ?? new Set<string>();
    this.fixing.set(plan.id, open.add(dir));
    this.deps.allowFixup?.(plan.home, dir);
    this.toFixer(plan, plan.home, 'the conflict');
  }

  /**
   * The conflict in `dir` is gone (undefined: it never came, the step failed another way). Another
   * still there: the conversation stays on the fix agent, fixing that one. None: back on the agent it
   * plans on, also when it was put on the fix agent before the daemon restarted.
   */
  fixedIn(plan: Plan, dir: string | undefined): void {
    const open = this.fixing.get(plan.id);
    if (dir) open?.delete(dir);
    const next = open ? [...open].at(-1) : undefined;
    this.deps.allowFixup?.(plan.home, next);
    if (next) return;
    this.fixing.delete(plan.id);
    const fixer = this.deps.fixer?.(plan);
    const home = this.deps.homeAgent?.(plan);
    const on = this.agentOn(plan.home);
    const put = this.onFixer.delete(plan.home) || (fixer !== undefined && on === agentKey(fixer));
    if (put && !(on && home && on === agentKey(home))) this.deps.switchAgent?.(plan.home, home);
  }

  /** The conversation was put on another agent by you (Agent for Its Work): no longer on the fix agent. */
  forget(channel: string): void {
    this.onFixer.delete(channel);
  }

  /** The watchdog's ask (a task stopped again soon after a wake): its conversation goes to the fix agent. → its name, or undefined (no fix agent, or it's on it already). */
  escalate(plan: Plan, channel: string): string | undefined {
    return this.toFixer(plan, channel, `${channel.startsWith(WS_PREFIX) ? 'a task that stopped twice' : 'a stuck conversation'}`);
  }

  /** The agent a conversation runs on now (its key), as kept on its workspace. */
  private agentOn(channel: string): string | undefined {
    const id = channel.startsWith(WS_PREFIX) ? channel.slice(WS_PREFIX.length) : undefined;
    const agent = id ? this.deps.store.getState().projects.flatMap((p) => p.workspaces).find((w) => w.id === id)?.agent : undefined;
    return agent ? agentKey(agent) : undefined;
  }
}
