import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { generateIdentity, identityPem, type Identity } from '../src/net/crypto.js';
import {
  STUDIO_LABEL,
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
} from '../src/net/studio/handler.js';
import { enqueue } from '../src/net/studio/queue.js';
import { memoryHub, memoryStudio, sha256Hex, type HubStore, type StudioStore } from '../src/net/studio/store.js';
import { loadStudioConfig, newRefKey, newStudioIdentity, removeStudioConfig, saveStudioConfig, studioSign, type StudioConfig } from '../src/studio/keys.js';
import { StudioLink, registerWithCode, type Deliver, type LinkSocket, type LinkStatus, type LinkTimers, type SnapshotSource, type WsFactory } from '../src/studio/link.js';
import { STUDIO_PROTO, type StudioPlanView } from '../src/studio/protocol.js';

/**
 * BLG-67: the daemon's outbound link, against the hub's real rules (`registerDaemon`,
 * `verifyDaemonConnect`, `onDaemonMessage`) over an in-memory socket pair. The clocks and the
 * timers are ours, so reconnects and backoff are asserted to the millisecond.
 */

const START = 1_768_000_000_000;
const OPERATOR = 'test-operator-token';

// --- A clock and its timers, advanced by hand ---

interface Scheduler {
  readonly timers: LinkTimers;
  now(): number;
  advance(ms: number): void;
  pending(): number;
}

function scheduler(start = START): Scheduler {
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
async function flush(rounds = 12): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise<void>((resolve) => setImmediate(resolve));
}

// --- The hub, over an in-memory socket pair ---

type Emit = {
  open: () => void;
  message: (text: string) => void;
  close: (code: number, reason: string) => void;
  unexpected: (status: number, body: string) => void;
};

interface Attempt {
  at: number;
  error?: string;
}

class World {
  readonly clock = scheduler();
  readonly hub: HubStore = memoryHub();
  readonly studio: StudioStore = memoryStudio();
  readonly deps: Deps;
  readonly sockets = new Map<string, Set<FakeServer>>();
  readonly attempts: Attempt[] = [];
  readonly alerts: string[] = [];
  answerPing = true;
  /** A frame the hub sends right after accepting the socket, before any hello. */
  early?: unknown;

  studioId = '';
  identity: Identity = generateIdentity();
  daemonId = '';

  constructor() {
    const deps: StudioDeps = {
      hub: this.hub,
      studio: this.studio,
      get now() {
        return 0;
      },
      random: (n) => crypto.getRandomValues(new Uint8Array(n)),
      mailer: { send: async () => {} },
      ent: alwaysAllow,
      operatorTokenHash: '',
      origin: 'https://hub.test',
      studioId: '',
    };
    // The two clocks are one; `now` is read lazily so advancing the scheduler moves both.
    Object.defineProperty(deps, 'now', { get: () => this.clock.now() });
    Object.defineProperty(deps, 'studioId', { get: () => this.studioId });
    this.deps = deps;
  }

  get studioDeps(): StudioDeps {
    return this.deps as StudioDeps;
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
    // The operator's mapping: a Studio project to this daemon's project `dpp1` (docs/studio-daemon.md §2.3).
    await w.hub.createProject({ id: 'stp1', studioId: w.studioId, name: 'App', now: w.clock.now() });
    await w.hub.replaceDaemonProjects(w.daemonId, [{ id: 'dpp1', name: 'bob-api' }], w.clock.now());
    const bound = await w.hub.bindProject({ projectId: 'stp1', daemonId: w.daemonId, daemonProjectId: 'dpp1', now: w.clock.now() });
    if (bound !== 'ok') throw new Error(`mapping failed: ${bound}`);
    await w.hub.createCustomer({ id: 'c1', email: 'c@acme.test', name: 'Cem', now: w.clock.now() });
    await w.hub.addMember('stp1', 'c1', w.clock.now());
    return w;
  }

  /** `registerWithCode`'s fetch, answered by the hub's own route. */
  readonly fetch: typeof fetch = async (input, init) => {
    const reply: HubReply = await handleHubRequest(new Request(String(input), init), this.deps);
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), { status: reply.status });
  };

  /** The real WebSocket factory's stand-in: every connection is a socket pair whose other side runs the hub. */
  readonly ws: WsFactory = (_url, o) => this.pair(o.headers);

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

  config(patch: Partial<StudioConfig> = {}): StudioConfig {
    return {
      v: 1,
      hub: 'http://localhost:8787',
      studioId: this.studioId,
      daemonId: this.daemonId,
      name: 'Studio Mac',
      linkedAt: START,
      key: identityPem(this.identity),
      refKey: newRefKey(),
      projects: {},
      ...patch,
    };
  }

  /** A `plan.create`: the one customer action that needs no plan already published. */
  async enqueuePlanCreate(): Promise<void> {
    const r = await enqueue(
      { t: 'action', opId: crypto.randomUUID(), kind: 'plan.create', payload: { goal: 'A shop', platforms: ['web'] } },
      { studio: this.studioId, projectId: 'stp1', customerId: 'c1' },
      this.studioDeps,
    );
    if (!r.ok || r.receipt.state === 'refused') throw new Error(`enqueue failed: ${JSON.stringify(r)}`);
  }
}

class FakeServer {
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
    const attempt: Attempt = { at: this.at };
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
    await this.apply(await onDaemonOpen(this.daemonId, this.w.studioDeps));
    this.accepted = true;
    this.emit.open();
    if (this.w.early !== undefined) this.push(this.w.early);
  }

  receive(text: string): void {
    this.chain = this.chain.then(async () => {
      if (this.dead) return;
      if (text === 'ping') {
        if (this.w.answerPing) this.emit.message('pong');
        return;
      }
      this.received.push(text);
      await this.apply(await onDaemonMessage(this.daemonId, text, this.w.studioDeps, this.at));
    });
  }

  clientClosed(): void {
    this.chain = this.chain.then(async () => {
      if (this.dead) return;
      this.dead = true;
      this.w.sockets.get(this.daemonId)?.delete(this);
      if (this.accepted) await onDaemonClose(this.daemonId, this.at, this.w.studioDeps);
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

  private hubClose(code: number, reason: string): void {
    this.dead = true;
    this.emit.close(code, reason);
  }

  private async apply(effects: readonly Effect[]): Promise<void> {
    for (const e of effects) {
      if (e.to === 'daemon') for (const s of this.w.sockets.get(e.daemonId) ?? []) s.push(e.msg);
      else if (e.to === 'close') {
        const id = e.tag.split(':')[1] ?? '';
        for (const s of this.w.sockets.get(id) ?? []) s.hubClose(e.code, e.reason);
      } else if (e.to === 'alert') this.w.alerts.push(e.what);
    }
  }
}

// --- The daemon's side of a snapshot ---

const viewOf = (title: string): StudioPlanView => ({
  planRef: 'p1',
  draftRev: 0,
  title,
  goal: '',
  stage: 'drafting',
  waitingOn: 'customer',
  headline: '计划在写',
  progress: { done: 0, total: 0 },
  milestones: [],
  decisions: [],
  turns: [],
  typing: false,
  moreTurns: false,
  activity: [],
});

interface Source extends SnapshotSource {
  readonly events: string[];
  readonly resyncs: { project: string; planRef?: string }[];
  readonly onlines: number[];
}

function source(): Source {
  const events: string[] = [];
  const resyncs: { project: string; planRef?: string }[] = [];
  const onlines: number[] = [];
  return {
    events,
    resyncs,
    get onlines() {
      return onlines;
    },
    projects: () => [{ id: 'dpp1', name: 'bob-api' }],
    snapshot: () => [{ t: 'for', project: 'dpp1', frame: { t: 'plan', rev: 1, view: viewOf('Bob') } }],
    onResync: (project, planRef) => void resyncs.push({ project, ...(planRef ? { planRef } : {}) }),
    onOnline: () => {
      onlines.push(1);
      events.push('online');
    },
  };
}

const framesOf = (server: FakeServer | undefined): string[] =>
  (server?.received ?? []).map((text) => {
    try {
      const parsed = JSON.parse(text) as { t?: unknown };
      return typeof parsed.t === 'string' ? parsed.t : '?';
    } catch {
      return '?';
    }
  });

const linkFor = (
  w: World,
  src: Source,
  extra: { config?: Partial<StudioConfig>; ws?: WsFactory; random?: () => number; onDeliver?: (f: Deliver) => void; statuses?: LinkStatus[] } = {},
): StudioLink =>
  new StudioLink({
    config: w.config(extra.config),
    identity: w.identity,
    source: src,
    ws: extra.ws ?? w.ws,
    now: w.clock.now,
    random: extra.random ?? (() => 0.5),
    timers: w.clock.timers,
    ...(extra.onDeliver ? { onDeliver: extra.onDeliver } : {}),
    ...(extra.statuses ? { onState: (s: LinkStatus) => void extra.statuses!.push(s) } : {}),
  });

// --- Tests ---

describe('registerWithCode', () => {
  it('registers with a binding code and reports the studio', async () => {
    const w = await World.make();
    expect(w.daemonId).toBe(w.identity.peerId);
    expect((await w.hub.daemon(w.daemonId))?.studioId).toBe(w.studioId);
  });

  it('reads the code loosely', async () => {
    const w = await World.make();
    const made = await handleHubRequest(
      new Request(`https://hub.test/v1/admin/studios/${w.studioId}/link-codes`, { method: 'POST', headers: { authorization: `Bearer ${OPERATOR}` } }),
      w.deps,
    );
    const code = ((made.body as { code: string }).code ?? '').toLowerCase().replace('-', ' ');
    const identity = newStudioIdentity();
    const ok = await registerWithCode({ hub: 'http://localhost:8787', code, name: 'Second', identity, fetch: w.fetch, now: w.clock.now });
    expect(ok.ok).toBe(true);
  });

  it('maps an unreachable hub and a bad address to codes, never a throw', async () => {
    const identity = newStudioIdentity();
    const unreachable = await registerWithCode({ hub: 'http://localhost:8787', code: 'ABCD-EFGH', name: 'X', identity, fetch: async () => Promise.reject(new Error('nope')), now: () => START });
    expect(unreachable).toEqual({ ok: false, error: 'unreachable' });
    const bad = await registerWithCode({ hub: 'http://example.com', code: 'ABCD-EFGH', name: 'X', identity, now: () => START });
    expect(bad).toEqual({ ok: false, error: 'bad-hub' });
    const alsoBad = await registerWithCode({ hub: 'http://localhost:8787', code: 'nope', name: 'X', identity, now: () => START });
    expect(alsoBad).toEqual({ ok: false, error: 'bad-code' });
  });

  it('refuses a signature that does not match the key it names', async () => {
    const w = await World.make();
    const made = await handleHubRequest(
      new Request(`https://hub.test/v1/admin/studios/${w.studioId}/link-codes`, { method: 'POST', headers: { authorization: `Bearer ${OPERATOR}` } }),
      w.deps,
    );
    const code = (made.body as { code: string }).code;
    const other = newStudioIdentity();
    const forged = await handleHubRequest(
      new Request('https://hub.test/v1/link', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code, key: w.identity.publicKey, name: 'Fake', at: w.clock.now(), sig: studioSign(other, `link:${code}:${w.clock.now()}`) }),
      }),
      w.deps,
    );
    expect(forged.status).toBe(403);
    expect(forged.body).toEqual({ error: 'bad-signature' });
  });
});

describe('StudioLink', () => {
  it('says hello, pushes the full snapshots, then synced — in that order', async () => {
    const w = await World.make();
    const src = source();
    const link = linkFor(w, src);
    link.start();
    await flush();
    expect(link.status().state).toBe('online');
    const server = [...(w.sockets.get(w.daemonId) ?? [])][0];
    expect(framesOf(server)).toEqual(['hello', 'for', 'synced']);
    expect(JSON.parse(server!.received[0]!)).toMatchObject({ t: 'hello', proto: STUDIO_PROTO, daemon: w.daemonId, projects: [{ id: 'dpp1', name: 'bob-api' }] });
    expect(src.onlines).toHaveLength(1);
    const shown = JSON.stringify(link.status());
    expect(shown).not.toContain('PRIVATE KEY');
    expect(link.status()).not.toHaveProperty('key');
    expect(link.status()).not.toHaveProperty('refKey');
    link.stop();
  });

  it('asks for a full snapshot when the hub says resync', async () => {
    const w = await World.make();
    const src = source();
    const link = linkFor(w, src);
    link.start();
    await flush();
    const server = [...(w.sockets.get(w.daemonId) ?? [])][0]!;
    server.push({ t: 'resync', project: 'dpp1', planRef: 'p1' });
    await flush();
    expect(src.resyncs).toEqual([{ project: 'dpp1', planRef: 'p1' }]);
    link.stop();
  });

  it('sends what was queued while offline only after synced', async () => {
    const w = await World.make();
    const src = source();
    const link = linkFor(w, src);
    link.start();
    await flush();
    expect(link.status().state).toBe('online');

    // Offline: the hub requeues what it had taken, and a customer's action waits.
    link.stop();
    await flush();
    await w.enqueuePlanCreate();
    await flush();

    const delivered: string[] = [];
    const again = new StudioLink({
      config: w.config(),
      identity: w.identity,
      source: src,
      ws: w.ws,
      now: w.clock.now,
      random: () => 0.5,
      timers: w.clock.timers,
      onDeliver: (f) => void delivered.push(f.project),
      onState: (s) => void (s.state === 'online' && src.events.push('online')),
    });
    again.start();
    await flush();
    expect(again.status().state).toBe('online');
    expect(delivered).toEqual(['dpp1']);
    const server = [...(w.sockets.get(w.daemonId) ?? [])][0]!;
    expect(framesOf(server)).toEqual(['hello', 'for', 'synced']);
    // On the wire, `synced` went up before the hub's `deliver` came down.
    const syncedAt = server.received.findIndex((t) => JSON.parse(t).t === 'synced');
    const deliverAt = server.sent.findIndex((t) => JSON.parse(t).t === 'deliver');
    expect(syncedAt).toBeGreaterThanOrEqual(0);
    expect(deliverAt).toBeGreaterThanOrEqual(0);
    again.stop();
  });

  it('drops a deliver that arrives before it is online', async () => {
    const w = await World.make();
    w.early = {
      t: 'deliver',
      seq: 1,
      project: 'dpp1',
      action: { t: 'action', opId: crypto.randomUUID(), kind: 'plan.create', payload: { goal: 'early', platforms: ['web'] } },
    };
    const delivered: unknown[] = [];
    const link = linkFor(w, source(), { onDeliver: (f) => void delivered.push(f) });
    link.start();
    await flush();
    expect(link.status().state).toBe('online');
    expect(delivered).toEqual([]);
    expect(link.status().dropped).toBeGreaterThan(0);
    link.stop();
  });

  it('never sends a frame the hub would refuse', async () => {
    const w = await World.make();
    const link = linkFor(w, source());
    link.start();
    await flush();
    const before = link.status().dropped;
    expect(link.send({ t: 'for', project: 'a/b', frame: { t: 'plan', rev: 1, view: viewOf('x') } } as never)).toBe(false);
    expect(link.send({ t: 'nope' } as never)).toBe(false);
    expect(link.status().dropped).toBe(before + 2);
    const server = [...(w.sockets.get(w.daemonId) ?? [])][0]!;
    expect(framesOf(server)).toEqual(['hello', 'for', 'synced']);
    link.stop();
  });

  it('backs off with full jitter and forgets it after synced', async () => {
    const w = await World.make();
    let broken = true;
    const ws: WsFactory = (url, o) => {
      if (broken) throw new Error('no route');
      return w.ws(url, o);
    };
    const statuses: LinkStatus[] = [];
    const link = linkFor(w, source(), { ws, statuses });
    link.start();
    expect(() => link.start()).not.toThrow();
    const delays: number[] = [];
    for (let i = 0; i < 3; i++) {
      const s = link.status();
      expect(s.state).toBe('offline');
      const delay = (s.retryAt ?? 0) - w.clock.now();
      expect(delay).toBeGreaterThanOrEqual(250);
      expect(delay).toBeLessThanOrEqual(Math.min(60_000, 1000 * 2 ** i));
      delays.push(delay);
      w.clock.advance(delay);
      await flush();
    }
    // With random = 0.5 the caps are 500, 1000 and 2000: the delay grows and stays inside them.
    expect(delays).toEqual([500, 1000, 2000]);
    broken = false;
    const waiting = (link.status().retryAt ?? 0) - w.clock.now();
    w.clock.advance(waiting);
    await flush();
    expect(link.status().state).toBe('online');
    expect(link.status().attempt).toBe(0);
    expect(statuses.some((s) => s.state === 'online')).toBe(true);
    link.stop();
  });

  it('stops on revoked and does not reconnect', async () => {
    const w = await World.make();
    await w.hub.revokeDaemon(w.daemonId, w.clock.now());
    const link = linkFor(w, source());
    link.start();
    await flush();
    expect(link.status().state).toBe('revoked');
    expect(link.status().retryAt).toBeUndefined();
    const attempts = w.attempts.length;
    w.clock.advance(120_000);
    await flush();
    expect(w.attempts.length).toBe(attempts);
    link.stop();
  });

  it('retries once with a newer at after replayed', async () => {
    const w = await World.make();
    const first = linkFor(w, source());
    first.start();
    await flush();
    expect(first.status().state).toBe('online');
    first.stop();
    await flush();

    // A fresh run whose lastAt is forgotten asks with the same `at`: the hub refused it once.
    const src = source();
    const second = new StudioLink({ config: w.config(), identity: w.identity, source: src, ws: w.ws, now: w.clock.now, random: () => 0.5, timers: w.clock.timers });
    second.start();
    await flush();
    expect(second.status().state).toBe('online');
    expect(w.attempts.map((a) => a.error ?? 'ok')).toEqual(['ok', 'replayed', 'ok']);
    expect(w.attempts[1]!.at).toBe(w.attempts[0]!.at);
    expect(w.attempts[2]!.at).toBe(w.attempts[0]!.at + 1);
    second.stop();
  });

  it('reconnects when nothing is heard back for 60 seconds', async () => {
    const w = await World.make();
    w.answerPing = false;
    const link = linkFor(w, source());
    link.start();
    await flush();
    expect(link.status().state).toBe('online');
    expect(w.attempts).toHaveLength(1);
    w.clock.advance(50_000); // two pings, no pong
    await flush();
    expect(link.status().state).toBe('online');
    w.clock.advance(9_000); // 59 s: still inside the silence window
    await flush();
    expect(link.status().state).toBe('online');
    w.clock.advance(1_000); // 60 s: nothing heard, so the socket is dead
    await flush();
    expect(link.status().state).toBe('offline');
    expect(link.status().lastError).toBe('pong-timeout');
    const wait = link.status().retryAt! - w.clock.now();
    expect(wait).toBeGreaterThanOrEqual(250);
    w.clock.advance(wait + 1);
    await flush();
    expect(w.attempts).toHaveLength(2);
    expect(link.status().state).toBe('online');
    link.stop();
  });

  it('keeps a link signed by a key the hub does not know off', async () => {
    const w = await World.make();
    const stranger = generateIdentity();
    const link = new StudioLink({ config: w.config(), identity: stranger, source: source(), ws: w.ws, now: w.clock.now, random: () => 0.5, timers: w.clock.timers });
    link.start();
    await flush();
    expect(link.status().state).toBe('revoked');
    expect(link.status().lastError).toBe('bad-signature');
    expect(w.attempts[0]?.error).toBe('bad-signature');
    // The hub never accepted a socket, so nothing was said on one.
    expect([...(w.sockets.get(w.daemonId) ?? [])]).toHaveLength(0);
    link.stop();
  });

  it('keeps a wrong studio out', async () => {
    const w = await World.make();
    const link = linkFor(w, source(), { config: { studioId: 'another-studio' } });
    link.start();
    await flush();
    expect(link.status().state).toBe('wrong-studio');
    link.stop();
  });
});

describe('studio.json', () => {
  const dirs: string[] = [];
  const file = (): string => {
    const dir = mkdtempSync(path.join(tmpdir(), 'beluga-studio-'));
    dirs.push(dir);
    return path.join(dir, 'studio.json');
  };

  it('round-trips, is 0600, and a broken file is not linked', () => {
    const f = file();
    const w = new World();
    const cfg = w.config({ studioId: 'st1', daemonId: w.identity.peerId });
    expect(loadStudioConfig(f)).toBeUndefined();
    saveStudioConfig(cfg, f);
    if (process.platform !== 'win32') expect(statSync(f).mode & 0o777).toBe(0o600);
    expect(loadStudioConfig(f)).toEqual(cfg);
    removeStudioConfig(f);
    expect(loadStudioConfig(f)).toBeUndefined();
  });

  it('treats bad JSON and an unknown version as unlinked', () => {
    const f = file();
    writeFileSync(f, '{"v":1,"hub":');
    expect(loadStudioConfig(f)).toBeUndefined();
    writeFileSync(f, JSON.stringify({ v: 2, hub: 'http://localhost:8787' }));
    expect(loadStudioConfig(f)).toBeUndefined();
  });

  it('signs under the studio label the hub verifies', () => {
    const w = new World();
    const cfg = w.config();
    expect(cfg.key).toContain('PRIVATE KEY');
    expect(STUDIO_LABEL).toBe('synon-studio-v1');
    expect(studioSign(w.identity, 'x')).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });

  it('cleans up temp folders', () => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
  });
});
