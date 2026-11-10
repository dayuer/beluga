import type { BoardState } from '../core/board/model.js';
import type { Plan } from '../core/plans/model.js';
import { planView } from '../core/plans/progress.js';
import type { Store } from '../core/store.js';
import { DaemonUp } from '../net/studio/handler.js';
import { refOf, type StudioConfig } from './keys.js';
import type { DaemonUpFor } from './link.js';
import { PlanFrame, STUDIO_PROTO, type StudioGate, type StudioPlanView, type StudioTurn } from './protocol.js';
import { studioPlanView } from './view.js';

/**
 * What a plan looks like to a customer, kept current (docs/studio-daemon.md §5).
 *
 * The publisher watches the store, builds the customer view with M1's own builder (`studioPlanView`,
 * so the whitelist and the sanitizer decide what may leave), and sends the hub a `patch` with only
 * the top-level fields that changed. On a connection it hands the link one full `for` frame per
 * plan; when a plan is gone it sends `plan-gone`. Nothing is sent for a project the person hasn't
 * shared, and a frame is only ever handed to `send` after the hub's own `DaemonUp` accepts it.
 *
 * The store is watched by reference (plans, board), coalesced with a trailing debounce and a max
 * wait, and every refresh is a diff: an unchanged plan produces no frame at all.
 */

/** What M4's chat and gates add to a plan's view; M3 leaves it undefined. */
export interface StudioExtras {
  readonly turns?: readonly StudioTurn[];
  readonly typing?: boolean;
  readonly moreTurns?: boolean;
  readonly gate?: StudioGate;
}

export interface PublishTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
}

const realTimers: PublishTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

export const DEBOUNCE_MS = 250;
export const MAX_WAIT_MS = 750;
/** A full snapshot asked for again this soon after the last is dropped: never a patch→resync loop. */
export const RESYNC_MIN_MS = 5_000;
/** At most RESYNC_MAX answers to `resync` in any RESYNC_WINDOW_MS: a hub can't make us work for free. */
export const RESYNC_WINDOW_MS = 10_000;
export const RESYNC_MAX = 100;

/** Keys in a fixed order, so two views made by the same builder compare by what they say, not by key order. */
function stable(value: unknown, depth = 0): string {
  if (depth > 32) return '"[deep]"';
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((v) => stable(v, depth + 1)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v, depth + 1)}`).join(',')}}`;
}

const same = (a: unknown, b: unknown): boolean => stable(a) === stable(b);

/**
 * The fields of a view that changed. `planRef` never moves, so it never travels in `set`; `turns`
 * travels whole (the hub replaces them) only when they changed. Undefined when nothing did.
 */
export function diffView(prev: StudioPlanView, next: StudioPlanView): { set?: Partial<StudioPlanView>; turns?: StudioTurn[] } | undefined {
  const set: Record<string, unknown> = {};
  for (const key of Object.keys(next) as (keyof StudioPlanView)[]) {
    if (key === 'planRef' || key === 'turns') continue;
    if (!same(prev[key], next[key])) set[key] = next[key];
  }
  const turnsChanged = !same(prev.turns, next.turns);
  if (Object.keys(set).length === 0 && !turnsChanged) return undefined;
  return {
    ...(Object.keys(set).length > 0 ? { set: set as Partial<StudioPlanView> } : {}),
    ...(turnsChanged ? { turns: [...next.turns] } : {}),
  };
}

/** A field that was there and isn't any more (`review`, `draftDiff`, `gate`): a patch cannot delete it. */
function lostField(prev: StudioPlanView, next: StudioPlanView): boolean {
  return Object.keys(prev).some((key) => key !== 'planRef' && !(key in next));
}

interface Baseline {
  readonly projectId: string;
  readonly planRef: string;
  readonly projectRef: string;
  view: StudioPlanView;
  rev: number;
}

export class StudioPublisher {
  private readonly store: Store;
  private readonly config: () => StudioConfig | undefined;
  private readonly send: (frame: DaemonUp) => boolean;
  private readonly extras?: (planId: string) => StudioExtras;
  /** Where the refs the hub was told about are kept, so a plan deleted while we were off is retracted. */
  private readonly remember?: (projectId: string, planRefs: readonly string[]) => void;
  private readonly debounceMs: number;
  private readonly maxWaitMs: number;
  private readonly timers: PublishTimers;
  private readonly now: () => number;

  private readonly baseline = new Map<string, Baseline>();
  private readonly revs = new Map<string, number>();
  private readonly lastResync = new Map<string, number>();
  private readonly lastProjectResync = new Map<string, number>();
  private resyncWindow = { at: 0, n: 0 };
  private plansRef: unknown;
  private boardRef: unknown;
  private unsub: (() => void) | undefined;
  private tailTimer: unknown;
  private maxTimer: unknown;
  private online = false;
  private dirty = false;
  private lastError: string | undefined;
  private pushedAt: number | undefined;

  constructor(d: {
    readonly store: Store;
    readonly config: () => StudioConfig | undefined;
    readonly send: (frame: DaemonUp) => boolean;
    readonly extras?: (planId: string) => StudioExtras;
    readonly remember?: (projectId: string, planRefs: readonly string[]) => void;
    readonly debounceMs?: number;
    readonly maxWaitMs?: number;
    readonly timers?: PublishTimers;
    readonly now?: () => number;
  }) {
    this.store = d.store;
    this.config = d.config;
    this.send = d.send;
    if (d.extras) this.extras = d.extras;
    if (d.remember) this.remember = d.remember;
    this.debounceMs = d.debounceMs ?? DEBOUNCE_MS;
    this.maxWaitMs = d.maxWaitMs ?? MAX_WAIT_MS;
    this.timers = d.timers ?? realTimers;
    this.now = d.now ?? Date.now;
  }

  start(): void {
    if (this.unsub) return;
    this.unsub = this.store.subscribe(() => this.changed());
    this.changed();
  }

  stop(): void {
    this.unsub?.();
    this.unsub = undefined;
    for (const id of [this.tailTimer, this.maxTimer]) if (id !== undefined) this.timers.clearTimeout(id);
    this.tailTimer = undefined;
    this.maxTimer = undefined;
  }

  /** What the service's status shows: the last problem this publisher hit and when it last pushed. */
  status(): { readonly lastError?: string; readonly lastPushAt?: number; readonly plans: number } {
    return { ...(this.lastError !== undefined ? { lastError: this.lastError } : {}), ...(this.pushedAt !== undefined ? { lastPushAt: this.pushedAt } : {}), plans: this.baseline.size };
  }

  // --- SnapshotSource ---

  /** The shared projects, as the hub's project refs and their names (for `hello`). */
  projects(): { id: string; name: string }[] {
    const cfg = this.config();
    if (!cfg) return [];
    const state = this.store.getState();
    return Object.keys(cfg.projects)
      .slice(0, 200)
      .map((projectId) => ({
        id: refOf(cfg.refKey, 'project', projectId),
        // Never fall back to the id: it can be `local:/Users/…`, and a name is all the hub needs.
        name: (state.projects.find((p) => p.id === projectId)?.name ?? 'Project').slice(0, 200),
      }));
  }

  /** Every plan of a shared project as a full frame, plus `plan-gone` for what the hub still holds and we don't. */
  snapshot(): DaemonUpFor[] {
    const cfg = this.config();
    if (!cfg) return [];
    const frames: DaemonUpFor[] = [];
    const visible = this.visible(cfg);
    /** projectId → the plan refs this snapshot publishes. */
    const sent = new Map<string, Set<string>>();
    for (const [planId, { plan, projectId, projectRef }] of visible) {
      let view: StudioPlanView;
      try {
        view = this.build(plan, cfg);
      } catch {
        // It can't be shown this time: its old view at the hub goes with the retraction below.
        this.badView();
        this.baseline.delete(planId);
        continue;
      }
      // A plan that changed project (import, a moved plan) still has its old project's view at the
      // hub: say it's gone there before the new full frame.
      const was = this.baseline.get(planId);
      if (was && was.projectRef !== projectRef) {
        frames.push({ t: 'for', project: was.projectRef, frame: { t: 'plan-gone', planRef: was.planRef } });
        this.unremember(was.projectId, was.planRef);
        this.revs.delete(was.planRef);
      }
      const rev = this.nextRev(view.planRef);
      frames.push({ t: 'for', project: projectRef, frame: { t: 'plan', rev, view } });
      this.baseline.set(planId, { projectId, planRef: view.planRef, projectRef, view, rev });
      this.rememberRef(projectId, view.planRef);
      const list = sent.get(projectId) ?? new Set<string>();
      list.add(view.planRef);
      sent.set(projectId, list);
    }
    // What this run doesn't publish any more (a plan deleted or unshared while we were off, a plan
    // that can't build): the hub has no TTL, so say so now or the customer keeps seeing it.
    for (const [projectId, refs] of Object.entries(cfg.published ?? {})) {
      const projectRef = refOf(cfg.refKey, 'project', projectId);
      const keep = sent.get(projectId) ?? new Set<string>();
      for (const planRef of refs) {
        if (keep.has(planRef)) continue;
        frames.push({ t: 'for', project: projectRef, frame: { t: 'plan-gone', planRef } });
        this.unremember(projectId, planRef);
        this.revs.delete(planRef);
      }
    }
    // Gone from this run's baseline too (a plan that was published, then deleted): nothing more to do.
    for (const [planId, base] of [...this.baseline]) {
      if (visible.has(planId)) continue;
      this.baseline.delete(planId);
    }
    this.online = true;
    if (frames.length > 0) this.pushedAt = this.now();
    return frames;
  }

  /** The hub wants a project (or one plan) again: one full frame each, at most every five seconds per plan. */
  onResync(project: string, planRef?: string): void {
    const cfg = this.config();
    if (!cfg) return;
    const now = this.now();
    // A hub that asks far too often doesn't get to make us scan the whole baseline each time.
    if (now - this.resyncWindow.at > RESYNC_WINDOW_MS) this.resyncWindow = { at: now, n: 0 };
    this.resyncWindow.n++;
    if (this.resyncWindow.n > RESYNC_MAX) return;
    if (planRef === undefined) {
      const last = this.lastProjectResync.get(project);
      if (last !== undefined && now - last < RESYNC_MIN_MS) return;
      this.lastProjectResync.set(project, now);
    }
    const targets = [...this.baseline].filter(([, base]) => base.projectRef === project && (planRef === undefined || base.planRef === planRef));
    if (targets.length === 0) return;
    const visible = this.visible(cfg);
    for (const [planId, base] of targets) {
      const last = this.lastResync.get(base.planRef);
      if (last !== undefined && now - last < RESYNC_MIN_MS) continue;
      this.lastResync.set(base.planRef, now);
      const plan = visible.get(planId)?.plan;
      if (!plan) {
        this.sendGone(base.projectId, base.projectRef, base.planRef, planId);
        continue;
      }
      let view: StudioPlanView;
      try {
        view = this.build(plan, cfg);
      } catch {
        this.badView();
        continue;
      }
      this.sendFull(planId, base.projectId, base.projectRef, view);
    }
  }

  onOnline(): void {
    this.online = true;
    if (this.dirty) {
      this.dirty = false;
      this.refresh();
    }
  }

  /**
   * Unlinking: one last `plan-gone` per published plan, best effort, so nothing of this daemon stays
   * on the customer's side after its file is gone (docs/studio-daemon.md §7.1).
   */
  leave(): void {
    for (const [planId, base] of [...this.baseline]) this.sendGone(base.projectId, base.projectRef, base.planRef, planId);
    // Refs the hub was told about that this run never published (a plan deleted while we were off).
    const cfg = this.config();
    if (!cfg) return;
    for (const [projectId, refs] of Object.entries(cfg.published ?? {})) {
      const projectRef = refOf(cfg.refKey, 'project', projectId);
      for (const planRef of refs) {
        if (this.push({ t: 'for', project: projectRef, frame: { t: 'plan-gone', planRef } })) this.unremember(projectId, planRef);
      }
    }
  }

  /** `studio.setProject` changed the set: tell the hub the new project list, then the plans that moved. */
  projectsChanged(): void {
    const cfg = this.config();
    if (!cfg) return;
    // The hub allows a second hello mid-connection: its project list is replaced whole.
    const hello: DaemonUp = { t: 'hello', proto: STUDIO_PROTO, daemon: cfg.daemonId, projects: this.projects() };
    if (!this.push(hello)) return;
    this.online = true;
    const shared = new Set(Object.keys(cfg.projects).map((projectId) => refOf(cfg.refKey, 'project', projectId)));
    // What is no longer shared is gone from the customer's side, even if the hub's mapping stays.
    for (const [planId, base] of [...this.baseline]) {
      if (shared.has(base.projectRef)) continue;
      if (!this.sendGone(base.projectId, base.projectRef, base.planRef, planId)) return;
    }
    this.refresh();
  }

  // --- Refreshing ---

  private changed(): void {
    const state = this.store.getState();
    if (state.plans === this.plansRef && state.board === this.boardRef) return;
    this.plansRef = state.plans;
    this.boardRef = state.board;
    this.schedule();
  }

  private schedule(): void {
    if (this.tailTimer === undefined) {
      this.tailTimer = this.timers.setTimeout(() => {
        this.tailTimer = undefined;
        if (this.maxTimer !== undefined) this.timers.clearTimeout(this.maxTimer);
        this.maxTimer = undefined;
        this.refresh();
      }, this.debounceMs);
    }
    if (this.maxTimer === undefined) {
      this.maxTimer = this.timers.setTimeout(() => {
        this.maxTimer = undefined;
        if (this.tailTimer !== undefined) this.timers.clearTimeout(this.tailTimer);
        this.tailTimer = undefined;
        this.refresh();
      }, this.maxWaitMs);
    }
  }

  private refresh(): void {
    const cfg = this.config();
    if (!cfg) return;
    if (!this.online) {
      this.dirty = true;
      return;
    }
    const visible = this.visible(cfg);
    for (const [planId, base] of [...this.baseline]) {
      if (visible.has(planId)) continue;
      if (!this.sendGone(base.projectId, base.projectRef, base.planRef, planId)) return;
    }
    for (const [planId, { plan, projectId, projectRef }] of visible) {
      let view: StudioPlanView;
      try {
        view = this.build(plan, cfg);
      } catch {
        this.badView();
        continue;
      }
      const base = this.baseline.get(planId);
      if (base && base.projectRef !== projectRef) {
        // It moved project: the old project's cached view has to go, then the new one is full.
        if (!this.sendGone(base.projectId, base.projectRef, base.planRef, planId)) return;
      }
      if (!base || base.planRef !== view.planRef || base.projectRef !== projectRef) {
        this.sendFull(planId, projectId, projectRef, view);
        continue;
      }
      // A field that went away can't be expressed as a patch (the hub merges), so check before the
      // diff: `diffView` only looks at what the new view has.
      if (lostField(base.view, view)) {
        this.sendFull(planId, projectId, projectRef, view);
        continue;
      }
      const diff = diffView(base.view, view);
      if (!diff) continue;
      const rev = this.nextRev(view.planRef);
      const frame: DaemonUp = { t: 'patch', project: projectRef, planRef: view.planRef, rev, ...diff };
      const parsed = DaemonUp.safeParse(frame);
      if (!parsed.success) {
        this.badView();
        continue;
      }
      if (!this.send(parsed.data)) {
        this.offline();
        return;
      }
      base.view = view;
      base.rev = rev;
      this.rememberRef(projectId, view.planRef);
      this.pushedAt = this.now();
    }
  }

  private visible(cfg: StudioConfig): Map<string, { plan: Plan; projectId: string; projectRef: string }> {
    const state = this.store.getState();
    const refs = new Map<string, string>();
    for (const projectId of Object.keys(cfg.projects)) refs.set(projectId, refOf(cfg.refKey, 'project', projectId));
    const out = new Map<string, { plan: Plan; projectId: string; projectRef: string }>();
    for (const plan of state.plans.plans) {
      const projectRef = refs.get(plan.projectId);
      if (projectRef === undefined) continue;
      out.set(plan.id, { plan, projectId: plan.projectId, projectRef });
    }
    return out;
  }

  /** The customer's view of one plan, built the one way M1 allows; throws when the plan makes it impossible. */
  private build(plan: Plan, cfg: StudioConfig): StudioPlanView {
    const state = this.store.getState();
    const extra = this.extras?.(plan.id);
    const view = studioPlanView({
      planRef: refOf(cfg.refKey, 'plan', plan.id),
      view: planView(plan, state.board),
      keyPrefixes: keyPrefixesOf(state.board, plan.projectId),
      ...(extra?.turns ? { turns: extra.turns } : {}),
      ...(extra?.typing !== undefined ? { typing: extra.typing } : {}),
      ...(extra?.moreTurns !== undefined ? { moreTurns: extra.moreTurns } : {}),
      ...(extra?.gate ? { gate: extra.gate } : {}),
    });
    // The hub will parse the frame strictly; a view it would refuse is a bug here, never a frame.
    const frame = PlanFrame.safeParse({ t: 'plan', rev: 0, view });
    if (!frame.success) throw new Error('bad-view');
    return frame.data.view;
  }

  private sendFull(planId: string, projectId: string, projectRef: string, view: StudioPlanView): void {
    const rev = this.nextRev(view.planRef);
    const frame: DaemonUpFor = { t: 'for', project: projectRef, frame: { t: 'plan', rev, view } };
    if (!this.push(frame)) return;
    this.baseline.set(planId, { projectId, planRef: view.planRef, projectRef, view, rev });
    this.rememberRef(projectId, view.planRef);
  }

  private sendGone(projectId: string, projectRef: string, planRef: string, planId: string): boolean {
    const frame: DaemonUpFor = { t: 'for', project: projectRef, frame: { t: 'plan-gone', planRef } };
    if (!this.push(frame)) return false;
    this.baseline.delete(planId);
    this.revs.delete(planRef);
    this.lastResync.delete(planRef);
    this.unremember(projectId, planRef);
    return true;
  }

  /** Validate with the hub's own schema, then hand it to the link (the one way out). */
  private push(frame: DaemonUp): boolean {
    const parsed = DaemonUp.safeParse(frame);
    if (!parsed.success) {
      this.lastError = 'bad-frame';
      return false;
    }
    if (!this.send(parsed.data)) {
      this.offline();
      return false;
    }
    this.pushedAt = this.now();
    return true;
  }

  private offline(): void {
    this.online = false;
    this.dirty = true;
  }

  private nextRev(planRef: string): number {
    const rev = (this.revs.get(planRef) ?? 0) + 1;
    this.revs.set(planRef, rev);
    return rev;
  }

  private badView(): void {
    this.lastError = 'bad-view';
  }

  /** The hub was told about this ref: keep it where a later run can retract it. */
  private rememberRef(projectId: string, planRef: string): void {
    const refs = this.config()?.published?.[projectId] ?? [];
    if (refs.includes(planRef)) return;
    this.remember?.(projectId, [...refs, planRef]);
  }

  private unremember(projectId: string, planRef: string): void {
    const refs = this.config()?.published?.[projectId];
    if (!refs?.includes(planRef)) return;
    this.remember?.(projectId, refs.filter((r) => r !== planRef));
  }
}

/** The KEY prefixes a project's tasks may wear: its own board's and any board that covers it. */
export function keyPrefixesOf(board: BoardState, projectId: string): string[] {
  const out = new Set<string>();
  const own = board.projects[projectId]?.prefix;
  if (own) out.add(own);
  for (const [id, project] of Object.entries(board.projects)) {
    if (id === projectId) continue;
    if (project.repos?.includes(projectId) && project.prefix) out.add(project.prefix);
  }
  return [...out];
}
