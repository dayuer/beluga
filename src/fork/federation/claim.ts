/**
 * The pool (fork, milestone 2): which Ready tasks labelled with the pool label this computer may
 * claim, and which it has claimed and not yet confirmed. Pure: reads only synced fields (assignee,
 * status, labels, working.<peer>), never the board, settings, a clock or a random source; the
 * caller passes those in. Pending ones are read off the board, so a restart between claim and
 * confirm finds them again.
 */
import { type Issue, listOrder } from '../../core/board/model.js';
import { type EligibleCtx, eligibleCore, poolGiverOf } from './eligible.js';
import type { FederationAccept } from './settings.js';

export interface ClaimCtx extends EligibleCtx {
  readonly accept: FederationAccept;
  readonly poolLabel: string;
}

const ordered = (issues: readonly Issue[]): Issue[] => [...issues].sort(listOrder);

/** Every rule but who it's for, given by whoever labelled it; capacity is counted by the callers. */
function poolOk(issue: Issue, ctx: ClaimCtx): boolean {
  if (!issue.labels.includes(ctx.poolLabel)) return false;
  return eligibleCore(issue, { ...ctx, running: 0 }, poolGiverOf(ctx.sharedOf(issue.id)), { selfOk: true }).ok;
}

/** Claimed by this computer and not started yet: they hold a place each. */
export function pickPending(issues: readonly Issue[], ctx: ClaimCtx): Issue[] {
  if (ctx.accept !== 'pool') return [];
  return ordered(issues).filter((i) => i.assignee?.id === ctx.self && ctx.sharedOf(i.id)?.fields.assignee?.a === ctx.self && poolOk(i, ctx));
}

/** Free pool tasks to claim now, in board order, as many as places left after running and pending. */
export function pickClaimable(issues: readonly Issue[], ctx: ClaimCtx): Issue[] {
  if (ctx.accept !== 'pool') return [];
  const room = Math.max(0, ctx.atOnce - ctx.running - pickPending(issues, ctx).length);
  return ordered(issues).filter((i) => !i.assignee && poolOk(i, ctx)).slice(0, room);
}

/** After a claim, wait this long plus up to the jitter before confirming: the board has time to merge a rival claim. */
export const CONFIRM_MIN_MS = 3_000;
export const CONFIRM_JITTER_MS = 4_000;

/** How long to wait before confirming a claim, in [CONFIRM_MIN_MS, CONFIRM_MIN_MS + CONFIRM_JITTER_MS). `random` is injected. */
export function confirmDelay(random: () => number): number {
  const r = Math.min(Math.max(random(), 0), 1 - Number.EPSILON);
  return CONFIRM_MIN_MS + Math.floor(r * CONFIRM_JITTER_MS);
}

/** Whether the claim held: the board still says this computer has it. */
export function stillMine(issue: Pick<Issue, 'assignee'> | undefined, self: string): boolean {
  return issue?.assignee?.id === self;
}
