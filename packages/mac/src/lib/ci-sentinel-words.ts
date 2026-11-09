/**
 * A sentinel's schedule and pause reason, and a GitHub run's status and event, in the language
 * shown. The engine words them in English for every screen (src/core/sentinel/model.ts,
 * src/core/ci/model.ts); in English these return exactly that, in Chinese they're rebuilt here
 * from the same fields. A kind of trigger not worded here keeps the engine's sentence.
 */
import { type Sentinel, type Trigger, clockText, hostOf, pausedWords, scheduleSentence } from '@beluga/core/sentinel/model.js';
import { type RunTone, eventWords, runTone, statusWords } from '@beluga/core/ci/model.js';
import type { Locale } from '../../../../src/shared/i18n.js';
import { type Key, currentLocale, tIn } from '../i18n/index.js';

type RunLike = Parameters<typeof statusWords>[0];

/** When a sentinel runs, in one sentence (scheduleSentence's). */
export function localSchedule(trigger: Trigger, nameOf: (id: string) => string | undefined = () => undefined, lang: Locale = currentLocale()): string {
  const en = scheduleSentence(trigger, nameOf);
  if (lang === 'en') return en;
  const t = tIn(lang);
  switch (trigger.kind) {
    case 'schedule': {
      const at = clockText(trigger.at);
      switch (trigger.every) {
        case 'hours': {
          const n = trigger.hours ?? 1;
          return n === 1 ? t('more.schedule.everyHour') : t('more.schedule.everyHours', { n });
        }
        case 'day':
          return t('more.schedule.everyDay', { at });
        case 'other-day':
          return t('more.schedule.otherDay', { at });
        case 'week': {
          const days = [...new Set(trigger.days?.length ? trigger.days : [1])].filter((d) => d >= 0 && d <= 6).sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
          if (days.length === 7) return t('more.schedule.everyDay', { at });
          if (days.length === 5 && [1, 2, 3, 4, 5].every((d) => days.includes(d))) return t('more.schedule.weekdays', { at });
          if (days.length === 2 && days.includes(0) && days.includes(6)) return t('more.schedule.weekends', { at });
          return t('more.schedule.week', { days: days.map((d) => t(`common.DAY_NAMES.${d}.text` as Key)).join('、'), at });
        }
        case 'month':
          return t('more.schedule.month', { day: trigger.day ?? 1, at });
      }
      return at;
    }
    case 'manual':
      return t('more.schedule.manual');
    case 'after': {
      const name = nameOf(trigger.sentinelId);
      const other = name ? `“${name}”` : t('more.schedule.anotherSentinel');
      return t(trigger.on === 'success' ? 'more.schedule.afterSuccess' : trigger.on === 'failure' ? 'more.schedule.afterFailure' : 'more.schedule.afterRuns', { other });
    }
    case 'uptime':
      return t('more.schedule.uptime', { host: hostOf(trigger.url), minutes: trigger.minutes === 1 ? t('more.schedule.minute') : t('more.schedule.minutes', { n: trigger.minutes }) });
    case 'webhook':
      return t(trigger.signature === 'github' ? 'more.schedule.webhookGithub' : trigger.signature === 'stripe' ? 'more.schedule.webhookStripe' : 'more.schedule.webhook');
    default:
      return en;
  }
}

/** Why Beluga paused a sentinel ("Paused after 3 failures in a row"), else the words as they are. */
export function localPausedWhy(why: string | undefined, lang: Locale = currentLocale()): string | undefined {
  if (why === undefined || lang === 'en') return why;
  const t = tIn(lang);
  const m = /^Paused after (\d+) failures in a row$/.exec(why);
  return m ? t('more.sentinel.pausedAfter', { n: Number(m[1]) }) : why;
}

/** pausedWords, in the language shown. */
export const localPausedWords = (s: Sentinel): string | undefined => localPausedWhy(pausedWords(s));

const TONE_KEYS = { running: 'more.ci.tone.running', queued: 'more.ci.tone.queued', waiting: 'more.ci.tone.waiting', passed: 'more.ci.tone.passed', failed: 'more.ci.tone.failed', cancelled: 'more.ci.tone.cancelled', skipped: 'more.ci.tone.skipped' } as const satisfies Record<RunTone, string>;

/** A run's, job's or step's status (statusWords). */
export function localStatusWords(x: RunLike, lang: Locale = currentLocale()): string {
  if (lang === 'en') return statusWords(x);
  const t = tIn(lang);
  if (x.status === 'waiting') return t('more.ci.waitingApproval');
  if (x.conclusion === 'timed_out') return t('more.ci.timedOut');
  if (x.conclusion === 'startup_failure') return t('more.ci.startupFailure');
  if (x.conclusion === 'action_required') return t('more.ci.actionRequired');
  return t(TONE_KEYS[runTone(x)]);
}

const EVENT_KEYS: Readonly<Record<string, Key>> = { push: 'more.ci.event.push', workflow_dispatch: 'more.ci.event.manual', pull_request: 'more.ci.event.pr', pull_request_target: 'more.ci.event.pr', schedule: 'more.ci.event.schedule', workflow_run: 'more.ci.event.afterWorkflow', workflow_call: 'more.ci.event.called', merge_group: 'more.ci.event.mergeQueue', repository_dispatch: 'more.ci.event.dispatch', release: 'more.ci.event.release' };

/** What started a run (eventWords): GitHub's own event names, in words. */
export function localEventWords(event: string, lang: Locale = currentLocale()): string {
  if (lang === 'en') return eventWords(event);
  const key = EVENT_KEYS[event];
  return key ? tIn(lang)(key) : eventWords(event);
}
