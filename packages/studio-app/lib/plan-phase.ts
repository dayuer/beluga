import type { StudioPlanView } from '../../../src/studio/protocol';

/**
 * The one phase the plan page is in, and therefore the one primary action (docs/studio-plan-page.md
 * §2). The view decides; `local` is only the short-lived patch between an action's receipt and the
 * daemon's next frame, and it is dropped as soon as a newer revision arrives.
 */
export type PagePhase =
  | 'decide'
  | 'review'
  | 'changes'
  | 'confirm'
  | 'awaiting-start'
  | 'awaiting-changes'
  | 'drafting-ai'
  | 'running'
  | 'done';

/** The phases that own the one primary action; every other phase has none. */
export const hasPrimary = (phase: PagePhase): boolean =>
  phase === 'decide' || phase === 'review' || phase === 'changes' || phase === 'confirm';

export interface LocalPlanState {
  /** The view revision at the moment the action was sent; a newer frame wins. */
  readonly rev: number;
  readonly confirm?: boolean;
  readonly applied?: boolean;
  readonly passedMilestoneRef?: string;
  readonly sentBackMilestoneRef?: string;
  readonly answered?: readonly string[];
}

/** Apply the short-lived local patch to a copy of the view. Never mutates the cached one. */
export function applyLocal(view: StudioPlanView, local?: LocalPlanState): StudioPlanView {
  if (!local) return view;
  const next: StudioPlanView = { ...view };
  if (local.answered?.length) {
    next.decisions = view.decisions.map((d) => (local.answered!.includes(d.decisionId) ? { ...d, open: false } : d));
  }
  if (local.passedMilestoneRef || local.sentBackMilestoneRef) {
    next.milestones = view.milestones.map((m) => {
      if (m.ref === local.passedMilestoneRef) return { ...m, status: 'passed' as const };
      if (m.ref === local.sentBackMilestoneRef) return { ...m, status: 'working' as const };
      return m;
    });
  }
  if (local.confirm) {
    next.gate = { kind: 'start', state: 'pending', draftRev: view.draftRev };
  } else if (local.applied) {
    next.gate = { kind: 'changes', state: 'pending', draftRev: view.draftRev };
  }
  return next;
}

/** Only use the patch while the screen is still on the revision it was made on. */
export function localFor(rev: number, local: LocalPlanState | undefined): LocalPlanState | undefined {
  return local && rev <= local.rev ? local : undefined;
}

export function pagePhase(view: StudioPlanView, local?: LocalPlanState): PagePhase {
  const v = applyLocal(view, local);
  if (v.decisions.some((d) => d.open)) return 'decide';
  if (v.milestones.some((m) => m.status === 'review')) return 'review';
  const gatePending = v.gate?.state === 'pending';
  if (v.draftDiff && !(v.gate?.kind === 'changes' && gatePending)) return 'changes';
  if (v.stage === 'drafting' && v.milestones.length > 0 && !v.typing && v.gate?.state !== 'pending') return 'confirm';
  if (v.gate?.kind === 'start' && gatePending) return 'awaiting-start';
  if (v.gate?.kind === 'changes' && gatePending) return 'awaiting-changes';
  if (v.stage === 'drafting') return 'drafting-ai';
  if (v.stage === 'done') return 'done';
  return 'running';
}
