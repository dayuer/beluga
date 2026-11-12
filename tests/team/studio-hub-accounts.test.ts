import { describe, expect, it } from 'vitest';
import {
  alwaysAllow,
  handleHubRequest,
  handleStudioRequest,
  type HubReply,
  type InternalAuth,
  type StudioDeps,
} from '../../src/net/studio/handler.js';
import { authCustomer } from '../../src/net/studio/session.js';
import { memoryHub, memoryStudio, sha256Hex, type HubStore, type StudioStore } from '../../src/net/studio/store.js';

/** BLG-64: the operator invites, grants and maps; the customer sees only their project. */

const START = 1_768_000_000_000;
const OPERATOR = 'operator';
const OP_HASH = await sha256Hex(OPERATOR);
const did = (c: string): string => c.repeat(32);

interface World {
  readonly deps: StudioDeps;
  readonly hub: HubStore;
  readonly studio: StudioStore;
  readonly sent: Array<{ email: string; link: string }>;
  advance(ms: number): void;
}

async function world(): Promise<World> {
  const hub = memoryHub();
  const studio = memoryStudio();
  const clock = { now: START };
  const sent: Array<{ email: string; link: string }> = [];
  const deps: StudioDeps = {
    hub,
    studio,
    studioId: 'st_placeholder',
    get now() {
      return clock.now;
    },
    random: (n) => crypto.getRandomValues(new Uint8Array(n)),
    mailer: { send: async (email, link) => void sent.push({ email, link }) },
    ent: alwaysAllow,
    operatorTokenHash: OP_HASH,
    origin: 'https://hub.test',
  };
  return { deps, hub, studio, sent, advance: (ms) => void (clock.now += ms) };
}

function request(method: string, path: string, opts: { token?: string; body?: unknown } = {}): Request {
  const headers = new Headers();
  if (opts.token !== undefined) headers.set('authorization', `Bearer ${opts.token}`);
  const init: RequestInit = { method, headers };
  if (opts.body !== undefined) {
    headers.set('content-type', 'application/json');
    init.body = JSON.stringify(opts.body);
  }
  return new Request(`https://hub.test${path}`, init);
}

const admin = (w: World, method: string, path: string, body?: unknown): Promise<HubReply> => handleHubRequest(request(method, path, { token: OPERATOR, body }), w.deps);
const bodyOf = (r: HubReply): Record<string, unknown> => r.body as Record<string, unknown>;

async function studio(w: World, name = 'Acme'): Promise<string> {
  const r = await admin(w, 'POST', '/v1/admin/studios', { name });
  return (bodyOf(r).studio as { id: string }).id;
}

async function project(w: World, sid: string, name = '客户 App'): Promise<string> {
  const r = await admin(w, 'POST', `/v1/admin/studios/${sid}/projects`, { name });
  return (bodyOf(r).project as { id: string }).id;
}

async function invited(w: World, email = 'c1@example.test', name = '客户一'): Promise<string> {
  const r = await admin(w, 'POST', '/v1/admin/customers', { email, name });
  return (bodyOf(r).customer as { id: string }).id;
}

async function manualLogin(w: World, cid: string): Promise<{ session: string; customerId: string }> {
  const r = await admin(w, 'POST', `/v1/admin/customers/${cid}/login-link`);
  const link = (bodyOf(r).link as string);
  const token = new URL(link).hash.replace('#token=', '');
  const v = await handleHubRequest(request('POST', '/v1/login/verify', { body: { token } }), w.deps);
  return bodyOf(v) as { session: string; customerId: string };
}

async function daemon(w: World, sid: string, id: string, reported: Array<{ id: string; name: string }>, revoked = false): Promise<void> {
  await w.hub.createDaemon({ id, studioId: sid, publicKey: `key-${id}`, name: id, now: w.deps.now });
  await w.hub.replaceDaemonProjects(id, reported, w.deps.now);
  if (revoked) await w.hub.revokeDaemon(id, w.deps.now);
}

const appAuth = (customerId: string, projectId: string): InternalAuth => ({ role: 'app', customerId, projectId });

describe('only the operator', () => {
  it('can invite, grant, map or revoke', async () => {
    const w = await world();
    const sid = await studio(w);
    const pid = await project(w, sid);
    const cid = await invited(w);
    const d1 = did('a');
    await daemon(w, sid, d1, [{ id: 'dp1', name: 'api' }]);

    for (const [method, path, body] of [
      ['POST', '/v1/admin/customers', { email: 'x@y.z' }],
      ['PUT', `/v1/admin/projects/${pid}/members/${cid}`, undefined],
      ['PUT', `/v1/admin/projects/${pid}/daemon`, { daemonId: d1, daemonProjectId: 'dp1' }],
      ['DELETE', `/v1/admin/daemons/${d1}`, undefined],
      ['GET', `/v1/admin/studios/${sid}`, undefined],
      ['POST', `/v1/admin/customers/${cid}/login-link`, undefined],
    ] as const) {
      const r = await handleHubRequest(request(method, path, { body }), w.deps);
      expect(r.status).toBe(401);
    }

    expect((await admin(w, 'POST', '/v1/admin/customers', { email: 'ok@example.test' })).status).toBe(200);
    expect((await admin(w, 'PUT', `/v1/admin/projects/${pid}/members/${cid}`)).status).toBe(200);
    expect((await admin(w, 'PUT', `/v1/admin/projects/${pid}/daemon`, { daemonId: d1, daemonProjectId: 'dp1' })).status).toBe(200);
    expect((await admin(w, 'GET', `/v1/admin/studios/${sid}`)).status).toBe(200);
    expect((await admin(w, 'DELETE', `/v1/admin/daemons/${d1}`)).status).toBe(200);
  });
});

describe('inviting customers', () => {
  it('normalizes the email, is idempotent, and re-invites a removed email as a new account', async () => {
    const w = await world();
    const first = await admin(w, 'POST', '/v1/admin/customers', { email: ' Ann@Example.Test ', name: 'Ann' });
    expect(first.status).toBe(200);
    const customer = bodyOf(first).customer as { id: string; email: string; status: string };
    expect(customer.email).toBe('ann@example.test');
    expect(customer.status).toBe('invited');

    const again = await admin(w, 'POST', '/v1/admin/customers', { email: 'ann@example.test' });
    expect((bodyOf(again).customer as { id: string }).id).toBe(customer.id);
    expect((await admin(w, 'POST', '/v1/admin/customers', { email: 'not an email' })).status).toBe(400);

    expect((await admin(w, 'DELETE', `/v1/admin/customers/${customer.id}`)).status).toBe(200);
    const fresh = await admin(w, 'POST', '/v1/admin/customers', { email: 'ann@example.test' });
    expect((bodyOf(fresh).customer as { id: string }).id).not.toBe(customer.id);
  });

  it('lists all customers, or one studio’s', async () => {
    const w = await world();
    const s1 = await studio(w, 'One');
    const s2 = await studio(w, 'Two');
    const p1 = await project(w, s1);
    const p2 = await project(w, s2);
    const c1 = await invited(w, 'one@example.test');
    const c2 = await invited(w, 'two@example.test');
    await admin(w, 'PUT', `/v1/admin/projects/${p1}/members/${c1}`);
    await admin(w, 'PUT', `/v1/admin/projects/${p2}/members/${c2}`);

    const all = await admin(w, 'GET', '/v1/admin/customers');
    expect((bodyOf(all).customers as Array<{ email: string }>).map((c) => c.email)).toEqual(['one@example.test', 'two@example.test']);
    const one = await admin(w, 'GET', `/v1/admin/customers?studio=${s1}`);
    expect((bodyOf(one).customers as Array<{ email: string; projectIds: string[] }>)).toEqual([expect.objectContaining({ email: 'one@example.test', projectIds: [p1] })]);
  });
});

describe('members and access', () => {
  it('adds and removes a member, and a removed customer is out at once', async () => {
    const w = await world();
    const sid = await studio(w);
    const pid = await project(w, sid);
    const cid = await invited(w);
    expect((await admin(w, 'PUT', `/v1/admin/projects/${pid}/members/${cid}`)).status).toBe(200);
    expect((await admin(w, 'PUT', `/v1/admin/projects/${pid}/members/${cid}`)).status).toBe(200);
    expect(await w.hub.canAccess(cid, pid)).toBe(true);

    const { session } = await manualLogin(w, cid);
    expect((await authCustomer(session, w.deps)).ok).toBe(true);
    expect((await handleStudioRequest(request('GET', `/v1/app/projects/${pid}/plans`), w.deps, appAuth(cid, pid))).status).toBe(200);

    const removed = await admin(w, 'DELETE', `/v1/admin/customers/${cid}`);
    expect(bodyOf(removed).studioIds).toEqual([sid]);
    expect(await w.hub.canAccess(cid, pid)).toBe(false);
    expect((await authCustomer(session, w.deps)).ok).toBe(false);
    expect((await handleHubRequest(request('GET', '/v1/app/projects', { token: session }), w.deps)).status).toBe(401);
    expect((await handleStudioRequest(request('GET', `/v1/app/projects/${pid}/plans`), w.deps, appAuth(cid, pid))).status).toBe(403);

    // Removing from one project leaves the account (and its other projects) alone.
    const w2 = await world();
    const sid2 = await studio(w2);
    const pA = await project(w2, sid2, 'A');
    const pB = await project(w2, sid2, 'B');
    const c = await invited(w2);
    await admin(w2, 'PUT', `/v1/admin/projects/${pA}/members/${c}`);
    await admin(w2, 'PUT', `/v1/admin/projects/${pB}/members/${c}`);
    expect((await admin(w2, 'DELETE', `/v1/admin/projects/${pA}/members/${c}`)).status).toBe(200);
    expect(await w2.hub.canAccess(c, pA)).toBe(false);
    expect(await w2.hub.canAccess(c, pB)).toBe(true);
  });

  it('refuses another project’s views and actions', async () => {
    const w = await world();
    const sid = await studio(w);
    const p1 = await project(w, sid, 'One');
    const p2 = await project(w, sid, 'Two');
    const c1 = await invited(w, 'c1@example.test');
    const c2 = await invited(w, 'c2@example.test');
    await admin(w, 'PUT', `/v1/admin/projects/${p1}/members/${c1}`);
    await admin(w, 'PUT', `/v1/admin/projects/${p2}/members/${c2}`);

    expect((await handleStudioRequest(request('GET', `/v1/app/projects/${p2}/plans`), w.deps, appAuth(c1, p1))).status).toBe(403);
    expect((await handleStudioRequest(request('GET', `/v1/app/projects/${p2}/plans`), w.deps, appAuth(c1, p2))).status).toBe(403);
    const action = { t: 'action', opId: '00000000-0000-4000-8000-000000000001', kind: 'chat.send', planRef: 'plan1', payload: { text: 'hi' } };
    expect((await handleStudioRequest(request('POST', `/v1/app/projects/${p2}/actions`, { body: action }), w.deps, appAuth(c1, p2))).status).toBe(403);
  });
});

describe('project ↔ daemon mapping', () => {
  it('one project, one daemon; a second bind is refused, and a revoked device cannot be bound', async () => {
    const w = await world();
    const sid = await studio(w);
    const p1 = await project(w, sid, 'One');
    const p2 = await project(w, sid, 'Two');
    const d1 = did('a');
    const d2 = did('b');
    const gone = did('c');
    await daemon(w, sid, d1, [{ id: 'dp1', name: 'api' }, { id: 'dp2', name: 'web' }]);
    await daemon(w, sid, d2, [{ id: 'dp1', name: 'api' }]);
    await daemon(w, sid, gone, [{ id: 'dp1', name: 'api' }], true);

    const bound = await admin(w, 'PUT', `/v1/admin/projects/${p1}/daemon`, { daemonId: d1, daemonProjectId: 'dp1' });
    expect(bound.status).toBe(200);
    expect(bodyOf(bound).project).toMatchObject({ daemonId: d1, daemonProjectId: 'dp1' });

    // A bound project must be unbound first, even for the same daemon with another project.
    expect((await admin(w, 'PUT', `/v1/admin/projects/${p1}/daemon`, { daemonId: d1, daemonProjectId: 'dp2' })).status).toBe(409);
    expect((await admin(w, 'PUT', `/v1/admin/projects/${p1}/daemon`, { daemonId: d2, daemonProjectId: 'dp1' })).status).toBe(409);
    expect((await admin(w, 'PUT', `/v1/admin/projects/${p2}/daemon`, { daemonId: d1, daemonProjectId: 'dp1' })).status).toBe(409);
    expect((await admin(w, 'PUT', `/v1/admin/projects/${p2}/daemon`, { daemonId: d1, daemonProjectId: 'dp9' })).status).toBe(404);
    expect((await admin(w, 'PUT', `/v1/admin/projects/${p2}/daemon`, { daemonId: gone, daemonProjectId: 'dp1' })).status).toBe(409);
    expect((await admin(w, 'PUT', `/v1/admin/projects/${p2}/daemon`, { daemonId: 'z'.repeat(32), daemonProjectId: 'dp1' })).status).toBe(404);

    const other = await studio(w, 'Other');
    const foreign = did('d');
    await daemon(w, other, foreign, [{ id: 'dp1', name: 'api' }]);
    expect((await admin(w, 'PUT', `/v1/admin/projects/${p2}/daemon`, { daemonId: foreign, daemonProjectId: 'dp1' })).status).toBe(400);

    // Unbind, then bind the same pair again.
    expect((await admin(w, 'DELETE', `/v1/admin/projects/${p1}/daemon`)).status).toBe(200);
    expect((await admin(w, 'PUT', `/v1/admin/projects/${p1}/daemon`, { daemonId: d1, daemonProjectId: 'dp1' })).status).toBe(200);

    // Revoking the device stops new binds.
    const revoked = await admin(w, 'DELETE', `/v1/admin/daemons/${d1}`);
    expect(bodyOf(revoked).studioId).toBe(sid);
    expect((await w.hub.daemon(d1))?.revokedAt).toBe(w.deps.now);
    expect((await admin(w, 'PUT', `/v1/admin/projects/${p2}/daemon`, { daemonId: d1, daemonProjectId: 'dp2' })).status).toBe(409);
  });
});

describe('login links from the admin page', () => {
  it('returns the link, mails it, and respects the five-an-hour cap', async () => {
    const w = await world();
    const cid = await invited(w);
    const r = await admin(w, 'POST', `/v1/admin/customers/${cid}/login-link`);
    expect(r.status).toBe(200);
    expect(bodyOf(r).link).toContain('#token=');
    expect(w.sent).toHaveLength(1);
    const token = new URL(bodyOf(r).link as string).hash.replace('#token=', '');
    const verified = await handleHubRequest(request('POST', '/v1/login/verify', { body: { token } }), w.deps);
    expect(verified.status).toBe(200);

    for (let i = 0; i < 4; i++) expect((await admin(w, 'POST', `/v1/admin/customers/${cid}/login-link`)).status).toBe(200);
    expect((await admin(w, 'POST', `/v1/admin/customers/${cid}/login-link`)).status).toBe(429);

    expect((await admin(w, 'POST', '/v1/admin/customers/nope/login-link')).status).toBe(404);
    await admin(w, 'DELETE', `/v1/admin/customers/${cid}`);
    expect((await admin(w, 'POST', `/v1/admin/customers/${cid}/login-link`)).status).toBe(409);
  });
});

describe('the studio detail', () => {
  it('gathers daemons, reported projects, mapped projects, members and outbox', async () => {
    const w = await world();
    const sid = await studio(w, 'Acme');
    const pid = await project(w, sid, '客户 App');
    const cid = await invited(w, 'ann@example.test');
    const d1 = did('a');
    await daemon(w, sid, d1, [{ id: 'dp1', name: 'api' }]);
    await admin(w, 'PUT', `/v1/admin/projects/${pid}/daemon`, { daemonId: d1, daemonProjectId: 'dp1' });
    await admin(w, 'PUT', `/v1/admin/projects/${pid}/members/${cid}`);

    const r = await admin(w, 'GET', `/v1/admin/studios/${sid}`);
    expect(r.status).toBe(200);
    const detail = bodyOf(r);
    expect(detail.studio).toMatchObject({ id: sid, name: 'Acme' });
    expect(detail.daemons).toHaveLength(1);
    expect(detail.daemonProjects).toEqual([expect.objectContaining({ daemonId: d1, projectId: 'dp1', name: 'api' })]);
    expect(detail.projects).toEqual([expect.objectContaining({ id: pid, daemonId: d1, daemonProjectId: 'dp1', memberIds: [cid] })]);
    expect(detail.customers).toEqual([expect.objectContaining({ id: cid, email: 'ann@example.test', projectIds: [pid] })]);
    expect(detail.outbox).toEqual([]);

    expect((await admin(w, 'GET', '/v1/admin/studios/nope')).status).toBe(404);
  });
});
