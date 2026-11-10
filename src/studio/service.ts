import { dirname, join } from 'node:path';
import os from 'node:os';
import { customerTurns } from '../core/plans/customer-turns.js';
import { parseDecisionQid } from '../core/plans/decisions.js';
import type { Autonomy } from '../core/plans/model.js';
import { needPlans } from '../core/plans/registry.js';
import type { Store } from '../core/store.js';
import { identityPem, type Identity } from '../net/crypto.js';
import { StudioChat, type SayResult, type StudioChatSession } from './chat.js';
import { StudioDecisions } from './decisions.js';
import { StudioGates, type GateAnswer, type GateAnswerResult } from './gates.js';
import { StudioInbox, type InboxExec, type InboxPlugs } from './inbox.js';
import { identityOf, loadStudioConfig, newRefKey, newStudioIdentity, removeStudioConfig, saveStudioConfig, studioPath, type StudioConfig } from './keys.js';
import { StudioLink, defaultHub, hubUrl, registerWithCode, type LinkState, type LinkTimers, type WsFactory } from './link.js';
import { StudioPublisher } from './publish.js';

/**
 * Synon Studio, as the daemon runs it (docs/studio-daemon.md §7).
 *
 * One link and one publisher, tied together: the link says hello, the publisher says what the
 * customer may see (and keeps saying it as plans change). The link's file lives in
 * `~/.beluga/studio.json`; unlinking sends `plan-gone` for what was published, closes the socket,
 * then deletes the file. Nothing here is exposed without `studioOf(session)`, and the status it
 * returns never carries the key or the ref key.
 */

export type StudioProjectStatus = {
  readonly projectId: string;
  readonly shared: boolean;
  readonly plans: number;
};

export interface StudioStatus {
  readonly linked: boolean;
  readonly state: LinkState | 'unlinked';
  readonly hub?: string;
  readonly studioId?: string;
  readonly daemonId?: string;
  readonly name?: string;
  readonly since?: number;
  readonly retryAt?: number;
  readonly lastError?: string;
  readonly projects: readonly StudioProjectStatus[];
  readonly lastPushAt?: number;
}

export type StudioLinkResult = { readonly ok: true; readonly status: StudioStatus } | { readonly ok: false; readonly error: string };

const machineName = (): string => os.hostname().trim().slice(0, 80) || 'Beluga';

/** A service built without a session (the demo, a link-only test): an action can't run anything. */
const MISSING_EXEC: InboxExec = {
  createPlan: async () => {
    throw new Error('Studio has no plans to run here');
  },
  verify: async () => {
    throw new Error('Studio has no plans to run here');
  },
  pass: () => {
    throw new Error('Studio has no plans to run here');
  },
  sendBack: () => {
    throw new Error('Studio has no plans to run here');
  },
  discard: () => {
    throw new Error('Studio has no plans to run here');
  },
  answer: () => {
    throw new Error('Studio has no plans to run here');
  },
};

/** How the inbox runs a customer's action: the daemon's own plans, as the customer, never as the operator. */
export function plansExec(session: object): InboxExec {
  const plans = () => needPlans(session);
  const questions = (session as { questions?: { answer(qid: string, a: { kind: 'answers'; answers: Record<string, string> }): void } }).questions;
  return {
    async createPlan(projectId, wrappedGoal) {
      // The operator's defaults, never the customer's: gated autonomy, quiet, and a restricted first turn.
      const plan = await plans().create({ projectId, goal: wrappedGoal, autonomy: 'gated' }, { quiet: true, customerTurn: true });
      return { planId: plan.id };
    },
    async verify(planId) {
      await plans().verify(planId, false);
    },
    pass: (planId, milestoneId) => void plans().pass(planId, milestoneId),
    sendBack: (planId, milestoneId, wrappedNote) => void plans().sendBack(planId, milestoneId, wrappedNote, { customerTurn: true }),
    discard: (planId) => void plans().discard(planId),
    answer: (qid, a) => {
      if (!questions) throw new Error('This daemon has no questions store');
      // The answer is a customer's (the inbox only runs customer actions): the head Claude's turn
      // that follows it is limited too, exactly like a chat message (docs/studio-gates.md §5.3). If
      // no run comes, customer-turns drops the marker after its grace.
      const decision = parseDecisionQid(qid);
      const plan = decision ? plans().plans.get(decision.plan) : undefined;
      if (plan) customerTurns.begin(plan.home);
      try {
        questions.answer(qid, a);
      } catch (err) {
        if (plan) customerTurns.end(plan.home);
        throw err;
      }
    },
  };
}

export class StudioService {
  private readonly store: Store;
  private readonly demo: boolean;
  private readonly file: string;
  /** Test seams: the hub can be a fake socket and the clock hand-driven. */
  private readonly ws?: WsFactory;
  private readonly timers?: LinkTimers;
  private readonly now: () => number;
  /** What a customer's action runs (the daemon's plans); tests and the demo can leave it out. */
  private readonly exec?: InboxExec;
  /** The repository's one `plans.approve`, and the way to lower an autopilot plan. */
  private readonly approve?: (planId: string) => void;
  private readonly setAutonomy?: (planId: string, autonomy: Autonomy, milestone?: string) => void;
  private readonly chatSession?: StudioChatSession;
  private readonly plugs?: Partial<InboxPlugs>;
  private readonly inboxFile?: string;
  private readonly log?: (line: string) => void;
  private config: StudioConfig | undefined;
  private identity: Identity | undefined;
  private connection: StudioLink | undefined;
  private publisher: StudioPublisher | undefined;
  private inbox: StudioInbox | undefined;
  private gates: StudioGates | undefined;
  private chat: StudioChat | undefined;
  private decisions: StudioDecisions | undefined;
  /** A link is registering right now: two screens can't start two registrations. */
  private linking = false;

  constructor(d: {
    readonly store: Store;
    readonly demo?: boolean;
    readonly file?: string;
    readonly ws?: WsFactory;
    readonly timers?: LinkTimers;
    readonly now?: () => number;
    readonly exec?: InboxExec;
    readonly approve?: (planId: string) => void;
    readonly setAutonomy?: (planId: string, autonomy: Autonomy, milestone?: string) => void;
    readonly session?: StudioChatSession;
    readonly plugs?: Partial<InboxPlugs>;
    readonly inboxFile?: string;
    readonly log?: (line: string) => void;
  }) {
    this.store = d.store;
    this.demo = Boolean(d.demo);
    this.file = d.file ?? studioPath();
    if (d.ws) this.ws = d.ws;
    if (d.timers) this.timers = d.timers;
    this.now = d.now ?? Date.now;
    if (d.exec) this.exec = d.exec;
    if (d.approve) this.approve = d.approve;
    if (d.setAutonomy) this.setAutonomy = d.setAutonomy;
    if (d.session) this.chatSession = d.session;
    if (d.plugs) this.plugs = d.plugs;
    if (d.inboxFile) this.inboxFile = d.inboxFile;
    if (d.log) this.log = d.log;
  }

  /** Read the link's file (if any) and start connecting. Demo runs never read or write it. */
  start(): void {
    if (this.demo || this.connection) return;
    const cfg = loadStudioConfig(this.file);
    if (!cfg) {
      // No link: the shared state still says so (the Mac's bell reads it).
      this.dispatchStudio();
      return;
    }
    let identity: Identity;
    try {
      identity = identityOf(cfg);
    } catch {
      // A corrupt key is no key: unlinked until someone links again (a file we can't remove still blocks a re-link, which unlink reports).
      try {
        removeStudioConfig(this.file);
      } catch {
        // Leave it; the person can remove it.
      }
      this.dispatchStudio();
      return;
    }
    this.config = cfg;
    this.identity = identity;
    this.connect();
  }

  /** The daemon is stopping: close the socket, keep the file for the next run. */
  stop(): void {
    this.publisher?.stop();
    this.connection?.stop();
    this.connection = undefined;
    this.publisher = undefined;
  }

  async link(code: string, hub?: string, name?: string): Promise<StudioLinkResult> {
    if (this.demo) return { ok: false, error: 'demo-mode' };
    if (this.config) return { ok: false, error: 'already-linked' };
    if (this.linking) return { ok: false, error: 'already-linking' };
    this.linking = true;
    try {
      return await this.register(code, hub, name);
    } finally {
      this.linking = false;
    }
  }

  private async register(code: string, hub: string | undefined, name: string | undefined): Promise<StudioLinkResult> {
    const base = hubUrl(hub?.trim() || defaultHub());
    if (!base) return { ok: false, error: 'bad-hub' };
    const who = (name?.trim() || machineName()).slice(0, 80);
    const identity = newStudioIdentity();
    const registered = await registerWithCode({ hub: base, code, name: who, identity });
    if (!registered.ok) return registered;
    // A link or unlink happened while we were waiting: this registration is not ours to keep.
    if (this.config) return { ok: false, error: 'already-linked' };
    const cfg: StudioConfig = {
      v: 1,
      hub: base,
      studioId: registered.studioId,
      daemonId: registered.daemonId,
      name: who,
      linkedAt: this.now(),
      key: identityPem(identity),
      refKey: newRefKey(),
      projects: {},
    };
    try {
      saveStudioConfig(cfg, this.file);
    } catch {
      return { ok: false, error: 'cannot-save' };
    }
    this.config = cfg;
    this.identity = identity;
    this.connect();
    return { ok: true, status: this.status() };
  }

  /** Say `plan-gone` for what was published, close the link, delete the key (even when the link was corrupt). */
  unlink(): StudioStatus {
    this.publisher?.leave();
    this.publisher?.stop();
    this.connection?.stop();
    this.connection = undefined;
    this.publisher = undefined;
    this.identity = undefined;
    this.config = undefined;
    // Pending Gates go void and queued customer words are dropped; the opId receipts stay (an opId
    // is scoped to the studio that made it).
    this.chat?.unlink();
    this.inbox?.unlink();
    this.dispatchStudio();
    let removed = true;
    try {
      removeStudioConfig(this.file);
    } catch {
      // A key file we couldn't delete stays; the person has to be told (status.lastError below).
      removed = false;
    }
    const status = this.status();
    return removed ? status : { ...status, lastError: 'cannot-remove' };
  }

  status(): StudioStatus {
    const cfg = this.config;
    if (!cfg) return { linked: false, state: 'unlinked', projects: this.projectList(undefined) };
    const link = this.connection?.status();
    const published = this.publisher?.status();
    const lastError = published?.lastError ?? link?.lastError;
    return {
      linked: true,
      state: link?.state ?? 'stopped',
      hub: cfg.hub,
      studioId: cfg.studioId,
      daemonId: cfg.daemonId,
      name: cfg.name,
      since: cfg.linkedAt,
      ...(link?.retryAt !== undefined ? { retryAt: link.retryAt } : {}),
      ...(lastError !== undefined ? { lastError } : {}),
      projects: this.projectList(cfg),
      ...(published?.lastPushAt !== undefined ? { lastPushAt: published.lastPushAt } : {}),
    };
  }

  /** Share (or stop sharing) one project with Studio; the hub still has to map it (docs/studio-daemon.md §2.3). */
  setProject(projectId: string, shared: boolean): StudioStatus {
    const cfg = this.config;
    if (!cfg) throw new Error('Studio is not connected');
    if (!this.store.getState().projects.some((p) => p.id === projectId)) throw new Error('No such project');
    const projects = { ...cfg.projects };
    if (shared) {
      if (!projects[projectId]) projects[projectId] = { since: this.now() };
    } else delete projects[projectId];
    const next: StudioConfig = { ...cfg, projects };
    saveStudioConfig(next, this.file);
    this.config = next;
    this.publisher?.projectsChanged();
    this.dispatchStudio();
    return this.status();
  }

  reconnect(): StudioStatus {
    this.connection?.reconnectNow();
    return this.status();
  }

  /** An operator's answer to a start Gate, from the Mac or the phone; the Gate binds it to a draftRev. */
  answerGate(gateId: string, answer: GateAnswer): GateAnswerResult {
    if (!this.gates) return { ok: false, error: 'gone' };
    return this.gates.answer(gateId, answer);
  }

  /** The operator's words to a customer (Mac only): "名字 · Synon Studio" in the customer's turns. */
  say(planId: string, text: string): SayResult {
    if (!this.chat) return { ok: false, error: 'not-shared' };
    return this.chat.say(planId, text);
  }

  private connect(): void {
    const cfg = this.config;
    const identity = this.identity;
    if (!cfg || !identity || this.connection) return;
    // Which decisions a customer may see and answer (one filter for the view and the answer path).
    if (!this.decisions) this.decisions = new StudioDecisions({ store: this.store });
    // The customer's conversation: queued words to the plan's own chat, and what the customer sees back.
    if (!this.chat && !this.plugs?.chat && this.chatSession) {
      this.chat = new StudioChat({
        store: this.store,
        config: () => this.config,
        session: this.chatSession,
        persist: () => this.inbox?.persist(),
        touch: (planId) => this.publisher?.touch(planId),
        now: this.now,
        ...(this.log ? { log: this.log } : {}),
      });
    }
    // The Gate is the only holder of `plans.approve`; the inbox's executor can't reach it.
    if (!this.gates && !this.plugs?.gates && this.approve) {
      this.gates = new StudioGates({
        store: this.store,
        config: () => this.config,
        approve: this.approve,
        ...(this.setAutonomy ? { setAutonomy: this.setAutonomy } : {}),
        persist: () => this.inbox?.persist(),
        touch: (planId) => {
          this.publisher?.touch(planId);
          this.dispatchStudio();
        },
        now: this.now,
      });
    }
    // The inbox keeps what an opId already did and the Gates raised, in its own file next to the key.
    if (!this.inbox) {
      const gates = this.plugs?.gates ?? this.gates;
      const chat = this.plugs?.chat ?? this.chat;
      const decisions = this.plugs?.decisions ?? (this.decisions ? (plan, view) => this.decisions!.decisions(plan, view) : undefined);
      this.inbox = new StudioInbox({
        store: this.store,
        config: () => this.config,
        exec: this.exec ?? MISSING_EXEC,
        plugs: { ...(this.plugs ?? {}), ...(gates ? { gates } : {}), ...(chat ? { chat } : {}), ...(decisions ? { decisions } : {}) },
        send: (frame) => this.connection?.send(frame) ?? false,
        file: this.inboxFile ?? join(dirname(this.file), 'studio-inbox.json'),
        now: this.now,
        ...(this.log ? { log: this.log } : {}),
      });
    }
    this.publisher = new StudioPublisher({
      store: this.store,
      config: () => this.config,
      send: (frame) => this.connection?.send(frame) ?? false,
      // What the hub was told about, kept in the file: a plan deleted while we were off is retracted.
      remember: (projectId, refs) => this.rememberPublished(projectId, refs),
      // The chat's turns and a plan's Gate are not in the store: the publisher has to be told to look again.
      extras: (planId) => this.inbox!.extras(planId),
    });
    const link = new StudioLink({
      config: cfg,
      identity,
      source: this.publisher,
      ...(this.ws ? { ws: this.ws } : {}),
      ...(this.timers ? { timers: this.timers } : {}),
      // The hub refuses an `at` it has already seen, and its record survives our restarts.
      onAt: (at) => this.rememberAt(at),
      // Deliveries only begin after the full snapshot and `synced` (M3's link), then run one at a time.
      onDeliver: (f) => this.inbox!.deliver(f),
    });
    this.connection = link;
    this.publisher.start();
    link.start();
    this.dispatchStudio();
  }

  /** The shared state a screen reads: the projects shared and the Gates waiting on you (docs/studio-gates.md §2.6). */
  private dispatchStudio(): void {
    // The config is the truth: the store's project list is filled asynchronously at daemon start,
    // so a `known` filter here could write an empty list after a late project scan (the e2e run found
    // that: the bell kept the native approve cards of Studio plans).
    const shared = this.config ? Object.keys(this.config.projects).slice(0, 500) : [];
    this.store.dispatch({ type: 'studio_state', shared, gates: (this.inbox?.gateNeeds() ?? []).slice(0, 50) });
  }

  /** The refs the hub was told about, kept in the file so a later run can retract them. */
  private rememberPublished(projectId: string, planRefs: readonly string[]): void {
    const cfg = this.config;
    if (!cfg) return;
    const published: Record<string, readonly string[]> = { ...(cfg.published ?? {}) };
    if (planRefs.length === 0) delete published[projectId];
    else published[projectId] = [...planRefs];
    const written = { ...cfg } as StudioConfig & { published?: Record<string, readonly string[]> };
    delete written.published;
    if (Object.keys(published).length > 0) written.published = published;
    this.config = written;
    try {
      saveStudioConfig(written, this.file);
    } catch {
      // This run's copy is current; the file catches up on the next change.
    }
  }

  private rememberAt(at: number): void {
    const cfg = this.config;
    if (!cfg || cfg.lastAt === at) return;
    const next: StudioConfig = { ...cfg, lastAt: at };
    this.config = next;
    try {
      saveStudioConfig(next, this.file);
    } catch {
      // Losing this write only means one extra `replayed` retry on the next start.
    }
  }

  private projectList(cfg: StudioConfig | undefined): StudioProjectStatus[] {
    const state = this.store.getState();
    return state.projects.map((project) => {
      const shared = cfg?.projects[project.id] !== undefined;
      return {
        projectId: project.id,
        shared,
        plans: shared ? state.plans.plans.filter((plan) => plan.projectId === project.id).length : 0,
      };
    });
  }
}

const services = new WeakMap<object, StudioService>();

export const attachStudio = (session: object, service: StudioService): void => void services.set(session, service);

/** This daemon's Studio service; throws where there is none (no daemon running it, e.g. in a plain test). */
export function studioOf(session: object): StudioService {
  const service = services.get(session);
  if (!service) throw new Error('Synon Studio lives in the Beluga app for Mac (its daemon).');
  return service;
}

/** Start Studio for the daemon: a no-op in the demo, otherwise whatever the link file holds. */
export function launchStudio(d: { readonly session: object; readonly store: Store; readonly demo: boolean }): () => void {
  const service = new StudioService({
    store: d.store,
    demo: d.demo,
    exec: plansExec(d.session),
    // The one place a Gate's approve is wired: nothing else in `src/studio/` holds it.
    approve: (id) => void needPlans(d.session).approve(id),
    setAutonomy: (id, autonomy, milestone) => void needPlans(d.session).setAutonomy(id, autonomy, milestone),
    session: d.session as unknown as StudioChatSession,
    log: (line) => console.error(`[studio] ${line}`),
  });
  attachStudio(d.session, service);
  service.start();
  return () => service.stop();
}
