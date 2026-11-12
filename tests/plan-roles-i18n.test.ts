import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { compile, lookup } from '../packages/mac/src/i18n/match.js';

/**
 * Plan roles and Plan Settings in Simplified Chinese (fork, BLG-125): every sentence they show — the
 * sheets, the toasts after a change, and the lines the daemon writes into a plan's feed — comes out
 * with no English left but names (models, a task's key, what's in quotes).
 */

const read = (file: string): Record<string, string> => {
  const at = path.join(import.meta.dirname, `../packages/mac/src/i18n/${file}`);
  return existsSync(at) ? (JSON.parse(readFileSync(at, 'utf8')) as Record<string, string>) : {};
};
const c = compile({ ...read('zh-CN.json'), ...read('zh-CN.fork.json') });

/** Names that stay as they are. */
const NAMES = /\b(Claude|Opus|Sonnet|Haiku|Codex|Beluga|Mac|git|BOB-\d+|\d+(\.\d+)?)\b/g;
/** The English words left once translated, names and quoted titles aside. */
const leftover = (en: string): string[] => {
  const zh = lookup(c, en) ?? en;
  return (zh.replace(/“[^”]*”|'[^']*'/g, '').replace(NAMES, '').match(/[A-Za-z]{2,}/g) ?? []).map((w) => `${w} (in: ${zh})`);
};

const SHEETS = [
  // Plan Settings and its entry.
  'Plan Settings…',
  'Plan Settings',
  'How “Card checkout” runs and who does each part. Changes apply from now on; work already running keeps its agent.',
  'Project',
  'How it runs',
  'When to run tests',
  'Who does each part',
  'Save',
  'This plan is gone.',
  // The roles, as New Plan and Plan Settings say them.
  'Architecture',
  'Coding',
  'Audit',
  'Hard fixes',
  'No architect (start right away)',
  'Your agent',
  'Same as its work',
  'Whoever is at it',
  'Strongest: Claude (Opus)',
  'Everyday: Claude (Haiku)',
  'Mid-tier: Claude (Sonnet)',
  'Auto route: an everyday model per task',
  'As the tiers say (Settings › Auto Route)',
  'More options',
  'The strongest model designs it and takes over what’s hard (fix tasks after a failed check, conflicts, a task that stopped twice), an everyday one writes the code, one in between checks it.',
  'The strongest model designs it and takes over what’s hard (fix tasks after a failed check, conflicts, a task that stopped twice), an everyday one writes the code, one in between checks it. Change any of them later in Plan Settings.',
  // How it runs, and its tests (a hint and its full stop are two pieces of text).
  '“Card checkout” runs on Step by Step now. Pick how it runs from here on.',
  'Each Milestone',
  'Only at the End',
  'Tasks run typecheck and the tests they touched; each milestone’s check runs the full suites once',
  'Milestone checks read the code and diffs; the full suites run once, in the final step',
  // Settings › Auto Route.
  'Plan Audits',
  'Hard Work',
  'Everything Else',
  'Its tasks, and plans’ design and hard fixes, start on the one marked Used now',
  'Plans’ checks run on the one marked Used now',
  'None of these runs here: a plan’s work agent checks it',
  'Used now',
  'Sonnet 5.5 · Local model',
];

const TOASTS = [
  'Plan settings saved',
  'Plan settings saved · From now on, milestone checks skip the test suites; they all run once, in the final step · Claude (Sonnet) checks this plan’s milestones and reviews its drafts',
  'From now on, each milestone’s check runs the full suites once, on its combined work',
  'Runs on Autopilot now',
  // What each role's setter says (core/plans/work.ts).
  'Claude (Haiku) works this plan’s milestones and tasks',
  'your default agent works this plan’s milestones and tasks',
  'Claude (Haiku) works what starts next; the milestone already at work keeps its agent',
  'Claude (Haiku) works what starts next; the 2 milestones already at work keep their agent',
  'Claude (Sonnet) checks this plan’s milestones and reviews its drafts',
  'The agent for its work checks this plan’s milestones',
  'Claude (Opus) designs each of this plan’s milestones before its work starts',
  'This plan’s milestones start without a design',
  'Claude (Opus) takes over what’s hard in this plan: fix tasks after a failed check, conflicts, a task that stopped twice',
  'What’s hard in this plan goes to auto route’s strongest model, else stays with whoever is at it',
];

const FEED = [
  // A role or the tests changed (core/plans/plans.ts).
  'gave its work to Claude (Haiku) from here on',
  'gave its checks to Claude (Sonnet) from here on',
  'gave its checks back to the agent for its work',
  'gave its milestones’ designs to Claude (Opus) from here on: each one is designed before its work starts',
  'starts its milestones without a design from here on',
  'gave what’s hard (fix tasks, conflicts, a task that stopped twice) to Claude (Opus) from here on',
  'gave what’s hard back to whoever is at it',
  'runs the test suites only at the end, in the final step',
  'runs the test suites once per milestone, at its check',
  // What's hard, handed to the fix agent (core/plans/pilot.ts toFixer).
  'handed the conflict to Claude (Opus)',
  'handed a task that stopped twice to Claude (Opus)',
  'handed a stuck conversation to Claude (Opus)',
  // Naming its milestone (BLG-199, fork/plans/fixer.ts escalate).
  'handed a task that stopped twice in “Safe payments” to Claude (Opus)',
  'handed a stuck conversation in “Safe payments” to Claude (Opus)',
  'handed the fix tasks for “Safe payments” to Claude (Opus)',
  // A task that stopped twice (core/plans/watchdog.ts).
  'BOB-4 stopped again: gave it to Claude (Opus), woke it at 14:05',
  'BOB-4 stopped, woke it at 14:05',
  // A milestone's check, as the feed says it (the checker's own words after the colon stay as written).
  'checked “Safe payments”',
];

/** git's own words that reach the window now git speaks English to Beluga (docs/reports/plan-roles-git-locale.md). */
const GIT = [
  'fatal: Not possible to fast-forward, aborting.',
  "error: pathspec 'main' did not match any file(s) known to git",
  "error: the branch 'beluga/blg-1' is not fully merged",
  "hint: If you are sure you want to delete it, run 'git branch -D beluga/blg-1'",
  'fatal: Could not read from remote repository.',
];

describe('plan roles and Plan Settings in Simplified Chinese', () => {
  it.each(SHEETS)('the sheets: %s', (en) => expect(leftover(en)).toEqual([]));
  it.each(TOASTS)('a toast: %s', (en) => expect(leftover(en)).toEqual([]));
  it.each(FEED)('the plan’s feed: %s', (en) => expect(leftover(en)).toEqual([]));
  it.each(GIT)('git’s own words: %s', (en) => expect(leftover(en)).toEqual([]));
  it('a handoff that names its milestone (BLG-205): the whole sentence, the title kept', () => {
    expect(lookup(c, 'handed a task that stopped twice in “Safe payments” to Claude (Opus)')).toBe('把“Safe payments”里卡住两次的任务交给了 Claude (Opus)');
    expect(lookup(c, 'handed a stuck conversation in “Safe payments” to Claude (Opus)')).toBe('把“Safe payments”里卡住的对话交给了 Claude (Opus)');
  });
});
