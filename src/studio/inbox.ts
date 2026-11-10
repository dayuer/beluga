import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Plan } from '../core/plans/model.js';
import { planView, type PlanView } from '../core/plans/progress.js';
import type { Store, StudioGateNeed } from '../core/store.js';
import type { DaemonUp } from '../net/studio/handler.js';
import { OPID_KEEP_MS, OpLog, callRefusal, checkAction, opIdOf, opKey, wrapCustomerText, type ActionContext, type InternalCall, type PlanFacts } from './actions.js';
import { refOf, studioInboxPath, type StudioConfig } from './keys.js';
import type { Deliver } from './link.js';
import type { StudioExtras } from './publish.js';
import { REFUSAL_CODES, StudioReceipt, type RefusalCode, type StudioAction, type StudioGate } from './protocol.js';

/**
 * The customer actions the hub hands this daemon (docs/studio-gates.md §2).
 *
 * Every action goes through M1's own whitelist a second time (`checkAction`, `callRefusal`), runs
 * at most once (an opId's receipt is kept 14 days, in a file that survives a restart), and comes
 * back as a receipt that carries a code, never the daemon's own words. The inbox can't reach
 * `plans.approve`: its executor has no such call, and a start or a change request only ever asks
 * `gates` for a Gate (§3).
 *
 * Actions are handled one at a time in arrival order. The link only delivers after the full
 * snapshot and `synced` (docs/studio-daemon.md §4), so an action is never run against a view the
 * customer has not been shown. The state read, `checkAction`, `callRefusal`, the pending marker and
 * a synchronous call all happen without an `await` in between: a `draftRev` a customer confirmed
 * cannot move between the check and the call. `createPlan` and `verify` are the only async calls,
 * and neither is bound to a `draftRev`.
 */

export interface InboxExec {
  /** A plan from the customer's words: operator defaults (gated autonomy, quiet) and a restricted first turn. */
  createPlan(projectId: string, wrappedGoal: string): Promise<{ planId: string }>;
  /** Ask for the draft to be reviewed (BLG-772). Never with `thenApprove`: only the Gate starts a plan. */
  verify(planId: string): Promise<void>;
  pass(planId: string, milestoneId: string): void;
  sendBack(planId: string, milestoneId: string, wrappedNote: string): void;
  discard(planId: string): void;
  answer(qid: string, a: { kind: 'answers'; answers: Record<string, string> }): void;
}

/** The Gate side of the inbox (BLG-74). `dump`/`restore` keep its records in the inbox's one file. */
export interface GatePlug {
  request(p: Plan, kind: 'start' | 'changes', draftRev: number, opId: string, by?: string): RefusalCode | undefined;
  /** The Gate a customer's plan shows, if any. */
  view?(planId: string): StudioGate | undefined;
  /** The pending Gates a screen draws (the store's `studio.gates`). */
  needs?(): readonly StudioGateNeed[];
  /** Unlinked: pending Gates are void. */
  unlink?(): void;
  dump?(): unknown;
  restore?(rows: unknown): void;
}

/** The chat side (BLG-78): it queues the customer's words and turns the agent's reply into turns. */
export interface ChatPlug {
  accept(p: Plan, opId: string, text: string): RefusalCode | undefined;
  extras?(planId: string): Pick<StudioExtras, 'turns' | 'typing' | 'moreTurns'>;
  dump?(): unknown;
  restore?(rows: unknown): void;
}

export interface InboxPlugs {
  readonly gates: GatePlug;
  readonly chat: ChatPlug;
  readonly decisions: (p: Plan, view: PlanView) => PlanFacts['decisions'];
}

export const NULL_GATES: GatePlug = { request: () => 'not-allowed' };
export const NULL_CHAT: ChatPlug = { accept: () => 'not-allowed' };
export const NO_DECISIONS: InboxPlugs['decisions'] = () => ({});

export interface InboxDeps {
  readonly store: Store;
  readonly config: () => StudioConfig | undefined;
  readonly exec: InboxExec;
  readonly plugs?: Partial<InboxPlugs>;
  readonly send: (frame: DaemonUp) => boolean;
  readonly file?: string;
  readonly now?: () => number;
  readonly log?: (line: string) => void;
}

interface Saved {
  readonly v: 1;
  readonly ops: Array<[string, { readonly at: number; readonly receipt: StudioReceipt }]>;
  readonly pending: Array<[string, { readonly at: number }]>;
  readonly gates?: unknown;
  readonly chat?: unknown;
}

const done = (opId: string, planRef?: string): StudioReceipt => ({ t: 'receipt', opId, state: 'done', ...(planRef ? { planRef } : {}) });
const refused = (opId: string, code: RefusalCode): StudioReceipt => ({ t: 'receipt', opId, state: 'refused', code });

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

const receiptsOf = (raw: unknown): Array<[string, { at: number; receipt: StudioReceipt }]> => {
  if (!Array.isArray(raw)) return [];
  const out: Array<[string, { at: number; receipt: StudioReceipt }]> = [];
  for (const row of raw) {
    if (!Array.isArray(row) || typeof row[0] !== 'string' || typeof row[1] !== 'object' || row[1] === null) continue;
    const entry = row[1] as { at?: unknown; receipt?: unknown };
    const receipt = StudioReceipt.safeParse(entry.receipt);
    if (typeof entry.at === 'number' && Number.isFinite(entry.at) && receipt.success) out.push([row[0], { at: entry.at, receipt: receipt.data }]);
  }
  return out;
};

const pendingOf = (raw: unknown): Array<[string, { at: number }]> => {
  if (!Array.isArray(raw)) return [];
  const out: Array<[string, { at: number }]> = [];
  for (const row of raw) {
    if (!Array.isArray(row) || typeof row[0] !== 'string' || typeof row[1] !== 'object' || row[1] === null) continue;
    const at = (row[1] as { at?: unknown }).at;
    if (typeof at === 'number' && Number.isFinite(at)) out.push([row[0], { at }]);
  }
  return out;
};

export class StudioInbox {
  private readonly store: Store;
  private readonly config: () => StudioConfig | undefined;
  private readonly exec: InboxExec;
  private readonly plugs: InboxPlugs;
  private readonly send: (frame: DaemonUp) => boolean;
  private readonly file: string;
  private readonly now: () => number;
  private readonly log: (line: string) => void;

  private ops = new OpLog();
  private readonly pending = new Map<string, { at: number }>();
  private readonly queue: Deliver[] = [];
  private draining = false;

  constructor(d: InboxDeps) {
    this.store = d.store;
    this.config = d.config;
    this.exec = d.exec;
    this.plugs = { gates: d.plugs?.gates ?? NULL_GATES, chat: d.plugs?.chat ?? NULL_CHAT, decisions: d.plugs?.decisions ?? NO_DECISIONS };
    this.send = d.send;
    this.file = d.file ?? studioInboxPath();
    this.now = d.now ?? Date.now;
    this.log = d.log ?? (() => undefined);
    this.load();
  }

  /** One action from the hub: queued, then run one at a time in the order they arrived. Never throws. */
  deliver(f: Deliver): void {
    this.queue.push(f);
    if (this.draining) return;
    this.draining = true;
    void this.drain();
  }

  /** What the customer sees of this plan beyond the plan itself: the chat's turns and the Gate. */
  extras(planId: string): StudioExtras {
    const chat = this.plugs.chat.extras?.(planId) ?? {};
    const gate = this.plugs.gates.view?.(planId);
    return { ...chat, ...(gate ? { gate } : {}) };
  }

  /** The pending Gates for the store's `studio.gates` (a screen's NeedsYou). */
  gateNeeds(): readonly StudioGateNeed[] {
    return this.plugs.gates.needs?.() ?? [];
  }

  /** Unlinked: the Gates pending go void; the opId receipts stay (a new studio can't reuse them anyway). */
  unlink(): void {
    this.plugs.gates.unlink?.();
    this.persist();
  }

  /** Write the file now (the Gate and chat plugs call this after they change something). */
  persist(): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
      const tmp = `${this.file}.${process.pid}.tmp`;
      const saved: Saved = {
        v: 1,
        ops: this.ops.entries(),
        pending: [...this.pending],
        gates: this.plugs.gates.dump?.() ?? [],
        chat: this.plugs.chat.dump?.() ?? [],
      };
      writeFileSync(tmp, `${JSON.stringify(saved)}\n`, { mode: 0o600 });
      renameSync(tmp, this.file);
    } catch (err) {
      // The records in memory are still good; the next successful write catches the file up.
      this.log(`could not save ${this.file}: ${messageOf(err)}`);
    }
  }

  // --- Reading and writing the file ---

  private load(): void {
    let text: string;
    try {
      text = readFileSync(this.file, 'utf8');
    } catch {
      return;
    }
    let saved: Saved | undefined;
    try {
      const raw = JSON.parse(text) as Partial<Saved> | null;
      if (raw && raw.v === 1) saved = raw as Saved;
    } catch {
      saved = undefined;
    }
    if (!saved) return;
    this.ops = new OpLog(receiptsOf(saved.ops));
    for (const entry of pendingOf(saved.pending)) this.pending.set(entry[0], entry[1]);
    this.prune();
    this.plugs.gates.restore?.(saved.gates);
    this.plugs.chat.restore?.(saved.chat);
  }

  private prune(): void {
    const now = this.now();
    this.ops.prune(now);
    for (const [key, p] of this.pending) if (p.at < now - OPID_KEEP_MS) this.pending.delete(key);
  }

  // --- One action ---

  private async drain(): Promise<void> {
    try {
      for (;;) {
        const f = this.queue.shift();
        if (!f) break;
        try {
          await this.handle(f);
        } catch (err) {
          // handle() keeps its own errors; this is the last line of defence for the link.
          this.log(`studio action failed: ${messageOf(err)}`);
        }
      }
    } finally {
      this.draining = false;
    }
  }

  private async handle(f: Deliver): Promise<void> {
    const cfg = this.config();
    const action: StudioAction = f.action;
    const opId = opIdOf(action);
    if (!cfg) {
      this.log('an action arrived with no Studio link; dropped');
      return;
    }
    if (!opId) {
      this.log('an action with no usable opId was dropped');
      return;
    }
    const requested = (action as { planRef?: unknown }).planRef;
    const planRef = typeof requested === 'string' ? requested : undefined;
    const scope = { studio: cfg.studioId, project: f.project, ...(planRef !== undefined ? { plan: planRef } : {}) };
    const key = opKey(scope, opId);

    // Already answered: the first receipt, unchanged (the hub may send an action twice).
    const first = this.ops.seen(key);
    if (first) {
      this.send(first);
      return;
    }
    // Written just before an execution that a restart interrupted: at most once, so don't run it again.
    if (this.pending.has(key)) {
      this.finish(key, refused(opId, 'already-done'));
      return;
    }

    const projectId = this.projectOf(cfg, f.project);
    if (!projectId) {
      this.finish(key, refused(opId, 'not-yours'));
      return;
    }
    const plan = planRef !== undefined ? this.planOf(cfg, projectId, planRef) : undefined;
    // A plan.create names no plan; any other action must name one of this project's plans.
    if (planRef !== undefined && !plan) {
      this.finish(key, refused(opId, 'unknown-plan'));
      return;
    }

    const view = plan ? planView(plan, this.store.getState().board) : undefined;
    const ctx: ActionContext = {
      scope,
      projectId,
      ...(plan && view ? { plan: this.factsOf(plan, view) } : {}),
      seen: (k) => this.ops.seen(k),
    };
    const verdict = checkAction(action, ctx);
    if (!verdict.ok) {
      this.log(`${verdict.code} for ${action.kind}: ${verdict.reason}`);
      this.finish(key, refused(opId, verdict.code));
      return;
    }
    if ('replay' in verdict) {
      this.send(verdict.replay);
      return;
    }

    const by = typeof (f as Deliver & { by?: unknown }).by === 'string' ? (f as Deliver & { by: string }).by.slice(0, 100) : undefined;
    if ('gate' in verdict && verdict.gate) {
      // A start or a change request: the Gate is the only thing it produces. No plans.* call here.
      const code = this.plugs.gates.request(plan!, verdict.gate.kind, verdict.gate.draftRev, opId, by);
      this.finish(key, code ? refused(opId, code) : done(opId, planRef));
      return;
    }
    const call = (verdict as { readonly call: InternalCall }).call;
    const why = callRefusal(call.method, call.args);
    if (why) {
      // The daemon's own second look. The reason stays here; the customer gets only the code.
      this.log(`${call.method} refused: ${why}`);
      this.finish(key, refused(opId, 'not-allowed'));
      return;
    }

    // First seen now: from here to the call there is no await for a synchronous call (see the class comment).
    this.pending.set(key, { at: this.now() });
    this.persist();
    const bound = typeof (action.payload as { draftRev?: unknown }).draftRev === 'number' ? (action.payload as { draftRev: number }).draftRev : undefined;
    try {
      const result = await this.run(call, action, plan, opId, projectId);
      if (result.refusal) this.finish(key, refused(opId, result.refusal));
      else this.finish(key, done(opId, result.planRef));
    } catch (err) {
      this.log(`${call.method} failed: ${messageOf(err)}`);
      this.finish(key, refused(opId, this.codeOf(err, plan?.id, bound)));
    }
  }

  private async run(
    call: InternalCall,
    action: StudioAction,
    plan: Plan | undefined,
    opId: string,
    projectId: string,
  ): Promise<{ planRef?: string; refusal?: RefusalCode }> {
    const [a, b, c] = call.args;
    switch (call.method) {
      case 'plans.create': {
        const result = await this.exec.createPlan(projectId, String((a as { goal?: unknown } | undefined)?.goal ?? ''));
        const cfg = this.config();
        return cfg ? { planRef: refOf(cfg.refKey, 'plan', result.planId) } : {};
      }
      case 'plans.verify':
        await this.exec.verify(String(a));
        return {};
      case 'plans.pass':
        this.exec.pass(String(a), String(b));
        return {};
      case 'plans.sendBack':
        this.exec.sendBack(String(a), String(b), String(c));
        return {};
      case 'plans.discard':
        this.exec.discard(String(a));
        return {};
      case 'questions.answer':
        this.exec.answer(String(a), b as { kind: 'answers'; answers: Record<string, string> });
        return {};
      case 'session.submit': {
        // Only the customer's own words, never the wrapped text: chat.accept wraps it when it submits.
        const code = this.plugs.chat.accept(plan!, opId, action.kind === 'chat.send' ? action.payload.text : '');
        return code ? { refusal: code } : {};
      }
      default:
        return { refusal: 'not-allowed' };
    }
  }

  /** After a call threw: a `stale` if the draft moved, `not-open` if the plan is gone, else `not-allowed`. */
  private codeOf(err: unknown, planId: string | undefined, boundRev: number | undefined): RefusalCode {
    const code = (err as { code?: unknown } | null)?.code;
    if (typeof code === 'string' && (REFUSAL_CODES as readonly string[]).includes(code)) return code as RefusalCode;
    const plan = planId ? this.store.getState().plans.plans.find((p) => p.id === planId) : undefined;
    if (!plan) return 'not-open';
    if (boundRev !== undefined && plan.draftRev !== boundRev) return 'stale';
    return 'not-allowed';
  }

  private finish(key: string, receipt: StudioReceipt): void {
    this.pending.delete(key);
    this.ops.record(key, receipt, this.now());
    this.persist();
    if (!this.send(receipt)) this.log(`receipt ${receipt.opId} not sent: the link is offline (it replays on the next delivery)`);
  }

  // --- Looking up the customer's names in this daemon's own ---

  private projectOf(cfg: StudioConfig, ref: string): string | undefined {
    return Object.keys(cfg.projects).find((id) => refOf(cfg.refKey, 'project', id) === ref);
  }

  private planOf(cfg: StudioConfig, projectId: string, ref: string): Plan | undefined {
    return this.store
      .getState()
      .plans.plans.find((plan) => plan.projectId === projectId && refOf(cfg.refKey, 'plan', plan.id) === ref);
  }

  private factsOf(plan: Plan, view: PlanView): PlanFacts {
    const milestones: Record<string, { id: string; awaitingReview: boolean }> = {};
    view.milestones.forEach((m, i) => {
      milestones[`m${i}`] = { id: m.milestone.id, awaitingReview: m.state === 'gate' };
    });
    return {
      id: plan.id,
      started: Boolean(plan.body),
      draftRev: plan.draftRev,
      home: plan.home,
      milestones,
      decisions: this.plugs.decisions(plan, view),
    };
  }
}

/** The customer's words, wrapped for an agent (re-exported here so a caller has one import for the flow). */
export { wrapCustomerText };
