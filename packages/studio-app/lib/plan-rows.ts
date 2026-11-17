import type { StudioPlanView } from '../../../src/studio/protocol';
import type { PlanSummary } from './hub-schema';
import type { StringKey } from './strings';

/** The row the project page draws, from the list response or from a live plan frame. */
export type PlanRowData = PlanSummary;

export function rowFromView(view: StudioPlanView, at: number = Date.now()): PlanRowData {
  return {
    planRef: view.planRef,
    title: view.title,
    stage: view.stage,
    waitingOn: view.waitingOn,
    headline: view.headline,
    progress: view.progress,
    updatedAt: at,
  };
}

export function stageKey(stage: PlanSummary['stage']): StringKey {
  switch (stage) {
    case 'drafting':
      return 'stage.drafting';
    case 'awaiting-start':
      return 'stage.awaitingStart';
    case 'running':
      return 'stage.running';
    case 'awaiting-review':
      return 'stage.awaitingReview';
    case 'done':
      return 'stage.done';
  }
}

export function waitingKey(waitingOn: PlanSummary['waitingOn']): StringKey {
  switch (waitingOn) {
    case 'customer':
      return 'home.waitingYou';
    case 'studio':
      return 'home.waitingStudio';
    case 'ai':
      return 'home.working';
  }
}
