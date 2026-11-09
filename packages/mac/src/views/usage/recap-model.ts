import type { AppState } from '@beluga/core/store.js';
import { type StatsSnapshot, streaks, totalsBy, totalsOf } from '@beluga/shared/stats.js';
import type { IconName } from '../../components/Icon.js';
import { duration, favouriteHour, groupOf } from './stats-model.js';
import { type Title, titlesOf } from './titles.js';
import { compact } from './usage-model.js';
import { t } from '../../i18n/index.js';

/**
 * Your recap, Wrapped-style (Recap.tsx): a slide per thing worth a big number, in the words you'd
 * say it. A slide with nothing behind it (no pull requests, never dictated, one agent) is left out,
 * so the story always makes sense.
 */
export interface Slide {
  readonly id: string;
  /** The slide's colour (CSS). */
  readonly color: string;
  readonly icon: IconName;
  readonly lead: string;
  /** The big figure: counted up to on screen. */
  readonly value?: number;
  readonly format?: (n: number) => string;
  /** Instead of a number: a name (a project, a title). */
  readonly big?: string;
  readonly after?: string;
  readonly note?: string;
  /** Bars under it: each one's share. */
  readonly bars?: ReadonlyArray<{ readonly name: string; readonly color: string; readonly share: number; readonly value: string }>;
  /** The last slide: your title. */
  readonly title?: Title;
}

const HOUR = 3_600_000;
const NOVEL = 450_000;
const WORDS_PER_MIN = 130;
const hoursOf = (ms: number): string => (ms >= HOUR ? t('views.recap.hours', { n: Math.round(ms / HOUR).toLocaleString() }) : duration(ms));

export function recapSlides(stats: StatsSnapshot, state: Pick<AppState, 'projects'>, name: string, now: number, worn?: Title): Slide[] {
  const all = totalsOf(stats, '');
  const { longest, current } = streaks(stats, now);
  const byProject = [...totalsBy(stats, 'project', '').entries()].filter(([, t]) => t.agentMs > 0).sort((a, b) => b[1].agentMs - a[1].agentMs);
  const byAgent = [...totalsBy(stats, 'agent', '').entries()].filter(([k, t]) => k && t.prompts + t.agentMs > 0).sort((a, b) => b[1].prompts - a[1].prompts);
  const hour = favouriteHour(stats.hours);
  const titles = titlesOf({ all, hours: stats.hours, longestStreak: longest, agents: byAgent.length });
  const since = stats.since ? new Date(stats.since).toLocaleDateString([], { month: 'long', year: 'numeric' }) : t('views.info.today');
  const first = name.split(' ')[0] || name;
  const slides: Slide[] = [{ id: 'hello', color: 'var(--series-1)', icon: 'sparkles', lead: t('views.recap.helloLead', { name: first }), big: t('views.recap.helloBig'), note: t('views.recap.helloNote', { since }) }];
  if (all.agentMs > 0) slides.push({ id: 'time', color: 'var(--worktree)', icon: 'clock', lead: t('views.recap.timeLead'), value: all.agentMs, format: hoursOf, after: t('views.recap.timeAfter', { n: all.runs.toLocaleString() }), note: all.agentMs >= 8 * HOUR ? t('views.recap.workdays', { n: Math.round(all.agentMs / (8 * HOUR)) }) : t('views.recap.gettingStarted') });
  if (all.prompts > 0)
    slides.push({
      id: 'prompts',
      color: 'var(--series-1)',
      icon: 'send',
      lead: t('views.recap.sentLead'),
      value: all.prompts,
      format: (n) => Math.round(n).toLocaleString(),
      after: t('views.recap.prompts', { n: all.prompts }),
      note: `${t('views.recap.chars', { chars: compact(all.chars), each: Math.round(all.chars / all.prompts) })}${hour ? t('views.recap.mostly', { day: hour.day, time: hour.time }) : ''}`,
    });
  if (all.pasted > 0) slides.push({ id: 'pasted', color: 'var(--series-4)', icon: 'clip', lead: t('views.recap.pastedLead'), value: all.pasted, format: (n) => compact(n), after: t('views.recap.characters'), note: all.pasted >= NOVEL / 2 ? t('views.recap.novels', { n: (all.pasted / NOVEL).toFixed(1) }) : t('views.recap.pages', { n: Math.max(1, Math.round(all.pasted / 1800)) }) });
  if (all.dictationMs > 0) slides.push({ id: 'voice', color: 'var(--series-5)', icon: 'mic', lead: t('views.recap.voiceLead'), value: all.dictationMs, format: (n) => duration(n), note: t('views.recap.words', { n: compact(Math.round((all.dictationMs / 60_000) * WORDS_PER_MIN)) }) });
  if (byProject.length) {
    const top = byProject[0]!;
    const sum = byProject.reduce((n, [, t]) => n + t.agentMs, 0);
    slides.push({
      id: 'project',
      color: 'var(--series-3)',
      icon: 'folder',
      lead: t('views.recap.placeLead'),
      big: groupOf(top[0], 'project', state.projects).name,
      note: t('views.recap.placeNote', { pct: Math.round((top[1].agentMs / sum) * 100) }),
      bars: byProject.slice(0, 4).map(([k, t]) => ({ name: groupOf(k, 'project', state.projects).name, color: groupOf(k, 'project', state.projects).color, share: t.agentMs / sum, value: hoursOf(t.agentMs) })),
    });
  }
  if (byAgent.length > 1) {
    const sum = byAgent.reduce((n, [, t]) => n + t.prompts, 0);
    slides.push({
      id: 'agents',
      color: 'var(--claude)',
      icon: 'bot',
      lead: t('views.recap.agentLead'),
      big: groupOf(byAgent[0]![0], 'agent', state.projects).name,
      note: t('views.recap.others', { n: byAgent.length - 1 }),
      bars: byAgent.slice(0, 4).map(([k, n]) => ({ name: groupOf(k, 'agent', state.projects).name, color: groupOf(k, 'agent', state.projects).color, share: n.prompts / sum, value: t('views.recap.promptsN', { n: n.prompts.toLocaleString() }) })),
    });
  }
  if (all.prsMerged > 0) slides.push({ id: 'shipped', color: 'var(--merged)', icon: 'merge', lead: t('views.recap.shippedLead'), value: all.prsMerged, format: (n) => Math.round(n).toLocaleString(), after: t('views.recap.pulls', { n: all.prsMerged }), note: t('views.recap.lines', { add: compact(all.linesAdded), del: compact(all.linesRemoved) }) });
  else if (all.worktrees > 0) slides.push({ id: 'worktrees', color: 'var(--series-3)', icon: 'branch', lead: t('views.recap.startedLead'), value: all.worktrees, format: (n) => Math.round(n).toLocaleString(), after: t('views.recap.worktrees', { n: all.worktrees }), note: t('views.recap.putAway', { n: all.archived.toLocaleString() }) });
  if (longest > 1) slides.push({ id: 'streak', color: 'var(--series-2)', icon: 'flame', lead: t('views.recap.streakLead'), value: longest, format: (n) => Math.round(n).toLocaleString(), after: t('views.recap.daysInARow'), note: current > 1 ? t('views.recap.onDay', { n: current }) : t('views.recap.ready') });
  // The title you wear on your pass (else the one you earned most).
  const top = worn ?? titles[0]!;
  slides.push({ id: 'title', color: top.color, icon: top.icon, lead: t('views.recap.makesYou'), title: top, note: top.id === 'rookie' ? top.why : t('views.recap.because', { why: top.why }) });
  return slides;
}
