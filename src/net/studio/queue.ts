/**
 * The customer action queue (docs/studio-hub.md §7).
 *
 * A customer's action is checked against the same whitelist the daemon uses (`src/studio/actions.ts`)
 * and against the project membership, then kept in the studio's Durable Object until the daemon
 * takes it. Every opId runs once: its receipt is kept at least 14 days, longer than the 7-day queue,
 * so a replay on day 8 answers with the first result instead of running again.
 *
 * Plain data in and out: the handler turns the receipts and deliveries into frames and effects;
 * this module never imports the handler (so there is no cycle).
 */

import { OPID_KEEP_MS, checkAction, opIdOf, opKey, type PlanFacts } from '../../studio/actions.js';
import { StudioAction, StudioPlanView, StudioReceipt, type RefusalCode } from '../../studio/protocol.js';
import {
  DELIVER_MAX,
  QUEUE_TTL_MS,
  RATE_CHARS_PER_DAY,
  RATE_PER_DAY,
  RATE_PER_MIN,
  type HubStore,
  type OpRow,
  type QueueItem,
  type StudioStore,
} from './store.js';

/** What the queue needs from a handler's `Deps`; `StudioDeps` satisfies it. */
export interface QueueDeps {
  readonly hub: HubStore;
  readonly studio: StudioStore;
  readonly now: number;
}

export interface EnqueueContext {
  readonly studio: string;
  /** The Studio project the action is for (from the session and URL, never the body). */
  readonly projectId: string;
  readonly customerId: string;
}

export type EnqueueResult = { readonly ok: true; readonly receipt: StudioReceipt } | { readonly ok: false; readonly status: number; readonly error: string };

/** One action on its way to a daemon. */
export interface Deliver {
  readonly seq: number;
  /** The daemon's own project id (the mapping), not the Studio project id. */
  readonly daemonProjectId: string;
  readonly action: StudioAction;
}

/** An action that waited too long: tell its customer. */
export interface ExpiredNotice {
  readonly projectId: string;
  readonly receipt: StudioReceipt;
}

export type AckResult = { readonly ok: true; readonly projectId: string; readonly receipt: StudioReceipt } | { readonly ok: false; readonly error: string };

const RATE_LIMITS = { perMinute: RATE_PER_MIN, perDay: RATE_PER_DAY, charsPerDay: RATE_CHARS_PER_DAY } as const;
const REF = /^[A-Za-z0-9_-]{1,64}$/;

const receiptOf = (op: Pick<OpRow, 'state' | 'code'>, opId: string, planRef: string | undefined): StudioReceipt =>
  StudioReceipt.parse({
    t: 'receipt',
    opId,
    state: op.state,
    ...(op.state === 'refused' ? { code: (op.code ?? 'not-allowed') as RefusalCode } : {}),
    ...(planRef ? { planRef } : {}),
  });

const charsOf = (action: StudioAction): number => {
  switch (action.kind) {
    case 'chat.send':
      return action.payload.text.length;
    case 'plan.create':
      return action.payload.goal.length;
    case 'milestone.sendBack':
      return action.payload.reason.length;
    case 'decision.answer':
      return action.payload.text?.length ?? 0;
    default:
      return 0;
  }
};

/** The rate bucket is per project, and per plan only when that plan actually exists in this project. */
const rateKeyFor = (projectId: string, planRef: string | undefined, hasPlan: boolean): string => (hasPlan && planRef !== undefined ? `plan:${projectId}:${planRef}` : `project:${projectId}`);

function actionOf(json: string): StudioAction | undefined {
  try {
    const parsed = StudioAction.safeParse(JSON.parse(json) as unknown);
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/** The cached view as the whitelist checker needs it (daemon-side values that don't travel are placeholders). */
function factsOf(viewJson: string): PlanFacts | undefined {
  try {
    const parsed = StudioPlanView.safeParse(JSON.parse(viewJson) as unknown);
    if (!parsed.success) return undefined;
    const view = parsed.data;
    return {
      id: view.planRef,
      started: view.stage !== 'drafting' && view.stage !== 'awaiting-start',
      draftRev: view.draftRev,
      home: 'hub',
      milestones: Object.fromEntries(view.milestones.map((m) => [m.ref, { id: m.ref, awaitingReview: m.status === 'review' }])),
      decisions: Object.fromEntries(
        view.decisions.map((d) => [
          d.decisionId,
          {
            audience: 'customer' as const,
            open: d.open,
            qid: '',
            question: d.question,
            options: Object.fromEntries(d.options.map((o) => [o.id, o.label])),
            multi: d.multi,
          },
        ]),
      ),
    };
  } catch {
    return undefined;
  }
}

/**
 * Check and queue one customer action.
 *
 * `ok:false` is only for a body with no usable opId (400) or a customer who isn't a member (403);
 * a refusal of the action itself is `ok:true` with a `refused` receipt, because the client's contract
 * is the receipt (`docs/studio-protocol.md` §4.2).
 */
export async function enqueue(frame: unknown, ctx: EnqueueContext, deps: QueueDeps): Promise<EnqueueResult> {
  const opId = opIdOf(frame);
  if (!opId) return { ok: false, status: 400, error: 'bad-args' };

  const parsed = StudioAction.safeParse(frame);
  const framePlan = (frame as { readonly planRef?: unknown } | null)?.planRef;
  const planRef = typeof framePlan === 'string' && REF.test(framePlan) ? framePlan : undefined;
  const key = opKey({ studio: ctx.studio, plan: planRef, project: ctx.projectId }, opId);

  // The project belongs to this customer (the Worker checked too; this is the DO's own look).
  // Membership comes before the opId replay: a removed customer gets nothing back, not even an
  // old receipt.
  if (!(await deps.hub.canAccess(ctx.customerId, ctx.projectId))) return { ok: false, status: 403, error: 'not-yours' };

  // Anything that waited seven days is expired before a replay can read a stale `queued`.
  await expire(deps.now, deps);

  // An opId already handled answers with its current state, before rate limiting: an idempotent
  // retry must not be turned into `rate-limited`.
  const existing = await deps.studio.op(key);
  if (existing) return { ok: true, receipt: receiptOf(existing, opId, planRef) };

  // Every frame counts against the budget, including malformed ones and ones naming a plan that
  // doesn't exist: the key never comes from a request field that can mint new buckets. Only the
  // text-carrying kinds add characters.
  const view = planRef ? await deps.studio.readView(ctx.projectId, planRef) : undefined;
  const chars = parsed.success ? charsOf(parsed.data) : 0;
  const rateKey = rateKeyFor(ctx.projectId, planRef, view !== undefined);
  if (!(await deps.studio.rateHit(ctx.customerId, rateKey, deps.now, chars, RATE_LIMITS))) {
    const refused: OpRow = { opKey: key, state: 'refused', code: 'rate-limited', at: deps.now, updatedAt: deps.now };
    await deps.studio.recordOp(refused);
    return { ok: true, receipt: receiptOf(refused, opId, planRef) };
  }
  await deps.studio.rateAdd(ctx.customerId, rateKey, deps.now, chars);

  const project = await deps.hub.project(ctx.projectId);
  const verdict = checkAction(frame, {
    scope: { studio: ctx.studio, plan: planRef, project: ctx.projectId },
    ...(project?.daemonProjectId ? { projectId: project.daemonProjectId } : {}),
    ...(view ? { plan: factsOf(view.viewJson) } : {}),
    seen: () => undefined,
  });

  if (!verdict.ok) {
    const refused: OpRow = { opKey: key, state: 'refused', code: verdict.code, at: deps.now, updatedAt: deps.now };
    await deps.studio.recordOp(refused);
    return { ok: true, receipt: receiptOf(refused, opId, planRef) };
  }
  if ('replay' in verdict) return { ok: true, receipt: verdict.replay };

  const action = parsed.data as StudioAction;
  const seq = await deps.studio.enqueue({
    opKey: key,
    opId,
    projectId: ctx.projectId,
    ...(planRef ? { planRef } : {}),
    customerId: ctx.customerId,
    kind: action.kind,
    frameJson: JSON.stringify(action),
    enqueuedAt: deps.now,
  });
  if (seq === undefined) {
    const winner = await deps.studio.op(key);
    if (winner) return { ok: true, receipt: receiptOf(winner, opId, planRef) };
    return { ok: false, status: 409, error: 'duplicate' };
  }
  const queued: OpRow = { opKey: key, state: 'queued', at: deps.now, updatedAt: deps.now };
  await deps.studio.recordOp(queued);
  return { ok: true, receipt: receiptOf(queued, opId, planRef) };
}

/**
 * Take what's waiting for this daemon, oldest first. Only once it has said `synced` (it pushed the
 * full views), so an action never runs against a view the daemon hasn't published.
 */
export async function take(daemonId: string, deps: QueueDeps): Promise<{ readonly deliver: readonly Deliver[]; readonly expired: readonly ExpiredNotice[] }> {
  const conn = await deps.studio.conn(daemonId);
  if (!conn || conn.connectedAt === undefined || !conn.synced) return { deliver: [], expired: [] };

  const expired = await expire(deps.now, deps);
  const projects = await deps.hub.projectsOfDaemon(daemonId);
  if (projects.length === 0) return { deliver: [], expired };
  const byProject = new Map(projects.map((p) => [p.id, p]));
  const rows = await deps.studio.takeable(projects.map((p) => p.id), DELIVER_MAX);
  if (rows.length === 0) return { deliver: [], expired };

  await deps.studio.markTaken(rows.map((r) => r.seq), daemonId, deps.now);
  const deliver: Deliver[] = [];
  for (const row of rows) {
    const project = byProject.get(row.projectId);
    const action = actionOf(row.frameJson);
    if (!project?.daemonProjectId || !action) {
      // A row that can't be delivered: keep it taken (it ages out) and say so, instead of looping.
      await deps.studio.alert(daemonId, 'bad-queued-frame', deps.now);
      continue;
    }
    deliver.push({ seq: row.seq, daemonProjectId: project.daemonProjectId, action });
  }
  return { deliver, expired };
}

/** What came of an action the daemon executed: settle the row and pass the receipt to the customer. */
export async function ack(daemonId: string, receipt: unknown, deps: QueueDeps): Promise<AckResult> {
  const parsed = StudioReceipt.safeParse(receipt);
  if (!parsed.success || (parsed.data.state !== 'done' && parsed.data.state !== 'refused')) {
    await deps.studio.alert(daemonId, 'bad-receipt', deps.now);
    return { ok: false, error: 'bad-receipt' };
  }
  const candidates = (await deps.studio.queueByOp(parsed.data.opId, daemonId)).filter((r) => r.state === 'taken' && r.takenBy === daemonId);
  const rows = candidates.length > 1 && parsed.data.planRef ? candidates.filter((r) => r.planRef === parsed.data.planRef) : candidates;
  if (rows.length !== 1) {
    await deps.studio.alert(daemonId, 'bad-receipt', deps.now);
    return { ok: false, error: 'bad-receipt' };
  }
  const row = rows[0]!;
  await deps.studio.settle(row.seq, parsed.data.state);

  const before = await deps.studio.op(row.opKey);
  const appReceipt = StudioReceipt.parse({
    t: 'receipt',
    opId: parsed.data.opId,
    state: parsed.data.state,
    ...(parsed.data.state === 'refused' ? { code: parsed.data.code } : {}),
    ...(row.planRef ? { planRef: row.planRef } : {}),
  });
  await deps.studio.recordOp({
    opKey: row.opKey,
    state: parsed.data.state,
    ...(parsed.data.code ? { code: parsed.data.code } : {}),
    at: before?.at ?? row.enqueuedAt,
    updatedAt: deps.now,
  });
  return { ok: true, projectId: row.projectId, receipt: appReceipt };
}

/** Anything that waited seven days is expired, and its customer is told. */
export async function expire(now: number, deps: QueueDeps): Promise<readonly ExpiredNotice[]> {
  const rows = await deps.studio.expire(now - QUEUE_TTL_MS, now);
  const out: ExpiredNotice[] = [];
  for (const row of rows) {
    const before = await deps.studio.op(row.opKey);
    await deps.studio.recordOp({ opKey: row.opKey, state: 'expired', at: before?.at ?? row.enqueuedAt, updatedAt: now });
    out.push({ projectId: row.projectId, receipt: receiptOf({ state: 'expired' }, row.opId, row.planRef) });
  }
  return out;
}

/** Forget finished queue rows and opId receipts older than the keep (never sooner than 14 days). */
export async function prune(now: number, deps: QueueDeps): Promise<void> {
  await deps.studio.prune(now - OPID_KEEP_MS);
}

export type { QueueItem };
