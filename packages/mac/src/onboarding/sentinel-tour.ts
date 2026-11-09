import type { Access, ClaudeWhere, StepKind, TriggerKind } from '../../../../src/core/sentinel/model.js';
import { computerWord } from '../lib/os-words.js';
import { type Key, t } from '../i18n/index.js';

/**
 * The tour's Sentinel step (BLG-362): a few real sentinels, each said in a sentence (when, what,
 * and how you hear of it) and built from the same parts the Sentinel page has. One trigger, a
 * few steps, the access they need, and the report the run leaves. Pure, so a test can hold every
 * one to what Sentinel really allows (tests/mac-onboarding.test.ts).
 */

export interface TourStep {
  readonly kind: StepKind;
  /** What this step does here ("Write a brief of what changed"). */
  readonly detail: string;
  /** Where Claude works, for an Ask Claude step (a worktree needs Work access). */
  readonly where?: ClaudeWhere;
}

export interface TourSentinel {
  readonly id: string;
  readonly name: string;
  /** The sentence it's described in: when, what Claude does, and how you hear of it. */
  readonly said: readonly [when: string, what: string, then: string];
  readonly trigger: TriggerKind;
  /** The trigger in the Sentinel page's own words. */
  readonly when: string;
  readonly steps: readonly TourStep[];
  readonly access: Access;
  /** What the run left, in a line. */
  readonly report: { readonly title: string; readonly line: string };
}

const k = (id: string, part: string): Key => `onboarding.sentinels.${id}.${part}` as Key;
const step = (id: string, n: number, kind: StepKind, where?: ClaudeWhere): TourStep => ({ kind, get detail() { return t(k(id, `step${n}`), { computer: computerWord() }); }, ...(where ? { where } : {}) });
const sentinel = (id: string, trigger: TriggerKind, access: Access, steps: readonly TourStep[]): TourSentinel => ({
  id,
  get name() { return t(k(id, 'name')); },
  get said() { return [t(k(id, 'said1')), t(k(id, 'said2')), t(k(id, 'said3'))] as const; },
  trigger,
  get when() { return t(k(id, 'when')); },
  steps,
  access,
  get report() { return { title: t(k(id, 'reportTitle')), line: t(k(id, 'reportLine')) }; },
});

export const TOUR_SENTINELS: readonly TourSentinel[] = [
  sentinel('brief', 'schedule', 'look', [step('brief', 1, 'claude', 'project'), step('brief', 2, 'notify')]),
  sentinel('ci', 'github', 'ship', [step('ci', 1, 'claude', 'worktree'), step('ci', 2, 'pr'), step('ci', 3, 'merge')]),
  sentinel('payment', 'stripe', 'look', [step('payment', 1, 'claude', 'project'), step('payment', 2, 'message')]),
  sentinel('site', 'uptime', 'look', [step('site', 1, 'script'), step('site', 2, 'http'), step('site', 3, 'notify')]),
  sentinel('numbers', 'schedule', 'look', [step('numbers', 1, 'measure')]),
];
