import WebSocket from 'ws';
import { belugaEnv } from '../core/beluga-env.js';
import type { Identity } from '../net/crypto.js';
import { DaemonUp, HubDown, normalizeLinkCode } from '../net/studio/handler.js';
import { studioSign, type StudioConfig } from './keys.js';
import { STUDIO_PROTO } from './protocol.js';

/**
 * This daemon's one outbound link to a Synon Studio hub (docs/studio-daemon.md §3, §4).
 *
 * The daemon never listens: it dials `{hub}/v1/daemon/ws` with a signature, says hello with the
 * projects it shares, pushes one full snapshot per plan, then `synced` — and only then receives
 * queued actions (`deliver`), which M3 does not execute yet. Every frame it sends goes through
 * `send`, which parses it with the hub's own `DaemonUp` first, so no unvalidated frame can leave.
 * Down frames are parsed with `HubDown` and anything else is dropped and counted, never a reason to
 * close: a version difference must not turn into a reconnect storm. Nothing here throws to its
 * caller; a failure only changes `status()` and schedules a reconnect with full jitter.
 */

// --- Where the hub is ---

export const DEFAULT_HUB = 'http://localhost:8787';
export const defaultHub = (): string => belugaEnv('STUDIO_HUB') ?? DEFAULT_HUB;

/**
 * A hub base URL, normalized, or undefined: https anywhere, http only to this computer (P1 runs a
 * local `wrangler dev`). A URL with a username, password, query or fragment is refused: none of
 * those belong in a base address, and a token in it would end up in a log.
 */
export function hubUrl(raw: string): string | undefined {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return undefined;
  }
  if (url.username || url.password || url.search || url.hash) return undefined;
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1'))) return undefined;
  return `${url.protocol}//${url.host}${url.pathname}`.replace(/\/+$/, '');
}

// --- Registering with a binding code ---

export type RegisterError = 'bad-code' | 'expired-code' | 'key-taken' | 'clock-skew' | 'unreachable' | 'bad-hub';
export type RegisterResult = { readonly ok: true; readonly studioId: string; readonly daemonId: string } | { readonly ok: false; readonly error: RegisterError };

export const REF = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * `POST {hub}/v1/link`: the admin page's one-time code and proof of the key's private half register
 * this daemon. The code is read loosely (`normalizeLinkCode`), `at` is milliseconds (the hub compares
 * it with its own clock within five minutes), and the signature covers the canonical code.
 */
export async function registerWithCode(o: {
  readonly hub: string;
  readonly code: string;
  readonly name: string;
  readonly identity: Identity;
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
  readonly timeoutMs?: number;
}): Promise<RegisterResult> {
  const hub = hubUrl(o.hub);
  if (!hub) return { ok: false, error: 'bad-hub' };
  const code = normalizeLinkCode(o.code);
  if (!code) return { ok: false, error: 'bad-code' };
  const at = (o.now ?? Date.now)();
  const body = {
    code,
    key: o.identity.publicKey,
    name: o.name.trim().slice(0, 200) || 'Beluga',
    at,
    sig: studioSign(o.identity, `link:${code}:${at}`),
  };
  const doFetch = o.fetch ?? fetch;
  let res: Response;
  try {
    res = await doFetch(`${hub}/v1/link`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(o.timeoutMs ?? 10_000),
    });
  } catch {
    return { ok: false, error: 'unreachable' };
  }
  let reply: unknown;
  try {
    reply = await res.json();
  } catch {
    reply = undefined;
  }
  const bodyOf = (typeof reply === 'object' && reply !== null ? reply : {}) as { studioId?: unknown; daemonId?: unknown; error?: unknown };
  if (res.status === 200 && typeof bodyOf.studioId === 'string' && REF.test(bodyOf.studioId) && typeof bodyOf.daemonId === 'string' && REF.test(bodyOf.daemonId)) {
    return { ok: true, studioId: bodyOf.studioId, daemonId: bodyOf.daemonId };
  }
  if (res.status === 401 && bodyOf.error === 'clock-skew') return { ok: false, error: 'clock-skew' };
  // The hub says `bad-or-expired-code` for both a wrong code and a spent one, so they are one answer here.
  if (res.status === 403) return { ok: false, error: 'bad-code' };
  if (res.status === 409) return { ok: false, error: 'key-taken' };
  return { ok: false, error: 'unreachable' };
}

// --- The socket (injectable: tests use an in-memory pair) ---

export interface LinkSocket {
  send(text: string): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
  onOpen(fn: () => void): void;
  onMessage(fn: (data: string) => void): void;
  onClose(fn: (code: number, reason: string) => void): void;
  onError(fn: () => void): void;
  onUnexpectedResponse(fn: (status: number, body: string) => void): void;
}

/** `url` is already ws(s)://. Headers are what the hub checks before it accepts the socket. */
export type WsFactory = (url: string, o: { readonly headers: Readonly<Record<string, string>> }) => LinkSocket;

/** The real one: the `ws` package, because Node's global WebSocket cannot send headers. */
export const nodeSocket: WsFactory = (url, o) => {
  const ws = new WebSocket(url, { headers: o.headers, handshakeTimeout: 10_000, perMessageDeflate: false, maxPayload: MAX_INBOUND_BYTES });
  const h: {
    open?: () => void;
    message?: (data: string) => void;
    close?: (code: number, reason: string) => void;
    error?: () => void;
    unexpected?: (status: number, body: string) => void;
  } = {};
  ws.on('open', () => h.open?.());
  ws.on('message', (data) => h.message?.(typeof data === 'string' ? data : data.toString()));
  ws.on('close', (code, reason) => h.close?.(code, reason.toString()));
  // Without a listener, an 'error' would be an unhandled event; the close that follows does the work.
  ws.on('error', () => h.error?.());
  ws.on('unexpected-response', (_req, res) => {
    let body = '';
    res.on('data', (chunk: Buffer) => {
      if (body.length < 1024) body += chunk.toString();
    });
    const done = (): void => h.unexpected?.(res.statusCode ?? 0, body);
    res.on('end', done);
    res.on('error', done);
  });
  return {
    send: (text) => ws.send(text),
    close: (code, reason) => ws.close(code, reason),
    terminate: () => ws.terminate(),
    onOpen: (fn) => void (h.open = fn),
    onMessage: (fn) => void (h.message = fn),
    onClose: (fn) => void (h.close = fn),
    onError: (fn) => void (h.error = fn),
    onUnexpectedResponse: (fn) => void (h.unexpected = fn),
  };
};

// --- Timers (the test drives them by hand) ---

export interface LinkTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(id: unknown): void;
}

const realTimers: LinkTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (id) => clearInterval(id as ReturnType<typeof setInterval>),
};

// --- The link ---

export type LinkState = 'connecting' | 'online' | 'offline' | 'revoked' | 'outdated' | 'clock-skew' | 'wrong-studio' | 'stopped';

export interface LinkStatus {
  readonly state: LinkState;
  readonly daemonId: string;
  readonly studioId: string;
  readonly onlineAt?: number;
  /** When the next attempt is due (offline / clock-skew). */
  readonly retryAt?: number;
  /** A code only: '1006', 'replayed', 'clock-skew', 'hello-timeout', … — never a sentence with a key in it. */
  readonly lastError?: string;
  /** The backoff's n: grows on each failed attempt, back to 0 after `synced`. */
  readonly attempt: number;
  /** Frames refused (down) or not sent (up). */
  readonly dropped: number;
}

/** One full snapshot frame: the hub's envelope, not a new shape of our own. */
export type DaemonUpFor = Extract<DaemonUp, { t: 'for' }>;
export type Deliver = Extract<HubDown, { t: 'deliver' }>;

/** What the link needs from the publisher, in the order the hub expects it. */
export interface SnapshotSource {
  /** The projects shared with Studio: ref ids and their names, for `hello`. */
  projects(): { id: string; name: string }[];
  /** Every plan of those projects, as full `for` frames, in any order. */
  snapshot(): DaemonUpFor[];
  onResync(project: string, planRef?: string): void;
  /** Called after `synced`: from here the link is online and deliveries begin. */
  onOnline(): void;
}

/** A hub frame bigger than this is refused before it is parsed (a hub can't make us allocate freely). */
export const MAX_INBOUND_BYTES = 512 * 1024;
/** Being online this long is what earns a fresh backoff; a hub that drops us right after `synced` doesn't. */
export const STABLE_ONLINE_MS = 30_000;
/** The codes a hub may name in `{error}`: anything else is shown as the status code, never echoed. */
const KNOWN_ERRORS: ReadonlySet<string> = new Set(['clock-skew', 'unknown-daemon', 'bad-signature', 'revoked', 'replayed', 'not-yours', 'bad-args', 'upgrade-required', 'not-found', 'unknown-studio', 'bad-or-expired-code', 'key-taken', 'over-limit', 'hub-origin-missing']);

export const WELCOME_MS = 10_000;
export const PING_MS = 25_000;
export const SILENCE_MS = 60_000;
export const MAX_BACKOFF_MS = 60_000;
export const MIN_BACKOFF_MS = 250;
export const REPLACED_MS = 5_000;

export class StudioLink {
  private readonly config: StudioConfig;
  private readonly identity: Identity;
  private readonly source: SnapshotSource;
  private readonly ws: WsFactory;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly timers: LinkTimers;
  private readonly onState?: (s: LinkStatus) => void;
  private readonly onDeliver?: (f: Deliver) => void;
  private readonly onAt?: (at: number) => void;

  private state: LinkState = 'stopped';
  private phase: 'idle' | 'hello' | 'syncing' | 'online' = 'idle';
  private socket: LinkSocket | undefined;
  /** Bumped whenever a socket is retired: its late events then find a different number and are ignored. */
  private generation = 0;
  private stopped = true;
  private attempt = 0;
  private lastAt: number;
  private replayedRetry = false;
  private onlineAt: number | undefined;
  private onlineSince: number | undefined;
  private retryAt: number | undefined;
  private lastError: string | undefined;
  private droppedCount = 0;
  private reconnectTimer: unknown;
  private welcomeTimer: unknown;
  private heartTimer: unknown;
  private silenceTimer: unknown;

  constructor(d: {
    readonly config: StudioConfig;
    readonly identity: Identity;
    readonly source: SnapshotSource;
    readonly ws?: WsFactory;
    readonly now?: () => number;
    readonly random?: () => number;
    readonly timers?: LinkTimers;
    readonly onState?: (s: LinkStatus) => void;
    readonly onDeliver?: (f: Deliver) => void;
    readonly onAt?: (at: number) => void;
  }) {
    this.config = d.config;
    this.identity = d.identity;
    this.source = d.source;
    this.ws = d.ws ?? nodeSocket;
    this.now = d.now ?? Date.now;
    this.random = d.random ?? Math.random;
    this.timers = d.timers ?? realTimers;
    if (d.onState) this.onState = d.onState;
    if (d.onDeliver) this.onDeliver = d.onDeliver;
    if (d.onAt) this.onAt = d.onAt;
    this.lastAt = d.config.lastAt ?? 0;
  }

  start(): void {
    if (!this.stopped && (this.socket || this.reconnectTimer !== undefined)) return;
    this.stopped = false;
    this.connect();
  }

  /** Close the socket and stay closed; `state` is 'stopped' (a link being removed, or the app quitting). */
  stop(code = 1000): void {
    this.stopped = true;
    if (this.reconnectTimer !== undefined) {
      this.timers.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    const socket = this.retire();
    if (socket) {
      try {
        socket.close(code, 'stopped');
      } catch {
        // A socket that refuses to close cleanly is retired anyway.
      }
    }
    this.retryAt = undefined;
    this.setState('stopped');
  }

  /** Try now, forgetting the backoff (a person pressed "reconnect"). */
  reconnectNow(): void {
    this.stopped = false;
    if (this.reconnectTimer !== undefined) {
      this.timers.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.attempt = 0;
    this.connect();
  }

  status(): LinkStatus {
    return {
      state: this.state,
      daemonId: this.config.daemonId,
      studioId: this.config.studioId,
      ...(this.onlineAt !== undefined ? { onlineAt: this.onlineAt } : {}),
      ...(this.retryAt !== undefined ? { retryAt: this.retryAt } : {}),
      ...(this.lastError !== undefined ? { lastError: this.lastError } : {}),
      attempt: this.attempt,
      dropped: this.droppedCount,
    };
  }

  /** The one way out: parsed with the hub's own schema first; an online link sends it, anything else refuses. */
  send(frame: DaemonUp): boolean {
    if (this.phase !== 'online' || this.socket === undefined) {
      this.droppedCount++;
      return false;
    }
    return this.write(frame);
  }

  // --- Connecting ---

  private connect(): void {
    if (this.stopped) return;
    const old = this.retire();
    if (old) {
      try {
        old.terminate();
      } catch {
        // Already gone.
      }
    }
    this.retryAt = undefined;
    const hub = hubUrl(this.config.hub);
    if (!hub) {
      // A configuration we cannot talk to: retrying would not change the file.
      this.lastError = 'bad-hub';
      this.stopped = true;
      this.setState('offline');
      return;
    }
    const at = Math.max(this.now(), this.lastAt + 1);
    this.lastAt = at;
    this.onAt?.(at);
    const headers = {
      'x-studio-daemon': this.config.daemonId,
      'x-studio-at': String(at),
      'x-studio-sig': studioSign(this.identity, `connect:${this.config.daemonId}:${at}`),
    };
    this.setState('connecting');
    let socket: LinkSocket;
    try {
      socket = this.ws(`${hub.replace(/^http/, 'ws')}/v1/daemon/ws`, { headers });
    } catch {
      this.fail('ws-throw');
      return;
    }
    const gen = ++this.generation;
    this.socket = socket;
    socket.onOpen(() => {
      if (!this.alive(gen)) return;
      this.onOpened(gen);
    });
    socket.onMessage((data) => {
      if (!this.alive(gen)) return;
      this.onData(gen, data);
    });
    socket.onClose((code) => {
      if (!this.alive(gen)) return;
      this.onClosed(gen, code);
    });
    socket.onError(() => {
      // The close that follows decides; keeping the listener stops an unhandled 'error'.
    });
    socket.onUnexpectedResponse((status, body) => {
      if (!this.alive(gen)) return;
      this.onRefused(gen, status, body);
    });
  }

  private alive(gen: number): boolean {
    return !this.stopped && gen === this.generation;
  }

  /** Bump the generation (its late events are now ignored), forget the socket, clear this connection's timers. */
  private retire(): LinkSocket | undefined {
    this.generation++;
    const socket = this.socket;
    this.socket = undefined;
    this.phase = 'idle';
    this.clearConnTimers();
    return socket;
  }

  private clearConnTimers(): void {
    if (this.welcomeTimer !== undefined) this.timers.clearTimeout(this.welcomeTimer);
    if (this.heartTimer !== undefined) this.timers.clearInterval(this.heartTimer);
    if (this.silenceTimer !== undefined) this.timers.clearTimeout(this.silenceTimer);
    this.welcomeTimer = undefined;
    this.heartTimer = undefined;
    this.silenceTimer = undefined;
  }

  private onOpened(gen: number): void {
    this.phase = 'hello';
    let hello: DaemonUp;
    try {
      hello = { t: 'hello', proto: STUDIO_PROTO, daemon: this.config.daemonId, projects: this.source.projects() };
    } catch {
      this.fail('projects-throw');
      return;
    }
    if (!this.write(hello)) {
      this.fail('hello-refused');
      return;
    }
    this.welcomeTimer = this.timers.setTimeout(() => {
      this.welcomeTimer = undefined;
      if (!this.alive(gen)) return;
      this.fail('hello-timeout');
    }, WELCOME_MS);
  }

  // --- Reading the hub's frames ---

  private onData(gen: number, data: string): void {
    if (data.length > MAX_INBOUND_BYTES) {
      // Bigger than any frame the hub has business sending: counted, not parsed.
      this.droppedCount++;
      return;
    }
    // The hub answers a bare `ping` itself, without waking the object; it is not JSON.
    if (data === 'pong') {
      this.heard(gen);
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      this.droppedCount++;
      return;
    }
    const frame = HubDown.safeParse(parsed);
    if (!frame.success) {
      // A newer hub's addition, or noise: ignored, counted, never a reason to drop the socket.
      this.droppedCount++;
      return;
    }
    this.heard(gen);
    switch (frame.data.t) {
      case 'welcome': {
        if (this.phase !== 'hello') {
          this.droppedCount++;
          return;
        }
        this.clearWelcome();
        if (frame.data.studio !== this.config.studioId) {
          this.halt('wrong-studio', 4006);
          return;
        }
        this.pushSnapshot(gen);
        return;
      }
      case 'resync': {
        if (this.phase !== 'online') {
          this.droppedCount++;
          return;
        }
        try {
          this.source.onResync(frame.data.project, frame.data.planRef);
        } catch {
          // The publisher's own problem; the link stays up.
        }
        return;
      }
      case 'outdated': {
        this.halt('outdated', 4001);
        return;
      }
      case 'deliver': {
        // Only once the full snapshot is in: before that the hub hasn't taken the queue for us.
        if (this.phase !== 'online') {
          this.droppedCount++;
          return;
        }
        try {
          this.onDeliver?.(frame.data);
        } catch {
          // M3 does nothing here; M4's inbox must not take the link down either.
        }
        return;
      }
    }
  }

  private pushSnapshot(gen: number): void {
    this.phase = 'syncing';
    let frames: DaemonUpFor[];
    try {
      frames = this.source.snapshot();
    } catch {
      this.fail('snapshot-throw');
      return;
    }
    for (const frame of frames) {
      if (!this.alive(gen)) return;
      // A frame the hub's schema refuses is counted by `write`; the rest still go out and `synced`
      // still follows, so one bad plan can't keep the whole daemon offline.
      this.write(frame);
    }
    if (!this.alive(gen)) return;
    if (!this.write({ t: 'synced' })) {
      this.fail('synced-refused');
      return;
    }
    this.phase = 'online';
    // A hub that says welcome, takes the snapshot and drops us would otherwise pin reconnect at
    // 250-1000ms forever: only a connection that stays up a while earns a fresh backoff.
    const lasted = this.onlineSince !== undefined ? this.now() - this.onlineSince : Number.POSITIVE_INFINITY;
    if (lasted >= STABLE_ONLINE_MS) this.attempt = 0;
    this.onlineSince = this.now();
    this.replayedRetry = false;
    this.lastError = undefined;
    this.retryAt = undefined;
    this.onlineAt = this.now();
    this.setState('online');
    try {
      this.source.onOnline();
    } catch {
      // A publisher that throws on the first refresh must not stop the link.
    }
    this.startHeartbeat(gen);
  }

  // --- Staying up ---

  private startHeartbeat(gen: number): void {
    if (this.heartTimer !== undefined) this.timers.clearInterval(this.heartTimer);
    this.heartTimer = this.timers.setInterval(() => {
      if (!this.alive(gen) || this.phase !== 'online') return;
      try {
        this.socket?.send('ping');
      } catch {
        this.fail('ping-throw');
      }
    }, PING_MS);
    this.heard(gen);
  }

  /** Anything from the hub resets the silence timer: 60 seconds of nothing means the socket is dead. */
  private heard(gen: number): void {
    if (this.silenceTimer !== undefined) this.timers.clearTimeout(this.silenceTimer);
    this.silenceTimer = this.timers.setTimeout(() => {
      this.silenceTimer = undefined;
      if (!this.alive(gen) || this.phase !== 'online') return;
      this.fail('pong-timeout');
    }, SILENCE_MS);
  }

  private clearWelcome(): void {
    if (this.welcomeTimer !== undefined) this.timers.clearTimeout(this.welcomeTimer);
    this.welcomeTimer = undefined;
  }

  // --- Failures ---

  private fail(reason: string): void {
    this.lastError = reason;
    const socket = this.retire();
    if (socket) {
      try {
        socket.terminate();
      } catch {
        // Already gone.
      }
    }
    this.schedule();
  }

  private onClosed(gen: number, code: number): void {
    if (!this.alive(gen)) return;
    this.lastError = String(code);
    this.retire();
    if (code === 4001) {
      this.halt('outdated', 4001);
      return;
    }
    if (code === 4005) {
      this.halt('revoked', 4005);
      return;
    }
    // Another connection of ours took over: give it room before crowding it out.
    this.schedule(code === 4002 ? Math.max(REPLACED_MS, this.backoff()) : this.backoff());
  }

  /** The handshake was refused before a socket: read the status and the hub's `{error}`. */
  private onRefused(gen: number, status: number, body: string): void {
    if (!this.alive(gen)) return;
    let error: string | undefined;
    try {
      const parsed = JSON.parse(body) as { error?: unknown };
      error = typeof parsed.error === 'string' ? parsed.error : undefined;
    } catch {
      error = undefined;
    }
    // Only a code this hub protocol knows is kept as it is; a crafted string never reaches a status line.
    this.lastError = error !== undefined && KNOWN_ERRORS.has(error) ? error : String(status);
    const socket = this.retire();
    if (socket) {
      try {
        socket.terminate();
      } catch {
        // Already gone.
      }
    }
    if (status === 409 && !this.replayedRetry) {
      // The hub already accepted an `at` this high (a quick restart): one more, one millisecond later.
      this.replayedRetry = true;
      this.connect();
      return;
    }
    if (status === 401 && error === 'clock-skew') {
      this.schedule(this.backoff(), 'clock-skew');
      return;
    }
    if ((status === 401 && (error === 'unknown-daemon' || error === 'bad-signature')) || (status === 403 && error === 'revoked')) {
      this.halt('revoked');
      return;
    }
    this.schedule();
  }

  /** Full jitter: [250 ms, min(60 s, 1 s · 2ⁿ)], then n grows. */
  private backoff(): number {
    const cap = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.min(this.attempt, 10));
    this.attempt = Math.min(this.attempt + 1, 10);
    const r = Math.min(1, Math.max(0, this.random()));
    return Math.max(MIN_BACKOFF_MS, r * cap);
  }

  private schedule(delay: number = this.backoff(), state: LinkState = 'offline'): void {
    if (this.stopped) return;
    this.retryAt = this.now() + delay;
    this.setState(state);
    if (this.reconnectTimer !== undefined) this.timers.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = this.timers.setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connect();
    }, delay);
  }

  /** Stop for a reason only a person can fix (re-link, update the app); no reconnect is scheduled. */
  private halt(state: LinkState, code?: number): void {
    this.stopped = true;
    if (this.reconnectTimer !== undefined) {
      this.timers.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    const socket = this.retire();
    if (socket) {
      try {
        socket.close(code, state);
      } catch {
        // Gone already.
      }
    }
    this.retryAt = undefined;
    this.setState(state);
  }

  // --- Sending ---

  /** Parse then send; false (and no bytes) when the frame isn't one the hub accepts. */
  private write(frame: DaemonUp): boolean {
    const parsed = DaemonUp.safeParse(frame);
    if (!parsed.success) {
      this.droppedCount++;
      return false;
    }
    const socket = this.socket;
    if (!socket) {
      this.droppedCount++;
      return false;
    }
    try {
      socket.send(JSON.stringify(parsed.data));
      return true;
    } catch {
      this.droppedCount++;
      return false;
    }
  }

  private setState(state: LinkState): void {
    this.state = state;
    this.onState?.(this.status());
  }
}
