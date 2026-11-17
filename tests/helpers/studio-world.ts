import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { generateIdentity, identityPem, type Identity } from '../../src/net/crypto.js';
import {
  alwaysAllow,
  handleHubRequest,
  onDaemonClose,
  onDaemonMessage,
  onDaemonOpen,
  verifyDaemonConnect,
  type Deps,
  type Effect,
  type HubReply,
  type StudioDeps,
} from '../../src/net/studio/handler.js';
import { enqueue } from '../../src/net/studio/queue.js';
import { memoryHub, memoryStudio, sha256Hex, type HubStore, type StudioStore } from '../../src/net/studio/store.js';
import { newRefKey, refOf, type StudioConfig } from '../../src/studio/keys.js';
import { registerWithCode, type LinkSocket, type LinkTimers, type WsFactory } from '../../src/studio/link.js';
import type { AppFrame } from '../../src/studio/protocol.js';

/**
 * M7's soak needs a hub that is the real rules and a daemon that is the real service, in one
 * process, with time under the test's hand. This is `tests/studio-link.test.ts`'s World, copied
 * (that file stays as it is) and extended with the three things a full customer flow needs:
 *
 * - frames the hub pushes to an app socket are kept (`appFrames`), so the customer's side of the
 *   flow can be asserted without a browser;
 * - the mailer keeps what it sent (`mail`), so a test can take the magic link out and log in;
 * - `dropUp` throws away what the daemon sends *before the hub sees it*: a deliver that was
 *   received and executed, whose receipt never arrived, is the one disconnection a snapshot cannot
 *   paper over (the hub's row stays taken; the redelivery must be answered, not run again).
 *
 * The clocks and timers are one scheduler, advanced by hand; `until`/`untilAsync` are the only
 * waits (real time, a state it is looking for — never a fixed number of rounds).
 */

const START = 1_768_000_000_000;
const OPERATOR = 'test-operator-token';

// --- A clock and its timers, advanced by hand ---

export interface Scheduler {
  readonly timers: LinkTimers;
  now(): number;
  advance(ms: number): void;
  pending(): number;
}

export function scheduler(start = START): Scheduler {
  let now = start;
  let nextId = 1;
  const jobs = new Map<number, { at: number; fn: () => void; every?: number }>();
  const timers: LinkTimers = {
    setTimeout: (fn, ms) => {
      const id = nextId++;
      jobs.set(id, { at: now + Math.max(0, ms), fn });
      return id;
    },
    clearTimeout: (id) => void jobs.delete(id as number),
    setInterval: (fn, ms) => {
      const id = nextId++;
      jobs.set(id, { at: now + Math.max(1, ms), fn, every: Math.max(1, ms) });
      return id;
    },
    clearInterval: (id) => void jobs.delete(id as number),
  };
  const advance = (ms: number): void => {
    const until = now + ms;
    for (;;) {
      let due: [number, { at: number; fn: () => void; every?: number }] | undefined;
      for (const entry of jobs) if (entry[1].at <= until && (!due || entry[1].at < due[1].at || (entry[1].at === due[1].at && entry[0] < due[0]))) due = entry;
      if (!due) break;
      const [id, job] = due;
      now = job.at;
      if (job.every !== undefined) job.at = now + job.every;
      else jobs.delete(id);
      job.fn();
    }
    now = until;
  };
  return { timers, now: () => now, advance, pending: () => jobs.size };
}

/** Let the hub's promise chains run: every await is a microtask, and sockets deliver on one. */
export async function flush(rounds = 20): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise<void>((resolve) => setImmediate(resolve));
}

/** Wait (in real time) for a state the hub reaches after a few crypto awaits; never a fixed round count. */
export async function until(cond: () => boolean, ms = 3_000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond() && Date.now() < end) await new Promise<void>((resolve) => setTimeout(resolve, 5));
}

/** `until` for a state that has to be fetched (a customer's GET). */
export async function untilAsync(cond: () => Promise<boolean>, ms = 3_000): Promise<void> {
  const end = Date.now() + ms;
  while (!(await cond()) && Date.now() < end) await new Promise<void>((resolve) => setTimeout(resolve, 5));
}

// --- The hub, over an in-memory socket pair ---

type Emit = {
  open: () => void;
  message: (text: string) => void;
  close: (code: number, reason: string) => void;
  unexpected: (status: number, body: string) => void;
};

export interface Mail {
  readonly email: string;
  readonly link: string;
}

export interface AppPush {
  readonly projectId: string;
  readonly frame: AppFrame;
}

export class World {
  readonly clock = scheduler();
  readonly hub: HubStore = memoryHub();
  readonly studio: StudioStore = memoryStudio();
  readonly deps: Deps;
  readonly sockets = new Map<string, Set<FakeServer>>();
  readonly attempts: Array<{ at: number; error?: string }> = [];
  readonly alerts: string[] = [];
  /** What the hub pushed to the customer's socket (simulated: every broadcast is kept). */
  readonly appFrames: AppPush[] = [];
  /** What the mailer was asked to send. */
  readonly mail: Mail[] = [];
  /** A daemon's frames thrown away before the hub sees them (a receipt lost, the socket then closed). */
  dropUp = false;
  answerPing = true;
  early?: unknown;

  studioId = '';
  identity: Identity = generateIdentity();
  daemonId = '';
  /** One ref key for the whole world: the daemon's refs and the hub's mapping agree. */
  readonly refKey = newRefKey();
  /** The daemon's own project id, and the Studio project it is mapped to. */
  readonly daemonProjectId = 'dpp1';
  readonly studioProjectId = 'stp1';
  /** Where this run's studio.json and studio-inbox.json live. */
  readonly dir: string;
  readonly file: string;
  readonly inboxFile: string;

  constructor() {
    this.dir = mkdtempSync(path.join(tmpdir(), 'beluga-studio-soak-'));
    this.file = path.join(this.dir, 'studio.json');
    this.inboxFile = path.join(this.dir, 'studio-inbox.json');
    const deps: StudioDeps = {
      hub: this.hub,
      studio: this.studio,
      get now() {
        return 0;
      },
      random: (n) => crypto.getRandomValues(new Uint8Array(n)),
      mailer: {
        send: async (email, link) => {
          this.mail.push({ email, link });
        },
      },
      ent: alwaysAllow,
      operatorTokenHash: '',
      origin: 'https://hub.test',
      studioId: '',
    };
    Object.defineProperty(deps, 'now', { get: () => this.clock.now() });
    Object.defineProperty(deps, 'studioId', { get: () => this.studioId });
    this.deps = deps;
  }

  get studioDeps(): StudioDeps {
    return this.deps as StudioDeps;
  }

  /** The daemon's project ref as the publisher says it (refOf(refKey, 'project', dpp1)). */
  get projectRef(): string {
    return refOf(this.refKey, 'project', this.daemonProjectId);
  }

  static async make(): Promise<World> {
    const w = new World();
    const deps = w.deps;
    Object.defineProperty(deps, 'operatorTokenHash', { value: await sha256Hex(OPERATOR), enumerable: true });
    const created = await handleHubRequest(
      new Request('https://hub.test/v1/admin/studios', {
        method: 'POST',
        headers: { authorization: `Bearer ${OPERATOR}`, 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Acme Studio' }),
      }),
      deps,
    );
    const body = created.body as { studio: { id: string }; linkCode: { code: string } };
    w.studioId = body.studio.id;
    const registered = await registerWithCode({
      hub: 'http://localhost:8787',
      code: body.linkCode.code,
      name: 'Studio Mac',
      identity: w.identity,
      fetch: w.fetch,
      now: w.clock.now,
    });
    if (!registered.ok) throw new Error(`registration failed: ${registered.error}`);
    w.daemonId = registered.daemonId;
    // The operator's mapping: Studio project stp1 → this daemon's own project, under its ref.
    await w.hub.createProject({ id: w.studioProjectId, studioId: w.studioId, name: 'App', now: w.clock.now() });
    await w.hub.replaceDaemonProjects(w.daemonId, [{ id: w.projectRef, name: 'bob-api' }], w.clock.now());
    const bound = await w.hub.bindProject({ projectId: w.studioProjectId, daemonId: w.daemonId, daemonProjectId: w.projectRef, now: w.clock.now() });
    if (bound !== 'ok') throw new Error(`mapping failed: ${bound}`);
    await w.hub.createCustomer({ id: 'c1', email: 'c@acme.test', name: 'Cem', now: w.clock.now() });
    await w.hub.addMember(w.studioProjectId, 'c1', w.clock.now());
    return w;
  }

  /** `registerWithCode`'s fetch, answered by the hub's own route. */
  readonly fetch: typeof fetch = async (input, init) => {
    const reply: HubReply = await handleHubRequest(new Request(String(input), init), this.deps);
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), { status: reply.status });
  };

  /** The real WebSocket factory's stand-in: every connection is a socket pair whose other side runs the hub. */
  readonly ws: WsFactory = (_url, o) => this.pair(o.headers);

  config(patch: Partial<StudioConfig> = {}): StudioConfig {
    return {
      v: 1,
      hub: 'http://localhost:8787',
      studioId: this.studioId,
      daemonId: this.daemonId,
      name: 'Studio Mac',
      linkedAt: START,
      key: identityPem(this.identity),
      refKey: this.refKey,
      projects: {},
      ...patch,
    };
  }

  /** A `plan.create`, with no customer app (kept for the simplest use). */
  async enqueuePlanCreate(goal = 'A shop'): Promise<void> {
    const r = await enqueue(
      { t: 'action', opId: crypto.randomUUID(), kind: 'plan.create', payload: { goal, platforms: ['web'] } },
      { studio: this.studioId, projectId: this.studioProjectId, customerId: 'c1' },
      this.studioDeps,
    );
    if (!r.ok || r.receipt.state === 'refused') throw new Error(`enqueue failed: ${JSON.stringify(r)}`);
  }

  /** Run what a reply or a daemon frame asks the shell to do (the Worker's effects). */
  apply(effects: readonly Effect[]): void {
    for (const e of effects) {
      if (e.to === 'daemon') for (const s of this.sockets.get(e.daemonId) ?? []) s.push(e.msg);
      else if (e.to === 'app') this.appFrames.push({ projectId: e.projectId, frame: e.frame });
      else if (e.to === 'close') {
        const id = e.tag.split(':')[1] ?? '';
        for (const s of this.sockets.get(id) ?? []) s.hubClose(e.code, e.reason);
      } else this.alerts.push(e.what);
    }
  }

  private pair(headers: Readonly<Record<string, string>>): LinkSocket {
    const h: { open?: () => void; message?: (text: string) => void; close?: (code: number, reason: string) => void; error?: () => void; unexpected?: (status: number, body: string) => void } = {};
    const later = (fn: () => void): void => void queueMicrotask(fn);
    const server = new FakeServer(this, headers, {
      open: () => later(() => h.open?.()),
      message: (text) => later(() => h.message?.(text)),
      close: (code, reason) => later(() => h.close?.(code, reason)),
      unexpected: (status, body) => later(() => h.unexpected?.(status, body)),
    });
    let closed = false;
    const client: LinkSocket = {
      send: (text) => {
        if (!closed) server.receive(text);
      },
      close: (code = 1000, reason) => {
        if (closed) return;
        closed = true;
        server.clientClosed();
        later(() => h.close?.(code, reason ?? ''));
      },
      terminate: () => {
        if (closed) return;
        closed = true;
        server.clientClosed();
        later(() => h.close?.(1006, ''));
      },
      onOpen: (fn) => void (h.open = fn),
      onMessage: (fn) => void (h.message = fn),
      onClose: (fn) => void (h.close = fn),
      onError: (fn) => void (h.error = fn),
      onUnexpectedResponse: (fn) => void (h.unexpected = fn),
    };
    server.begin();
    return client;
  }

  /** The socket the daemon is on now (the newest accepted one). */
  server(): FakeServer | undefined {
    return [...(this.sockets.get(this.daemonId) ?? [])][0];
  }
}

export class FakeServer {
  private chain: Promise<void> = Promise.resolve();
  private dead = false;
  private accepted = false;
  readonly received: string[] = [];
  readonly sent: string[] = [];
  private readonly at: number;
  private readonly daemonId: string;
  private readonly sig: string;

  constructor(private readonly w: World, headers: Readonly<Record<string, string>>, private readonly emit: Emit) {
    this.daemonId = headers['x-studio-daemon'] ?? '';
    this.at = Number(headers['x-studio-at']);
    this.sig = headers['x-studio-sig'] ?? '';
  }

  begin(): void {
    this.chain = this.chain.then(() => this.accept());
  }

  private async accept(): Promise<void> {
    const attempt: { at: number; error?: string } = { at: this.at };
    this.w.attempts.push(attempt);
    const check = await verifyDaemonConnect({ daemonId: this.daemonId, at: this.at, sig: this.sig }, this.w.deps);
    if (!check.ok) {
      attempt.error = check.error;
      this.dead = true;
      this.emit.unexpected(check.status, JSON.stringify({ error: check.error }));
      return;
    }
    await this.w.studio.requeueTaken(this.daemonId);
    for (const old of [...(this.w.sockets.get(this.daemonId) ?? [])]) old.repel();
    this.w.sockets.set(this.daemonId, new Set([this]));
    await this.w.studio.putConn({ daemonId: this.daemonId, lastAt: this.at, connectedAt: this.w.clock.now(), lastSeenAt: this.w.clock.now(), hello: false, synced: false });
    this.w.apply(await onDaemonOpen(this.daemonId, this.w.studioDeps));
    this.accepted = true;
    this.emit.open();
    if (this.w.early !== undefined) this.push(this.w.early);
  }

  receive(text: string): void {
    this.chain = this.chain.then(async () => {
      if (this.dead) return;
      // Lost on the way: the hub never sees it (the row it was answering stays taken).
      if (this.w.dropUp) return;
      if (text === 'ping') {
        if (this.w.answerPing) this.emit.message('pong');
        return;
      }
      this.received.push(text);
      this.w.apply(await onDaemonMessage(this.daemonId, text, this.w.studioDeps, this.at));
    });
  }

  clientClosed(): void {
    this.chain = this.chain.then(async () => {
      if (this.dead) return;
      this.dead = true;
      this.w.sockets.get(this.daemonId)?.delete(this);
      if (this.accepted) this.w.apply(await onDaemonClose(this.daemonId, this.at, this.w.studioDeps));
    });
  }

  /** Another of our connections took over: the hub closes this one with 4002. */
  repel(): void {
    this.dead = true;
    this.emit.close(4002, 'replaced');
  }

  /** A frame the hub pushes down (a `deliver`, a `resync`, or the test's `early` one). */
  push(msg: unknown): void {
    if (this.dead) return;
    const text = JSON.stringify(msg);
    this.sent.push(text);
    this.emit.message(text);
  }

  hubClose(code: number, reason: string): void {
    this.dead = true;
    this.emit.close(code, reason);
  }

  /** The frame types this daemon sent up, in order. */
  frames(): string[] {
    return this.received.map((text) => {
      try {
        const parsed = JSON.parse(text) as { t?: unknown };
        return typeof parsed.t === 'string' ? parsed.t : '?';
      } catch {
        return '?';
      }
    });
  }

  /** The frame types the hub sent down, in order. */
  down(): string[] {
    return this.sent.map((text) => {
      try {
        const parsed = JSON.parse(text) as { t?: unknown };
        return typeof parsed.t === 'string' ? parsed.t : '?';
      } catch {
        return '?';
      }
    });
  }
}
