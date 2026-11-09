import type { Totals } from '@beluga/shared/stats.js';
import type { IconName } from '../../components/Icon.js';
import { compact, formatCost } from './usage-model.js';
import { type Key, t } from '../../i18n/index.js';

/**
 * Titles you earn from your stats (the Usage tab's card and recap): playful, but each with a plain
 * rule and the number that earned it. Your title is the one you're furthest past the bar for.
 */
export interface Title {
  readonly id: string;
  readonly name: string;
  readonly icon: IconName;
  /** A pastel the card is drawn in (CSS colour). */
  readonly color: string;
  /** Why: the number behind it, in a few words. */
  readonly why: string;
  /** How far past the bar (1: just made it). */
  readonly score: number;
}

/** What the titles look at: all-time totals, when prompts were sent, streaks, how many agents. */
export interface TitleInput {
  readonly all: Totals;
  readonly hours: readonly number[];
  readonly longestStreak: number;
  readonly agents: number;
}

const HOUR = 3_600_000;
const sumHours = (hours: readonly number[], pick: (day: number, hour: number) => boolean): number => hours.reduce((n, v, i) => n + (pick(Math.floor(i / 24), i % 24) ? v : 0), 0);

interface Rule {
  readonly id: string;
  readonly icon: IconName;
  readonly color: string;
  /** How far past the bar (≥ 1 earns it), and why. */
  readonly test: (x: TitleInput) => { score: number; why: string };
}

const share = (part: number, whole: number): number => (whole ? part / whole : 0);
const pct = (f: number): string => `${Math.round(f * 100)}%`;
const why = (id: string, vars: Record<string, string | number>): string => t(`views.titles.${id}Why` as Key, vars);

const RULES: readonly Rule[] = [
  { id: 'code-god', icon: 'bolt', color: '#8c7bf0', test: (x) => ({ score: (x.all.linesAdded + x.all.linesRemoved) / 10_000, why: why('code-god', { n: compact(x.all.linesAdded + x.all.linesRemoved) }) }) },
  { id: 'merge-machine', icon: 'merge', color: '#b294f0', test: (x) => ({ score: x.all.prsMerged / 25, why: why('merge-machine', { n: x.all.prsMerged }) }) },
  { id: 'talkative', icon: 'send', color: '#6ea8f5', test: (x) => ({ score: x.all.prompts / 1000, why: why('talkative', { n: x.all.prompts.toLocaleString() }) }) },
  { id: 'novelist', icon: 'book', color: '#5fb3d9', test: (x) => ({ score: share(x.all.chars, x.all.prompts) / 450, why: why('novelist', { n: Math.round(share(x.all.chars, x.all.prompts)) }) }) },
  { id: 'paste-wizard', icon: 'clip', color: '#f2b84b', test: (x) => ({ score: x.all.pasted / 250_000, why: why('paste-wizard', { n: compact(x.all.pasted) }) }) },
  { id: 'voice', icon: 'mic', color: '#ea7b70', test: (x) => ({ score: x.all.dictationMs / HOUR, why: why('voice', { n: Math.round(x.all.dictationMs / 60_000) }) }) },
  {
    id: 'night-owl',
    icon: 'eye',
    color: '#7d86e8',
    test: (x) => {
      const f = share(
        sumHours(x.hours, (_, h) => h >= 22 || h < 4),
        sumHours(x.hours, () => true),
      );
      return { score: f / 0.2, why: why('night-owl', { pct: pct(f) }) };
    },
  },
  {
    id: 'early-bird',
    icon: 'bulb',
    color: '#f5c35b',
    test: (x) => {
      const f = share(
        sumHours(x.hours, (_, h) => h >= 5 && h < 9),
        sumHours(x.hours, () => true),
      );
      return { score: f / 0.2, why: why('early-bird', { pct: pct(f) }) };
    },
  },
  {
    id: 'weekend',
    icon: 'calendar',
    color: '#5cc49a',
    test: (x) => {
      const f = share(
        sumHours(x.hours, (d) => d === 0 || d === 6),
        sumHours(x.hours, () => true),
      );
      return { score: f / 0.25, why: why('weekend', { pct: pct(f) }) };
    },
  },
  { id: 'marathon', icon: 'clock', color: '#4fb8a8', test: (x) => ({ score: x.all.agentMs / (100 * HOUR), why: why('marathon', { n: Math.round(x.all.agentMs / HOUR).toLocaleString() }) }) },
  { id: 'branches', icon: 'branch', color: '#6cc187', test: (x) => ({ score: x.all.worktrees / 50, why: why('branches', { n: x.all.worktrees }) }) },
  { id: 'tidy', icon: 'archive', color: '#8fcfc4', test: (x) => ({ score: x.all.worktrees >= 10 ? share(x.all.archived, x.all.worktrees) / 0.6 : 0, why: why('tidy', { pct: pct(share(x.all.archived, x.all.worktrees)) }) }) },
  { id: 'streak', icon: 'flame', color: '#f09a6b', test: (x) => ({ score: x.longestStreak / 14, why: why('streak', { n: x.longestStreak }) }) },
  { id: 'polyglot', icon: 'bot', color: '#a0a7f2', test: (x) => ({ score: (x.agents - 1) / 2, why: why('polyglot', { n: x.agents }) }) },
  { id: 'tycoon', icon: 'coin', color: '#e7a95b', test: (x) => ({ score: x.all.tokens / 50_000_000, why: why('tycoon', { n: compact(x.all.tokens), cost: formatCost(x.all.cost) }) }) },
];

/** Everyone starts here: nothing earned yet. */
export const ROOKIE: Title = {
  id: 'rookie',
  get name() { return t('views.titles.rookie'); },
  icon: 'sparkles',
  color: '#9fb7f5',
  get why() { return t('views.titles.rookieWhy'); },
  score: 0,
};

/** The titles earned, best first (your title first); none: the starting one. */
export function titlesOf(x: TitleInput): Title[] {
  const earned = RULES.map((r) => ({ id: r.id, name: t(`views.titles.${r.id}` as Key), icon: r.icon, color: r.color, ...r.test(x) }))
    .filter((t) => Number.isFinite(t.score) && t.score >= 1)
    .sort((a, b) => b.score - a.score);
  return earned.length ? earned : [ROOKIE];
}
