/** The plan's own palette names. A tone means something (butter: needs you, rose: a problem) or is decorative (neutral in the apps). */
export type PlanTone = 'plain' | 'sky' | 'mint' | 'peach' | 'lavender' | 'butter' | 'rose';

/** One milestone on the small map: what it is, how far it got, and what it waits on. */
export interface MapItem {
  readonly id: string;
  readonly title: string;
  /** The number drawn in the circle (1-based). */
  readonly index: number;
  readonly tone: PlanTone;
  readonly statusLabel: string;
  readonly done: number;
  readonly total: number;
  /** Draw the stronger border (the milestone at work / waiting on you). */
  readonly emphasized?: boolean;
  /** Draw a check instead of the number. */
  readonly passed?: boolean;
  readonly dependsOn?: readonly string[];
}

/** One task under a milestone in the outline. */
export interface OutlineTask {
  readonly id: string;
  readonly title: string;
  readonly tone: PlanTone;
  readonly statusLabel: string;
  readonly goal?: string;
  readonly acceptance?: readonly string[];
  /** A quiet line under the title (the companion's "Waits on …"). */
  readonly sub?: string;
  /** A quiet line shown when the task is open (the companion's "why"). */
  readonly note?: string;
  /** Mark it as the reader's own task. */
  readonly mine?: boolean;
  /** Draw a chevron: the task opens something (the companion's conversation). */
  readonly opens?: boolean;
}

/** One milestone in the timeline. */
export interface OutlineMilestone {
  readonly id: string;
  readonly title: string;
  /** The number drawn in the circle (1-based). */
  readonly index: number;
  readonly tone: PlanTone;
  readonly statusLabel: string;
  readonly done: number;
  readonly total: number;
  /** Draw a check instead of the number and ink the connector. */
  readonly passed?: boolean;
  readonly criteria: readonly string[];
  readonly tasks: readonly OutlineTask[];
  /** What it runs after, already resolved to titles. */
  readonly after?: readonly string[];
  readonly dependsOn?: readonly string[];
}
