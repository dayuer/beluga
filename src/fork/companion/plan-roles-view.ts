import { z } from 'zod';

/**
 * Fork (1.55, BLG-199): who did each part of a plan's milestone, on the phone's plan page (read
 * only): src/fork/plans/roles.ts says it, src/companion/views.ts sends it. zod only, like
 * protocol.ts; its agents have AgentRefView's shape (kept here so protocol.ts imports one way).
 */
const Agent = z.object({ runtime: z.string().max(32), model: z.string().max(64).optional(), label: z.string().max(64) });

export const RoleSeenView = z.object({
  /** off (not set), waiting (set, not begun), skipped (it started without it), on (at it or done). */
  state: z.string().max(20),
  agent: Agent.optional(),
  /** It ran on your default agent. */
  mine: z.boolean().optional(),
  /** What the plan sets now, and that its work is on auto route. */
  set: Agent.optional(),
  auto: z.boolean().optional(),
  /** Why what ran isn't what's set: pick, task, fix, default, changed. */
  why: z.string().max(20).optional(),
  /** Hard fixes: each handoff to the fix agent (what: fix, stopped, stuck, conflict; to: its name). */
  handoffs: z.array(z.object({ at: z.number(), what: z.string().max(20), to: z.string().max(80) })).max(20).optional(),
});
export type RoleSeenView = z.infer<typeof RoleSeenView>;

export const MilestoneRolesView = z.object({ arch: RoleSeenView, work: RoleSeenView, check: RoleSeenView, fix: RoleSeenView });
export type MilestoneRolesView = z.infer<typeof MilestoneRolesView>;
