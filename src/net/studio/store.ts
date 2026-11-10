/**
 * Synon Studio's hub storage, as two interfaces (docs/studio-hub.md §1.1, §4, §5):
 *
 * - `HubStore` is D1: everything looked up before the studio is known — studios, binding codes,
 *   daemon devices, the projects a daemon reports, customers, members, sessions, the outbox.
 * - `StudioStore` is one studio's Durable Object SQLite: views, turns, the action queue, opId
 *   receipts, rate counters, the daemon connection and alerts.
 *
 * `memoryHub()`/`memoryStudio()` are the test (and local) implementations. Both are plain data and
 * Web Crypto only: the Worker, the DO and the tests run the same code. Every method takes `now`
 * explicitly: nothing here reads the clock.
 */

// --- Limits and lifetimes (docs/studio-hub.md §2); here so no rule module imports another ---

export const STUDIO_LABEL = 'synon-studio-v1';
export const LINK_CODE_TTL_MS = 15 * 60_000;
export const CLOCK_SKEW_MS = 5 * 60_000;
export const LOGIN_TOKEN_TTL_MS = 15 * 60_000;
export const LOGIN_PER_EMAIL_PER_HOUR = 5;
export const SESSION_TTL_MS = 30 * 86_400_000;
export const QUEUE_TTL_MS = 7 * 86_400_000;
export const TURNS_KEEP = 500;
export const TURNS_PAGE = 50;
export const VIEW_TURNS = 50;
export const DELIVER_MAX = 50;
export const RATE_PER_MIN = 20;
export const RATE_PER_DAY = 300;
export const RATE_CHARS_PER_DAY = 50_000;
export const PREVIEW_TTL_MS = 15 * 60_000;
export const OUTBOX_TTL_MS = 15 * 60_000;
export const ALERTS_KEEP = 200;
export const DAY_MS = 86_400_000;

// --- Web Crypto helpers (no Node imports: the Worker and the browser run this) ---

const enc = new TextEncoder();

export const fromB64 = (s: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export const b64url = (bytes: ArrayBuffer | ArrayBufferView): string => {
  const view = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return btoa(String.fromCharCode(...view)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export const sha256Hex = async (text: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
};

/** `n` random bytes as base64url; `random` is injected so tests can make ids predictable. */
export const randomToken = (n: number, random: (k: number) => Uint8Array = (k) => crypto.getRandomValues(new Uint8Array(k))): string => b64url(random(n));

/** Two strings of the same length compared without stopping at the first difference (tokens). */
export function equalBytes(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// --- D1 shapes ---

export interface Studio {
  readonly id: string;
  readonly name: string;
  readonly createdAt: number;
}

export interface LinkCode {
  readonly codeHash: string;
  readonly studioId: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly usedAt?: number;
  readonly daemonId?: string;
}

export interface Daemon {
  readonly id: string;
  readonly studioId: string;
  /** The device's Ed25519 public key: base64 SPKI DER. */
  readonly publicKey: string;
  readonly name: string;
  readonly createdAt: number;
  readonly revokedAt?: number;
}

/** A project a daemon reported in `hello` (the admin page's mapping choices). */
export interface DaemonProject {
  readonly daemonId: string;
  readonly projectId: string;
  readonly name: string;
  readonly seenAt: number;
}

export type CustomerStatus = 'invited' | 'active' | 'removed';

export interface Customer {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly status: CustomerStatus;
  readonly createdAt: number;
}

export interface Project {
  readonly id: string;
  readonly studioId: string;
  readonly name: string;
  readonly daemonId?: string;
  readonly daemonProjectId?: string;
  readonly createdAt: number;
}

export interface Member {
  readonly projectId: string;
  readonly customerId: string;
  readonly addedAt: number;
}

export interface Session {
  readonly tokenHash: string;
  readonly customerId: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly revokedAt?: number;
}

export interface LoginToken {
  readonly tokenHash: string;
  readonly customerId: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly usedAt?: number;
}

export interface OutboxEntry {
  readonly id: string;
  readonly customerId: string;
  readonly link: string;
  readonly createdAt: number;
  readonly expiresAt: number;
}

/** Where one mailbox keeps its mail: a Durable Object's SQLite, or memory. */
export interface HubStore {
  createStudio(input: { readonly name: string; readonly now: number }): Promise<Studio>;
  listStudios(): Promise<readonly Studio[]>;
  studio(id: string): Promise<Studio | undefined>;

  /** Invalidate this studio's unused codes, then keep `codeHash` until `now + ttl`. */
  issueLinkCode(input: { readonly studioId: string; readonly codeHash: string; readonly now: number; readonly ttl: number }): Promise<number | undefined>;
  peekLinkCode(codeHash: string, now: number): Promise<{ readonly studioId: string } | undefined>;
  /** Atomically spend the code; only one caller gets a studio back. */
  takeLinkCode(codeHash: string, now: number, daemonId: string): Promise<{ readonly studioId: string } | undefined>;

  daemon(id: string): Promise<Daemon | undefined>;
  daemonByKey(publicKey: string): Promise<Daemon | undefined>;
  createDaemon(input: { readonly id: string; readonly studioId: string; readonly publicKey: string; readonly name: string; readonly now: number }): Promise<'ok' | 'key-taken'>;
  revokeDaemon(id: string, now: number): Promise<void>;
  daemonsOfStudio(studioId: string): Promise<readonly Daemon[]>;

  /** What the daemon reported in `hello`: replace its whole set, keeping `seen_at`. */
  replaceDaemonProjects(daemonId: string, projects: readonly { readonly id: string; readonly name: string }[], now: number): Promise<void>;
  daemonProjects(daemonId: string): Promise<readonly DaemonProject[]>;

  customer(id: string): Promise<Customer | undefined>;
  customerByEmail(email: string): Promise<Customer | undefined>;
  customers(): Promise<readonly Customer[]>;
  createCustomer(input: { readonly id: string; readonly email: string; readonly name: string; readonly now: number }): Promise<Customer | 'email-taken'>;
  /** Tombstone the account and clear its memberships, tokens, sessions and outbox. */
  removeCustomer(id: string, now: number): Promise<void>;
  /** An invited customer who logged in once is active (the admin page shows "signed in"). */
  activateCustomer(id: string): Promise<void>;

  project(id: string): Promise<Project | undefined>;
  projectsOfStudio(studioId: string): Promise<readonly Project[]>;
  projectsOfDaemon(daemonId: string): Promise<readonly Project[]>;
  projectsOfCustomer(customerId: string): Promise<readonly Project[]>;
  createProject(input: { readonly id: string; readonly studioId: string; readonly name: string; readonly now: number }): Promise<Project>;
  bindProject(input: { readonly projectId: string; readonly daemonId: string; readonly daemonProjectId: string; readonly now: number }): Promise<'ok' | 'unknown-project' | 'already-bound' | 'already-mapped'>;
  unbindProject(projectId: string): Promise<void>;

  members(projectId: string): Promise<readonly Member[]>;
  addMember(projectId: string, customerId: string, now: number): Promise<void>;
  removeMember(projectId: string, customerId: string): Promise<void>;
  canAccess(customerId: string, projectId: string): Promise<boolean>;

  /** `false` when this customer already got `maxPerHour` login tokens in the last hour. */
  createLoginToken(input: { readonly tokenHash: string; readonly customerId: string; readonly now: number; readonly ttl: number; readonly maxPerHour: number }): Promise<boolean>;
  takeLoginToken(tokenHash: string, now: number): Promise<string | undefined>;
  createSession(input: { readonly tokenHash: string; readonly customerId: string; readonly now: number; readonly ttl: number }): Promise<void>;
  session(tokenHash: string): Promise<Session | undefined>;
  touchSession(tokenHash: string, expiresAt: number): Promise<void>;
  revokeSession(tokenHash: string, now: number): Promise<void>;
  revokeCustomerSessions(customerId: string, now: number): Promise<void>;

  addOutbox(entry: OutboxEntry): Promise<void>;
  outboxForStudio(studioId: string, now: number): Promise<readonly (OutboxEntry & { readonly email: string })[]>;
  dropOutbox(before: number): Promise<void>;
}

// --- Durable Object shapes ---

export type QueueState = 'queued' | 'taken' | 'done' | 'refused' | 'expired';

export interface ViewRow {
  readonly projectId: string;
  readonly planRef: string;
  readonly rev: number;
  /** `StudioPlanView` JSON, already strict-validated before it got here. */
  readonly viewJson: string;
  readonly updatedAt: number;
}

export interface TurnRow {
  readonly projectId: string;
  readonly planRef: string;
  readonly turnId: string;
  readonly at: number;
  /** `StudioTurn` JSON. */
  readonly json: string;
}

export interface QueueItem {
  readonly seq: number;
  readonly opKey: string;
  readonly opId: string;
  readonly projectId: string;
  readonly planRef?: string;
  readonly customerId: string;
  readonly kind: string;
  /** The validated `StudioAction` JSON (the original frame). */
  readonly frameJson: string;
  readonly state: QueueState;
  readonly enqueuedAt: number;
  readonly takenBy?: string;
  readonly takenAt?: number;
}

export interface OpRow {
  readonly opKey: string;
  readonly state: 'queued' | 'done' | 'refused' | 'expired';
  readonly code?: string;
  readonly at: number;
  readonly updatedAt: number;
}

export interface Conn {
  readonly daemonId: string;
  /** The last accepted connection signature timestamp: a replay must be strictly greater. */
  readonly lastAt: number;
  readonly connectedAt?: number;
  readonly lastSeenAt: number;
  readonly synced: boolean;
}

export interface AlertRow {
  readonly id: number;
  readonly at: number;
  readonly daemonId?: string;
  readonly what: string;
}

export interface RateLimits {
  readonly perMinute: number;
  readonly perDay: number;
  readonly charsPerDay: number;
}

/** One studio's Durable Object storage. */
export interface StudioStore {
  readView(projectId: string, planRef: string): Promise<ViewRow | undefined>;
  listViews(projectId: string): Promise<readonly ViewRow[]>;
  putView(view: ViewRow): Promise<void>;
  deleteView(projectId: string, planRef: string): Promise<void>;

  /** Upsert by turn id, then keep the newest `keep` by (at, turnId). */
  putTurns<T extends { readonly id: string; readonly at: number }>(projectId: string, planRef: string, turns: readonly T[], keep: number): Promise<void>;
  turnsBefore(projectId: string, planRef: string, before: string | undefined, limit: number): Promise<readonly TurnRow[]>;
  turnCount(projectId: string, planRef: string): Promise<number>;
  deleteTurns(projectId: string, planRef: string): Promise<void>;

  /** `undefined` when `opKey` is already in the queue (the caller returns the existing receipt). */
  enqueue(item: Omit<QueueItem, 'seq' | 'state' | 'takenBy' | 'takenAt'>): Promise<number | undefined>;
  queueRow(opKey: string): Promise<QueueItem | undefined>;
  queueByOp(opId: string, daemonId?: string): Promise<readonly QueueItem[]>;
  takeable(projectIds: readonly string[], limit: number): Promise<readonly QueueItem[]>;
  markTaken(seqs: readonly number[], daemonId: string, now: number): Promise<void>;
  requeueTaken(daemonId: string): Promise<void>;
  settle(seq: number, state: 'done' | 'refused'): Promise<void>;

  op(opKey: string): Promise<OpRow | undefined>;
  /** Insert or update by opKey. */
  recordOp(row: OpRow): Promise<void>;

  /** Is one more action (and its `chars`) within every window? Does not add. */
  rateHit(customerId: string, planKey: string, now: number, chars: number, limits: RateLimits): Promise<boolean>;
  rateAdd(customerId: string, planKey: string, now: number, chars: number): Promise<void>;

  conn(daemonId: string): Promise<Conn | undefined>;
  conns(): Promise<readonly Conn[]>;
  putConn(conn: Conn): Promise<void>;

  alert(daemonId: string | undefined, what: string, now: number): Promise<void>;
  alerts(limit: number): Promise<readonly AlertRow[]>;

  /** Mark queued/taken items older than `before` expired; returns what changed. */
  expire(before: number, now: number): Promise<readonly QueueItem[]>;

  /** Drop terminal queue and op rows older than `before`. */
  prune(before: number): Promise<void>;
}

// --- A hub in memory (tests, and trying things out) ---

const clone = <T>(row: T): T => ({ ...row });

export function memoryHub(): HubStore {
  const studios = new Map<string, Studio>();
  const codes = new Map<string, LinkCode>();
  const daemons = new Map<string, Daemon>();
  const daemonProjects = new Map<string, DaemonProject[]>();
  const customers = new Map<string, Customer>();
  const projects = new Map<string, Project>();
  const members = new Map<string, Member>();
  const loginTokens = new Map<string, LoginToken>();
  const sessions = new Map<string, Session>();
  const outbox = new Map<string, OutboxEntry>();
  let nextId = 1;
  const id = (prefix: string): string => `${prefix}_${nextId++}`;

  const memberKey = (projectId: string, customerId: string): string => `${projectId}\u0000${customerId}`;

  return {
    createStudio: async ({ name, now }) => {
      const studio: Studio = { id: id('st'), name, createdAt: now };
      studios.set(studio.id, studio);
      return studio;
    },
    listStudios: async () => [...studios.values()].sort((a, b) => a.createdAt - b.createdAt),
    studio: async (sid) => studios.get(sid),

    issueLinkCode: async ({ studioId, codeHash, now, ttl }) => {
      if (!studios.has(studioId)) return undefined;
      for (const [hash, c] of codes) if (c.studioId === studioId && c.usedAt === undefined && c.expiresAt > now) codes.set(hash, { ...c, expiresAt: now });
      const expiresAt = now + ttl;
      codes.set(codeHash, { codeHash, studioId, createdAt: now, expiresAt });
      return expiresAt;
    },
    peekLinkCode: async (codeHash, now) => {
      const c = codes.get(codeHash);
      return c && c.usedAt === undefined && c.expiresAt > now ? { studioId: c.studioId } : undefined;
    },
    takeLinkCode: async (codeHash, now, daemonId) => {
      const c = codes.get(codeHash);
      if (!c || c.usedAt !== undefined || c.expiresAt <= now) return undefined;
      codes.set(codeHash, { ...c, usedAt: now, daemonId });
      return { studioId: c.studioId };
    },

    daemon: async (did) => daemons.get(did),
    daemonByKey: async (publicKey) => [...daemons.values()].find((d) => d.publicKey === publicKey),
    createDaemon: async ({ id: did, studioId, publicKey, name, now }) => {
      if ([...daemons.values()].some((d) => d.publicKey === publicKey)) return 'key-taken';
      daemons.set(did, { id: did, studioId, publicKey, name, createdAt: now });
      return 'ok';
    },
    revokeDaemon: async (did, now) => {
      const d = daemons.get(did);
      if (d) daemons.set(did, { ...d, revokedAt: now });
    },
    daemonsOfStudio: async (studioId) => [...daemons.values()].filter((d) => d.studioId === studioId).sort((a, b) => a.createdAt - b.createdAt),

    replaceDaemonProjects: async (daemonId, list, now) => {
      daemonProjects.set(daemonId, list.map((p) => ({ daemonId, projectId: p.id, name: p.name, seenAt: now })));
    },
    daemonProjects: async (daemonId) => daemonProjects.get(daemonId) ?? [],

    customer: async (cid) => customers.get(cid),
    customerByEmail: async (email) => [...customers.values()].find((c) => c.email === email),
    customers: async () => [...customers.values()].sort((a, b) => a.createdAt - b.createdAt),
    createCustomer: async ({ id: cid, email, name, now }) => {
      if ([...customers.values()].some((c) => c.email === email)) return 'email-taken';
      const customer: Customer = { id: cid, email, name, status: 'invited', createdAt: now };
      customers.set(cid, customer);
      return customer;
    },
    removeCustomer: async (cid, now) => {
      const c = customers.get(cid);
      if (c) customers.set(cid, { ...c, status: 'removed' });
      for (const [key, m] of members) if (m.customerId === cid) members.delete(key);
      for (const [hash, s] of sessions) if (s.customerId === cid) sessions.set(hash, { ...s, revokedAt: now });
      for (const [hash, t] of loginTokens) if (t.customerId === cid) loginTokens.delete(hash);
      for (const [oid, o] of outbox) if (o.customerId === cid) outbox.delete(oid);
    },
    activateCustomer: async (cid) => {
      const c = customers.get(cid);
      if (c && c.status === 'invited') customers.set(cid, { ...c, status: 'active' });
    },

    project: async (pid) => projects.get(pid),
    projectsOfStudio: async (studioId) => [...projects.values()].filter((p) => p.studioId === studioId).sort((a, b) => a.createdAt - b.createdAt),
    projectsOfDaemon: async (daemonId) => [...projects.values()].filter((p) => p.daemonId === daemonId).sort((a, b) => a.createdAt - b.createdAt),
    projectsOfCustomer: async (customerId) => [...new Set([...members.values()].filter((m) => m.customerId === customerId).map((m) => m.projectId))].map((pid) => projects.get(pid)).filter((p): p is Project => p !== undefined),
    createProject: async ({ id: pid, studioId, name, now }) => {
      const project: Project = { id: pid, studioId, name, createdAt: now };
      projects.set(pid, project);
      return project;
    },
    bindProject: async ({ projectId, daemonId, daemonProjectId }) => {
      const p = projects.get(projectId);
      if (!p) return 'unknown-project';
      if (p.daemonId !== undefined && p.daemonId !== daemonId) return 'already-bound';
      const taken = [...projects.values()].some((q) => q.id !== projectId && q.daemonId === daemonId && q.daemonProjectId === daemonProjectId);
      if (taken) return 'already-mapped';
      projects.set(projectId, { ...p, daemonId, daemonProjectId });
      return 'ok';
    },
    unbindProject: async (pid) => {
      const p = projects.get(pid);
      if (!p) return;
      projects.set(pid, { id: p.id, studioId: p.studioId, name: p.name, createdAt: p.createdAt });
    },

    members: async (projectId) => [...members.values()].filter((m) => m.projectId === projectId),
    addMember: async (projectId, customerId, now) => {
      members.set(memberKey(projectId, customerId), { projectId, customerId, addedAt: now });
    },
    removeMember: async (projectId, customerId) => {
      members.delete(memberKey(projectId, customerId));
    },
    canAccess: async (customerId, projectId) => members.has(memberKey(projectId, customerId)),

    createLoginToken: async ({ tokenHash, customerId, now, ttl, maxPerHour }) => {
      const hour = [...loginTokens.values()].filter((t) => t.customerId === customerId && t.createdAt > now - 3_600_000).length;
      if (hour >= maxPerHour) return false;
      loginTokens.set(tokenHash, { tokenHash, customerId, createdAt: now, expiresAt: now + ttl });
      return true;
    },
    takeLoginToken: async (tokenHash, now) => {
      const t = loginTokens.get(tokenHash);
      if (!t || t.usedAt !== undefined || t.expiresAt <= now) return undefined;
      loginTokens.set(tokenHash, { ...t, usedAt: now });
      return t.customerId;
    },
    createSession: async ({ tokenHash, customerId, now, ttl }) => {
      sessions.set(tokenHash, { tokenHash, customerId, createdAt: now, expiresAt: now + ttl });
    },
    session: async (tokenHash) => sessions.get(tokenHash),
    touchSession: async (tokenHash, expiresAt) => {
      const s = sessions.get(tokenHash);
      if (s) sessions.set(tokenHash, { ...s, expiresAt });
    },
    revokeSession: async (tokenHash, now) => {
      const s = sessions.get(tokenHash);
      if (s) sessions.set(tokenHash, { ...s, revokedAt: now });
    },
    revokeCustomerSessions: async (customerId, now) => {
      for (const [hash, s] of sessions) if (s.customerId === customerId) sessions.set(hash, { ...s, revokedAt: now });
    },

    addOutbox: async (entry) => void outbox.set(entry.id, entry),
    outboxForStudio: async (studioId, now) => {
      const customerIds = new Set([...projects.values()].filter((p) => p.studioId === studioId).flatMap((p) => [...members.values()].filter((m) => m.projectId === p.id).map((m) => m.customerId)));
      return [...outbox.values()]
        .filter((o) => o.expiresAt > now && customerIds.has(o.customerId))
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((o) => ({ ...o, email: customers.get(o.customerId)?.email ?? '' }));
    },
    dropOutbox: async (before) => {
      for (const [oid, o] of outbox) if (o.expiresAt <= before) outbox.delete(oid);
    },
  };
}

// --- A studio DO in memory ---

export function memoryStudio(limits: RateLimits = { perMinute: 20, perDay: 300, charsPerDay: 50_000 }): StudioStore {
  const views = new Map<string, ViewRow>();
  const turns = new Map<string, TurnRow>();
  const queue: QueueItem[] = [];
  const ops = new Map<string, OpRow>();
  const rates = new Map<string, { windowStart: number; n: number; chars: number }>();
  const conns = new Map<string, Conn>();
  const alerts: AlertRow[] = [];
  let seq = 0;
  let alertId = 0;

  const viewKey = (projectId: string, planRef: string): string => `${projectId}\u0000${planRef}`;
  const turnKey = (projectId: string, planRef: string, turnId: string): string => `${projectId}\u0000${planRef}\u0000${turnId}`;
  const rateKey = (customerId: string, planKey: string, windowStart: number): string => `${customerId}\u0000${planKey}\u0000${windowStart}`;
  const minuteOf = (now: number): number => now - (now % 60_000);
  const dayOf = (now: number): number => now - (now % 86_400_000);

  return {
    readView: async (projectId, planRef) => views.get(viewKey(projectId, planRef)),
    listViews: async (projectId) => [...views.values()].filter((v) => v.projectId === projectId).sort((a, b) => b.updatedAt - a.updatedAt),
    putView: async (view) => void views.set(viewKey(view.projectId, view.planRef), clone(view)),
    deleteView: async (projectId, planRef) => void views.delete(viewKey(projectId, planRef)),

    putTurns: async (projectId, planRef, list, keep) => {
      for (const turn of list) {
        turns.set(turnKey(projectId, planRef, turn.id), { projectId, planRef, turnId: turn.id, at: turn.at, json: JSON.stringify(turn) });
      }
      const all = [...turns.values()].filter((t) => t.projectId === projectId && t.planRef === planRef).sort((a, b) => a.at - b.at || a.turnId.localeCompare(b.turnId));
      for (const old of all.slice(0, Math.max(0, all.length - keep))) turns.delete(turnKey(projectId, planRef, old.turnId));
    },
    turnsBefore: async (projectId, planRef, before, limit) => {
      const all = [...turns.values()].filter((t) => t.projectId === projectId && t.planRef === planRef).sort((a, b) => a.at - b.at || a.turnId.localeCompare(b.turnId));
      const cut = before === undefined ? all.length : Math.max(0, all.findIndex((t) => t.turnId === before));
      return all.slice(Math.max(0, cut - limit), cut);
    },
    turnCount: async (projectId, planRef) => [...turns.values()].filter((t) => t.projectId === projectId && t.planRef === planRef).length,
    deleteTurns: async (projectId, planRef) => {
      for (const [key, t] of turns) if (t.projectId === projectId && t.planRef === planRef) turns.delete(key);
    },

    enqueue: async (item) => {
      if (queue.some((q) => q.opKey === item.opKey)) return undefined;
      seq += 1;
      queue.push({ ...item, seq, state: 'queued' });
      return seq;
    },
    queueRow: async (opKey) => queue.find((q) => q.opKey === opKey),
    queueByOp: async (opId, daemonId) => queue.filter((q) => q.opId === opId && (daemonId === undefined || q.takenBy === daemonId)),
    takeable: async (projectIds, limit) => {
      const ids = new Set(projectIds);
      return queue.filter((q) => q.state === 'queued' && ids.has(q.projectId)).sort((a, b) => a.seq - b.seq).slice(0, limit);
    },
    markTaken: async (seqs, daemonId, now) => {
      const set = new Set(seqs);
      for (let i = 0; i < queue.length; i++) {
        const q = queue[i]!;
        if (set.has(q.seq) && q.state === 'queued') queue[i] = { ...q, state: 'taken', takenBy: daemonId, takenAt: now };
      }
    },
    requeueTaken: async (daemonId) => {
      for (let i = 0; i < queue.length; i++) {
        const q = queue[i]!;
        if (q.state === 'taken' && q.takenBy === daemonId) queue[i] = { seq: q.seq, opKey: q.opKey, opId: q.opId, projectId: q.projectId, ...(q.planRef ? { planRef: q.planRef } : {}), customerId: q.customerId, kind: q.kind, frameJson: q.frameJson, state: 'queued', enqueuedAt: q.enqueuedAt };
      }
    },
    settle: async (s, state) => {
      const i = queue.findIndex((q) => q.seq === s);
      if (i < 0) return;
      const q = queue[i]!;
      queue[i] = { ...q, state };
    },

    op: async (opKey) => ops.get(opKey),
    recordOp: async (row) => void ops.set(row.opKey, clone(row)),

    rateHit: async (customerId, planKey, now, chars, lim) => {
      const minute = rates.get(rateKey(customerId, planKey, minuteOf(now)));
      if ((minute?.n ?? 0) >= lim.perMinute) return false;
      const dayStart = dayOf(now);
      let n = 0;
      let c = 0;
      for (const [key, row] of rates) {
        if (!key.startsWith(`${customerId}\u0000${planKey}\u0000`)) continue;
        if (row.windowStart < dayStart) continue;
        n += row.n;
        c += row.chars;
      }
      return n < lim.perDay && c + chars <= lim.charsPerDay;
    },
    rateAdd: async (customerId, planKey, now, chars) => {
      const key = rateKey(customerId, planKey, minuteOf(now));
      const row = rates.get(key) ?? { windowStart: minuteOf(now), n: 0, chars: 0 };
      rates.set(key, { ...row, n: row.n + 1, chars: row.chars + chars });
    },

    conn: async (daemonId) => conns.get(daemonId),
    conns: async () => [...conns.values()],
    putConn: async (conn) => void conns.set(conn.daemonId, clone(conn)),

    alert: async (daemonId, what, now) => {
      alertId += 1;
      alerts.push({ id: alertId, at: now, ...(daemonId ? { daemonId } : {}), what });
      if (alerts.length > 200) alerts.splice(0, alerts.length - 200);
    },
    alerts: async (limit) => [...alerts].reverse().slice(0, limit),

    expire: async (before) => {
      const out: QueueItem[] = [];
      for (let i = 0; i < queue.length; i++) {
        const q = queue[i]!;
        if ((q.state === 'queued' || q.state === 'taken') && q.enqueuedAt < before) {
          queue[i] = { ...q, state: 'expired' };
          out.push(queue[i]!);
        }
      }
      return out;
    },
    prune: async (before) => {
      for (let i = queue.length - 1; i >= 0; i--) {
        const q = queue[i]!;
        if (q.state !== 'queued' && q.state !== 'taken' && q.enqueuedAt < before) queue.splice(i, 1);
      }
      for (const [key, row] of ops) if (row.state !== 'queued' && row.updatedAt < before) ops.delete(key);
    },
  };
}
