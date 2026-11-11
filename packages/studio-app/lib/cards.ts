import type { PlanSummary, ProjectSummary, StudioStatus } from './hub-schema';

/** What a project card shows. Pure, so the "latest plan / waiting" rules can be tested without a screen. */
export interface ProjectCardData {
  readonly id: string;
  readonly name: string;
  readonly studioId: string;
  readonly studioName: string;
  /** The latest plan's one line; null when there are no plans (or their titles are empty). */
  readonly headline: string | null;
  readonly waiting: boolean;
  /** False when the plans call failed and no cache was available: say so, don't claim "no requests". */
  readonly plansKnown: boolean;
  /** True while the first plans answer is still on its way and there is no cached one. */
  readonly plansLoading: boolean;
  /** Undefined when the plans call failed and there was no cached studio status. */
  readonly studio: StudioStatus | undefined;
}

export function cardFor(
  project: ProjectSummary,
  plans: readonly PlanSummary[] | undefined,
  studio: StudioStatus | undefined,
  loading = false,
): ProjectCardData {
  const latest = plans && plans.length > 0 ? [...plans].sort((a, b) => b.updatedAt - a.updatedAt)[0] : undefined;
  const headline = latest?.headline.trim() ? latest.headline : null;
  return {
    id: project.id,
    name: project.name,
    studioId: project.studioId,
    studioName: project.studioName,
    headline,
    waiting: plans?.some((p) => p.waitingOn === 'customer') ?? false,
    plansKnown: plans !== undefined,
    plansLoading: loading && plans === undefined,
    studio,
  };
}
