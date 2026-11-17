import type { StudioPlanView } from '../../../src/studio/protocol';
import { pagePhase } from './plan-phase';
import { t, type Lang } from './strings';

export type TodoKind = 'decision' | 'review' | 'changes' | 'confirm';

/** One thing waiting on the customer; `key` is stable across loads so an acted-on card can hide. */
export interface Todo {
  readonly kind: TodoKind;
  readonly pid: string;
  readonly planRef: string;
  readonly title: string;
  readonly sub: string;
  readonly key: string;
  readonly decisionId?: string;
  readonly milestoneRef?: string;
  readonly draftRev?: number;
}

/**
 * What a plan asks of the customer, using the same priority as the plan page: a plan yields
 * decision cards (one per open question) or exactly one of review / changes / confirm, and
 * nothing while it waits on the studio or the AI.
 */
export function todosOf(pid: string, view: StudioPlanView, lang: Lang): Todo[] {
  const phase = pagePhase(view);
  if (phase === 'decide') {
    const open = view.decisions.filter((d) => d.open);
    return open.map((decision, i) => ({
      kind: 'decision',
      pid,
      planRef: view.planRef,
      title: view.title,
      sub: `${t(lang, 'decision.count', { i: i + 1, n: open.length })} · ${decision.question}`,
      key: `decision:${view.planRef}:${decision.decisionId}`,
      decisionId: decision.decisionId,
    }));
  }
  if (phase === 'review') {
    const milestone = view.milestones.find((m) => m.status === 'review');
    if (!milestone) return [];
    return [
      {
        kind: 'review',
        pid,
        planRef: view.planRef,
        title: view.title,
        sub: t(lang, 'todo.reviewSub', { m: milestone.title }),
        key: `review:${view.planRef}:${milestone.ref}`,
        milestoneRef: milestone.ref,
        draftRev: view.draftRev,
      },
    ];
  }
  if (phase === 'changes' && view.draftDiff) {
    return [
      {
        kind: 'changes',
        pid,
        planRef: view.planRef,
        title: view.title,
        sub: t(lang, 'todo.changesSub', { a: view.draftDiff.added.length, c: view.draftDiff.changed.length, r: view.draftDiff.removed.length }),
        key: `changes:${view.planRef}`,
        draftRev: view.draftRev,
      },
    ];
  }
  if (phase === 'confirm') {
    return [
      {
        kind: 'confirm',
        pid,
        planRef: view.planRef,
        title: view.title,
        sub: t(lang, 'todo.confirmSub'),
        key: `confirm:${view.planRef}`,
        draftRev: view.draftRev,
      },
    ];
  }
  return [];
}
