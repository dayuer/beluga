import type { AgentRef } from '../../protocol.js';
import { agentName } from '../../shared/agent-label.js';
import type { Plan } from '../../core/plans/model.js';
import type { PilotDeps } from '../../core/plans/pilot.js';
import type { Routable } from '../../shared/auto-route.js';
import { FINISHED, type MilestoneView } from '../../core/plans/progress.js';
import { handoffsIn, milestoneOfChannel, type WorkVia, workAgentFor, workspaceAgent } from './roles.js';
import { ladderAgents, modelFailed, nextRung } from './ladder.js';

/** What the watchdog says with its ask (watchdog.ts WatchdogDeps.escalate). */
export interface EscalateHow {
  /** Why it stopped, in the watchdog's words: a failed model goes up at once. */
  readonly stall?: string;
  /** It just stopped (the watchdog would wake it where it is). */
  readonly first?: boolean;
  /** It was moved up before, and stopped again. */
  readonly again?: boolean;
}

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
  /** What the fix agent took each milestone's conversation over for (by channel: task ids), so it goes back once they're done. */
  private readonly hard = new Map<string, Set<string>>();
  /** Conflicts the plan's conversation is fixing (by plan: their folders), so one gone doesn't hand it back while another is still there. */
  private readonly fixing = new Map<string, Set<string>>();
  /** Conversations moved up the failure ladder this session (ladder.ts): they stay where they climbed to, not handed back by settle. */
  private readonly climbed = new Set<string>();

  constructor(private readonly deps: PilotDeps) {}

  /**
   * What's hard goes to the plan's fix agent (see PilotDeps.fixer): `channel` is put on it from its
   * next message on, once, for `tasks` (the fix tasks, the task that stopped twice): it stays there
   * until they're done, then the milestone's work goes back to its own agent (settle).
   * → the fixer's name when it was switched now.
   */
  toFixer(plan: Plan, channel: string, what: string, tasks: readonly string[] = []): string | undefined {
    const fixer = this.deps.fixer?.(plan);
    // Handed for something hard now (fix tasks, a conflict): settle hands it back once that's done, ladder or not.
    this.climbed.delete(channel);
    if (fixer && tasks.length) this.hard.set(channel, new Set([...(this.hard.get(channel) ?? []), ...tasks]));
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
    this.hard.delete(channel);
    this.climbed.delete(channel);
  }

  /**
   * A milestone's worktree on the fix agent goes back to the agent its work runs on once what was
   * hard is done: the fix tasks it was given, the task that stopped twice. Coding stays the coding
   * agent's (the plan's Coding, a task's own, auto route's): the fix agent doesn't keep the rest of
   * the milestone. After a daemon restart (what it was given isn't known): the tasks marked as having
   * stopped twice, and while its round's check failed, the fix tasks of that round. Only between
   * turns (`idle`): switching mid-turn would cut it.
   */
  settle(plan: Plan, m: MilestoneView, idle: (channel: string) => boolean): void {
    const at = m.agent;
    const fixer = this.deps.fixer?.(plan);
    if (!at || !fixer || !this.deps.switchAgent) return;
    const channel = `${WS_PREFIX}${at.worktree}`;
    // Moved up the failure ladder: handing it back would put it on the model that failed.
    if (this.climbed.has(channel)) return;
    const on = this.agentOn(channel);
    const known = this.hard.get(channel);
    const stoppedTwice = new Set(Object.entries(plan.watch ?? {}).flatMap(([id, w]) => (w?.escalated ? [id] : [])));
    // Handed over this session, or (after a restart) on the fix agent with what says it was handed: its
    // handoff in the plan's activity (fix tasks, a task that stopped twice), a task of it that stopped
    // twice, or a round started on it for fix tasks. Put there by you: yours.
    // Only what came after its last hand-back counts: once back, a model you put on yourself is yours.
    const back = `what was hard in “${m.milestone.title}” is done:`;
    const lastBack = plan.activity.reduce((t, e) => (e.kind === 'note' && e.text.startsWith(back) ? Math.max(t, e.at) : t), -Infinity);
    const said = handoffsIn(plan.activity, m.milestone.title).some((h) => (h.what === 'fix' || h.what === 'stopped') && h.at > lastBack);
    const startedOnFixer = at.via === 'fix' && lastBack === -Infinity;
    // On the fix agent now, and put there by a handoff (this session, or one the activity or a
    // stopped-twice mark says): switched to another model by you since, it's left where you put it.
    const handed = on === agentKey(fixer) && (this.onFixer.has(channel) || said || startedOnFixer || m.tasks.some((t) => stoppedTwice.has(t.task.id)));
    if (!handed) return;
    const left = m.tasks.filter((t) => (known ?? stoppedTwice).has(t.task.id) && !FINISHED.has(t.state));
    if (left.length || (!known && m.run.check?.verdict === 'fail') || !idle(channel)) return;
    const next = m.tasks.find((t) => t.issue && !FINISHED.has(t.state));
    const { agent: work } = workAgentFor(plan, next?.issue ?? { labels: [], priority: 'none' }, this.deps.store.getState());
    this.hard.delete(channel);
    this.onFixer.delete(channel);
    if (on === (work ? agentKey(work) : undefined)) return;
    this.deps.switchAgent(channel, work);
    const name = work ? agentName(work, { model: true }) : 'your default agent';
    this.deps.plans.note(plan.id, 'note', `what was hard in “${m.milestone.title}” is done: its work is back on ${name}`, { kind: 'beluga' });
  }

  /**
   * The watchdog's ask. `first`: a task just stopped (woken on its own model unless its model failed:
   * then it goes up the ladder at once). Otherwise it stopped again soon after a wake (`again`: it was
   * moved up before). With a ladder (Settings › Auto Route › When a Model Fails, ladder.ts) its
   * conversation goes one rung up, each time, until the top; with none, to the fix agent once, as
   * before. → the new agent's name, or undefined (it stays: woken where it is, or it waits for you).
   */
  escalate(plan: Plan, channel: string, task?: string, how: EscalateHow = {}): string | undefined {
    // Which milestone (BLG-199): the plan page shows each handoff under its own.
    const title = milestoneOfChannel(plan, channel);
    const where = title ? ` in “${title}”` : '';
    const st = this.deps.store.getState();
    const ladder = ladderAgents(st.prefs.autoRoute, st.runtimes);
    if (!ladder.length) {
      if (how.first || how.again) return undefined;
      return this.toFixer(plan, channel, `${channel.startsWith(WS_PREFIX) ? 'a task that stopped twice' : 'a stuck conversation'}${where}`, task ? [task] : []);
    }
    const failed = modelFailed(how.stall);
    if (how.first && !failed) return undefined;
    if (!this.deps.switchAgent) return undefined;
    const current = channel.startsWith(WS_PREFIX) ? workspaceAgent(this.deps.store.getState().projects.flatMap((p) => p.workspaces).find((w) => w.id === channel.slice(WS_PREFIX.length))) : this.deps.homeAgent?.(plan);
    const next = nextRung(ladder, current, st.prefs.model);
    if (!next) return undefined;
    this.deps.switchAgent(channel, next);
    // Up the ladder, not handed for something hard: settle doesn't hand it back (to the model that failed).
    this.climbed.add(channel);
    const name = agentName(next, { model: true });
    const what = !channel.startsWith(WS_PREFIX) ? 'a stuck conversation' : failed ? 'a task whose model failed' : 'a task that stopped twice';
    this.deps.plans.note(plan.id, 'note', `handed ${what}${where} to ${name}`, { kind: 'beluga' });
    return name;
  }

  /**
   * Who a milestone's worktree starts on (roles.ts workAgentFor: Start with…, its first task's own,
   * the fix agent after a failed check, the plan's, auto route's, your default), and why. Its fix
   * tasks going straight to the fix agent are a handoff too: a line in the activity.
   */
  workAgent(plan: Plan, title: string, failed: boolean, task: Routable & { readonly agent?: AgentRef }, pick?: AgentRef): { readonly agent?: AgentRef; readonly via: WorkVia } {
    const got = workAgentFor(plan, task, this.deps.store.getState(), pick, failed ? this.deps.fixer?.(plan) : undefined);
    if (got.via === 'fix' && got.agent) this.deps.plans.note(plan.id, 'note', `handed the fix tasks for “${title}” to ${agentName(got.agent, { model: true })}`, { kind: 'beluga' });
    return got;
  }

  /** The agent a conversation runs on now (its key), as kept on its workspace. */
  private agentOn(channel: string): string | undefined {
    const id = channel.startsWith(WS_PREFIX) ? channel.slice(WS_PREFIX.length) : undefined;
    // Its model kept apart on the workspace (the manager's agentFields): put back, so “on it already” compares models too.
    const agent = id ? workspaceAgent(this.deps.store.getState().projects.flatMap((p) => p.workspaces).find((w) => w.id === id)) : undefined;
    return agent ? agentKey(agent) : undefined;
  }
}
