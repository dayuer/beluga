/**
 * Synon Studio's hub rules (docs/studio-hub.md): routing, the four identities, binding codes,
 * daemon signatures and the transport envelopes. Everything here is plain data and Web Crypto:
 * the Cloudflare Worker, the Durable Object and the tests call the same functions. Storage is
 * injected (`HubStore` on D1, `StudioStore` in the studio's DO); nothing here reads the clock.
 *
 * The shell (packages/studio-hub) only turns `HubReply`s into `Response`s and executes `Effect`s.
 */

import { z } from 'zod';
import { DaemonHello, LIMITS, PlanFrame, PlanGoneFrame, STUDIO_PROTO, StudioAction, StudioReceipt, type AppFrame } from '../../studio/protocol.js';
import { addMember, bindProject, createProject, customerLoginLink, inviteCustomer, listCustomers, removeCustomer, removeMember, revokeDaemon, studioDetail, unbindProject } from './accounts.js';
import { ack, enqueue, take } from './queue.js';
import { authCustomer, bearerOf, logout as logoutSession, requestLogin, verifyLogin } from './session.js';
import { ingestGone, ingestPlan, listPlans, readView, turnsBefore } from './views.js';
import {
  ALERTS_KEEP,
  CLOCK_SKEW_MS,
  DAY_MS,
  DELIVER_MAX,
  LINK_CODE_TTL_MS,
  LOGIN_PER_EMAIL_PER_HOUR,
  LOGIN_TOKEN_TTL_MS,
  OUTBOX_TTL_MS,
  PREVIEW_TTL_MS,
  QUEUE_TTL_MS,
  RATE_CHARS_PER_DAY,
  RATE_PER_DAY,
  RATE_PER_MIN,
  SESSION_TTL_MS,
  STUDIO_LABEL,
  TURNS_KEEP,
  TURNS_PAGE,
  VIEW_TURNS,
  b64url,
  equalBytes,
  fromB64,
  sha256Hex,
  type Daemon,
  type HubStore,
  type StudioStore,
} from './store.js';

// Re-exported for the shell, the tests and the other rule modules; they live in store.ts so no
// rule module has to import this one just for a constant.
export {
  ALERTS_KEEP,
  CLOCK_SKEW_MS,
  DAY_MS,
  DELIVER_MAX,
  LINK_CODE_TTL_MS,
  LOGIN_PER_EMAIL_PER_HOUR,
  LOGIN_TOKEN_TTL_MS,
  OUTBOX_TTL_MS,
  PREVIEW_TTL_MS,
  QUEUE_TTL_MS,
  RATE_CHARS_PER_DAY,
  RATE_PER_DAY,
  RATE_PER_MIN,
  SESSION_TTL_MS,
  STUDIO_LABEL,
  TURNS_KEEP,
  TURNS_PAGE,
  VIEW_TURNS,
};

// --- Shared shapes (docs/studio-hub.md §1.1) ---

export interface Mailer {
  /** May throw when the transport fails; the login route turns that into a retryable 503. */
  send(email: string, link: string): Promise<void>;
}

/** P1 allows everything; P3 adds the paid tiers and a refusal code. */
export interface Entitlements {
  allows(what: 'project' | 'active-plan', studioId: string, n?: number): Promise<boolean>;
}

export const alwaysAllow: Entitlements = { allows: async () => true };

export interface Deps {
  readonly hub: HubStore;
  readonly studio?: StudioStore;
  readonly now: number;
  readonly random: (n: number) => Uint8Array;
  readonly mailer: Mailer;
  readonly ent: Entitlements;
  /** `sha256Hex(OPERATOR_TOKEN)`; the token itself never enters this module. */
  readonly operatorTokenHash: string;
  /** The public origin, for magic links and (P2) preview links. */
  readonly origin: string;
  readonly previewSecret?: string;
}

export type StudioDeps = Deps & { readonly studio: StudioStore; readonly studioId: string };

/** What the shell executes after a WebSocket or an HTTP call. */
export type Effect =
  | { readonly to: 'daemon'; readonly daemonId: string; readonly msg: HubDown }
  | { readonly to: 'app'; readonly projectId: string; readonly frame: AppFrame }
  | { readonly to: 'close'; readonly tag: string; readonly code: number; readonly reason: string }
  | { readonly to: 'alert'; readonly daemonId?: string; readonly what: string };

/** What `handleHubRequest`/`handleStudioRequest` return; the shell makes the `Response`. */
export interface HubReply {
  readonly status: number;
  readonly body?: unknown;
  readonly headers?: Readonly<Record<string, string>>;
  readonly effects?: readonly Effect[];
}

export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'cache-control': 'no-store',
};

// --- Routing ---

export type RouteName =
  | 'admin-page'
  | 'health'
  | 'link'
  | 'login'
  | 'login-verify'
  | 'logout'
  | 'admin-studios'
  | 'admin-studio'
  | 'admin-link-codes'
  | 'admin-projects'
  | 'admin-customers'
  | 'admin-customer'
  | 'admin-customer-login'
  | 'admin-project-daemon'
  | 'admin-project-member'
  | 'admin-daemons'
  | 'app-projects'
  | 'app-plans'
  | 'app-plan'
  | 'app-turns'
  | 'app-actions'
  | 'app-ws'
  | 'app-preview'
  | 'daemon-ws'
  | 'internal-status'
  | 'internal-close'
  | 'not-found';

export interface Route {
  readonly name: RouteName;
  readonly area: 'hub' | 'studio' | 'none';
  readonly params: Readonly<Record<string, string>>;
}

const REF = /^[A-Za-z0-9_-]{1,64}$/;

const at = (name: RouteName, area: Route['area'], params: Record<string, string> = {}): Route => ({ name, area, params });

/** Which route a path is, and whether it belongs to the Worker (hub) or a studio's DO. */
export function routeOf(_method: string, pathname: string): Route {
  const p = pathname.split('/').filter((s) => s.length > 0);
  if (p.length === 0) return at('admin-page', 'hub');
  if (p.length === 1 && p[0] === 'healthz') return at('health', 'hub');
  if (p[0] !== 'v1' || p.length < 2) return at('not-found', 'none');
  const s = (i: number): string | undefined => p[i];
  const id = (i: number): boolean => {
    const v = s(i);
    return v !== undefined && REF.test(v);
  };

  if (p.length === 2) {
    if (s(1) === 'link') return at('link', 'hub');
    if (s(1) === 'login') return at('login', 'hub');
    if (s(1) === 'logout') return at('logout', 'hub');
  }
  if (p.length === 3 && s(1) === 'login' && s(2) === 'verify') return at('login-verify', 'hub');
  if (p.length === 3 && s(1) === 'daemon' && s(2) === 'ws') return at('daemon-ws', 'studio');

  if (s(1) === 'admin') {
    const area = 'hub' as const;
    if (p.length === 3 && s(2) === 'studios') return at('admin-studios', area);
    if (p.length === 3 && s(2) === 'customers') return at('admin-customers', area);
    if (p.length === 4 && s(2) === 'studios' && id(3)) return at('admin-studio', area, { sid: s(3)! });
    if (p.length === 4 && s(2) === 'customers' && id(3)) return at('admin-customer', area, { cid: s(3)! });
    if (p.length === 4 && s(2) === 'daemons' && id(3)) return at('admin-daemons', area, { did: s(3)! });
    if (p.length === 5 && s(2) === 'studios' && id(3) && s(4) === 'link-codes') return at('admin-link-codes', area, { sid: s(3)! });
    if (p.length === 5 && s(2) === 'studios' && id(3) && s(4) === 'projects') return at('admin-projects', area, { sid: s(3)! });
    if (p.length === 5 && s(2) === 'customers' && id(3) && s(4) === 'login-link') return at('admin-customer-login', area, { cid: s(3)! });
    if (p.length === 5 && s(2) === 'projects' && id(3) && s(4) === 'daemon') return at('admin-project-daemon', area, { pid: s(3)! });
    if (p.length === 6 && s(2) === 'projects' && id(3) && s(4) === 'members' && id(5)) return at('admin-project-member', area, { pid: s(3)!, cid: s(5)! });
  }

  if (s(1) === 'app' && s(2) === 'projects') {
    const area = 'studio' as const;
    if (p.length === 3) return at('app-projects', 'hub');
    if (!id(3)) return at('not-found', 'none');
    const pid = s(3)!;
    if (p.length === 5 && s(4) === 'plans') return at('app-plans', area, { pid });
    if (p.length === 5 && s(4) === 'actions') return at('app-actions', area, { pid });
    if (p.length === 5 && s(4) === 'ws') return at('app-ws', area, { pid });
    if (p.length === 6 && s(4) === 'plans' && id(5)) return at('app-plan', area, { pid, ref: s(5)! });
    if (p.length === 7 && s(4) === 'plans' && id(5) && s(6) === 'turns') return at('app-turns', area, { pid, ref: s(5)! });
    if (p.length === 6 && s(4) === 'previews' && id(5)) return at('app-preview', area, { pid, m: s(5)! });
  }

  if (s(1) === 'internal') {
    if (p.length === 3 && s(2) === 'close') return at('internal-close', 'studio');
    if (p.length === 5 && s(2) === 'studios' && id(3) && s(4) === 'status') return at('internal-status', 'studio', { sid: s(3)! });
  }

  return at('not-found', 'none');
}

// --- Errors and bodies ---

const reply = (status: number, body: unknown): HubReply => ({ status, body });
const failure = (status: number, error: string): HubReply => reply(status, { error });
const notImplemented = (): HubReply => failure(501, 'not-implemented');

async function readJson(req: Request): Promise<unknown> {
  try {
    const text = await req.text();
    if (text.length > 65_536) return undefined;
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

const method = (req: Request, ...allowed: readonly string[]): boolean => allowed.includes(req.method);

// --- Operator ---

export async function isOperator(req: Request, deps: Deps): Promise<boolean> {
  const header = req.headers.get('authorization') ?? '';
  const token = /^Bearer (.+)$/.exec(header)?.[1];
  if (token === undefined || token.length > 512) return false;
  return equalBytes(await sha256Hex(token), deps.operatorTokenHash);
}

async function operatorOnly(req: Request, deps: Deps): Promise<HubReply | undefined> {
  return (await isOperator(req, deps)) ? undefined : failure(401, 'operator-only');
}

// --- Binding codes ---

const LINK_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const LINK_CODE_RE = /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

/** Eight Crockford base32 symbols (40 bits) as `XXXX-XXXX`. */
export function newLinkCode(random: (n: number) => Uint8Array): string {
  const bytes = random(5);
  let acc = 0;
  let bits = 0;
  let out = '';
  for (const byte of bytes) {
    acc = ((acc << 8) | byte) & 0xffffff;
    bits += 8;
    while (bits >= 5) {
      out += LINK_ALPHABET[(acc >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return `${out.slice(0, 4)}-${out.slice(4, 8)}`;
}

/** What someone typed, as the canonical `XXXX-XXXX`; undefined when it isn't a code. */
export function normalizeLinkCode(input: string): string | undefined {
  const flat = input.trim().toUpperCase().replace(/[\s-]/g, '').replaceAll('O', '0').replaceAll('I', '1').replaceAll('L', '1');
  return flat.length === 8 && [...flat].every((c) => LINK_ALPHABET.includes(c)) ? `${flat.slice(0, 4)}-${flat.slice(4)}` : undefined;
}

export const linkCodeHash = (code: string): Promise<string> => sha256Hex(code.replace('-', ''));

/** `b64url(sha256(SPKI DER)).slice(0, 32)`, the same id mailbox uses for a key. */
export async function daemonIdOf(publicKey: string): Promise<string> {
  return b64url(await crypto.subtle.digest('SHA-256', fromB64(publicKey))).slice(0, 32);
}

const enc = new TextEncoder();

/** `sig` is `publicKey`'s Ed25519 signature over `synon-studio-v1:<text>` (as signText makes it). */
export async function signedBy(publicKey: string, text: string, sig: string): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey('spki', fromB64(publicKey), { name: 'Ed25519' }, false, ['verify']);
    return await crypto.subtle.verify({ name: 'Ed25519' }, key, fromB64(sig), enc.encode(`${STUDIO_LABEL}:${text}`));
  } catch {
    return false;
  }
}

export const LINK_CODE_BODY = z
  .object({ code: z.string().regex(LINK_CODE_RE), key: z.string().min(40).max(400), name: z.string().trim().min(1).max(200), at: z.number().int(), sig: z.string().min(40).max(400) })
  .strict();

/** `POST /v1/link`: a one-time code and proof of the key's private half register a daemon. */
export async function registerDaemon(req: Request, deps: Deps): Promise<HubReply> {
  const parsed = LINK_CODE_BODY.safeParse(await readJson(req));
  if (!parsed.success) return failure(400, 'bad-args');
  const { code, key, name, at: signedAt, sig } = parsed.data;
  if (Math.abs(deps.now - signedAt) > CLOCK_SKEW_MS) return failure(401, 'clock-skew');
  if (!(await signedBy(key, `link:${code}:${signedAt}`, sig))) return failure(403, 'bad-signature');

  const codeHash = await linkCodeHash(code);
  const found = await deps.hub.peekLinkCode(codeHash, deps.now);
  if (!found) return failure(403, 'bad-or-expired-code');
  const daemonId = await daemonIdOf(key);
  const existing = await deps.hub.daemonByKey(key);
  if (existing) {
    // The same key asking for the same studio is a retry, not a second device; the code is still spent.
    if (existing.studioId !== found.studioId) return failure(409, 'key-taken');
    if (!(await deps.hub.takeLinkCode(codeHash, deps.now, daemonId))) return failure(403, 'bad-or-expired-code');
    return reply(200, { studioId: existing.studioId, daemonId: existing.id });
  }

  const taken = await deps.hub.takeLinkCode(codeHash, deps.now, daemonId);
  if (!taken) return failure(403, 'bad-or-expired-code');
  const created = await deps.hub.createDaemon({ id: daemonId, studioId: taken.studioId, publicKey: key, name, now: deps.now });
  if (created === 'key-taken') {
    // Lost a race with another registration of the same key: answer with the winner.
    const winner = await deps.hub.daemonByKey(key);
    return winner && winner.studioId === taken.studioId ? reply(200, { studioId: winner.studioId, daemonId: winner.id }) : failure(409, 'key-taken');
  }
  return reply(200, { studioId: taken.studioId, daemonId });
}

// --- Daemon connections ---

export type ConnectCheck = { readonly ok: true; readonly daemon: Daemon } | { readonly ok: false; readonly status: number; readonly error: string };

/**
 * The rules of `GET /v1/daemon/ws` (docs/studio-hub.md §3.3), without the socket: the daemon must
 * be registered, not revoked, sign `connect:<id>:<at>` with its own key, be within five minutes,
 * and use a strictly newer `at` than the last accepted one (a replay of a signature is refused).
 */
export async function verifyDaemonConnect(input: { readonly daemonId: string; readonly at: number; readonly sig: string }, deps: Deps): Promise<ConnectCheck> {
  if (!/^[A-Za-z0-9_-]{32}$/.test(input.daemonId) || !Number.isInteger(input.at) || input.at <= 0) return { ok: false, status: 400, error: 'bad-args' };
  const daemon = await deps.hub.daemon(input.daemonId);
  if (!daemon) return { ok: false, status: 401, error: 'unknown-daemon' };
  if (daemon.revokedAt !== undefined) return { ok: false, status: 403, error: 'revoked' };
  if (Math.abs(deps.now - input.at) > CLOCK_SKEW_MS) return { ok: false, status: 401, error: 'clock-skew' };
  if (!(await signedBy(daemon.publicKey, `connect:${input.daemonId}:${input.at}`, input.sig))) return { ok: false, status: 401, error: 'bad-signature' };
  const conn = deps.studio ? await deps.studio.conn(input.daemonId) : undefined;
  if (conn && input.at <= conn.lastAt) return { ok: false, status: 409, error: 'replayed' };
  return { ok: true, daemon };
}

// --- Internal Worker → DO identity ---

export const INTERNAL_AUTH_SCHEMA = z.discriminatedUnion('role', [
  z.object({ role: z.literal('operator') }).strict(),
  z.object({ role: z.literal('daemon'), daemonId: z.string().regex(/^[A-Za-z0-9_-]{32}$/) }).strict(),
  z.object({ role: z.literal('app'), customerId: z.string().min(1).max(64), projectId: z.string().regex(REF), sessionHash: z.string().min(1).max(128).optional() }).strict(),
]);
export type InternalAuth = z.infer<typeof INTERNAL_AUTH_SCHEMA>;

export function internalAuthOf(header: string | null): InternalAuth | undefined {
  if (!header || header.length > 512) return undefined;
  try {
    const parsed = INTERNAL_AUTH_SCHEMA.safeParse(JSON.parse(header) as unknown);
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

// --- Transport envelopes (docs/studio-hub.md §10) ---

const ref = z.string().min(1).max(LIMITS.ref).regex(REF);
const proto = z.object({ major: z.number().int().min(0), minor: z.number().int().min(0) }).strict();

export const DaemonUp = z.union([
  DaemonHello,
  z.object({ t: z.literal('for'), project: ref, frame: z.union([PlanFrame, PlanGoneFrame]) }).strict(),
  StudioReceipt,
  z.object({ t: z.literal('synced') }).strict(),
]);
export type DaemonUp = z.infer<typeof DaemonUp>;

export const HubDown = z.union([
  z.object({ t: z.literal('welcome'), studio: ref, proto }).strict(),
  z.object({ t: z.literal('deliver'), seq: z.number().int().min(0), project: ref, action: StudioAction }).strict(),
  z.object({ t: z.literal('resync'), project: ref, planRef: ref.optional() }).strict(),
  z.object({ t: z.literal('outdated') }).strict(),
]);
export type HubDown = z.infer<typeof HubDown>;

// --- The Worker's routes ---

const CreateStudioBody = z.object({ name: z.string().trim().min(1).max(200) }).strict();

const ADMIN_PLACEHOLDER = '<!doctype html><meta charset="utf-8"><title>Synon Studio</title><h1>Synon Studio</h1><p>The admin page arrives in BLG-61.</p>';

export async function handleHubRequest(req: Request, deps: Deps): Promise<HubReply> {
  const route = routeOf(req.method, new URL(req.url).pathname);
  if (route.area === 'studio') return failure(404, 'not-found');

  switch (route.name) {
    case 'admin-page':
      return method(req, 'GET') ? { status: 200, body: ADMIN_PLACEHOLDER, headers: { 'content-type': 'text/html; charset=utf-8', ...SECURITY_HEADERS } } : failure(405, 'method-not-allowed');

    case 'health':
      return method(req, 'GET') ? reply(200, { ok: true, proto: STUDIO_PROTO }) : failure(405, 'method-not-allowed');

    case 'link':
      return method(req, 'POST') ? registerDaemon(req, deps) : failure(405, 'method-not-allowed');

    case 'admin-studios': {
      const no = await operatorOnly(req, deps);
      if (no) return no;
      if (method(req, 'GET')) return reply(200, { studios: await deps.hub.listStudios() });
      if (!method(req, 'POST')) return failure(405, 'method-not-allowed');
      const parsed = CreateStudioBody.safeParse(await readJson(req));
      if (!parsed.success) return failure(400, 'bad-args');
      const studio = await deps.hub.createStudio({ name: parsed.data.name, now: deps.now });
      const code = newLinkCode(deps.random);
      const expiresAt = (await deps.hub.issueLinkCode({ studioId: studio.id, codeHash: await linkCodeHash(code), now: deps.now, ttl: LINK_CODE_TTL_MS })) ?? deps.now + LINK_CODE_TTL_MS;
      return reply(200, { studio, linkCode: { code, expiresAt } });
    }

    case 'admin-link-codes': {
      const no = await operatorOnly(req, deps);
      if (no) return no;
      if (!method(req, 'POST')) return failure(405, 'method-not-allowed');
      const studioId = route.params.sid!;
      if (!(await deps.hub.studio(studioId))) return failure(404, 'unknown-project');
      const code = newLinkCode(deps.random);
      const expiresAt = (await deps.hub.issueLinkCode({ studioId, codeHash: await linkCodeHash(code), now: deps.now, ttl: LINK_CODE_TTL_MS })) ?? deps.now + LINK_CODE_TTL_MS;
      return reply(200, { code, expiresAt });
    }

    case 'admin-studio': {
      const no = await operatorOnly(req, deps);
      if (no) return no;
      if (!method(req, 'GET')) return failure(405, 'method-not-allowed');
      return studioDetail(route.params.sid!, deps);
    }

    case 'admin-projects': {
      const no = await operatorOnly(req, deps);
      if (no) return no;
      if (!method(req, 'POST')) return failure(405, 'method-not-allowed');
      return createProject(route.params.sid!, await readJson(req), deps);
    }

    case 'admin-customers': {
      const no = await operatorOnly(req, deps);
      if (no) return no;
      if (method(req, 'GET')) return listCustomers(new URL(req.url).searchParams.get('studio') ?? undefined, deps);
      if (!method(req, 'POST')) return failure(405, 'method-not-allowed');
      return inviteCustomer(await readJson(req), deps);
    }

    case 'admin-customer': {
      const no = await operatorOnly(req, deps);
      if (no) return no;
      if (!method(req, 'DELETE')) return failure(405, 'method-not-allowed');
      return removeCustomer(route.params.cid!, deps);
    }

    case 'admin-customer-login': {
      const no = await operatorOnly(req, deps);
      if (no) return no;
      if (!method(req, 'POST')) return failure(405, 'method-not-allowed');
      return customerLoginLink(route.params.cid!, deps);
    }

    case 'admin-project-daemon': {
      const no = await operatorOnly(req, deps);
      if (no) return no;
      if (method(req, 'PUT')) return bindProject(route.params.pid!, await readJson(req), deps);
      if (method(req, 'DELETE')) return unbindProject(route.params.pid!, deps);
      return failure(405, 'method-not-allowed');
    }

    case 'admin-project-member': {
      const no = await operatorOnly(req, deps);
      if (no) return no;
      if (method(req, 'PUT')) return addMember(route.params.pid!, route.params.cid!, deps);
      if (method(req, 'DELETE')) return removeMember(route.params.pid!, route.params.cid!, deps);
      return failure(405, 'method-not-allowed');
    }

    case 'admin-daemons': {
      const no = await operatorOnly(req, deps);
      if (no) return no;
      if (!method(req, 'DELETE')) return failure(405, 'method-not-allowed');
      return revokeDaemon(route.params.did!, deps);
    }

    case 'login':
      return method(req, 'POST') ? requestLogin(await readJson(req), deps) : failure(405, 'method-not-allowed');

    case 'login-verify':
      return method(req, 'POST') ? verifyLogin(await readJson(req), deps) : failure(405, 'method-not-allowed');

    case 'logout':
      return method(req, 'POST') ? logoutSession(bearerOf(req), deps) : failure(405, 'method-not-allowed');

    case 'app-projects': {
      if (!method(req, 'GET')) return failure(405, 'method-not-allowed');
      const auth = await authCustomer(bearerOf(req), deps);
      if (!auth.ok) return failure(auth.status, auth.error);
      const projects = await deps.hub.projectsOfCustomer(auth.customer.id);
      const out: Array<{ id: string; studioId: string; studioName: string; name: string }> = [];
      for (const p of projects) out.push({ id: p.id, studioId: p.studioId, studioName: (await deps.hub.studio(p.studioId))?.name ?? '', name: p.name });
      return reply(200, { projects: out });
    }

    default:
      return failure(404, 'not-found');
  }
}

// --- The studio DO's routes ---

const CloseBody = z.object({ role: z.enum(['daemon', 'customer', 'session']), id: z.string().min(1).max(200) }).strict();

/** A customer route: the internal identity is an app one for this project, and still a member. */
async function appGuard(auth: InternalAuth, pid: string | undefined, deps: StudioDeps): Promise<HubReply | undefined> {
  if (auth.role !== 'app' || pid === undefined || auth.projectId !== pid) return failure(403, 'not-yours');
  if (!(await deps.hub.canAccess(auth.customerId, auth.projectId))) return failure(403, 'not-yours');
  return undefined;
}

export async function handleStudioRequest(req: Request, deps: StudioDeps, auth: InternalAuth): Promise<HubReply> {
  const route = routeOf(req.method, new URL(req.url).pathname);
  if (route.area !== 'studio') return failure(404, 'not-found');

  switch (route.name) {
    case 'daemon-ws': {
      if (auth.role !== 'daemon') return failure(403, 'not-yours');
      const daemonId = req.headers.get('x-studio-daemon') ?? '';
      const signedAt = Number(req.headers.get('x-studio-at'));
      const sig = req.headers.get('x-studio-sig') ?? '';
      if (daemonId !== auth.daemonId) return failure(403, 'not-yours');
      const check = await verifyDaemonConnect({ daemonId, at: signedAt, sig }, deps);
      return check.ok ? reply(200, { ok: true }) : failure(check.status, check.error);
    }

    case 'internal-close': {
      if (auth.role !== 'operator') return failure(403, 'not-yours');
      if (!method(req, 'POST')) return failure(405, 'method-not-allowed');
      const parsed = CloseBody.safeParse(await readJson(req));
      if (!parsed.success) return failure(400, 'bad-args');
      const { role, id } = parsed.data;
      const close: Effect =
        role === 'daemon'
          ? { to: 'close', tag: `daemon:${id}`, code: 4005, reason: 'revoked' }
          : role === 'customer'
            ? { to: 'close', tag: `cust:${id}`, code: 4004, reason: 'removed' }
            : { to: 'close', tag: `sess:${id}`, code: 4004, reason: 'signed-out' };
      return { status: 200, body: { ok: true }, effects: [close] };
    }

    case 'internal-status': {
      if (auth.role !== 'operator') return failure(403, 'not-yours');
      const conns = await deps.studio.conns();
      return reply(200, {
        daemons: conns.map((c) => ({ id: c.daemonId, online: c.connectedAt !== undefined, synced: c.synced, connectedAt: c.connectedAt ?? null, lastSeenAt: c.lastSeenAt })),
        alerts: await deps.studio.alerts(50),
      });
    }

    case 'app-actions': {
      const no = await appGuard(auth, route.params.pid, deps);
      if (no) return no;
      if (auth.role !== 'app') return failure(403, 'not-yours');
      if (!method(req, 'POST')) return failure(405, 'method-not-allowed');
      const result = await enqueue(await readJson(req), { studio: deps.studioId, projectId: auth.projectId, customerId: auth.customerId }, deps);
      if (!result.ok) return failure(result.status, result.error);
      const effects: Effect[] = [];
      if (result.receipt.state === 'queued') {
        const project = await deps.hub.project(auth.projectId);
        if (project?.daemonId) {
          const taken = await take(project.daemonId, deps);
          for (const e of taken.expired) effects.push({ to: 'app', projectId: e.projectId, frame: e.receipt });
          for (const d of taken.deliver) effects.push({ to: 'daemon', daemonId: project.daemonId, msg: { t: 'deliver', seq: d.seq, project: d.daemonProjectId, action: d.action } });
        }
      }
      return { status: 200, body: { receipt: result.receipt }, effects };
    }

    case 'app-plans': {
      const no = await appGuard(auth, route.params.pid, deps);
      if (no) return no;
      if (!method(req, 'GET')) return failure(405, 'method-not-allowed');
      // Whether the studio is there is part of the list's answer: the app shows "工作室离线 · 上次同步
      // x 分钟前" without a second request (docs/studio-hub.md §6.2, M5 design §0.2).
      const project = await deps.hub.project(route.params.pid!);
      const conn = project?.daemonId ? await deps.studio.conn(project.daemonId) : undefined;
      const online = conn?.connectedAt !== undefined;
      const studio = { online, lastSyncAt: online ? deps.now : (conn?.lastSeenAt ?? null) };
      return reply(200, { plans: await listPlans(route.params.pid!, deps), studio });
    }

    case 'app-plan': {
      const no = await appGuard(auth, route.params.pid, deps);
      if (no) return no;
      if (!method(req, 'GET')) return failure(405, 'method-not-allowed');
      const shown = await readView(route.params.pid!, route.params.ref!, deps);
      return shown ? reply(200, { view: shown.view, updatedAt: shown.updatedAt }) : failure(404, 'unknown-plan');
    }

    case 'app-turns': {
      const no = await appGuard(auth, route.params.pid, deps);
      if (no) return no;
      if (!method(req, 'GET')) return failure(405, 'method-not-allowed');
      const url = new URL(req.url);
      const limit = Number(url.searchParams.get('limit') ?? String(TURNS_PAGE));
      return reply(200, await turnsBefore(route.params.pid!, route.params.ref!, url.searchParams.get('before') ?? undefined, limit, deps));
    }

    case 'app-preview': {
      const no = await appGuard(auth, route.params.pid, deps);
      if (no) return no;
      return failure(403, 'not-delivered');
    }

    default: {
      // Customer routes not built yet. The internal identity still has to be an app one for this
      // project, and a member.
      const no = await appGuard(auth, route.params.pid, deps);
      return no ?? notImplemented();
    }
  }
}

// --- The WebSocket side (docs/studio-hub.md §10, §11) ---

/** Deliver whatever is waiting; the shell turns each into a `deliver` frame on the daemon socket. */
async function delivery(daemonId: string, deps: StudioDeps): Promise<Effect[]> {
  const taken = await take(daemonId, deps);
  const effects: Effect[] = [];
  for (const expired of taken.expired) effects.push({ to: 'app', projectId: expired.projectId, frame: expired.receipt });
  for (const item of taken.deliver) effects.push({ to: 'daemon', daemonId, msg: { t: 'deliver', seq: item.seq, project: item.daemonProjectId, action: item.action } });
  return effects;
}

/** A daemon socket was accepted: keep its last-seen; nothing is sent until it says `hello`. */
export async function onDaemonOpen(daemonId: string, deps: StudioDeps): Promise<Effect[]> {
  const conn = await deps.studio.conn(daemonId);
  if (conn) await deps.studio.putConn({ ...conn, lastSeenAt: deps.now });
  return [];
}

/**
 * One daemon frame (already authenticated by the connection). The fixed order is: `hello` →
 * full `for` snapshots → `synced`, and only then deliveries. A bad frame is alerted and ignored,
 * never closes the socket (a version difference must not start a reconnect storm).
 */
export async function onDaemonMessage(daemonId: string, raw: string, deps: StudioDeps, at?: number): Promise<Effect[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    await deps.studio.alert(daemonId, 'bad-frame', deps.now);
    return [];
  }

  // M3's incremental frame is reserved: ask for a full snapshot instead (docs/studio-hub.md §15).
  if ((parsed as { t?: unknown } | null)?.t === 'patch') {
    const patch = parsed as { readonly project?: unknown; readonly planRef?: unknown };
    await deps.studio.alert(daemonId, 'patched-early', deps.now);
    return typeof patch.project === 'string' ? [{ to: 'daemon', daemonId, msg: { t: 'resync', project: patch.project, ...(typeof patch.planRef === 'string' ? { planRef: patch.planRef } : {}) } }] : [];
  }

  const frame = DaemonUp.safeParse(parsed);
  if (!frame.success) {
    await deps.studio.alert(daemonId, 'bad-frame', deps.now);
    return [];
  }

  const conn = await deps.studio.conn(daemonId);
  if (!conn) return [{ to: 'close', tag: `daemon:${daemonId}`, code: 4003, reason: 'not-hello' }];
  // A replaced socket may still deliver queued messages before its close lands: fence it by `at`.
  if (at !== undefined && conn.lastAt !== at) return [{ to: 'close', tag: `daemon:${daemonId}`, code: 4002, reason: 'replaced' }];
  // The fixed reconnect order: hello, then the full views, then synced. Nothing else comes first.
  if (frame.data.t !== 'hello' && !conn.hello) return [{ to: 'close', tag: `daemon:${daemonId}`, code: 4003, reason: 'not-hello' }];
  await deps.studio.putConn({ ...conn, lastSeenAt: deps.now });

  switch (frame.data.t) {
    case 'hello': {
      if (frame.data.daemon !== daemonId) return [{ to: 'close', tag: `daemon:${daemonId}`, code: 4003, reason: 'not-hello' }];
      if (frame.data.proto.major !== STUDIO_PROTO.major) {
        return [{ to: 'daemon', daemonId, msg: { t: 'outdated' } }, { to: 'close', tag: `daemon:${daemonId}`, code: 4001, reason: 'outdated' }];
      }
      await deps.hub.replaceDaemonProjects(daemonId, frame.data.projects, deps.now);
      await deps.studio.putConn({ ...conn, lastSeenAt: deps.now, hello: true });
      return [{ to: 'daemon', daemonId, msg: { t: 'welcome', studio: deps.studioId, proto: STUDIO_PROTO } }];
    }

    case 'for': {
      const result = frame.data.frame.t === 'plan'
        ? await ingestPlan(daemonId, { project: frame.data.project, frame: frame.data.frame }, deps)
        : await ingestGone(daemonId, { project: frame.data.project, planRef: frame.data.frame.planRef }, deps);
      return [...result.effects];
    }

    case 'receipt': {
      const result = await ack(daemonId, frame.data, deps);
      if (!result.ok) return [];
      return [{ to: 'app', projectId: result.projectId, frame: result.receipt }, ...(await delivery(daemonId, deps))];
    }

    case 'synced': {
      await deps.studio.putConn({ ...conn, lastSeenAt: deps.now, hello: true, synced: true });
      return delivery(daemonId, deps);
    }
  }
  return [];
}

/** A daemon socket closed. A replaced one leaves the connection to its successor (see §7.4). */
export async function onDaemonClose(daemonId: string, at: number, deps: StudioDeps): Promise<Effect[]> {
  const conn = await deps.studio.conn(daemonId);
  if (!conn || conn.lastAt !== at) return [];
  await deps.studio.putConn({ daemonId, lastAt: conn.lastAt, lastSeenAt: deps.now, hello: conn.hello, synced: false });
  await deps.studio.requeueTaken(daemonId);
  return [];
}

/**
 * Is this socket still allowed to receive the project's broadcasts? Re-checked before every send,
 * so a failed close (or a removed/logged-out customer whose socket lingers) still learns nothing.
 */
export async function appSocketAllowed(customerId: string, projectId: string, sessionHash: string | undefined, deps: StudioDeps): Promise<boolean> {
  if (sessionHash !== undefined) {
    const session = await deps.hub.session(sessionHash);
    if (!session || session.revokedAt !== undefined || session.expiresAt <= deps.now) return false;
    const customer = await deps.hub.customer(session.customerId);
    if (!customer || (customer.status !== 'invited' && customer.status !== 'active')) return false;
  }
  return deps.hub.canAccess(customerId, projectId);
}

/** A customer socket was accepted: send the last full view of every cached plan (only to it). */
export async function onAppOpen(customerId: string, projectId: string, deps: StudioDeps): Promise<Effect[]> {
  if (!(await deps.hub.canAccess(customerId, projectId))) return [{ to: 'close', tag: `app:${projectId}`, code: 4004, reason: 'not-yours' }];
  const effects: Effect[] = [];
  for (const row of await deps.studio.listViews(projectId)) {
    const shown = await readView(projectId, row.planRef, deps);
    if (shown) effects.push({ to: 'app', projectId, frame: { t: 'plan', rev: row.rev, view: shown.view } });
  }
  return effects;
}
