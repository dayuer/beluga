import type { Plan, PlanMilestone, PlanTask } from '../core/plans/model.js';
import { hiddenFromCustomer } from './decisions.js';

/**
 * A draft against the plan it changes (docs/studio-gates.md §3.3, §6; design §4.5).
 *
 * A customer's changes never go straight to the board: the planning agent revises the draft, the
 * customer applies it (an "apply the changes" Gate, bound to the draftRev they saw) or discards it.
 * The Gate's card and the customer's diff card both need the same numbers, worked out here, and
 * always on what the customer may see: your own tasks (accounts, keys…) aren't in them.
 */

export interface ChangesSummary {
  /** What the draft adds, and what the new tasks are estimated at (the Gate card's numbers). */
  readonly added: { readonly milestones: number; readonly tasks: number; readonly points: number };
  readonly changed: { readonly milestones: number; readonly tasks: number };
  readonly removed: { readonly milestones: number; readonly tasks: number };
}

const milestoneWords = (m: PlanMilestone): string => [m.goal ?? '', ...m.criteria].filter(Boolean).join('\n');
const taskWords = (t: PlanTask): string => [t.goal ?? '', ...t.acceptance].filter(Boolean).join('\n');

/** What the plan's draft changes, in numbers; undefined when there is no draft to compare. */
export function changesSummary(plan: Plan): ChangesSummary | undefined {
  if (!plan.body || !plan.draft) return undefined;
  const body = plan.body;
  const draft = plan.draft;
  const oldMilestones = new Map(body.milestones.map((m) => [m.id, m]));
  const newMilestones = new Map(draft.milestones.map((m) => [m.id, m]));
  const visible = (t: PlanTask): boolean => !hiddenFromCustomer(t);
  const oldTasks = new Map(body.milestones.flatMap((m) => m.tasks.filter(visible).map((t) => [t.id, t] as const)));
  const newTasks = new Map(draft.milestones.flatMap((m) => m.tasks.filter(visible).map((t) => [t.id, t] as const)));

  let addedMilestones = 0;
  let changedMilestones = 0;
  let addedTasks = 0;
  let changedTasks = 0;
  let points = 0;
  for (const m of draft.milestones) {
    const was = oldMilestones.get(m.id);
    if (!was) addedMilestones++;
    else if (was.title !== m.title || milestoneWords(was) !== milestoneWords(m)) changedMilestones++;
  }
  for (const t of newTasks.values()) {
    const was = oldTasks.get(t.id);
    if (!was) {
      addedTasks++;
      points += t.estimate ?? 0;
    } else if (was.title !== t.title || taskWords(was) !== taskWords(t)) changedTasks++;
  }
  let removedMilestones = 0;
  for (const m of body.milestones) if (!newMilestones.has(m.id)) removedMilestones++;
  let removedTasks = 0;
  for (const t of oldTasks.values()) if (!newTasks.has(t.id)) removedTasks++;

  return {
    added: { milestones: addedMilestones, tasks: addedTasks, points },
    changed: { milestones: changedMilestones, tasks: changedTasks },
    removed: { milestones: removedMilestones, tasks: removedTasks },
  };
}
