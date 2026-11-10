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
import { DAY_MS, LOGIN_TOKEN_TTL_MS, SESSION_TTL_MS, memoryHub, memoryStudio, sha256Hex, type HubStore, type StudioStore } from '../../src/net/studio/store.js';
import { ingestPatch, ingestPlan, previewLink, readView, turnsBefore } from '../../src/net/studio/views.js';

/** BLG-59: magic-link logins, project-scoped reads, and a strict, replayable view cache. */

const START = 1_768_000_000_000;
const view = {
  planRef: 'plan1',
  draftRev: 3,
  title: '客户 App',
  goal: '做一个客户能用的 App',
  stage: 'running',
  waitingOn: 'customer',
  headline: '在做：登录',
  progress: { done: 0, total: 2 },
  milestones: [{ ref: 'm0', title: '登录', criteria: ['可以登录'], status: 'review', tasks: [] }],
  decisions: [],
  turns: [],
  typing: false,
  moreTurns: false,
  activity: [],
};
const turn = (id: string, at: number, text = '好'): Record<string, unknown> => ({ id, who: 'ai', text, at });
const withView = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({ ...view, ...overrides });

interface World {
  readonly deps: StudioDeps;
  readonly hub: HubStore;
  readonly studio: StudioStore;
  readonly studioId: string;
  readonly sent: Array<{ email: string; link: string }>;
  advance(ms: number): void;
}

async function world(): Promise<World> {
  const hub = memoryHub();
  const studio = memoryStudio();
  const clock = { now: START };
  const sent: Array<{ email: string; link: string }> = [];
  const st = await hub.createStudio({ name: 'Acme', now: clock.now });
  await hub.createCustomer({ id: 'c1', email: 'c1@example.test', name: '客户一', now: clock.now });
  await hub.createCustomer({ id: 'c2', email: 'c2@example.test', name: '客户二', now: clock.now });
  await hub.createProject({ id: 'p1', studioId: st.id, name: '客户 App', now: clock.now });
  await hub.createProject({ id: 'p2', studioId: st.id, name: '另一个', now: clock.now });
  await hub.addMember('p1', 'c1', clock.now);
  await hub.addMember('p2', 'c2', clock.now);
  await hub.createDaemon({ id: 'd1', studioId: st.id, publicKey: 'views-test-key', name: 'Mac', now: clock.now });
  await hub.replaceDaemonProjects('d1', [{ id: 'dp1', name: 'api' }], clock.now);
  await hub.bindProject({ projectId: 'p1', daemonId: 'd1', daemonProjectId: 'dp1', now: clock.now });
  await studio.putConn({ daemonId: 'd1', lastAt: clock.now - 1, connectedAt: clock.now, lastSeenAt: clock.now, hello: true, synced: true });
  const deps: StudioDeps = {
    hub,
    studio,
    studioId: st.id,
    get now() {
      return clock.now;
    },
    random: (n) => crypto.getRandomValues(new Uint8Array(n)),
    mailer: { send: async (email, link) => void sent.push({ email, link }) },
    ent: alwaysAllow,
    operatorTokenHash: await sha256Hex('operator'),
    origin: 'https://hub.test',
  };
  return { deps, hub, studio, studioId: st.id, sent, advance: (ms) => void (clock.now += ms) };
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

const bodyOf = (r: HubReply): Record<string, unknown> => r.body as Record<string, unknown>;

async function sessionFor(w: World, email = 'c1@example.test'): Promise<string> {
  const login = await handleHubRequest(request('POST', '/v1/login', { body: { email } }), w.deps);
  expect(login.status).toBe(202);
  const link = w.sent.at(-1)?.link;
  expect(link).toBeDefined();
  const token = new URL(link!).hash.replace('#token=', '');
  const verified = await handleHubRequest(request('POST', '/v1/login/verify', { body: { token } }), w.deps);
  expect(verified.status).toBe(200);
  return (bodyOf(verified).session as string);
}

const appAuth = (customerId = 'c1', projectId = 'p1'): InternalAuth => ({ role: 'app', customerId, projectId });
const get = (path: string, auth: InternalAuth, w: World): Promise<HubReply> => handleStudioRequest(request('GET', path), w.deps, auth);

describe('a customer logs in with a magic link', () => {
  it('always answers 202, and only mails an invited, not removed email', async () => {
    const w = await world();
    for (const email of ['nobody@example.test', 'not-an-email', undefined]) {
      expect((await handleHubRequest(request('POST', '/v1/login', { body: { email } }), w.deps)).status).toBe(202);
    }
    expect(w.sent).toHaveLength(0);

    await handleHubRequest(request('POST', '/v1/login', { body: { email: ' C1@Example.Test ' } }), w.deps);
    expect(w.sent).toHaveLength(1);
    expect(w.sent[0]!.email).toBe('c1@example.test');
    expect(w.sent[0]!.link).toContain('https://hub.test/login#token=');
    expect(w.sent[0]!.link).not.toContain('?token=');

    await w.hub.removeCustomer('c1', w.deps.now);
    await handleHubRequest(request('POST', '/v1/login', { body: { email: 'c1@example.test' } }), w.deps);
    expect(w.sent).toHaveLength(1);
  });

  it('refuses to build a link without a configured origin', async () => {
    const w = await world();
    const noOrigin = { ...w.deps, origin: '' };
    const login = await handleHubRequest(request('POST', '/v1/login', { body: { email: 'c1@example.test' } }), noOrigin);
    expect(login.status).toBe(202);
    expect(w.sent).toHaveLength(0);
    const link = await handleHubRequest(request('POST', '/v1/admin/customers/c1/login-link', { token: 'operator' }), noOrigin);
    expect(link.status).toBe(503);
    expect((bodyOf(link) as { error: string }).error).toBe('hub-origin-missing');
  });

  it('caps the mail per email at five an hour', async () => {
    const w = await world();
    for (let i = 0; i < 5; i++) await handleHubRequest(request('POST', '/v1/login', { body: { email: 'c1@example.test' } }), w.deps);
    expect(w.sent).toHaveLength(5);
    await handleHubRequest(request('POST', '/v1/login', { body: { email: 'c1@example.test' } }), w.deps);
    expect(w.sent).toHaveLength(5);
  });

  it('spends a link once, within 15 minutes, and starts a 30-day session', async () => {
    const w = await world();
    const session = await sessionFor(w);
    const hash = await sha256Hex(session);
    expect((await w.hub.session(hash))?.expiresAt).toBe(w.deps.now + SESSION_TTL_MS);
    expect((await w.hub.customer('c1'))?.status).toBe('active');

    // The same link again is bad.
    const token = w.sent[0]!.link.split('#token=')[1]!;
    expect((await handleHubRequest(request('POST', '/v1/login/verify', { body: { token } }), w.deps)).status).toBe(403);

    // An unspent link expires.
    await handleHubRequest(request('POST', '/v1/login', { body: { email: 'c1@example.test' } }), w.deps);
    const later = w.sent.at(-1)!.link.split('#token=')[1]!;
    w.advance(LOGIN_TOKEN_TTL_MS + 1);
    expect((await handleHubRequest(request('POST', '/v1/login/verify', { body: { token: later } }), w.deps)).status).toBe(403);
  });

  it('sees itself signed in, slides the session, and stops when revoked or expired', async () => {
    const w = await world();
    const session = await sessionFor(w);
    expect((await authCustomer(session, w.deps)).ok).toBe(true);
    expect((await authCustomer(undefined, w.deps)).ok).toBe(false);
    expect((await authCustomer('not-a-session', w.deps)).ok).toBe(false);

    const hash = await sha256Hex(session);
    const before = (await w.hub.session(hash))!.expiresAt;
    w.advance(2 * DAY_MS);
    expect((await authCustomer(session, w.deps)).ok).toBe(true);
    expect((await w.hub.session(hash))!.expiresAt).toBe(before + 2 * DAY_MS);

    expect((await handleHubRequest(request('GET', '/v1/app/projects'), w.deps)).status).toBe(401);
    const projects = await handleHubRequest(request('GET', '/v1/app/projects', { token: session }), w.deps);
    expect(projects.status).toBe(200);
    expect(bodyOf(projects).projects).toEqual([{ id: 'p1', studioId: w.studioId, studioName: 'Acme', name: '客户 App' }]);

    expect((await handleHubRequest(request('POST', '/v1/logout', { token: session }), w.deps)).status).toBe(204);
    expect((await authCustomer(session, w.deps)).ok).toBe(false);

    const w2 = await world();
    const s2 = await sessionFor(w2);
    w2.advance(SESSION_TTL_MS + 1);
    expect((await authCustomer(s2, w2.deps)).ok).toBe(false);
  });
});

describe('a view is read by its own project only', () => {
  it('refuses no identity, another project, and a customer who is not a member', async () => {
    const w = await world();
    expect((await ingestPlan('d1', { project: 'dp1', frame: { t: 'plan', rev: 1, view } }, w.deps)).ok).toBe(true);

    expect((await get('/v1/app/projects/p1/plans', appAuth(), w)).status).toBe(200);
    expect((await get('/v1/app/projects/p1/plans', { role: 'operator' }, w)).status).toBe(403);
    expect((await get('/v1/app/projects/p2/plans', appAuth('c1', 'p1'), w)).status).toBe(403);
    expect((await get('/v1/app/projects/p1/plans', appAuth('c2', 'p1'), w)).status).toBe(403);
  });

  it('serves the last snapshot when the daemon is offline', async () => {
    const w = await world();
    await ingestPlan('d1', { project: 'dp1', frame: { t: 'plan', rev: 1, view } }, w.deps);
    await w.studio.putConn({ daemonId: 'd1', lastAt: w.deps.now, lastSeenAt: w.deps.now, hello: true, synced: false });
    const got = await get('/v1/app/projects/p1/plans/plan1', appAuth(), w);
    expect(got.status).toBe(200);
    expect((bodyOf(got).view as { title: string }).title).toBe('客户 App');
  });
});

describe('the cache trusts only the strict view', () => {
  it('refuses extra fields whole, alerts, and keeps the good cache', async () => {
    const w = await world();
    expect((await ingestPlan('d1', { project: 'dp1', frame: { t: 'plan', rev: 1, view: withView({ title: 'v1' }) } }, w.deps)).ok).toBe(true);

    const bad = await ingestPlan('d1', { project: 'dp1', frame: { t: 'plan', rev: 2, view: withView({ title: 'bad', extra: 'x' }) } }, w.deps);
    expect(bad).toMatchObject({ ok: false, alert: 'bad-view' });
    expect((await w.studio.alerts(5)).some((a) => a.what === 'bad-view')).toBe(true);
    expect((await readView('p1', 'plan1', w.deps))?.view.title).toBe('v1');

    // Not this daemon's project: refused too.
    expect(await ingestPlan('d1', { project: 'dp9', frame: { t: 'plan', rev: 3, view } }, w.deps)).toMatchObject({ ok: false, alert: 'unmapped-project' });
  });

  it('replaces a full snapshot, merges turns by id, and keeps them ordered', async () => {
    const w = await world();
    await ingestPlan('d1', { project: 'dp1', frame: { t: 'plan', rev: 1, view: withView({ title: 'v1', turns: [turn('t2', 2, '第二'), turn('t1', 1, '第一')] }) } }, w.deps);
    expect((await readView('p1', 'plan1', w.deps))?.view.turns.map((t) => [t.id, t.text])).toEqual([['t1', '第一'], ['t2', '第二']]);

    // A full snapshot may lower rev (the daemon restarted) and still replaces everything.
    await ingestPlan('d1', { project: 'dp1', frame: { t: 'plan', rev: 0, view: withView({ title: 'v2', turns: [turn('t1', 1, '第一改'), turn('t3', 3, '第三')] }) } }, w.deps);
    const shown = await readView('p1', 'plan1', w.deps);
    expect(shown?.view.title).toBe('v2');
    expect(shown?.view.turns.map((t) => [t.id, t.text])).toEqual([['t1', '第一改'], ['t2', '第二'], ['t3', '第三']]);

    const page = await turnsBefore('p1', 'plan1', undefined, 2, w.deps);
    expect(page.turns.map((t) => t.id)).toEqual(['t2', 't3']);
    expect(page.more).toBe(true);
    const older = await turnsBefore('p1', 'plan1', page.turns[0]!.id, 2, w.deps);
    expect(older.turns.map((t) => t.id)).toEqual(['t1']);
    expect(older.more).toBe(false);
  });

  it('keeps at most 500 turns per plan', async () => {
    const w = await world();
    const many = Array.from({ length: 505 }, (_, i) => ({ id: `t${i}`, at: i, who: 'ai' as const, text: 'x' }));
    await w.studio.putTurns('p1', 'plan500', many, 500);
    expect(await w.studio.turnCount('p1', 'plan500')).toBe(500);
  });

  it('applies a patch only at the next rev, and asks for a snapshot otherwise', async () => {
    const w = await world();
    await ingestPlan('d1', { project: 'dp1', frame: { t: 'plan', rev: 1, view: withView({ title: 'v1' }) } }, w.deps);

    const gap = await ingestPatch('d1', { project: 'dp1', planRef: 'plan1', rev: 3, set: { title: 'skipped' } }, w.deps);
    expect(gap).toMatchObject({ ok: false, alert: 'rev-gap' });
    expect(gap.effects[0]).toMatchObject({ to: 'daemon', msg: { t: 'resync', planRef: 'plan1' } });
    expect((await readView('p1', 'plan1', w.deps))?.view.title).toBe('v1');

    expect((await ingestPatch('d1', { project: 'dp1', planRef: 'plan1', rev: 2, set: { title: 'v2' } }, w.deps)).ok).toBe(true);
    expect((await readView('p1', 'plan1', w.deps))?.view.title).toBe('v2');

    const bad = await ingestPatch('d1', { project: 'dp1', planRef: 'plan1', rev: 3, set: { extra: 1 } }, w.deps);
    expect(bad).toMatchObject({ ok: false, alert: 'bad-view' });
    expect((await readView('p1', 'plan1', w.deps))?.view.title).toBe('v2');

    // A patch can't move the plan to another ref.
    const moved = await ingestPatch('d1', { project: 'dp1', planRef: 'plan1', rev: 3, set: { planRef: 'plan2' } }, w.deps);
    expect(moved).toMatchObject({ ok: false, alert: 'bad-view' });
    expect((await readView('p1', 'plan1', w.deps))?.view.title).toBe('v2');
  });
});

describe('preview links', () => {
  const gate = (kind: string, state: string): unknown => ({ kind, state, draftRev: 0 });

  it('are refused without a deliver gate that is approved', async () => {
    for (const g of [undefined, gate('start', 'approved'), gate('changes', 'approved'), gate('deliver', 'pending'), gate('deliver', 'declined')]) {
      expect(await previewLink(g as never, { objectKey: 'm0', origin: 'https://hub.test' }, 'secret', START)).toEqual({ ok: false, code: 'not-delivered' });
    }
    expect(await previewLink(gate('deliver', 'approved') as never, { objectKey: 'm0', origin: 'https://hub.test' }, '', START)).toEqual({ ok: false, code: 'not-delivered' });
    expect(await previewLink(gate('deliver', 'approved') as never, { objectKey: '../x', origin: 'https://hub.test' }, 'secret', START)).toEqual({ ok: false, code: 'not-delivered' });
  });

  it('are signed for 15 minutes only after the deliver gate says approved', async () => {
    const signed = await previewLink(gate('deliver', 'approved') as never, { objectKey: 'm0', origin: 'https://hub.test' }, 'secret', START);
    expect(signed.ok).toBe(true);
    if (!signed.ok) return;
    expect(signed.exp).toBe(START + 15 * 60_000);
    const url = new URL(signed.url);
    expect(url.origin).toBe('https://hub.test');
    expect(url.pathname).toBe('/p/m0');
    expect(url.searchParams.get('exp')).toBe(String(signed.exp));
    expect(url.searchParams.get('sig')).toMatch(/^[A-Za-z0-9_-]{40,50}$/);
  });

  it('have no open route in P1', async () => {
    const w = await world();
    await ingestPlan('d1', { project: 'dp1', frame: { t: 'plan', rev: 1, view } }, w.deps);
    const r = await get('/v1/app/projects/p1/previews/m0', appAuth(), w);
    expect(r.status).toBe(403);
    expect(bodyOf(r).error).toBe('not-delivered');
  });
});
