/**
 * Auto accept (fork): which tasks it started, read off the board itself, so a restart still
 * knows them and no queue file is kept. Auto accept starts a task as "<you>'s Claude, for <the
 * one who gave it>" (`autoActor`); work.start writes the Ready → In Progress line with that actor
 * (work.ts `opts.by`). A task you start by hand says you; one your Claude starts for you has no `for`.
 */
import { type Activity, type Actor, type Issue, worktreeDoing } from '../../core/board/model.js';

/** The actor auto accept starts a task as: this computer's Claude, working for whoever gave it. */
export function autoActor(self: string, selfName: string, assigner: string, assignerName: string): Actor {
  return { kind: 'claude', owner: self, ownerName: selfName, for: { id: assigner, name: assignerName.slice(0, 64) } };
}

const isAutoLine = (a: Activity, self: string): boolean =>
  a.kind === 'status' && a.by.kind === 'claude' && a.by.owner === self && a.by.for !== undefined && a.by.for.id !== self && a.by.external === undefined;

/** Auto accept started it here (once, at any time). */
export function isAutoStarted(issue: Pick<Issue, 'activity'>, self: string): boolean {
  return issue.activity.some((a) => isAutoLine(a, self));
}

/** Auto accept started it and it's still under way here: it takes one of the `atOnce` places. */
export function isAutoRunning(issue: Issue, self: string, live: (workspaceId: string) => boolean): boolean {
  return issue.status === 'in_progress' && isAutoStarted(issue, self) && worktreeDoing(issue, live) !== undefined;
}
