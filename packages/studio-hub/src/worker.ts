/**
 * Synon Studio's Worker (docs/studio-hub.md §6). It routes by D1 alone: hub routes go to
 * `handleHubRequest`; a studio route is resolved to its studio (a daemon's device or a project's
 * studio) and handed to that studio's Durable Object with an internal identity. The rules are all
 * in src/net/studio; this file only picks the DO, merges the admin detail with online state, and
 * closes sockets after an operator's removal (the DO does the closing).
 */

import {
  LOGIN_TOKEN_TTL_MS,
  OUTBOX_TTL_MS,
  randomToken,
  sha256Hex,
} from '../../../src/net/studio/store.js';
import {
  SECURITY_HEADERS,
  alwaysAllow,
  handleHubRequest,
  routeOf,
  type Deps,
  type InternalAuth,
} from '../../../src/net/studio/handler.js';
import { authCustomer, bearerOf } from '../../../src/net/studio/session.js';
import { resendMailer } from '../../../src/net/studio/mail.js';
import { ADMIN_HTML } from './admin-page.js';
import { D1HubStore } from './d1.js';
import { StudioHub, type Env } from './hub.js';
import { jsonOf, responseOf } from './reply.js';

export { StudioHub };

const random = (n: number): Uint8Array => crypto.getRandomValues(new Uint8Array(n));

let operatorHash: string | undefined;
async function operatorTokenHash(env: Env): Promise<string> {
  return (operatorHash ??= await sha256Hex(env.OPERATOR_TOKEN ?? ''));
}

/**
 * `outbox` (default: keep the link in D1 for the admin page to forward), `resend` (a real email,
 * BLG-82's choice), or `console` (only logs "link issued", never the token). The mailing rules are
 * the hub's; this function only picks the transport.
 */
function mailerFor(env: Env, hub: D1HubStore, now: number): Deps['mailer'] {
  // Outbox by default: a magic link is a credential and must not be in a log by default.
  const mode = env.MAIL_MODE ?? 'outbox';
  const outbox: Deps['mailer'] = {
    send: async (email, link) => {
      const customer = await hub.customerByEmail(email);
      if (!customer) return;
      await hub.addOutbox({ id: randomToken(16), customerId: customer.id, link, createdAt: now, expiresAt: now + OUTBOX_TTL_MS });
    },
  };
  if (mode === 'resend') {
    if (!env.RESEND_API_KEY) {
      // Keep the link rather than lose it; the operator can still forward it from the admin page.
      console.warn('[studio] mail: MAIL_MODE=resend without RESEND_API_KEY; using the outbox');
      return outbox;
    }
    return resendMailer({
      apiKey: env.RESEND_API_KEY,
      from: env.MAIL_FROM ?? 'Synon Studio <login@synon.studio>',
      ttlMinutes: Math.round(LOGIN_TOKEN_TTL_MS / 60_000),
    });
  }
  if (mode === 'outbox') return outbox;
  return { send: async () => void console.log('[studio] login link issued') };
}

async function depsFor(env: Env, hub: D1HubStore, now: number, origin: string): Promise<Deps> {
  return {
    hub,
    now,
    random,
    mailer: mailerFor(env, hub, now),
    ent: alwaysAllow,
    operatorTokenHash: await operatorTokenHash(env),
    origin,
    ...(env.PREVIEW_SECRET ? { previewSecret: env.PREVIEW_SECRET } : {}),
  };
}

const stubFor = (env: Env, studioId: string) => env.STUDIO.get(env.STUDIO.idFromName(studioId));

/** The same request, with whatever the client sent as an internal identity removed and ours added. */
function forwarded(req: Request, auth: InternalAuth): Request {
  const headers = new Headers(req.headers);
  headers.delete('x-studio-auth');
  for (const key of [...headers.keys()]) if (key.startsWith('x-internal-')) headers.delete(key);
  headers.set('x-studio-auth', JSON.stringify(auth));
  return new Request(req, { headers });
}

async function callDo(env: Env, studioId: string, path: string, method: 'GET' | 'POST', body?: unknown): Promise<Response> {
  const headers = new Headers({ 'x-studio-auth': JSON.stringify({ role: 'operator' } satisfies InternalAuth) });
  if (body !== undefined) headers.set('content-type', 'application/json');
  return stubFor(env, studioId).fetch(new Request(`https://studio.internal${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }));
}

async function doJson<T>(env: Env, studioId: string, path: string): Promise<T | undefined> {
  try {
    const res = await callDo(env, studioId, path, 'GET');
    return res.ok ? ((await res.json()) as T) : undefined;
  } catch {
    return undefined;
  }
}

/** The session a customer route carries: `Authorization` for HTTP, `bearer.<session>` for the socket. */
function sessionToken(req: Request): string | undefined {
  const bearer = bearerOf(req);
  if (bearer) return bearer;
  const protocols = (req.headers.get('sec-websocket-protocol') ?? '').split(',').map((p) => p.trim());
  const found = protocols.find((p) => p.startsWith('bearer.'));
  return found?.slice('bearer.'.length);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const route = routeOf(req.method, url.pathname);
    const hub = new D1HubStore(env.DB);
    const now = Date.now();
    // Never fall back to the request's Host: a magic link built from it could point at an attacker.
    const origin = env.HUB_ORIGIN ?? '';

    if (route.name === 'not-found') return jsonOf({ error: 'not-found' }, 404);
    // The admin page is static; the data behind it needs the operator token.
    if (route.name === 'admin-page' && req.method === 'GET') {
      return new Response(ADMIN_HTML, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', ...SECURITY_HEADERS } });
    }
    // Internal routes are only reachable through this Worker's own calls to a DO.
    if (url.pathname.startsWith('/v1/internal/')) return jsonOf({ error: 'not-found' }, 404);

    if (route.area === 'studio') {
      if (route.name === 'daemon-ws') {
        const daemonId = req.headers.get('x-studio-daemon') ?? '';
        const daemon = await hub.daemon(daemonId);
        if (!daemon) return jsonOf({ error: 'unknown-daemon' }, 401);
        // The DO re-checks the signature, the clock and the replay before accepting the socket.
        return stubFor(env, daemon.studioId).fetch(forwarded(req, { role: 'daemon', daemonId }));
      }

      const projectId = route.params.pid;
      if (projectId === undefined) return jsonOf({ error: 'not-found' }, 404);
      const token = sessionToken(req);
      const auth = await authCustomer(token, { hub, now, random, mailer: mailerFor(env, hub, now), origin });
      if (!auth.ok) return jsonOf({ error: auth.error }, auth.status);
      const project = await hub.project(projectId);
      if (!project) return jsonOf({ error: 'unknown-project' }, 404);
      const identity: InternalAuth = { role: 'app', customerId: auth.customer.id, projectId, ...(token !== undefined ? { sessionHash: await sha256Hex(token) } : {}) };
      return stubFor(env, project.studioId).fetch(forwarded(req, identity));
    }

    const deps = await depsFor(env, hub, now, origin);

    // Logging out: revoke the session, then close the sockets made for it in every studio.
    if (route.name === 'logout' && req.method === 'POST') {
      const token = bearerOf(req);
      const who = token !== undefined ? await authCustomer(token, deps) : undefined;
      const reply = await handleHubRequest(req, deps);
      if (who?.ok && token !== undefined) {
        const sessionHash = await sha256Hex(token);
        for (const studioId of new Set((await hub.projectsOfCustomer(who.customer.id)).map((p) => p.studioId))) {
          await callDo(env, studioId, '/v1/internal/close', 'POST', { role: 'session', id: sessionHash });
        }
      }
      return responseOf(reply);
    }

    const reply = await handleHubRequest(req, deps);

    // The admin detail: D1 from the handler, online state and alerts from the studio's DO.
    if (route.name === 'admin-studio' && req.method === 'GET' && reply.status === 200) {
      const studioId = route.params.sid!;
      const status = await doJson<{ daemons: Array<{ id: string; online: boolean; synced: boolean; connectedAt: number | null; lastSeenAt: number }>; alerts: unknown[] }>(env, studioId, `/v1/internal/studios/${studioId}/status`);
      const detail = reply.body as { daemons: Array<Record<string, unknown>>; alerts?: unknown };
      if (status) {
        const online = new Map(status.daemons.map((d) => [d.id, d]));
        detail.daemons = detail.daemons.map((d) => {
          const conn = online.get(String(d.id));
          return { ...d, online: conn?.online ?? false, synced: conn?.synced ?? false, connectedAt: conn?.connectedAt ?? null, lastSeenAt: conn?.lastSeenAt ?? null };
        });
        detail.alerts = status.alerts;
      }
      return responseOf(reply);
    }

    // An operator's removal changed D1; close the sockets it affected in that studio.
    const changed = reply.body as { studioIds?: string[]; studioId?: string } | undefined;
    if (route.name === 'admin-customer' && req.method === 'DELETE' && changed?.studioIds) {
      for (const studioId of changed.studioIds) await callDo(env, studioId, '/v1/internal/close', 'POST', { role: 'customer', id: route.params.cid! });
    } else if (route.name === 'admin-project-member' && req.method === 'DELETE' && changed?.studioId) {
      await callDo(env, changed.studioId, '/v1/internal/close', 'POST', { role: 'customer', id: route.params.cid! });
    } else if (route.name === 'admin-daemons' && req.method === 'DELETE' && changed?.studioId) {
      await callDo(env, changed.studioId, '/v1/internal/close', 'POST', { role: 'daemon', id: route.params.did! });
    }

    return responseOf(reply);
  },
};
