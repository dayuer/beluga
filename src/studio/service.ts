import os from 'node:os';
import type { Store } from '../core/store.js';
import { identityPem, type Identity } from '../net/crypto.js';
import { identityOf, loadStudioConfig, newRefKey, newStudioIdentity, removeStudioConfig, saveStudioConfig, studioPath, type StudioConfig } from './keys.js';
import { StudioLink, defaultHub, hubUrl, registerWithCode, type LinkState } from './link.js';
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

export class StudioService {
  private readonly store: Store;
  private readonly demo: boolean;
  private readonly file: string;
  private config: StudioConfig | undefined;
  private identity: Identity | undefined;
  private connection: StudioLink | undefined;
  private publisher: StudioPublisher | undefined;

  constructor(d: { readonly store: Store; readonly demo?: boolean; readonly file?: string }) {
    this.store = d.store;
    this.demo = Boolean(d.demo);
    this.file = d.file ?? studioPath();
  }

  /** Read the link's file (if any) and start connecting. Demo runs never read or write it. */
  start(): void {
    if (this.demo || this.connection) return;
    const cfg = loadStudioConfig(this.file);
    if (!cfg) return;
    let identity: Identity;
    try {
      identity = identityOf(cfg);
    } catch {
      // A corrupt key is no key: unlinked until someone links again.
      removeStudioConfig(this.file);
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
    const base = hubUrl(hub?.trim() || defaultHub());
    if (!base) return { ok: false, error: 'bad-hub' };
    const who = (name?.trim() || machineName()).slice(0, 80);
    const identity = newStudioIdentity();
    const registered = await registerWithCode({ hub: base, code, name: who, identity });
    if (!registered.ok) return registered;
    const cfg: StudioConfig = {
      v: 1,
      hub: base,
      studioId: registered.studioId,
      daemonId: registered.daemonId,
      name: who,
      linkedAt: Date.now(),
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

  /** Say `plan-gone` for what was published, close the link, delete the key. */
  unlink(): StudioStatus {
    if (!this.config) return this.status();
    this.publisher?.leave();
    this.publisher?.stop();
    this.connection?.stop();
    this.connection = undefined;
    this.publisher = undefined;
    this.identity = undefined;
    this.config = undefined;
    removeStudioConfig(this.file);
    return this.status();
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
      if (!projects[projectId]) projects[projectId] = { since: Date.now() };
    } else delete projects[projectId];
    const next: StudioConfig = { ...cfg, projects };
    saveStudioConfig(next, this.file);
    this.config = next;
    this.publisher?.projectsChanged();
    return this.status();
  }

  reconnect(): StudioStatus {
    this.connection?.reconnectNow();
    return this.status();
  }

  private connect(): void {
    const cfg = this.config;
    const identity = this.identity;
    if (!cfg || !identity || this.connection) return;
    this.publisher = new StudioPublisher({ store: this.store, config: () => this.config, send: (frame) => this.connection?.send(frame) ?? false });
    const link = new StudioLink({
      config: cfg,
      identity,
      source: this.publisher,
      // The hub refuses an `at` it has already seen, and its record survives our restarts.
      onAt: (at) => this.rememberAt(at),
    });
    this.connection = link;
    this.publisher.start();
    link.start();
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
  const service = new StudioService({ store: d.store, demo: d.demo });
  attachStudio(d.session, service);
  service.start();
  return () => service.stop();
}
