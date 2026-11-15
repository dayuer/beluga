/**
 * Auto accept (fork): may this task start by itself on this computer? A pure function over the
 * task, its shared copy and what the caller says (who we are, whom we trust, how many run). The
 * one who gave it is read off the board (`fields.assignee.a`: the Mac that last set who it's for),
 * so it holds after a restart too. Never reads settings, never touches the board or work.start.
 */
import { type Issue, type IssueStatus, isArchived } from '../../core/board/model.js';
import type { SharedTask } from '../../core/team/crdt.js';
import type { TrustLevel } from '../../shared/settings-schema.js';

/** Why it may not start: the first rule it breaks, in the order they're checked. Milestone 2 reuses these names. */
export type Why = 'assignee' | 'status' | 'scope' | 'not-team' | 'self-assigned' | 'blocked' | 'worktree' | 'working' | 'trust' | 'capacity';

export interface EligibleCtx {
  /** This computer's peer id. */
  readonly self: string;
  /** The team's copy of a task (TeamBoardSync.shared); undefined: not a team task. */
  readonly sharedOf: (id: string) => SharedTask | undefined;
  readonly trustOf: (peerId: string) => TrustLevel;
  /** Whose tasks may start: people you fully trust, or anyone you trust. */
  readonly from: 'full' | 'trusted';
  /** Tasks auto accept started that are running now. */
  readonly running: number;
  readonly atOnce: number;
  /** A blocker's status (undefined: not on this board). */
  readonly statusOf: (id: string) => IssueStatus | undefined;
}

export type Eligible = { readonly ok: true } | { readonly ok: false; readonly why: Why };

/** Who gave the task: the peer that last set its assignee on the team board. */
export function assignerOf(shared: SharedTask | undefined): string | undefined {
  return shared?.fields.assignee?.a;
}

const no = (why: Why): Eligible => ({ ok: false, why });

export function eligible(issue: Issue, ctx: EligibleCtx): Eligible {
  if (issue.assignee?.id !== ctx.self) return no('assignee');
  if (issue.status !== 'todo') return no('status');
  if (issue.private || isArchived(issue) || issue.plan) return no('scope');
  const shared = ctx.sharedOf(issue.id);
  const assigner = assignerOf(shared);
  if (!shared || assigner === undefined) return no('not-team');
  // Before trust: trustOf says 'full' for ourselves.
  if (assigner === ctx.self) return no('self-assigned');
  if (issue.blockedBy.some((b) => {
    const s = ctx.statusOf(b);
    return s !== 'done' && s !== 'in_review';
  })) return no('blocked');
  if (issue.worktrees.length > 0) return no('worktree');
  for (const [name, f] of Object.entries(shared.fields)) {
    if (name.startsWith('working.') && name !== `working.${ctx.self}` && f.v === true) return no('working');
  }
  const t = ctx.trustOf(assigner);
  if (!(t === 'full' || (ctx.from === 'trusted' && t === 'trusted'))) return no('trust');
  if (ctx.running >= ctx.atOnce) return no('capacity');
  return { ok: true };
}
