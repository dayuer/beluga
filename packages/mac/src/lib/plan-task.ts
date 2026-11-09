import type { AppState } from '../../../../src/core/store.js';
// Relative (not @beluga/…), so the root's unit tests can load it (as lib/plan-merge.ts and sheets.ts).
import { planTitle } from '../../../../src/core/plans/model.js';
import { planOwnerOf } from '../../../../src/core/plans/owner.js';
import type { UiAction } from '../../../../src/ui/workspace-models.js';
import { confirmMerge } from './plan-merge.js';
import { openSheet } from './sheets.js';
import { t } from '../i18n/index.js';

/** A plan's task worktree: open its task or its plan, or merge it by hand after a warning. */
export type PlanAction = 'open_task' | 'open_plan' | 'merge_anyway';

export const isPlanAction = (a: string): a is PlanAction => a === 'open_task' || a === 'open_plan' || a === 'merge_anyway';

/**
 * Opening a plan task's task or plan; merging one by hand asks first (the plan merges it itself).
 * `merge` is what runs once you say Merge Anyway: a plain merge, or Solve Conflict (Claude finishes it).
 */
export function runPlanAction(state: AppState, wsId: string, action: PlanAction, run: (a: UiAction) => void, merge: 'merge' | 'merge_claude' = 'merge'): void {
  const owner = planOwnerOf(state.plans, state.board, wsId);
  if (!owner) return;
  if (action === 'open_plan') return run({ type: 'view', view: { kind: 'plan', id: owner.plan.id } });
  if (action === 'open_task') return run({ type: 'view', view: { kind: 'task', id: owner.issue.id } });
  const name = planTitle(owner.plan);
  openSheet({
    kind: 'confirm',
    title: t('common.planTask.title', { key: owner.issue.key }),
    message: t('common.planTask.message', { name, milestone: owner.milestone.title }),
    confirm: t('common.planTask.confirm'),
    run: () => {
      confirmMerge(wsId);
      run({ type: 'ws', id: wsId, action: merge });
    },
  });
}
