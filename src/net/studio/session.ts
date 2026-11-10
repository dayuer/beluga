/**
 * Customer logins and sessions (docs/studio-hub.md §3.4).
 *
 * P1 has no sign-up: the operator invites an email, and only an invited (or already active) email
 * can get a magic link. `POST /v1/login` always answers 202, so it never says who is a customer.
 * A link token is 32 random bytes, kept as a hash, single use and 15 minutes; a session is 30 days
 * and slides forward a day at a time. The mailer is injected: the shell picks console or outbox.
 */

import { type Customer, DAY_MS, LOGIN_PER_EMAIL_PER_HOUR, LOGIN_TOKEN_TTL_MS, SESSION_TTL_MS, randomToken, sha256Hex } from './store.js';
import type { HubReply, Mailer } from './handler.js';

/** What a session or login needs from a handler's `Deps`; `Deps` satisfies it. */
export interface SessionDeps {
  readonly hub: import('./store.js').HubStore;
  readonly now: number;
  readonly random: (n: number) => Uint8Array;
  readonly mailer: Mailer;
  readonly origin: string;
}

const reply = (status: number, body: unknown): HubReply => ({ status, body });
const failure = (status: number, error: string): HubReply => reply(status, { error });

/** Trimmed and lowercased; undefined when it isn't an email we'd try. */
export function normalizeEmail(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const email = value.trim().toLowerCase();
  return email.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : undefined;
}

export function bearerOf(req: Request): string | undefined {
  const header = req.headers.get('authorization') ?? '';
  const token = /^Bearer (.+)$/.exec(header)?.[1];
  return token !== undefined && token.length <= 512 ? token : undefined;
}

/**
 * `POST /v1/login {email}`: always 202, whether or not the email is invited. The token goes in the
 * link's fragment, so it never reaches a server log or a Referer.
 */
export async function requestLogin(body: unknown, deps: SessionDeps): Promise<HubReply> {
  const email = normalizeEmail((body as { email?: unknown } | null)?.email);
  if (email) {
    const customer = await deps.hub.customerByEmail(email);
    if (customer && (customer.status === 'invited' || customer.status === 'active')) {
      const token = randomToken(32, deps.random);
      const kept = await deps.hub.createLoginToken({ tokenHash: await sha256Hex(token), customerId: customer.id, now: deps.now, ttl: LOGIN_TOKEN_TTL_MS, maxPerHour: LOGIN_PER_EMAIL_PER_HOUR });
      if (kept) {
        const link = `${deps.origin.replace(/\/$/, '')}/login#token=${token}`;
        try {
          await deps.mailer.send(email, link);
        } catch {
          // The request still looks the same; the operator can issue a link from the admin page.
        }
      }
    }
  }
  return { status: 202, body: { ok: true } };
}

/** `POST /v1/login/verify {token}`: spend the link once, start a session, mark the customer active. */
export async function verifyLogin(body: unknown, deps: SessionDeps): Promise<HubReply> {
  const token = (body as { token?: unknown } | null)?.token;
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return failure(403, 'bad-link');
  const customerId = await deps.hub.takeLoginToken(await sha256Hex(token), deps.now);
  if (!customerId) return failure(403, 'bad-link');

  const session = randomToken(32, deps.random);
  await deps.hub.createSession({ tokenHash: await sha256Hex(session), customerId, now: deps.now, ttl: SESSION_TTL_MS });
  await deps.hub.activateCustomer(customerId);
  return reply(200, { session, expiresAt: deps.now + SESSION_TTL_MS, customerId });
}

/** `POST /v1/logout`: revoke this session (idempotent for an already-revoked one). */
export async function logout(token: string | undefined, deps: SessionDeps): Promise<HubReply> {
  if (!token) return failure(401, 'not-signed-in');
  await deps.hub.revokeSession(await sha256Hex(token), deps.now);
  return { status: 204 };
}

export type CustomerAuth = { readonly ok: true; readonly customer: Customer; readonly sessionHash: string } | { readonly ok: false; readonly status: number; readonly error: string };

/**
 * Every customer request: the session is live and its customer isn't removed. A session with less
 * than 29 days left slides to 30 (at most once a day). The membership check is separate, and also
 * done on every request (`canAccess`), so removing someone takes effect immediately.
 */
export async function authCustomer(token: string | undefined, deps: SessionDeps): Promise<CustomerAuth> {
  if (!token) return { ok: false, status: 401, error: 'not-signed-in' };
  const hash = await sha256Hex(token);
  const session = await deps.hub.session(hash);
  if (!session || session.revokedAt !== undefined || session.expiresAt <= deps.now) return { ok: false, status: 401, error: 'not-signed-in' };
  const customer = await deps.hub.customer(session.customerId);
  if (!customer || (customer.status !== 'invited' && customer.status !== 'active')) return { ok: false, status: 401, error: 'not-signed-in' };
  if (session.expiresAt - deps.now < SESSION_TTL_MS - DAY_MS) await deps.hub.touchSession(hash, deps.now + SESSION_TTL_MS);
  return { ok: true, customer, sessionHash: hash };
}
