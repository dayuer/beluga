import type { IconName } from '../components/Icon.js';
import type { Step } from './onboarding-model.js';
import { thisComputer } from '../lib/os-words.js';
import { type Key, t } from '../i18n/index.js';

/** The tour's words, one idea a step. Every line says what the app really does. */
export interface TourCopy {
  readonly eyebrow: string;
  readonly icon: IconName;
  readonly title: string;
  readonly body: string;
  readonly points: readonly string[];
}

const tour = (step: TourStep, icon: IconName, points: number): TourCopy => ({
  icon,
  get eyebrow() { return t(`onboarding.tour.${step}.eyebrow` as const); },
  get title() { return t(`onboarding.tour.${step}.title` as const); },
  get body() { return t(`onboarding.tour.${step}.body` as const, { computer: thisComputer() }); },
  get points() { return Array.from({ length: points }, (_, i) => t(`onboarding.tour.${step}.point${i + 1}` as Key, { computer: thisComputer() })); },
});

type TourStep = 'parallel' | 'agents' | 'tables' | 'machines' | 'friends' | 'sentinel' | 'uses' | 'earnings' | 'archive';

export const TOUR_COPY: Readonly<Partial<Record<Step, TourCopy>>> = {
  parallel: tour('parallel', 'branch', 3),
  agents: tour('agents', 'eye', 3),
  tables: tour('tables', 'table', 3),
  machines: tour('machines', 'server', 3),
  friends: tour('friends', 'people', 3),
  sentinel: tour('sentinel', 'sentinel', 3),
  uses: tour('uses', 'pulse', 3),
  earnings: tour('earnings', 'gauge', 3),
  archive: tour('archive', 'archive', 3),
};
