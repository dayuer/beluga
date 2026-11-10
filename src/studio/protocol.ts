import { z } from 'zod';

/**
 * Synon Studio's wire: the customer's view of a plan, the customer's actions and their receipts,
 * shared by the daemon, the hub and the customer app (docs/studio-protocol.md). Zod only, so it
 * runs in a browser and in a Cloudflare Worker. Every object is strict and every string has a cap:
 * the hub trusts nothing the daemon sends beyond what is named here.
 *
 * Additive within a major: new fields optional, new kinds and codes appended. The hub upgrades
 * before daemons (it parses strictly); the app parses with the loose view (unknown fields dropped).
 */
export const STUDIO_PROTO = { major: 1, minor: 0 } as const;

export const LIMITS = { ref: 64, title: 200, text: 4000, line: 400, answer: 2000 } as const;

const ref = z.string().min(1).max(LIMITS.ref);
const title = z.string().max(LIMITS.title);
const text = z.string().max(LIMITS.text);
const line = z.string().max(LIMITS.line);
const int = z.number().int().min(0);
const rev = int;
const opId = z.string().uuid();

export const PLATFORMS = ['ios', 'android', 'miniprogram', 'web'] as const;
export type StudioPlatform = (typeof PLATFORMS)[number];

export const STAGES = ['drafting', 'awaiting-start', 'running', 'awaiting-review', 'done'] as const;
export const WAITING_ON = ['customer', 'studio', 'ai'] as const;
export const MILESTONE_STATUSES = ['planned', 'waiting', 'working', 'checking', 'review', 'passed'] as const;
export const TASK_STATUSES = ['planned', 'waiting', 'doing', 'done'] as const;

export const StudioTask = z
  .object({ ref, title, goal: text.optional(), acceptance: z.array(line).max(20), status: z.enum(TASK_STATUSES) })
  .strict();

export const StudioMilestone = z
  .object({ ref, title, goal: text.optional(), criteria: z.array(line).max(20), status: z.enum(MILESTONE_STATUSES), tasks: z.array(StudioTask).max(60) })
  .strict();

export const StudioDecision = z
  .object({
    decisionId: ref,
    question: text,
    options: z.array(z.object({ id: ref, label: title, description: line.optional() }).strict()).max(20),
    multi: z.boolean(),
    open: z.boolean(),
  })
  .strict();

export const StudioTurn = z
  .object({ id: ref, who: z.enum(['customer', 'ai', 'studio']), role: title.optional(), name: title.optional(), text, at: int, opId: opId.optional() })
  .strict();

const diffKind = z.enum(['milestone', 'task']);
export const StudioDraftDiff = z
  .object({
    draftRev: rev,
    added: z.array(z.object({ kind: diffKind, title, under: title.optional() }).strict()).max(100),
    changed: z.array(z.object({ kind: diffKind, title, before: text, after: text }).strict()).max(100),
    removed: z.array(z.object({ kind: diffKind, title }).strict()).max(100),
  })
  .strict();

export const StudioGate = z
  .object({ kind: z.enum(['start', 'changes']), state: z.enum(['pending', 'approved', 'declined']), draftRev: rev, reason: text.optional() })
  .strict();

const viewShape = {
  planRef: ref,
  draftRev: rev,
  title,
  goal: text,
  stage: z.enum(STAGES),
  waitingOn: z.enum(WAITING_ON),
  headline: line,
  progress: z.object({ done: int, total: int }).strict(),
  milestones: z.array(StudioMilestone).max(40),
  decisions: z.array(StudioDecision).max(40),
  turns: z.array(StudioTurn).max(50),
  typing: z.boolean(),
  moreTurns: z.boolean(),
  activity: z.array(z.object({ at: int, text: line }).strict()).max(30),
  review: z.object({ milestoneRef: ref, verdict: z.enum(['pass', 'fail']), notes: text }).strict().optional(),
  draftDiff: StudioDraftDiff.optional(),
  gate: StudioGate.optional(),
  // P2 adds `previews`, P3 `entitlement` (optional, here): see docs/studio-protocol.md §3.4.
};

/** What a customer may see of a plan: only these fields (the hub parses it strictly). */
export const StudioPlanView = z.object(viewShape).strict();
/** The app's parse: the same, unknown fields dropped (a newer daemon's additions). */
export const StudioPlanViewLoose = z.object(viewShape);

export type StudioPlanView = z.infer<typeof StudioPlanView>;
export type StudioTurn = z.infer<typeof StudioTurn>;
export type StudioDecision = z.infer<typeof StudioDecision>;
export type StudioMilestone = z.infer<typeof StudioMilestone>;
export type StudioTask = z.infer<typeof StudioTask>;
export type StudioDraftDiff = z.infer<typeof StudioDraftDiff>;
export type StudioGate = z.infer<typeof StudioGate>;

// --- Actions: Studio's own kinds, never an internal method name. ---

const action = <K extends string, P extends z.ZodRawShape>(kind: K, payload: P, planRef: 'required' | 'none', check?: (p: z.infer<z.ZodObject<P>>) => boolean) => {
  const body = z.object(payload).strict();
  return z
    .object({ t: z.literal('action'), opId, kind: z.literal(kind), ...(planRef === 'required' ? { planRef: ref } : {}), payload: check ? body.refine(check, 'payload is incomplete') : body })
    .strict();
};

const draftRev = { draftRev: rev };
const optionId = z.string().regex(/^o\d{1,2}$/);

export const StudioAction = z.discriminatedUnion('kind', [
  action('plan.create', { goal: text.min(1), platforms: z.array(z.enum(PLATFORMS)).min(1).max(4).refine((p) => new Set(p).size === p.length, 'platforms repeat') }, 'none'),
  action('chat.send', { text: text.min(1) }, 'required'),
  action('plan.verify', {}, 'required'),
  action('plan.requestStart', draftRev, 'required'),
  action(
    'decision.answer',
    { decisionId: ref, picks: z.array(optionId).min(1).max(20).optional(), text: z.string().min(1).max(LIMITS.answer).optional() },
    'required',
    (p) => p.picks !== undefined || p.text !== undefined,
  ),
  action('milestone.pass', { milestoneRef: ref, ...draftRev }, 'required'),
  action('milestone.sendBack', { milestoneRef: ref, ...draftRev, reason: z.string().min(10).max(LIMITS.text) }, 'required'),
  action('draft.apply', draftRev, 'required'),
  action('draft.discard', draftRev, 'required'),
]);
export type StudioAction = z.infer<typeof StudioAction>;
export type StudioActionKind = StudioAction['kind'];
export const ACTION_KINDS: readonly StudioActionKind[] = StudioAction.options.map((o) => o.shape.kind.value);

export const RECEIPT_STATES = ['done', 'refused', 'queued', 'expired'] as const;
export const REFUSAL_CODES = ['not-allowed', 'bad-args', 'stale', 'not-yours', 'already-done', 'rate-limited', 'not-open', 'unknown-plan'] as const;
export type RefusalCode = (typeof REFUSAL_CODES)[number];

/** What came of an action: never the daemon's own words, only a code the app says in the customer's. */
export const StudioReceipt = z
  .object({ t: z.literal('receipt'), opId, state: z.enum(RECEIPT_STATES), code: z.enum(REFUSAL_CODES).optional(), planRef: ref.optional() })
  .strict()
  .refine((r) => (r.state === 'refused') === (r.code !== undefined), 'a refusal carries a code, nothing else does');
export type StudioReceipt = z.infer<typeof StudioReceipt>;

// --- Frames ---

const proto = z.object({ major: int, minor: int }).strict();

export const DaemonHello = z
  .object({ t: z.literal('hello'), proto, daemon: ref, projects: z.array(z.object({ id: ref, name: title }).strict()).max(200) })
  .strict();
export const PlanFrame = z.object({ t: z.literal('plan'), rev, view: StudioPlanView }).strict();
export const PlanGoneFrame = z.object({ t: z.literal('plan-gone'), planRef: ref }).strict();

/** daemon → hub. */
export const DaemonFrame = z.union([DaemonHello, PlanFrame, PlanGoneFrame, StudioReceipt]);
/** hub → daemon, and app → hub. */
export const ActionFrame = StudioAction;
/** hub → app. */
export const AppFrame = z.union([z.object({ t: z.literal('plan'), rev, view: StudioPlanViewLoose }).strict(), PlanGoneFrame, StudioReceipt]);

export type DaemonFrame = z.infer<typeof DaemonFrame>;
export type AppFrame = z.infer<typeof AppFrame>;
