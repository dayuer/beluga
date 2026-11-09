import type { BoardState } from '../../../../src/core/board/model.js';
import type { Actor } from '../../../../src/core/board/model.js';
import { type Autonomy, type Plan, type PlanBody, type PlanEvent, type PlanPr, type PlansState, type TestsAt, diffBodies, milestoneDeps, planTitle, reviewState, shownBody } from '../../../../src/core/plans/model.js';
import { type MilestoneState, type MilestoneView, type NextStep, type PlanView, type TaskState, type TaskView, agentNowWords } from '../../../../src/core/plans/progress.js';
import { pulseWords } from '../../../../src/core/plans/watchdog.js';
import { t } from '../i18n/index.js';
import type { Key } from '../i18n/index.js';

/**
 * The Plans screens' pure parts (no DOM): words and tones for states, what a plan waits for as a
 * button, the plans of a project in the order they're shown, and the plan graph's structure (what
 * the layout depends on, kept apart from the live state so a task moving on never re-lays it out).
 */

export type Tone = 'muted' | 'neutral' | 'claude' | 'info' | 'ok' | 'warn' | 'error' | 'accent';

// The label is read when shown, in the language shown then.
const stateWords = (key: Key, tone: Tone): { readonly label: string; readonly tone: Tone } => ({ get label() { return t(key); }, tone });

export const TASK_STATE: Readonly<Record<TaskState, { readonly label: string; readonly tone: Tone }>> = {
  draft: stateWords('plans.model.taskState.draft', 'muted'),
  later: stateWords('plans.model.taskState.later', 'muted'),
  blocked: stateWords('plans.model.taskState.blocked', 'muted'),
  ready: stateWords('plans.model.taskState.ready', 'accent'),
  running: stateWords('plans.model.taskState.running', 'claude'),
  asking: stateWords('plans.model.taskState.asking', 'warn'),
  idle: stateWords('plans.model.taskState.idle', 'warn'),
  stalled: stateWords('plans.model.taskState.stalled', 'warn'),
  review: stateWords('plans.model.taskState.review', 'info'),
  planned: stateWords('plans.model.taskState.planned', 'info'),
  done: stateWords('plans.model.taskState.done', 'ok'),
  canceled: stateWords('plans.model.taskState.canceled', 'muted'),
  missing: stateWords('plans.model.taskState.missing', 'muted'),
};

export const MILESTONE_STATE: Readonly<Record<MilestoneState, { readonly label: string; readonly tone: Tone }>> = {
  draft: stateWords('plans.model.msState.draft', 'muted'),
  later: stateWords('plans.model.msState.later', 'muted'),
  running: stateWords('plans.model.msState.running', 'claude'),
  checking: stateWords('plans.model.msState.checking', 'claude'),
  gate: stateWords('plans.model.msState.gate', 'accent'),
  failed: stateWords('plans.model.msState.failed', 'error'),
  merging: stateWords('plans.model.msState.merging', 'claude'),
  passed: stateWords('plans.model.msState.passed', 'ok'),
};

/** How a plan runs (engine's AUTONOMY_INFO), in the language shown. */
export const autonomyInfo = (a: Autonomy): { readonly label: string; readonly summary: string; readonly hint: string } => ({ label: t(`plans.autonomy.${a}.label` as const), summary: t(`plans.autonomy.${a}.summary` as const), hint: t(`plans.autonomy.${a}.hint` as const) });

/** When a plan runs its tests (engine's TESTS_AT_INFO), in the language shown. */
export const testsAtInfo = (x: TestsAt): { readonly label: string; readonly hint: string } => ({ label: t(`plans.testsAt.${x}.label` as const), hint: t(`plans.testsAt.${x}.hint` as const) });

const and = (names: readonly string[]): string => names.join(t('plans.model.and'));

/**
 * A milestone's status text in the plan's list: its state, plus when it runs. Open milestones say
 * they run side by side with the others open now; a waiting one says what it waits on.
 */
export function milestoneLabel(view: Pick<PlanView, 'milestones' | 'open'>, m: MilestoneView): string {
  const base = MILESTONE_STATE[m.state].label;
  const title = (id: string): string => `“${view.milestones.find((x) => x.milestone.id === id)?.milestone.title ?? id}”`;
  if (m.state === 'later') {
    const waits = m.dependsOn.filter((d) => view.milestones.find((x) => x.milestone.id === d)?.state !== 'passed');
    return waits.length ? t('plans.model.after', { list: and(waits.map(title)) }) : base;
  }
  const beside = view.open.filter((x) => x.milestone.id !== m.milestone.id);
  if (!view.open.some((x) => x.milestone.id === m.milestone.id) || !beside.length) return base;
  return t('plans.model.alongside', { base, others: beside.length > 2 ? t('plans.model.nOthers', { n: beside.length }) : and(beside.map((x) => title(x.milestone.id))) });
}

/** How a plan is, in one word, for lists and the page's header. */
export function planStatus(view: Pick<PlanView, 'plan' | 'next'>): { readonly label: string; readonly tone: Tone } {
  const { plan, next } = view;
  if (!plan.body) return { label: t('plans.model.status.draft'), tone: 'muted' };
  if (plan.status === 'done' && !plan.draft) return next.kind === 'ship' ? { label: plan.pr?.state === 'CLOSED' ? t('plans.model.status.prClosed') : plan.pr ? t('plans.model.status.prOpen') : t('plans.model.status.readyToShip'), tone: plan.pr?.state === 'CLOSED' ? 'warn' : 'accent' } : { label: t('plans.model.status.done'), tone: 'ok' };
  if (plan.draft) return { label: t('plans.model.status.changesProposed'), tone: 'accent' };
  if (plan.paused) return { label: t('plans.model.status.paused'), tone: 'muted' };
  switch (next.kind) {
    case 'pass':
    case 'start':
    case 'answer':
    case 'stalled':
      return { label: t('plans.model.status.waitingForYou'), tone: 'accent' };
    case 'failed':
      return { label: t('plans.model.status.needsFix'), tone: 'error' };
    case 'checking':
      return { label: t('plans.model.status.checking'), tone: 'claude' };
    case 'merging':
      return next.milestone.merging?.conflict?.stuck ? { label: t('plans.model.status.waitingForYou'), tone: 'accent' } : { label: t('plans.model.status.merging'), tone: 'claude' };
    case 'working':
      return { label: t('plans.model.status.running'), tone: 'claude' };
    default:
      return { label: t('plans.model.status.waiting'), tone: 'muted' };
  }
}

/**
 * A task's state in words for its card: a started task says how it's doing right now (“Working”
 * with its step and how long, “Running a long command · 12m”, “Stopped without finishing”), never
 * “working” when no turn runs.
 */
export function taskWords(t: TaskView, now: number): { readonly label: string; readonly tone: Tone; readonly sub?: string } {
  const base = TASK_STATE[t.state];
  if (!t.pulse || t.combining) return { ...base, ...(t.state === 'running' && t.step ? { sub: t.step } : t.state === 'blocked' || t.state === 'later' ? (t.why ? { sub: t.why } : {}) : {}) };
  const w = pulseWords(t.pulse, now);
  // Woken: the card says so while it works again.
  const sub = t.watch && !t.watch.needsYou && t.pulse.kind !== 'stopped' && t.pulse.kind !== 'waiting' ? `${w.sub ?? ''}${w.sub ? ' · ' : ''}${t.watch.line}` : w.sub;
  return { label: w.label, tone: w.tone, ...(sub ? { sub } : {}) };
}

/** A milestone's Claude right now, for its header and details (see agentNowWords): nothing while it isn't at work. */
export function milestoneNowWords(m: Pick<MilestoneView, 'agentNow' | 'agent' | 'tasks'>, now: number): { readonly label: string; readonly tone: Tone; readonly sub?: string; readonly onCard: boolean } | undefined {
  const w = agentNowWords(m, now);
  return w ? { label: w.label, tone: w.asking ? 'warn' : 'claude', ...(w.sub ? { sub: w.sub } : {}), onCard: w.onCard } : undefined;
}

/** The one thing to do next, in words (the page's main button and its line). */
export function nextWords(next: NextStep): { readonly title: string; readonly detail?: string } {
  switch (next.kind) {
    case 'approve':
      return { title: t('plans.model.next.approve'), detail: t('plans.model.next.approveDetail') };
    case 'review_changes':
      return { title: t('plans.model.next.apply'), detail: t('plans.model.next.applyDetail') };
    case 'resume':
      return { title: t('plans.model.next.resume'), detail: t('plans.model.next.resumeDetail') };
    case 'start': {
      // Yours: no worktree, you answer it in the plan's conversation (see core/plans/decisions.ts).
      const yours = next.tasks.filter((t) => t.forYou);
      if (yours.length === next.tasks.length) return { title: yours.length === 1 ? t('plans.model.next.answerOne', { title: yours[0]!.task.title }) : t('plans.model.next.answerMany', { n: yours.length }), detail: t('plans.model.next.answerDetail') };
      const claude = next.tasks.length - yours.length;
      return { title: claude === 1 ? t('plans.model.next.startOne', { title: next.tasks.find((x) => !x.forYou)!.task.title }) : t('plans.model.next.startMany', { n: claude }), detail: claude === 1 ? t('plans.model.next.readyToGo') : t('plans.model.next.readyToGoSide') };
    }
    case 'pass':
      return { title: t('plans.model.next.pass', { title: next.milestone.milestone.title }), detail: next.milestone.run.check ? (next.milestone.run.check.verdict === 'pass' ? t('plans.model.next.passChecked') : t('plans.model.next.passProblems')) : t('plans.model.next.passFinished') };
    case 'checking':
      return { title: t('plans.model.next.checking'), detail: t('plans.model.next.checkingDetail', { title: next.milestone.milestone.title }) };
    case 'failed':
      return { title: t('plans.model.next.failed'), detail: t('plans.model.next.failedDetail', { title: next.milestone.milestone.title }) };
    case 'answer':
      return { title: t('plans.model.next.answer'), detail: next.tasks.map((x) => x.issue?.key ?? x.task.title).join(', ') };
    case 'stalled':
      return { title: next.tasks.length === 1 ? t('plans.model.next.resumeOne', { what: next.tasks[0]!.issue?.key ?? `“${next.tasks[0]!.task.title}”` }) : t('plans.model.next.resumeMany', { n: next.tasks.length }), detail: next.tasks.map((x) => x.watch?.line ?? t('plans.model.next.stoppedAgain', { what: x.issue?.key ?? x.task.title })).join(' · ') };
    case 'working':
      return { title: next.tasks.length ? t('plans.model.next.inProgress', { n: next.tasks.length }) : t('plans.model.next.starting'), ...(next.note ? { detail: next.note } : {}) };
    case 'waiting':
      return { title: t('plans.model.next.waiting'), detail: next.why };
    case 'merging':
      return { title: next.text, detail: t('plans.model.next.mergingDetail', { title: next.milestone.milestone.title }) };
    case 'ship':
      if (next.pr?.state === 'OPEN') return { title: t('plans.model.next.prOpen', { n: next.pr.number }), detail: `${next.branch} → main: ${prWords(next.pr)}` };
      if (next.pr?.state === 'CLOSED') return { title: t('plans.model.next.prClosed', { n: next.pr.number }), detail: t('plans.model.next.prClosedDetail') };
      return { title: t('plans.model.next.openPr'), detail: t('plans.model.next.openPrDetail', { branch: next.branch }) };
    case 'done':
      return { title: t('plans.model.next.done'), detail: t('plans.model.next.doneDetail') };
  }
}

/** A project's plans: running first, then drafts, then finished; newest first in each. */
export function plansOf(state: PlansState, projectId: string | undefined): Plan[] {
  const rank = (p: Plan): number => (p.status === 'active' ? 0 : p.status === 'draft' ? 1 : 2);
  return state.plans.filter((p) => p.projectId === projectId).sort((a, b) => rank(a) - rank(b) || b.updatedAt - a.updatedAt);
}

export const titleOf = planTitle;

/** How far along each milestone is, for a plan's progress bar (finished share per milestone). */
export function bars(view: PlanView): ReadonlyArray<{ readonly id: string; readonly title: string; readonly state: MilestoneState; readonly share: number }> {
  return view.milestones.map((m) => ({ id: m.milestone.id, title: m.milestone.title, state: m.state, share: m.state === 'passed' ? 1 : m.total ? m.finished / m.total : 0 }));
}

/**
 * Milestones in rows by what they wait on: the first row waits on nothing, each next row on the
 * rows before it. Milestones in one row run side by side (ids, in the plan's order).
 */
export function milestoneRows(body: PlanBody | undefined): ReadonlyArray<readonly string[]> {
  const ms = body?.milestones ?? [];
  const depth = new Map<string, number>();
  const of = (id: string, seen: ReadonlySet<string>): number => {
    const known = depth.get(id);
    if (known !== undefined) return known;
    const m = ms.find((x) => x.id === id);
    if (!m || seen.has(id)) return 0;
    const d = Math.max(-1, ...milestoneDeps(body, m).map((x) => of(x, new Set([...seen, id])))) + 1;
    depth.set(id, d);
    return d;
  };
  const rows: string[][] = [];
  for (const m of ms) (rows[of(m.id, new Set())] ??= []).push(m.id);
  return rows.filter(Boolean);
}

/** The plan's progress bar: one column per row of milestones, the milestones of a row stacked in it (side by side in time). */
export function barColumns(view: PlanView): ReadonlyArray<ReturnType<typeof bars>> {
  const all = new Map(bars(view).map((b) => [b.id, b]));
  return milestoneRows(view.body ?? shownBody(view.plan)).map((row) => row.flatMap((id) => all.get(id) ?? []));
}

// ---- the plan's one sentence

/** Who a sentence is about: you (something waits for you), Claude (it's at work), Beluga (the plan itself). */
export type Who = 'you' | 'claude' | 'beluga';

export interface Headline {
  readonly who: Who;
  readonly text: string;
}

/** The plan's branch bits, when the plan carries them (plan-branch-flow): read loosely. */
interface BranchBits {
  readonly branch?: string;
  readonly merging?: Readonly<Record<string, { readonly catchUp?: boolean; readonly conflict?: { readonly key?: string; readonly merging?: string; readonly files?: readonly string[]; readonly stuck?: boolean } }>>;
}
const branchBits = (plan: Plan): BranchBits => plan as Plan & BranchBits;

const quoted = (m: MilestoneView): string => `“${m.milestone.title}”`;
const nTasks = (n: number): string => t('plans.model.nTasks', { n });

/** What's merging into the plan's branch now, when the plan carries that (a conflict first). */
function mergingLine(view: PlanView): Headline | undefined {
  const merging = branchBits(view.plan).merging ?? {};
  const entries = Object.entries(merging).filter(([, m]) => !m.catchUp);
  const conflict = entries.find(([, m]) => m.conflict);
  if (conflict) {
    const c = conflict[1].conflict!;
    const what = c.key ?? c.merging ?? t('plans.model.planBranch');
    return c.stuck ? { who: 'you', text: t('plans.model.h.fixConflict', { what, files: c.files?.length ? ` (${c.files.slice(0, 2).join(', ')})` : '' }) } : { who: 'claude', text: t('plans.model.h.fixingConflict', { what }) };
  }
  const first = entries[0];
  if (!first) return undefined;
  const m = view.milestones.find((x) => x.milestone.id === first[0]);
  return { who: 'beluga', text: t('plans.model.h.mergingInto', { what: m ? quoted(m) : t('plans.model.aMilestone'), branch: branchBits(view.plan).branch ?? t('plans.model.planBranch') }) };
}

/**
 * The plan in one sentence, with who it's about: what waits for you (“You: pass “API” — Claude
 * checked all 4 criteria”), else what Claude or Beluga is doing (“Claude is checking “API””, “3
 * tasks running in 2 milestones”).
 */
export function headline(view: PlanView): Headline {
  const { plan, next } = view;
  const running = view.active.filter((t) => t.state === 'running' || t.state === 'idle');
  const inMilestones = new Set(running.map((t) => t.milestoneId)).size;
  const alsoRunning = running.length ? t('plans.model.h.alsoRunning', { tasks: nTasks(running.length) }) : '';
  if (!plan.body && view.milestones.length) {
    // The draft's review before approval (BLG-772).
    const review = reviewState(plan);
    if (review === 'reviewing') return { who: 'claude', text: plan.review?.thenApprove ? t('plans.model.h.verifyingThenApprove') : t('plans.model.h.verifying') };
    if (review === 'findings' && !plan.review?.fixAsked) return { who: 'you', text: t('plans.model.h.findings', { n: plan.review!.findings.length }) };
  }
  if (!plan.body) return view.milestones.length ? { who: 'you', text: t('plans.model.h.approve', { milestones: t('plans.model.nMilestones', { n: view.milestones.length }), tasks: nTasks(view.total) }) } : { who: 'claude', text: t('plans.model.h.writing') };
  if (plan.draft) return { who: 'you', text: t('plans.model.h.review', { changes: changeWords(plan) }) };
  if (next.kind !== 'done' && next.kind !== 'answer' && next.kind !== 'failed') {
    const merging = mergingLine(view);
    if (merging) return merging;
  }
  switch (next.kind) {
    case 'approve':
    case 'review_changes':
      return { who: 'you', text: t('plans.model.h.review', { changes: changeWords(plan) }) };
    case 'resume':
      return { who: 'you', text: t('plans.model.h.resume') };
    case 'answer':
      return { who: 'you', text: t('plans.model.h.answer', { list: next.tasks.map((x) => x.issue?.key ?? `“${x.task.title}”`).join(', ') }) };
    case 'failed':
      return { who: 'you', text: t('plans.model.h.failed', { milestone: quoted(next.milestone) }) };
    case 'pass': {
      const m = next.milestone;
      const failed = m.run.mergeFailed;
      if (failed) return { who: 'you', text: t('plans.model.h.mergeFailed', { milestone: quoted(m), branch: plan.branch ?? t('plans.model.planBranch'), reason: failed.reason }) };
      const n = m.milestone.criteria.length;
      const why = m.run.check?.verdict === 'pass' ? t('plans.model.h.checkedCriteria', { n }) : t('plans.model.h.everyTaskFinished');
      return { who: 'you', text: t('plans.model.h.pass', { milestone: quoted(m), why }) };
    }
    case 'start':
      return { who: 'you', text: next.tasks.length === 1 ? t('plans.model.next.startOne', { title: next.tasks[0]!.task.title }) : t('plans.model.h.start', { tasks: nTasks(next.tasks.length) }) };
    case 'checking':
      return { who: 'claude', text: t('plans.model.h.checking', { milestone: quoted(next.milestone), also: alsoRunning }) };
    case 'working': {
      if (running.length) return { who: 'claude', text: t('plans.model.h.running', { tasks: nTasks(running.length) }) + (inMilestones > 1 ? t('plans.model.h.inMilestones', { n: inMilestones }) : '') };
      const starting = startingMilestones(view);
      return { who: 'beluga', text: starting.length ? settingUp(view, starting) : t('plans.model.h.startingNext') };
    }
    case 'waiting':
      return { who: 'beluga', text: next.why };
    case 'merging':
      return { who: next.milestone.merging?.conflict?.stuck ? 'you' : 'beluga', text: next.text };
    case 'stalled':
      return { who: 'you', text: t('plans.model.h.stalled', { list: next.tasks.map((x) => x.issue?.key ?? `“${x.task.title}”`).join(', ') }) };
    case 'ship':
      return shipHeadline(plan, next.branch, next.pr);
    case 'done':
      return { who: 'beluga', text: t('plans.model.h.done') };
  }
}

/** From a task's worktree: where it stands in its plan, in the same voice as the plan's sentence. */
export function taskHeadline(view: PlanView, taskId: string): Headline | undefined {
  const tv = view.milestones.flatMap((m) => m.tasks).find((x) => x.task.id === taskId);
  const m = tv && view.milestones.find((x) => x.milestone.id === tv.milestoneId);
  if (!tv || !m) return undefined;
  const into = t('plans.model.th.into');
  const state = tv.state as string;
  if (state === 'planned') return { who: 'beluga', text: t('plans.model.th.planned') };
  switch (tv.state) {
    case 'running':
      return { who: 'claude', text: tv.step ? t('plans.model.th.workingStep', { step: tv.step }) : t('plans.model.th.working') };
    case 'asking':
      return { who: 'you', text: t('plans.model.th.asking') };
    case 'idle':
      return { who: 'beluga', text: t('plans.model.th.idle') };
    case 'ready':
      if (tv.forYou) return { who: 'you', text: t('plans.model.th.yours') };
      if (tv.queued) return { who: 'claude', text: t('plans.model.th.queued') };
      return m.autonomy === 'step' ? { who: 'you', text: t('plans.model.th.readyStep') } : { who: 'beluga', text: t('plans.model.th.readyAuto') };
    case 'blocked':
    case 'later':
      return { who: 'beluga', text: tv.why ?? t('plans.model.th.waiting') };
    case 'done':
      return { who: 'beluga', text: m.state === 'passed' ? t('plans.model.th.doneIn') : t('plans.model.th.doneWaitPass', { milestone: quoted(m) }) };
    case 'canceled':
    case 'missing':
      return { who: 'beluga', text: t('plans.model.th.takenOut') };
    case 'draft':
      return { who: 'you', text: t('plans.model.th.draft') };
    case 'review':
      break;
  }
  // Done here: what's left is the milestone's.
  const others = m.tasks.filter((x) => x !== tv && !['review', 'done', 'canceled', 'missing', 'planned'].includes(x.state)).length;
  if (m.state === 'running') return { who: 'beluga', text: t('plans.model.th.doneWaitOthers', { tasks: t('plans.model.nOtherTasks', { n: others }), milestone: quoted(m), into }) };
  if (m.state === 'checking' || (m.state === 'gate' && m.milestone.criteria.length && !m.run.check)) return { who: 'claude', text: t('plans.model.th.doneChecking', { milestone: quoted(m), into }) };
  if (m.state === 'gate') return m.autonomy === 'autopilot' ? { who: 'beluga', text: t('plans.model.th.donePassesItself', { milestone: quoted(m), into }) } : { who: 'you', text: t('plans.model.th.donePass', { milestone: quoted(m), into }) };
  if (m.state === 'failed') return { who: 'you', text: t('plans.model.th.doneFailed', { milestone: quoted(m) }) };
  return { who: 'beluga', text: t('plans.model.th.doneWaitCheck', { into }) };
}

// ---- changing how a plan runs

/** What switching a plan to `to` changes from now on, in plain words (and what happens at once). */
export function modeChange(view: PlanView, to: Autonomy): { readonly title: string; readonly from: string; readonly now?: string } {
  const branch = branchBits(view.plan).branch;
  const label = autonomyInfo(to).label;
  const from = {
    step: () => t('plans.model.mode.step'),
    gated: () => t('plans.model.mode.gated'),
    autopilot: () => t('plans.model.mode.autopilot', { merges: branch ? t('plans.model.mode.autopilotMerges', { branch }) : '' }),
  }[to]();
  const open = view.open;
  const nowBits: string[] = [];
  if (to === 'autopilot') {
    const passing = open.filter((m) => m.state === 'gate' && (m.run.check?.verdict === 'pass' || !m.milestone.criteria.length));
    if (passing.length) nowBits.push(t('plans.model.mode.passNow', { list: and(passing.map(quoted)), n: passing.length }));
  }
  if (to !== 'step') {
    const ready = view.ready.filter((x) => !x.forYou).length;
    const room = Math.max(0, view.plan.maxParallel - view.active.length);
    const starts = Math.min(ready, room);
    if (starts) nowBits.push(t('plans.model.mode.startNow', { n: starts }));
  }
  if (view.plan.body?.milestones.some((m) => m.autonomy && m.autonomy !== to)) nowBits.push(t('plans.model.mode.ownWay'));
  const now = nowBits.length ? `${nowBits.join(t('plans.model.mode.sep'))}${t('plans.model.mode.end')}` : undefined;
  return { title: t('plans.model.mode.switchTo', { mode: label }), from, ...(now ? { now: now[0]!.toUpperCase() + now.slice(1) } : {}) };
}

// ---- what happened

export type FeedKind = 'started' | 'finished' | 'checking' | 'checked' | 'failed' | 'merged' | 'passed' | 'mode' | 'approved' | 'changed' | 'paused' | 'resumed' | 'done' | 'problem' | 'branch' | 'pr';

export interface FeedItem {
  readonly id: string;
  readonly at: number;
  readonly by: Actor;
  readonly kind: FeedKind;
  /** What happened (the newest of a run of repeats), after the actor's name. */
  readonly text: string;
  /** Repeats folded into it (1: none). */
  readonly count: number;
  /** Every text folded in, newest first. */
  readonly texts: readonly string[];
}

function feedKind(e: PlanEvent): FeedKind | undefined {
  switch (e.kind) {
    case 'started':
    case 'finished':
    case 'checked':
    case 'failed':
    case 'merged':
    case 'approved':
    case 'changed':
    case 'paused':
    case 'resumed':
    case 'done':
    case 'problem':
      return e.kind;
    case 'passed':
      return /^merged\b/.test(e.text) ? 'merged' : 'passed';
    case 'gate':
      return /^checked\b/.test(e.text) ? 'checked' : 'checking';
    case 'autonomy':
      return 'mode';
    // Where the work goes: the plan's branch made, its pull request opened (other notes stay out).
    case 'note':
      return /^(made the plan’s branch|collects the plan’s work on)\b/.test(e.text) ? 'branch' : /^opened pull request #\d+/.test(e.text) ? 'pr' : undefined;
    default:
      return undefined;
  }
}

/** Repeats this close together are one line. */
const FOLD_MS = 30 * 60 * 1000;

/**
 * What the plan did, newest first: started / finished / checked / merged / passed / the mode
 * changed (and the few other things worth seeing). A run of the same thing by the same one is one
 * line (“Beluga started 3 tasks”); the same line again and again says ×3.
 */
export function feedOf(activity: readonly PlanEvent[]): readonly FeedItem[] {
  const out: FeedItem[] = [];
  for (const e of [...activity].reverse()) {
    const kind = feedKind(e);
    if (!kind) continue;
    const last = out.at(-1);
    const fold = last && last.kind === kind && sameBy(last.by, e.by) && last.at - e.at < FOLD_MS && (last.texts[0] === e.text || kind === 'started' || kind === 'finished');
    if (!fold) {
      out.push({ id: e.id, at: e.at, by: e.by, kind, text: e.text, count: 1, texts: [e.text] });
      continue;
    }
    const texts = [...last.texts, e.text];
    const same = texts.every((x) => x === texts[0]);
    out[out.length - 1] = { ...last, count: texts.length, texts, text: same ? last.texts[0]! : `${kind} ${texts.length} tasks: ${texts.map((x) => /\b[A-Z][A-Z0-9]*-\d+\b/.exec(x)?.[0] ?? x.replace(/^\w+\s+/, '')).reverse().join(', ')}` };
  }
  return out;
}

const sameBy = (a: Actor, b: Actor): boolean => a.kind === b.kind && (a.kind === 'person' ? a.id === (b as typeof a).id : a.kind === 'claude' ? a.owner === (b as typeof a).owner : true);

/** What a draft changes in an approved plan, per task id (for marks on the graph and outline). */
export function changeMarks(plan: Plan): ReadonlyMap<string, 'added' | 'changed'> {
  if (!plan.body || !plan.draft) return new Map();
  const d = diffBodies(plan.body, plan.draft);
  return new Map([...d.added.map((id) => [id, 'added'] as const), ...d.changed.map((id) => [id, 'changed'] as const)]);
}

export function changeWords(plan: Plan): string {
  const d = diffBodies(plan.body, plan.draft);
  const parts = [d.added.length ? t('plans.model.changes.added', { n: d.added.length }) : '', d.changed.length ? t('plans.model.changes.changed', { n: d.changed.length }) : '', d.removed.length ? t('plans.model.changes.removed', { n: d.removed.length }) : ''].filter(Boolean);
  return parts.length ? parts.join(' · ') : t('plans.model.changes.milestones');
}

// ---- the graph's structure

export interface PlanGraphShape {
  /** Milestones as boxes (in order), each with its tasks and a gate at its end listing its criteria (they size it). */
  readonly milestones: ReadonlyArray<{ readonly id: string; readonly tasks: readonly string[]; readonly criteria: readonly string[] }>;
  /** Milestones by row: those in a row run side by side (milestoneRows). */
  readonly rows: ReadonlyArray<readonly string[]>;
  /** Lines: task → task (waits on), task → gate (finishes the milestone), gate → a milestone that waits on it. */
  readonly edges: ReadonlyArray<{ readonly id: string; readonly from: string; readonly to: string; readonly kind: 'blocks' | 'finish' | 'next' }>;
  /** Changes when (and only when) the layout must: its JSON. */
  readonly key: string;
}

export const gateId = (milestoneId: string): string => `gate:${milestoneId}`;
export const groupId = (milestoneId: string): string => `m:${milestoneId}`;
export const taskNodeId = (taskId: string): string => `t:${taskId}`;

/** The plan graph's structure from what's shown (the draft while there is one). */
export function graphShape(plan: Plan): PlanGraphShape {
  const body = shownBody(plan);
  const milestones = (body?.milestones ?? []).map((m) => ({ id: m.id, tasks: m.tasks.map((t) => t.id), criteria: m.criteria }));
  const edges: Array<PlanGraphShape['edges'][number]> = [];
  for (const m of body?.milestones ?? []) {
    const inside = new Set(m.tasks.map((t) => t.id));
    const needed = new Set(m.tasks.flatMap((t) => t.blockedBy.filter((b) => inside.has(b))));
    for (const t of m.tasks) {
      for (const b of t.blockedBy) edges.push({ id: `${b}->${t.id}`, from: taskNodeId(b), to: taskNodeId(t.id), kind: 'blocks' });
      // The last tasks of a milestone lead to its gate.
      if (!needed.has(t.id)) edges.push({ id: `${t.id}->gate`, from: taskNodeId(t.id), to: gateId(m.id), kind: 'finish' });
    }
  }
  // A milestone's gate opens the milestones that wait on it (only those: the others run alongside),
  // and only the nearest: one that waits on A and on B (which waits on A) gets its line from B alone.
  const deps = new Map((body?.milestones ?? []).map((m) => [m.id, milestoneDeps(body, m)] as const));
  const reaches = (from: string, to: string, seen = new Set<string>()): boolean =>
    (deps.get(from) ?? []).some((d) => d === to || (!seen.has(d) && (seen.add(d), reaches(d, to, seen))));
  for (const m of body?.milestones ?? []) {
    const mine = deps.get(m.id) ?? [];
    for (const d of mine) if (!mine.some((o) => o !== d && reaches(o, d))) edges.push({ id: `ms:${d}->${m.id}`, from: gateId(d), to: groupId(m.id), kind: 'next' });
  }
  const rows = milestoneRows(body);
  return { milestones, rows, edges, key: JSON.stringify({ milestones, rows, edges: edges.map((e) => e.id) }) };
}

/** A board task's key, if the plan's task is on the board. */
export function keyOf(board: BoardState, issueId: string | undefined): string | undefined {
  return issueId ? board.issues.find((i) => i.id === issueId)?.key : undefined;
}

export type { MilestoneView };

// ---------------------------------------------------------------- between milestones

/** A milestone's line into one that waits on it, from how it stands: passed (merged in), merging, at its gate, or not yet. */
export interface MilestoneLink {
  readonly state: 'done' | 'ready' | 'waiting';
  /** What the line says just below the gate it leaves. */
  readonly label: string;
}

/**
 * How a milestone's line reads. Passing it merges its work into the plan's branch first (by
 * itself; a conflict goes to Claude), and what waits on it unlocks only once that's in: so the line
 * says Merging, Fixing a conflict or Conflict while that runs, never a silent "Passed".
 */
export function milestoneLink(m: MilestoneView | undefined): MilestoneLink {
  if (!m) return { state: 'waiting', label: t('plans.model.link.unlocks') };
  if (m.state === 'merging') {
    const c = m.merging?.conflict;
    return { state: 'ready', label: c ? (c.stuck ? t('plans.model.link.conflict') : t('plans.model.link.fixing')) : t('plans.model.link.merging') };
  }
  if (m.state === 'passed' || m.run.passedAt) return { state: 'done', label: t('plans.model.link.unlocked') };
  return { state: m.state === 'gate' || m.state === 'checking' ? 'ready' : 'waiting', label: t('plans.model.link.unlocks') };
}

/**
 * Where the lines from several milestones meet before the one that waits on all of them: how many
 * are in, and what it says. One line in has no join (it simply leads there).
 */
export interface MilestoneJoin {
  readonly passed: number;
  readonly total: number;
  readonly state: MilestoneLink['state'];
  /** Its tooltip: which are in, which it still waits on, and the branch it starts from. */
  readonly tip: string;
}

export function milestoneJoin(parents: readonly (MilestoneView | undefined)[], branch: string | undefined): MilestoneJoin | undefined {
  if (parents.length < 2) return undefined;
  const links = parents.map(milestoneLink);
  const passed = links.filter((l) => l.state === 'done').length;
  const total = parents.length;
  const state: MilestoneLink['state'] = passed === total ? 'done' : links.some((l) => l.state === 'ready') ? 'ready' : 'waiting';
  const left = parents.filter((m, i) => m && links[i]!.state !== 'done').map((m) => `“${m!.milestone.title}”`);
  const into = branch ? t('plans.model.join.into', { branch }) : '';
  const tip = passed === total ? t('plans.model.join.allPassed', { total, into, from: branch ?? t('plans.model.join.theirWork') }) : t('plans.model.join.waiting', { total, into, left: left.join(', ') });
  return { passed, total, state, tip };
}

/** What a gated milestone's lock says: what it waits on, or the branch it starts from once they're in. */
export function lockWords(waitsOn: readonly string[], dependsOn: number, branch: string | undefined): string {
  const names = and(waitsOn.map((x) => `“${x}”`));
  if (waitsOn.length) return t('plans.model.lock.when', { names, n: waitsOn.length, branch: branch ?? '' });
  if (!branch) return t('plans.model.link.unlocked');
  return t('plans.model.lock.startsFrom', { branch, n: dependsOn });
}

// ---------------------------------------------------------------- setting up

/**
 * Open milestones whose Claude Beluga is starting right now: on their way (not Step by Step, where
 * you start each task), with a task of Claude's ready and nothing of theirs begun or handed to a
 * Claude yet. Between approving and the first step this is everything there is to see, so it's
 * said, never left looking frozen.
 */
export function startingMilestones(view: Pick<PlanView, 'plan' | 'open'>): readonly MilestoneView[] {
  if (view.plan.status !== 'active' || view.plan.paused) return [];
  return view.open.filter(
    (m) =>
      m.state === 'running' &&
      m.autonomy !== 'step' &&
      !m.run.agent &&
      m.tasks.some((t) => t.state === 'ready' && !t.forYou && !t.queued) &&
      !m.tasks.some((t) => t.worktree || t.state === 'running' || t.state === 'asking' || t.state === 'idle' || t.state === 'review'),
  );
}

/** “Setting up: making the plan's branch, then starting an agent for “API” and “UI”” */
export function settingUp(view: Pick<PlanView, 'plan'>, starting: readonly MilestoneView[]): string {
  const names = starting.map((m) => `“${m.milestone.title}”`);
  const list = names.length > 2 ? `${names.slice(0, -1).join(', ')}${t('plans.model.and')}${names.at(-1)}` : and(names);
  return view.plan.branch ? t('plans.model.setup.starting', { list }) : t('plans.model.setup.makeBranch', { list });
}

// ---- the plan's branch and pull request

/** What stands in the way of the plan's pull request, in a few words (“checks pending · needs a review”). */
export function prWords(pr: PlanPr): string {
  if (pr.state === 'MERGED') return t('plans.model.pr.merged');
  if (pr.state === 'CLOSED') return t('plans.model.pr.closed');
  const bits: string[] = [];
  if (pr.draft) bits.push(t('plans.model.pr.draft'));
  if (pr.conflicts) bits.push(t('plans.model.pr.conflicts'));
  else if (pr.mergeState === 'behind') bits.push(t('plans.model.pr.behind'));
  if (pr.checks === 'failing') bits.push(t('plans.model.pr.checksFailing'));
  else if (pr.checks === 'pending') bits.push(t('plans.model.pr.checksRunning'));
  else if (pr.checks === 'passing') bits.push(t('plans.model.pr.checksPass'));
  if (pr.review === 'CHANGES_REQUESTED') bits.push(t('plans.model.pr.changesRequested'));
  else if (pr.review === 'REVIEW_REQUIRED') bits.push(t('plans.model.pr.needsReview'));
  else if (pr.review === 'APPROVED') bits.push(t('plans.model.pr.approved'));
  if (pr.autoMerge) bits.push(t('plans.model.pr.autoMerge'));
  return bits.length ? bits.join(' · ') : t('plans.model.pr.ready');
}

/**
 * What the plan's last step is now, once every milestone passed: open its pull request, bring main
 * in (it conflicts), wait on Claude fixing that, merge it now or once its checks pass, or nothing (queued).
 */
export type ShipAction =
  | { readonly kind: 'open'; readonly again: boolean }
  | { readonly kind: 'catching_up'; readonly main: string }
  | { readonly kind: 'fixing'; readonly files: readonly string[] }
  | { readonly kind: 'stuck'; readonly files: readonly string[] }
  | { readonly kind: 'resolve' }
  | { readonly kind: 'draft' }
  | { readonly kind: 'queued' }
  | { readonly kind: 'wait' }
  | { readonly kind: 'merge' }
  | { readonly kind: 'merged' };

export function shipAction(plan: Plan, pr: PlanPr | undefined): ShipAction {
  const main = plan.mainMerge;
  if (main?.conflict) return { kind: main.conflict.stuck ? 'stuck' : 'fixing', files: main.conflict.files };
  if (main) return { kind: 'catching_up', main: main.main };
  if (!pr || pr.state === 'CLOSED') return { kind: 'open', again: pr?.state === 'CLOSED' };
  if (pr.state === 'MERGED') return { kind: 'merged' };
  if (pr.conflicts) return { kind: 'resolve' };
  if (pr.draft) return { kind: 'draft' };
  if (pr.autoMerge) return { kind: 'queued' };
  if (pr.checks === 'pending' || pr.checks === 'failing' || pr.review === 'REVIEW_REQUIRED' || pr.review === 'CHANGES_REQUESTED' || pr.mergeState === 'blocked') return { kind: 'wait' };
  return { kind: 'merge' };
}

const fileList = (files: readonly string[]): string => files.slice(0, 2).join(', ') + (files.length > 2 ? t('plans.model.andMore', { n: files.length - 2 }) : '');

function shipHeadline(plan: Plan, branch: string, pr: PlanPr | undefined): Headline {
  const a = shipAction(plan, pr);
  const n = pr ? `#${pr.number}` : t('plans.model.ship.thePr');
  switch (a.kind) {
    case 'open':
      return a.again ? { who: 'you', text: t('plans.model.ship.closed', { pr: n }) } : { who: 'you', text: t('plans.model.ship.open', { branch }) };
    case 'catching_up':
      return { who: 'beluga', text: t('plans.model.ship.catchingUp', { main: a.main, branch, pr: n }) };
    case 'fixing':
      return { who: 'claude', text: t('plans.model.ship.fixing', { files: fileList(a.files) }) };
    case 'stuck':
      return { who: 'you', text: t('plans.model.ship.stuck', { files: fileList(a.files) }) };
    case 'resolve':
      return { who: 'you', text: t('plans.model.ship.resolve', { pr: n, branch }) };
    case 'draft':
      return { who: 'you', text: t('plans.model.ship.draft', { pr: n }) };
    case 'queued':
      return { who: 'beluga', text: t('plans.model.ship.queued', { pr: n }) };
    case 'wait':
      return { who: 'you', text: t('plans.model.ship.wait', { pr: n, state: prWords(pr!) }) };
    case 'merge':
      return { who: 'you', text: t('plans.model.ship.merge', { pr: n, state: prWords(pr!) }) };
    case 'merged':
      return { who: 'beluga', text: t('plans.model.ship.merged', { pr: n }) };
  }
}

/** One step on the way from the plan's milestones to main, for the branch view. */
export interface FlowStep {
  readonly id: string;
  readonly kind: 'main' | 'pr' | 'branch' | 'milestone';
  readonly label: string;
  readonly detail: string;
  readonly state: 'done' | 'active' | 'waiting' | 'problem' | 'later';
}

/**
 * Where the plan's work goes, from main back: main, the pull request into it, the plan's branch,
 * and each milestone merged into that branch (or merging, stopped at a conflict, couldn't, not yet).
 */
export function branchFlow(view: PlanView): readonly FlowStep[] {
  const { plan } = view;
  const branch = plan.branch;
  const pr = plan.pr;
  const steps: FlowStep[] = [];
  const shipped = plan.shipped;
  steps.push({ id: 'main', kind: 'main', label: 'main', detail: shipped ? (shipped.how === 'pr' ? t('plans.model.flow.inVia', { n: String(shipped.number) }) : t('plans.model.flow.inHere')) : t('plans.model.flow.goesHere'), state: shipped ? 'done' : 'waiting' });
  if (branch) {
    const ship = shipAction(plan, pr);
    const prState: FlowStep['state'] = shipped || pr?.state === 'MERGED' ? 'done' : ship.kind === 'stuck' || ship.kind === 'resolve' || pr?.state === 'CLOSED' || pr?.checks === 'failing' ? 'problem' : pr ? 'active' : 'waiting';
    const prDetail = plan.mainMerge?.conflict ? t(plan.mainMerge.conflict.stuck ? 'plans.model.flow.mainConflictStuck' : 'plans.model.flow.mainConflictFixing', { files: fileList(plan.mainMerge.conflict.files) }) : pr ? prWords(pr) : shipped?.how === 'local' ? t('plans.model.flow.mergedHere') : t('plans.model.flow.openedOnce');
    steps.push({ id: 'pr', kind: 'pr', label: pr ? t('plans.model.flow.prN', { n: pr.number }) : t('plans.model.flow.pr'), detail: `${branch} → main · ${prDetail}`, state: shipped?.how === 'local' ? 'done' : prState });
    steps.push({ id: 'branch', kind: 'branch', label: branch, detail: t('plans.model.flow.branch'), state: shipped ? 'done' : 'active' });
  } else if (plan.body && plan.status !== 'done') {
    const failed = [...plan.activity].reverse().find((e) => e.kind === 'problem' && /^couldn’t make the plan’s branch/.test(e.text));
    steps.push({ id: 'branch', kind: 'branch', label: t('plans.model.flow.noBranch'), detail: failed ? `${failed.text.replace(/^couldn’t make the plan’s branch /, 'couldn’t make ')}` : t('plans.model.flow.notMade'), state: failed ? 'problem' : 'waiting' });
  }
  for (const m of view.milestones) {
    const c = m.merging?.conflict;
    const failed = m.run.mergeFailed;
    const state: FlowStep['state'] = m.state === 'merging' ? (c?.stuck ? 'problem' : 'active') : failed ? 'problem' : m.state === 'passed' ? 'done' : m.state === 'later' || m.state === 'draft' ? 'later' : 'waiting';
    const detail =
      m.state === 'merging'
        ? c
          ? t(c.stuck ? 'plans.model.flow.msConflictStuck' : 'plans.model.flow.msConflictFixing', { branch: branch ?? t('plans.model.flow.theBranch'), what: `${c.key ?? c.merging}`, files: fileList(c.files) })
          : t('plans.model.flow.msMerging', { branch: branch ?? t('plans.model.flow.theBranch') })
        : failed
          ? t('plans.model.flow.msCouldnt', { reason: failed.reason })
          : m.state === 'passed'
            ? branch
              ? t('plans.model.flow.msMerged', { branch })
              : t('plans.model.flow.msPassed')
            : t('plans.model.flow.msLater', { branch: branch ?? t('plans.model.planBranch'), done: m.finished, total: m.total });
    steps.push({ id: m.milestone.id, kind: 'milestone', label: m.milestone.title, detail, state });
  }
  return steps;
}
