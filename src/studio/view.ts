import type { PlanBody, PlanEventKind, PlanMilestone, PlanTask } from '../core/plans/model.js';
import type { MilestoneState, MilestoneView, PlanView, TaskState } from '../core/plans/progress.js';
import { hiddenFromCustomer, studioDecisions } from './decisions.js';
import { StudioPlanView, type StudioDecision, type StudioDraftDiff, type StudioGate, type StudioMilestone, type StudioTurn } from './protocol.js';
import { OMITTED, type SanitizeOptions, sanitizeLine as cleanLine, sanitizeText as cleanText } from './sanitize.js';

/**
 * What a Synon Studio customer sees of a plan (decision no-code-leak): built field by field from
 * the plan, never by copying a screen's view and deleting from it, and parsed with the strict
 * schema so a field not named in protocol.ts can't get out. Every free text goes through the
 * sanitizer. Task titles are the plan's own (never "KEY title"); milestones, tasks and decisions
 * are named by position (m0, m0-t1, d-m0-t1), not by the ids agents give them. Only decisions
 * marked for the customer are in it. Pure: the same plan gives the same view (no clock, no
 * randomness). The fields and where each comes from: docs/studio-protocol.md §3.
 */

export interface StudioViewInput {
  /** The plan's opaque name toward the hub (from the daemon's mapping; never the plan's id). */
  readonly planRef: string;
  /** The plan as Beluga's screens read it (src/core/plans/progress.ts planView). */
  readonly view: PlanView;
  /** The conversation as the customer may see it (filled by the chat channel). */
  readonly turns?: readonly StudioTurn[];
  readonly typing?: boolean;
  readonly moreTurns?: boolean;
  readonly gate?: StudioGate;
  /** The studio's task KEY prefixes (BLG): taken out in any case, even when they look like words. */
  readonly keyPrefixes?: readonly string[];
  /** AI role names as the studio calls them (Product → 产品), configurable later. */
  readonly roles?: Readonly<Record<string, string>>;
}

/** The options of the view being built (set for the length of one synchronous build, so the helpers below stay plain). */
let building: SanitizeOptions = {};
const sanitizeText = (s: string, max?: number): string => cleanText(s, max, building);
const sanitizeLine = (s: string, max?: number): string => cleanLine(s, max, building);

const FINISHED: ReadonlySet<TaskState> = new Set(['review', 'planned', 'done', 'canceled', 'missing']);

const MILESTONE_STATUS: Readonly<Record<MilestoneState, StudioMilestone['status']>> = {
  draft: 'planned',
  later: 'waiting',
  running: 'working',
  failed: 'working',
  merging: 'working',
  checking: 'checking',
  gate: 'review',
  passed: 'passed',
};

function taskStatus(state: TaskState): StudioMilestone['tasks'][number]['status'] {
  if (state === 'draft') return 'planned';
  if (FINISHED.has(state)) return 'done';
  if (state === 'later' || state === 'blocked' || state === 'ready') return 'waiting';
  return 'doing';
}

/** What happened, in the customer's words: the kind only, never the event's own text (it names files and agents). */
const ACTIVITY: Partial<Readonly<Record<PlanEventKind, string>>> = {
  approved: '工作室批准了开工',
  changed: '计划的改动已生效',
  started: '开始了一项工作',
  finished: '完成了一项工作',
  passed: '一个里程碑通过了验收',
  done: '计划完成了',
};

const lines = (xs: readonly string[], max: number): string[] => xs.slice(0, max).map((x) => sanitizeLine(x)).filter(Boolean);
const optText = (s: string | undefined): { goal?: string } => {
  const t = s ? sanitizeText(s) : '';
  return t ? { goal: t } : {};
};

function milestoneOf(m: MilestoneView, i: number): StudioMilestone {
  return {
    ref: `m${i}`,
    title: sanitizeLine(m.milestone.title, 200),
    ...optText(m.milestone.goal),
    criteria: lines(m.milestone.criteria, 20),
    status: MILESTONE_STATUS[m.state],
    // Yours that aren't the customer's (accounts, keys, payments) aren't in their list at all, not even by title.
    tasks: m.tasks.slice(0, 60).flatMap((t, j) =>
      hiddenFromCustomer(t.task)
        ? []
        : [
            {
              ref: `m${i}-t${j}`,
              title: sanitizeLine(t.task.title, 200),
              ...optText(t.task.goal),
              acceptance: lines(t.task.acceptance, 20),
              status: taskStatus(t.state),
            },
          ],
    ),
  };
}

/** The customer's decisions, filtered and numbered once (src/studio/decisions.ts), sanitized here. */
function decisionsOf(view: PlanView): StudioDecision[] {
  return studioDecisions(view).map((d) => ({
    decisionId: d.decisionId,
    question: sanitizeText(d.question),
    options: d.options.map((o) => ({ id: o.id, label: sanitizeLine(o.label, 200), ...(o.description ? { description: sanitizeLine(o.description) } : {}) })),
    multi: d.multi,
    open: d.open,
  }));
}

const taskWords = (t: PlanTask): string => sanitizeText([t.goal ?? '', ...t.acceptance].filter(Boolean).join('\n'));
const milestoneWords = (m: PlanMilestone): string => sanitizeText([m.goal ?? '', ...m.criteria].filter(Boolean).join('\n'));

/** The draft against what was approved, in titles and words (ids stay inside). */
export function draftDiffOf(body: PlanBody, draft: PlanBody, draftRev: number): StudioDraftDiff {
  const diff: { added: StudioDraftDiff['added']; changed: StudioDraftDiff['changed']; removed: StudioDraftDiff['removed'] } = { added: [], changed: [], removed: [] };
  const oldMs = new Map(body.milestones.map((m) => [m.id, m]));
  const newMs = new Map(draft.milestones.map((m) => [m.id, m]));
  // The operator's own tasks aren't in the customer's diff either (not even their titles).
  const oldTasks = new Map(body.milestones.flatMap((m) => m.tasks.filter((t) => !hiddenFromCustomer(t)).map((t) => [t.id, t] as const)));
  const newTasks = new Map(draft.milestones.flatMap((m) => m.tasks.filter((t) => !hiddenFromCustomer(t)).map((t) => [t.id, { t, m }] as const)));
  for (const m of draft.milestones) {
    const was = oldMs.get(m.id);
    if (!was) diff.added.push({ kind: 'milestone', title: sanitizeLine(m.title, 200) });
    else if (was.title !== m.title || milestoneWords(was) !== milestoneWords(m)) diff.changed.push({ kind: 'milestone', title: sanitizeLine(m.title, 200), before: milestoneWords(was), after: milestoneWords(m) });
  }
  for (const m of body.milestones) if (!newMs.has(m.id)) diff.removed.push({ kind: 'milestone', title: sanitizeLine(m.title, 200) });
  for (const [id, { t, m }] of newTasks) {
    const was = oldTasks.get(id);
    if (!was) diff.added.push({ kind: 'task', title: sanitizeLine(t.title, 200), under: sanitizeLine(m.title, 200) });
    else if (was.title !== t.title || taskWords(was) !== taskWords(t)) diff.changed.push({ kind: 'task', title: sanitizeLine(t.title, 200), before: taskWords(was), after: taskWords(t) });
  }
  for (const [id, t] of oldTasks) if (!newTasks.has(id)) diff.removed.push({ kind: 'task', title: sanitizeLine(t.title, 200) });
  return { draftRev, added: diff.added.slice(0, 100), changed: diff.changed.slice(0, 100), removed: diff.removed.slice(0, 100) };
}

function stageOf(input: StudioViewInput): StudioPlanView['stage'] {
  const { plan, milestones } = input.view;
  if (plan.status === 'done') return 'done';
  if (!plan.body) return input.gate?.kind === 'start' && input.gate.state === 'pending' ? 'awaiting-start' : 'drafting';
  if (milestones.some((m) => m.state === 'gate')) return 'awaiting-review';
  return 'running';
}

function headlineOf(stage: StudioPlanView['stage'], view: PlanView): string {
  const current = view.milestones.find((m) => m.state === 'gate') ?? view.current;
  const name = current ? sanitizeLine(current.milestone.title, 120) : '';
  switch (stage) {
    case 'drafting':
      return '计划在写，确认后就可以开工';
    case 'awaiting-start':
      return '等工作室批准开工';
    case 'awaiting-review':
      return name ? `等你验收：${name}` : '等你验收';
    case 'running':
      return `${name ? `在做：${name}，` : ''}已完成 ${view.done} 项，共 ${view.total} 项`;
    case 'done':
      return '计划完成了';
  }
}

function turnOf(t: StudioTurn, roles: Readonly<Record<string, string>> | undefined): StudioTurn {
  // A name that was all technical (an agent's, a model's) is dropped, not shown as a placeholder.
  const said = (x: string | undefined): string => {
    const c = x ? sanitizeLine(x, 200) : '';
    return c === OMITTED ? '' : c;
  };
  const role = said(t.role ? (roles && Object.hasOwn(roles, t.role) ? roles[t.role] : t.role) : undefined);
  const name = said(t.name);
  return { id: t.id, who: t.who, ...(role ? { role } : {}), ...(name ? { name } : {}), text: sanitizeText(t.text), at: t.at, ...(t.opId ? { opId: t.opId } : {}) };
}

/** The customer's view of a plan. Throws if what it built doesn't fit the strict schema (a bug, never sent). */
export function studioPlanView(input: StudioViewInput): StudioPlanView {
  building = input.keyPrefixes ? { keyPrefixes: input.keyPrefixes } : {};
  try {
    return build(input);
  } finally {
    building = {};
  }
}

function build(input: StudioViewInput): StudioPlanView {
  const { view } = input;
  const { plan } = view;
  const body = plan.draft ?? plan.body;
  const stage = stageOf(input);
  const decisions = decisionsOf(view);
  const waitingOn: StudioPlanView['waitingOn'] =
    stage === 'awaiting-start' ? 'studio' : stage === 'awaiting-review' || decisions.some((d) => d.open) ? 'customer' : stage === 'drafting' ? (input.typing ? 'ai' : 'customer') : stage === 'done' ? 'studio' : 'ai';
  const check = view.milestones.findIndex((m) => m.state === 'gate' && m.run.check);
  const checked = check >= 0 ? view.milestones[check]!.run.check! : undefined;
  const out = {
    planRef: input.planRef,
    draftRev: plan.draftRev,
    title: sanitizeLine(body?.title || '新需求', 200),
    goal: sanitizeText(body?.goal ?? ''),
    stage,
    waitingOn,
    headline: headlineOf(stage, view),
    progress: { done: view.done, total: view.total },
    milestones: view.milestones.slice(0, 40).map(milestoneOf),
    decisions,
    turns: (input.turns ?? []).slice(-50).map((t) => turnOf(t, input.roles)),
    typing: Boolean(input.typing),
    moreTurns: Boolean(input.moreTurns) || (input.turns?.length ?? 0) > 50,
    activity: plan.activity.flatMap((e) => (ACTIVITY[e.kind] ? [{ at: e.at, text: ACTIVITY[e.kind]! }] : [])).slice(-30),
    ...(checked ? { review: { milestoneRef: `m${check}`, verdict: checked.verdict, notes: sanitizeText(checked.notes) } } : {}),
    ...(plan.body && plan.draft ? { draftDiff: draftDiffOf(plan.body, plan.draft, plan.draftRev) } : {}),
    ...(input.gate ? { gate: { kind: input.gate.kind, state: input.gate.state, draftRev: input.gate.draftRev, ...(input.gate.reason ? { reason: sanitizeText(input.gate.reason) } : {}) } } : {}),
  };
  return StudioPlanView.parse(out);
}
