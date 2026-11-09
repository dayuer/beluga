import type { IconName } from '../components/Icon.js';
import type { Grant, PrivacyPane } from '../lib/privacy-model.js';
import type { AccessStep } from './onboarding-model.js';
import { t } from '../i18n/index.js';

/**
 * The permission steps' words: what each lets Claude do, in one sentence, and where it lives in
 * System Settings. Every one is optional; nothing in Beluga stops working without it.
 */
export interface AccessCopy {
  readonly pane: PrivacyPane;
  readonly icon: IconName;
  /** As System Settings names it. */
  readonly name: string;
  readonly title: string;
  /** Why it may be useful, in one sentence. */
  readonly why: string;
  /** What happens without it. */
  readonly without: string;
  /** What to do once System Settings is open. */
  readonly how: string;
}

const copy = (step: AccessStep, icon: IconName): AccessCopy => ({
  pane: step,
  icon,
  get name() { return t(`onboarding.access.${step}.name` as const); },
  get title() { return t(`onboarding.access.${step}.title` as const); },
  get why() { return t(`onboarding.access.${step}.why` as const); },
  get without() { return t(`onboarding.access.${step}.without` as const); },
  get how() { return t(`onboarding.access.${step}.how` as const); },
});

export const ACCESS_COPY: Readonly<Record<AccessStep, AccessCopy>> = {
  screen: copy('screen', 'eye'),
  accessibility: copy('accessibility', 'hand'),
  disk: copy('disk', 'folder'),
  automation: copy('automation', 'wand'),
};

/** The step's main button: what pressing it does now. */
export function accessAction(grant: Grant | undefined): string {
  return grant === 'granted' ? t('onboarding.access.openSettings') : t('onboarding.access.allowInSettings');
}

/** The footer's button on a permission step: go on, or pass on this one. */
export const accessNext = (grant: Grant | undefined): string => (grant === 'granted' ? t('onboarding.onboarding.continue') : t('onboarding.onboarding.notNow'));

/** The line under the step's title: how it stands. */
export function grantText(grant: Grant | undefined, asked: boolean): string {
  if (grant === 'granted') return t('onboarding.access.allowed');
  if (grant === 'off') return asked ? t('onboarding.access.waiting') : t('onboarding.access.notYet');
  return asked ? t('onboarding.access.opened') : t('onboarding.access.optional');
}
