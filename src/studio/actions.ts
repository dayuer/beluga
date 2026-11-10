import { type RefusalCode, StudioAction, type StudioReceipt } from './protocol.js';

/**
 * What a Synon Studio customer may do (decision action-whitelist): pure, so the hub and the
 * daemon run the same check (docs/studio-protocol.md §6). Two layers:
 *
 * - `checkAction`: a customer's action frame → refused (with a code), already done (its first
 *   receipt), one internal call to make, or a start Gate to raise. Asking to start or applying
 *   changes only ever raises a Gate: `plans.approve` is never an answer here.
 * - `callRefusal`: the daemon's own second look at the internal call it's about to make. Only the
 *   calls a customer's action turns into pass, with only the arguments they may carry.
 *
 * Like client-scope.ts: anything not named is refused.
 */

export const OPID_KEEP_MS = 14 * 24 * 60 * 60 * 1000;

/** Where an opId is unique: the studio and the plan (`new` for a plan being created in a project). */
export interface OpScope {
  readonly studio: string;
  readonly plan?: string;
  /** For plan.create: the project it's for. */
  readonly project?: string;
}

export const opKey = (scope: OpScope, opId: string): string => `${scope.studio}\u0000${scope.plan ?? `new:${scope.project ?? ''}`}\u0000${opId}`;

export interface CustomerDecision {
  readonly audience?: 'customer' | 'operator';
  readonly open: boolean;
  /** The question card's id (decide:<plan>:<task>), never sent to the customer. */
  readonly qid: string;
  readonly question: string;
  /** Option labels, by option id (o0, o1…). */
  readonly options: Readonly<Record<string, string>>;
  readonly multi?: boolean;
}

/** The plan as the checker needs it, read by the caller from the daemon's state (or the hub's last view). */
export interface PlanFacts {
  /** The plan's id here (what internal calls name). */
  readonly id: string;
  /** Approved once: it has a body on the board. */
  readonly started: boolean;
  readonly draftRev: number;
  /** Its conversation (`ws:<id>`), where the customer's messages go. */
  readonly home: string;
  /** Milestones by ref (m0…): their id here and whether they wait for the customer's verdict. */
  readonly milestones: Readonly<Record<string, { readonly id: string; readonly awaitingReview: boolean }>>;
  readonly decisions: Readonly<Record<string, CustomerDecision>>;
}

export interface ActionContext {
  readonly scope: OpScope;
  /** The project here a new plan goes to (from the binding, never from the request). */
  readonly projectId?: string;
  /** The plan the action names (none: unknown, or plan.create). */
  readonly plan?: PlanFacts;
  /** The first receipt of an opId already handled in this scope. */
  readonly seen: (key: string) => StudioReceipt | undefined;
}

export interface InternalCall {
  readonly method: string;
  readonly args: readonly unknown[];
}

export type ActionVerdict =
  | { readonly ok: false; readonly code: RefusalCode; readonly reason: string }
  | { readonly ok: true; readonly replay: StudioReceipt }
  | { readonly ok: true; readonly call: InternalCall }
  | { readonly ok: true; readonly gate: { readonly kind: 'start' | 'changes'; readonly draftRev: number } };

const no = (code: RefusalCode, reason: string): ActionVerdict => ({ ok: false, code, reason });

const PLATFORM_WORDS: Readonly<Record<string, string>> = { ios: 'iOS', android: 'Android', miniprogram: '微信小程序', web: 'Web' };

/** The opId of a frame, if it has a usable one (for the receipt of a refusal). */
export const opIdOf = (frame: unknown): string | undefined => {
  const id = (frame as { opId?: unknown } | null)?.opId;
  return typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id) ? id : undefined;
};

/** Is this customer action allowed, and what does it turn into? */
export function checkAction(frame: unknown, ctx: ActionContext): ActionVerdict {
  const kind = (frame as { kind?: unknown } | null)?.kind;
  const parsed = StudioAction.safeParse(frame);
  if (!parsed.success) {
    // An unknown kind (mixed case, an internal method name) is not allowed; a known one with the wrong fields is bad.
    const known = typeof kind === 'string' && StudioAction.options.some((o) => o.shape.kind.value === kind);
    return known ? no('bad-args', `${kind}: ${parsed.error.issues[0]?.message ?? 'bad arguments'}`) : no('not-allowed', `${String(kind)} isn’t a customer action`);
  }
  const a = parsed.data;
  const first = ctx.seen(opKey(ctx.scope, a.opId));
  if (first) return { ok: true, replay: first };

  if (a.kind === 'plan.create') {
    if (!ctx.projectId) return no('not-yours', 'no project is bound');
    const platforms = a.payload.platforms.map((p) => PLATFORM_WORDS[p]).join('、');
    return { ok: true, call: { method: 'plans.create', args: [{ projectId: ctx.projectId, goal: `${a.payload.goal}\n\n涉及平台：${platforms}` }] } };
  }

  const plan = ctx.plan;
  if (!plan) return no('unknown-plan', 'no such plan');
  const fresh = (rev: number): boolean => rev === plan.draftRev;

  switch (a.kind) {
    case 'chat.send':
      return { ok: true, call: { method: 'session.submit', args: [a.payload.text, { channel: plan.home }] } };
    case 'plan.verify':
      return { ok: true, call: { method: 'plans.verify', args: [plan.id] } };
    case 'plan.requestStart':
      if (!fresh(a.payload.draftRev)) return no('stale', 'the plan changed since');
      if (plan.started) return no('not-allowed', 'already started: apply the changes instead');
      return { ok: true, gate: { kind: 'start', draftRev: plan.draftRev } };
    case 'draft.apply':
      if (!fresh(a.payload.draftRev)) return no('stale', 'the changes changed since');
      if (!plan.started) return no('not-allowed', 'not started: confirm the plan instead');
      return { ok: true, gate: { kind: 'changes', draftRev: plan.draftRev } };
    case 'draft.discard':
      if (!fresh(a.payload.draftRev)) return no('stale', 'the changes changed since');
      // Discarding a plan never approved throws the whole plan away.
      if (!plan.started) return no('not-allowed', 'a plan not started has no changes to discard');
      return { ok: true, call: { method: 'plans.discard', args: [plan.id] } };
    case 'milestone.pass':
    case 'milestone.sendBack': {
      if (!fresh(a.payload.draftRev)) return no('stale', 'the plan changed since');
      const m = plan.milestones[a.payload.milestoneRef];
      if (!m) return no('bad-args', 'no such milestone');
      if (!m.awaitingReview) return no('not-open', 'that milestone isn’t waiting for you');
      return a.kind === 'milestone.pass'
        ? { ok: true, call: { method: 'plans.pass', args: [plan.id, m.id] } }
        : { ok: true, call: { method: 'plans.sendBack', args: [plan.id, m.id, a.payload.reason] } };
    }
    case 'decision.answer':
      return answerDecision(plan, a.payload);
  }
}

/** Answering a decision: only one that's the customer's (audience customer), and still open. */
function answerDecision(plan: PlanFacts, p: { decisionId: string; picks?: string[] | undefined; text?: string | undefined }): ActionVerdict {
  const d = Object.hasOwn(plan.decisions, p.decisionId) ? plan.decisions[p.decisionId] : undefined;
  // Missing audience is the operator's.
  if (!d || d.audience !== 'customer') return no('not-open', 'that question isn’t yours to answer');
  if (!d.open) return no('not-open', 'already answered');
  const picks = p.picks ?? [];
  if (picks.some((id) => !Object.hasOwn(d.options, id))) return no('bad-args', 'no such option');
  if (picks.length > 1 && !d.multi) return no('bad-args', 'pick one');
  const words = [...picks.map((id) => d.options[id]!), ...(p.text ? [p.text] : [])].join('; ');
  return { ok: true, call: { method: 'questions.answer', args: [d.qid, { kind: 'answers', answers: { [d.question]: words } }] } };
}

// --- The daemon's second look at the call it's about to make ---

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const onlyKeys = (v: unknown, keys: readonly string[]): boolean => isObj(v) && Object.keys(v).every((k) => keys.includes(k));

/** Why the daemon won't make this call for a customer, or undefined when it may. */
export function callRefusal(method: string, args: readonly unknown[]): string | undefined {
  switch (method) {
    case 'plans.create':
      // The operator decides autonomy, the agent and when tests run; the project comes from the binding.
      return args.length === 1 && onlyKeys(args[0], ['projectId', 'goal']) ? undefined : 'plans.create takes only a project and a goal from a customer';
    case 'plans.verify':
      // thenApprove would start the plan without the start Gate: refused whatever its value.
      if (args.length > 2) return 'plans.verify: too many arguments';
      if (args.length === 2 && args[1] !== undefined && !onlyKeys(args[1], [])) return 'plans.verify: no thenApprove for a customer';
      return typeof args[0] === 'string' ? undefined : 'plans.verify: which plan?';
    case 'plans.pass':
    case 'plans.discard':
      return args.every((a) => typeof a === 'string') ? undefined : `${method}: bad arguments`;
    case 'plans.sendBack':
      return args.length === 3 && args.every((a) => typeof a === 'string') ? undefined : 'plans.sendBack: bad arguments';
    case 'session.submit':
      return args.length === 2 && typeof args[0] === 'string' && onlyKeys(args[1], ['channel']) && typeof (args[1] as { channel?: unknown }).channel === 'string' ? undefined : 'session.submit: only text to the plan’s conversation';
    case 'questions.answer':
      return args.length === 2 && typeof args[0] === 'string' && (args[0] as string).startsWith('decide:') && isObj(args[1]) && args[1].kind === 'answers' ? undefined : 'questions.answer: only a plan decision';
    case 'plans.approve':
      return 'plans.approve only runs from the start Gate, never for a customer';
    case 'host.answerApproval':
      return 'a customer never answers a tool approval';
    default:
      return `${method} isn’t in the customer whitelist`;
  }
}

// --- opIds: each runs once ---

/**
 * The receipts of the opIds handled, kept at least 14 days (longer than the 7-day queue), so a
 * replay on day 8 is answered, not run again. Plain data in and out: the daemon and the hub keep
 * `entries()` on disk and load them back.
 */
export class OpLog {
  private readonly map = new Map<string, { at: number; receipt: StudioReceipt }>();

  constructor(entries: Iterable<readonly [string, { at: number; receipt: StudioReceipt }]> = []) {
    for (const [k, v] of entries) this.map.set(k, v);
  }

  readonly seen = (key: string): StudioReceipt | undefined => this.map.get(key)?.receipt;

  record(key: string, receipt: StudioReceipt, at: number): void {
    if (!this.map.has(key)) this.map.set(key, { at, receipt });
  }

  /** Forget what's older than the keep (never sooner). */
  prune(now: number, keep = OPID_KEEP_MS): void {
    const cut = now - Math.max(keep, OPID_KEEP_MS);
    for (const [k, v] of this.map) if (v.at < cut) this.map.delete(k);
  }

  entries(): Array<[string, { at: number; receipt: StudioReceipt }]> {
    return [...this.map];
  }
}
