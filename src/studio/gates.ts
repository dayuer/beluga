import type { Autonomy, Plan } from '../core/plans/model.js';
import { planTitle, reviewState } from '../core/plans/model.js';
import type { Store, StudioGateNeed } from '../core/store.js';
import { OPID_KEEP_MS } from './actions.js';
import { changesSummary } from './draft.js';
import { refOf, type StudioConfig } from './keys.js';
import type { StudioGate } from './protocol.js';

/**
 * The start Gate: the one way a Studio plan begins (docs/studio-gates.md §3).
 *
 * A customer's "confirm the plan" never starts it. It raises this Gate; the operator sees a card
 * on the Mac or the phone and answers. This class is the only place in the repository that holds
 * `approve`, and it calls it exactly once, for a Gate that is still pending and only when the
 * draft the operator is looking at is still the draft the customer confirmed (`draftRev`). A
 * change Gate applies a draft the same way. A plan shared with Studio can never run autopilot:
 * `work.setAutonomy` refuses it, and this class demotes one that was set before sharing.
 */

export const START_DECLINED = '现在还不能开工，工作室会再和你说';
export const STALE_DECLINED = '计划在你确认后有了变化，请看一眼再确认';

export type GateAnswer = { readonly approve: true } | { readonly approve: false; readonly reason?: string };
export type GateAnswerResult = { readonly ok: true; readonly state: 'approved' | 'declined' } | { readonly ok: false; readonly error: 'gone' | 'settled' | 'stale' | 'failed' };

export interface GateRecord {
  readonly id: string;
  /** The studio that asked: a Gate left over from another studio must never surface to this one. */
  readonly studio: string;
  readonly planId: string;
  readonly planRef: string;
  readonly projectId: string;
  readonly kind: 'start' | 'changes';
  state: 'pending' | 'approved' | 'declined' | 'void';
  readonly draftRev: number;
  readonly opId: string;
  readonly askedAt: number;
  readonly by?: string;
  reason?: string;
  settledAt?: number;
}

export interface GatesDeps {
  readonly store: Store;
  readonly config: () => StudioConfig | undefined;
  /** The repository's one `plans.approve`. Injected by service.ts; never called from anywhere else. */
  readonly approve: (planId: string) => void;
  /** Lower a plan (or one milestone) that was autopilot before it was shared. */
  readonly setAutonomy?: (planId: string, autonomy: Autonomy, milestone?: string) => void;
  readonly persist: () => void;
  /** A Gate or the plan changed: let the publisher look again (and the service redraw the store's slice). */
  readonly touch: (planId?: string) => void;
  readonly now?: () => number;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function recordOf(raw: unknown): GateRecord | undefined {
  if (!isRecord(raw)) return undefined;
  const { id, studio, planId, planRef, projectId, kind, state, draftRev, opId, askedAt, by, reason, settledAt } = raw;
  if (typeof id !== 'string' || typeof planId !== 'string' || typeof planRef !== 'string' || typeof projectId !== 'string') return undefined;
  if (kind !== 'start' && kind !== 'changes') return undefined;
  if (state !== 'pending' && state !== 'approved' && state !== 'declined' && state !== 'void') return undefined;
  if (typeof draftRev !== 'number' || !Number.isFinite(draftRev) || typeof opId !== 'string' || typeof askedAt !== 'number' || !Number.isFinite(askedAt)) return undefined;
  return {
    id,
    // A file written before the studio id was kept has none: read it as this studio's once.
    studio: typeof studio === 'string' ? studio : '',
    planId,
    planRef,
    projectId,
    kind,
    state,
    draftRev,
    opId,
    askedAt,
    ...(typeof by === 'string' ? { by } : {}),
    ...(typeof reason === 'string' ? { reason } : {}),
    ...(typeof settledAt === 'number' && Number.isFinite(settledAt) ? { settledAt } : {}),
  };
}

export class StudioGates {
  private readonly store: Store;
  private readonly config: () => StudioConfig | undefined;
  private readonly approve: (planId: string) => void;
  private readonly setAutonomy?: (planId: string, autonomy: Autonomy, milestone?: string) => void;
  private readonly persist: () => void;
  private readonly touch: (planId?: string) => void;
  private readonly now: () => number;

  private records: GateRecord[] = [];
  /** The Gate whose `approve` call is running: the store's own reconcile must not mistake it for stale. */
  private approving: string | undefined;
  private reconciling = false;
  private readonly unsub: () => void;

  constructor(d: GatesDeps) {
    this.store = d.store;
    this.config = d.config;
    this.approve = d.approve;
    this.persist = d.persist;
    this.touch = d.touch;
    this.now = d.now ?? Date.now;
    if (d.setAutonomy) this.setAutonomy = d.setAutonomy;
    this.unsub = this.store.subscribe(() => this.reconcile());
  }

  stop(): void {
    this.unsub();
  }

  /** A start or change request from the inbox: a Gate, or the code that says why not. */
  request(plan: Plan, kind: 'start' | 'changes', draftRev: number, opId: string, by?: string): 'not-open' | 'not-allowed' | undefined {
    const cfg = this.config();
    if (!cfg || !cfg.projects[plan.projectId]) return 'not-allowed';
    if (kind === 'start') {
      const draft = plan.draft ?? plan.body;
      // Nothing to start without milestones; and a fresh agent's review is already on its way (BLG-772).
      if (!draft?.milestones.length || reviewState(plan) === 'reviewing') return 'not-open';
    } else if (!plan.draft) {
      // An "apply the changes" Gate without a draft has nothing to apply (it would fail on approve).
      return 'not-open';
    }
    // One Gate at a time per plan: the same draft keeps the card the operator already has.
    const pending = this.records.find((g) => g.planId === plan.id && g.state === 'pending');
    if (pending && pending.draftRev === draftRev) return undefined;
    if (pending) pending.state = 'void';

    // The opId is scoped to a plan, so the same opId may legally name a request on two plans (the
    // hub keys them separately). A Gate id must still be unique across every card: the operator
    // answers by it, and a collision would start the other plan (audit F2).
    const base = `g-${opId.slice(0, 8)}`;
    let id = base;
    for (let n = 1; this.records.some((g) => g.id === id); n++) id = `${base}-${n}`;
    const record: GateRecord = {
      id,
      studio: cfg.studioId,
      planId: plan.id,
      planRef: refOf(cfg.refKey, 'plan', plan.id),
      projectId: plan.projectId,
      kind,
      state: 'pending',
      draftRev,
      opId,
      askedAt: this.now(),
      ...(by ? { by } : {}),
    };
    this.records.push(record);
    this.persist();
    this.touch(plan.id);
    return undefined;
  }

  /** The operator's answer, from the Mac or the phone. Binds the Gate to the draft it was raised for. */
  answer(gateId: string, a: GateAnswer): GateAnswerResult {
    const gate = this.records.find((g) => g.id === gateId);
    if (!gate || gate.state === 'void') return { ok: false, error: 'gone' };
    if (gate.state !== 'pending') return { ok: false, error: 'settled' };
    const cfg = this.config();
    // The project was unshared, or this Gate was another studio's: it can't start anything here.
    if (!cfg || !cfg.projects[gate.projectId] || (gate.studio && gate.studio !== cfg.studioId)) {
      gate.state = 'void';
      this.changed(gate.planId);
      return { ok: false, error: 'gone' };
    }
    const plan = this.plan(gate.planId);
    if (!plan) {
      gate.state = 'void';
      this.changed(gate.planId);
      return { ok: false, error: 'gone' };
    }

    if (!a.approve) {
      const reason = (a.reason ?? '').trim().slice(0, 1000) || START_DECLINED;
      gate.state = 'declined';
      gate.reason = reason;
      gate.settledAt = this.now();
      this.changed(gate.planId);
      return { ok: true, state: 'declined' };
    }

    // The draft moved since the customer confirmed it: approve nothing; say why.
    if (plan.draftRev !== gate.draftRev) {
      gate.state = 'declined';
      gate.reason = STALE_DECLINED;
      gate.settledAt = this.now();
      this.changed(gate.planId);
      return { ok: false, error: 'stale' };
    }
    // A start Gate with a body already: it was started elsewhere (the Mac's plan page). Nothing to call.
    if (gate.kind === 'start' && plan.body) {
      gate.state = 'approved';
      gate.settledAt = this.now();
      this.changed(gate.planId);
      return { ok: true, state: 'approved' };
    }

    this.approving = gate.id;
    try {
      // Exactly once, in this same synchronous stretch: nothing can change the draft in between.
      this.approve(gate.planId);
    } catch {
      // The Gate stays pending: the operator can answer again (the plan did not start).
      this.approving = undefined;
      return { ok: false, error: 'failed' };
    }
    this.approving = undefined;
    gate.state = 'approved';
    gate.settledAt = this.now();
    this.changed(gate.planId);
    return { ok: true, state: 'approved' };
  }

  /** The customer's view of this plan's latest Gate (a void one is not shown). */
  viewGate(planId: string): StudioGate | undefined {
    const gate = this.latest(planId);
    if (!gate || gate.state === 'void') return undefined;
    return { kind: gate.kind, state: gate.state, draftRev: gate.draftRev, ...(gate.reason ? { reason: gate.reason } : {}) };
  }

  /** The inbox plug's name for `viewGate` (the publisher merges what it returns into the plan view). */
  view(planId: string): StudioGate | undefined {
    return this.viewGate(planId);
  }

  /** The pending Gates as cards (the store's `studio.gates`). */
  needs(): readonly StudioGateNeed[] {
    const cfg = this.config();
    if (!cfg) return [];
    const shared = new Set(Object.keys(cfg.projects));
    const state = this.store.getState();
    return this.records
      .filter((g) => g.state === 'pending' && shared.has(g.projectId) && (!g.studio || g.studio === cfg.studioId))
      .flatMap((g): StudioGateNeed[] => {
        const plan = this.plan(g.planId);
        if (!plan) return [];
        const body = plan.draft ?? plan.body;
        const added = changesSummary(plan)?.added;
        return [
          {
            id: g.id,
            planId: g.planId,
            kind: g.kind,
            draftRev: g.draftRev,
            askedAt: g.askedAt,
            ...(g.by ?? this.projectName(state, g.projectId) ? { by: g.by ?? this.projectName(state, g.projectId) } : {}),
            title: planTitle(plan).slice(0, 200),
            milestones: body?.milestones.length ?? 0,
            points: this.pointsOf(plan),
            ...(added ? { added } : {}),
          },
        ];
      });
  }

  /**
   * A store change: a plan gone voids its Gate, one started elsewhere is approved, a moved draft or
   * a discarded one is declined; a shared plan that is autopilot is brought back to gated.
   */
  reconcile(): void {
    // Plans off is a daemon shutting down (core/board/launch dispatches plans_off): the plan list
    // being empty there says nothing about the plan being gone, so a pending Gate must stay.
    if (!this.store.getState().plans.enabled) return;
    if (this.reconciling) return;
    this.reconciling = true;
    try {
      let changed = false;
      for (const gate of this.records) {
        if (gate.state !== 'pending' || this.approving === gate.id) continue;
        const plan = this.plan(gate.planId);
        if (!plan) {
          gate.state = 'void';
          changed = true;
          continue;
        }
        if (gate.kind === 'start' && plan.body) {
          gate.state = 'approved';
          gate.settledAt = this.now();
          changed = true;
          continue;
        }
        if (plan.draftRev !== gate.draftRev || (gate.kind === 'changes' && plan.body && !plan.draft)) {
          gate.state = 'declined';
          gate.reason = STALE_DECLINED;
          gate.settledAt = this.now();
          changed = true;
        }
      }
      if (changed) {
        this.persist();
        this.touch();
      }
      this.enforceAutonomy();
    } finally {
      this.reconciling = false;
    }
  }

  /** Shared with Studio: the whole plan and every milestone run gated, never autopilot. */
  private enforceAutonomy(): void {
    const setAutonomy = this.setAutonomy;
    if (!setAutonomy) return;
    const state = this.store.getState();
    const shared = new Set(state.studio.shared);
    if (!shared.size) return;
    for (const plan of state.plans.plans) {
      if (!shared.has(plan.projectId)) continue;
      if (plan.autonomy === 'autopilot') {
        setAutonomy(plan.id, 'gated');
        this.note(plan.home, 'This plan is shared with Synon Studio: autopilot was turned off, it runs gated.');
        continue;
      }
      for (const m of (plan.body ?? plan.draft)?.milestones ?? []) {
        if (m.autonomy !== 'autopilot') continue;
        setAutonomy(plan.id, 'gated', m.id);
        this.note(plan.home, `“${m.title}” ran autopilot in a plan shared with Synon Studio: it runs gated now.`);
      }
    }
  }

  // --- the file's gates section (the inbox owns the file) ---

  dump(): unknown[] {
    return this.records.map((g) => ({ ...g }));
  }

  restore(rows: unknown): void {
    if (!Array.isArray(rows)) return;
    this.records = rows.flatMap((row) => {
      const gate = recordOf(row);
      return gate ? [gate] : [];
    });
    // Keep settled Gates long enough for a client to read the answer; pending ones always.
    const cut = this.now() - OPID_KEEP_MS;
    this.records = this.records.filter((g) => g.state === 'pending' || g.settledAt === undefined || g.settledAt >= cut);
    // A file from another studio (unlinked without a clean unlink, or a key that had to be thrown
    // away): its Gates stay out. A record with no studio in the file is this one's.
    const studio = this.config()?.studioId;
    if (studio) this.records = this.records.filter((g) => !g.studio || g.studio === studio);
  }

  /**
   * Unlinked: every Gate is void. The plan may be shared with another studio later, and a settled
   * answer (or a decline reason) was that studio's, not the next one's.
   */
  unlink(): void {
    for (const gate of this.records) gate.state = 'void';
  }

  // --- helpers ---

  private changed(planId: string): void {
    this.persist();
    this.touch(planId);
  }

  private plan(planId: string): Plan | undefined {
    return this.store.getState().plans.plans.find((p) => p.id === planId);
  }

  private latest(planId: string): GateRecord | undefined {
    let best: GateRecord | undefined;
    // A later record wins a tie (two answers in the same millisecond still show the newest one).
    for (const gate of this.records) if (gate.planId === planId && (!best || gate.askedAt >= best.askedAt)) best = gate;
    return best;
  }

  private projectName(state: ReturnType<Store['getState']>, projectId: string): string | undefined {
    return state.projects.find((p) => p.id === projectId)?.name;
  }

  private pointsOf(plan: Plan): number {
    return ((plan.draft ?? plan.body)?.milestones ?? []).reduce((total, m) => total + m.tasks.reduce((sum, t) => sum + (t.estimate ?? 0), 0), 0);
  }

  private note(channel: string, text: string): void {
    this.store.dispatch({ type: 'system', channel, text, level: 'info' });
  }
}
