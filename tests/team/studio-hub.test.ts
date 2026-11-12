import { describe, expect, it } from 'vitest';
import { type Identity, generateIdentity, peerIdFor } from '../../src/net/crypto.js';
import { signText } from '../../src/net/mesh/keys.js';
import {
  CLOCK_SKEW_MS,
  DaemonUp,
  HubDown,
  LINK_CODE_TTL_MS,
  STUDIO_LABEL,
  alwaysAllow,
  daemonIdOf,
  handleHubRequest,
  handleStudioRequest,
  internalAuthOf,
  newLinkCode,
  normalizeLinkCode,
  onDaemonMessage,
  routeOf,
  type ConnectCheck,
  type Deps,
  type HubReply,
  verifyDaemonConnect,
} from '../../src/net/studio/handler.js';
import { memoryHub, memoryStudio, sha256Hex, type HubStore, type StudioStore } from '../../src/net/studio/store.js';
import { readView } from '../../src/net/studio/views.js';
import type { StudioPlanView } from '../../src/studio/protocol.js';

/** BLG-57: one binding code registers a daemon key; after that, every connection is signed. */

const OPERATOR = 'test-operator-token';

interface World {
  readonly deps: Deps;
  readonly hub: HubStore;
  readonly studio: StudioStore;
  advance(ms: number): void;
}

async function world(start = 1_768_000_000_000, studio: StudioStore = memoryStudio()): Promise<World> {
  const hub = memoryHub();
  const clock = { now: start };
  const deps: Deps = {
    hub,
    studio,
    get now() {
      return clock.now;
    },
    random: (n) => crypto.getRandomValues(new Uint8Array(n)),
    mailer: { send: async () => {} },
    ent: alwaysAllow,
    operatorTokenHash: await sha256Hex(OPERATOR),
    origin: 'https://hub.test',
  };
  return { deps, hub, studio, advance: (ms) => void (clock.now += ms) };
}

function request(method: string, path: string, opts: { token?: string; body?: unknown; headers?: Record<string, string> } = {}): Request {
  const headers = new Headers(opts.headers);
  if (opts.token !== undefined) headers.set('authorization', `Bearer ${opts.token}`);
  const init: RequestInit = { method, headers };
  if (opts.body !== undefined) {
    headers.set('content-type', 'application/json');
    init.body = JSON.stringify(opts.body);
  }
  return new Request(`https://hub.test${path}`, init);
}

const bodyOf = (r: HubReply): Record<string, unknown> => r.body as Record<string, unknown>;

async function studioOf(deps: Deps): Promise<{ studioId: string; code: string; expiresAt: number }> {
  const r = await handleHubRequest(request('POST', '/v1/admin/studios', { token: OPERATOR, body: { name: 'Acme Studio' } }), deps);
  const body = bodyOf(r) as { studio: { id: string }; linkCode: { code: string; expiresAt: number } };
  return { studioId: body.studio.id, code: body.linkCode.code, expiresAt: body.linkCode.expiresAt };
}

function link(deps: Deps, code: string, identity: Identity, at = deps.now, extra: Record<string, unknown> = {}): Promise<HubReply> {
  return handleHubRequest(
    request('POST', '/v1/link', {
      body: { code, key: identity.publicKey, name: 'Studio Mac', at, sig: signText(identity, STUDIO_LABEL, `link:${code}:${at}`), ...extra },
    }),
    deps,
  );
}

async function registered(w: World): Promise<{ studioId: string; daemonId: string; identity: Identity }> {
  const { studioId, code } = await studioOf(w.deps);
  const identity = generateIdentity();
  const r = await link(w.deps, code, identity);
  const body = bodyOf(r) as { studioId: string; daemonId: string };
  return { studioId, daemonId: body.daemonId, identity };
}

function connect(deps: Deps, daemonId: string, identity: Identity, at = deps.now, sig?: string): Promise<ConnectCheck> {
  return verifyDaemonConnect({ daemonId, at, sig: sig ?? signText(identity, STUDIO_LABEL, `connect:${daemonId}:${at}`) }, deps);
}

describe('the operator', () => {
  it('is the only one who can list or create studios', async () => {
    const w = await world();
    expect((await handleHubRequest(request('GET', '/v1/admin/studios'), w.deps)).status).toBe(401);
    expect((await handleHubRequest(request('GET', '/v1/admin/studios', { token: 'wrong' }), w.deps)).status).toBe(401);
    const empty = await handleHubRequest(request('GET', '/v1/admin/studios', { token: OPERATOR }), w.deps);
    expect(empty.status).toBe(200);
    expect(bodyOf(empty).studios).toEqual([]);

    const created = await handleHubRequest(request('POST', '/v1/admin/studios', { token: OPERATOR, body: { name: 'Acme' } }), w.deps);
    expect(created.status).toBe(200);
    expect((bodyOf(created).studio as { name: string }).name).toBe('Acme');
    expect(normalizeLinkCode((bodyOf(created).linkCode as { code: string }).code)).toBe((bodyOf(created).linkCode as { code: string }).code);
  });

  it('keeps one usable code per studio: issuing a new one kills the old', async () => {
    const w = await world();
    const { studioId, code: old } = await studioOf(w.deps);
    const fresh = await handleHubRequest(request('POST', `/v1/admin/studios/${studioId}/link-codes`, { token: OPERATOR }), w.deps);
    expect(fresh.status).toBe(200);
    const code = (bodyOf(fresh) as { code: string }).code;

    expect((await link(w.deps, old, generateIdentity())).status).toBe(403);
    expect((await link(w.deps, code, generateIdentity())).status).toBe(200);
  });
});

describe('binding codes', () => {
  it('are 40 random bits in Crockford base32', () => {
    expect(newLinkCode(() => new Uint8Array([0, 0, 0, 0, 0]))).toBe('0000-0000');
    expect(newLinkCode(() => new Uint8Array([255, 255, 255, 255, 255]))).toBe('ZZZZ-ZZZZ');
    expect(normalizeLinkCode(' ab12-cd34 ')).toBe('AB12-CD34');
    expect(normalizeLinkCode('AB1O-CD34')).toBe('AB10-CD34');
    expect(normalizeLinkCode('ABII-CD34')).toBe('AB11-CD34');
    expect(normalizeLinkCode('AB1U-CD34')).toBeUndefined();
  });

  it('register a daemon once, within 15 minutes', async () => {
    const w = await world();
    const { studioId, code, expiresAt } = await studioOf(w.deps);
    expect(expiresAt).toBe(w.deps.now + LINK_CODE_TTL_MS);

    const identity = generateIdentity();
    const first = await link(w.deps, code, identity);
    expect(first.status).toBe(200);
    const registered = bodyOf(first) as { studioId: string; daemonId: string };
    expect(registered.studioId).toBe(studioId);
    expect(registered.daemonId).toBe(peerIdFor(identity.publicKey));
    expect(registered.daemonId).toBe(await daemonIdOf(identity.publicKey));
    expect(await w.hub.daemon(registered.daemonId)).toMatchObject({ studioId, publicKey: identity.publicKey });

    // The same code again, even with a fresh signature, is spent.
    w.advance(1);
    expect((await link(w.deps, code, identity)).status).toBe(403);
    // And an expired code is not a code.
    const later = await studioOf(w.deps);
    w.advance(LINK_CODE_TTL_MS);
    expect((await link(w.deps, later.code, generateIdentity())).status).toBe(403);
  });

  it('are idempotent for the same key in the same studio', async () => {
    const w = await world();
    const { studioId, code } = await studioOf(w.deps);
    const identity = generateIdentity();
    const first = bodyOf(await link(w.deps, code, identity)) as { daemonId: string };

    // A second code for the same studio, used by the same key: the device is already known.
    const second = bodyOf(await handleHubRequest(request('POST', `/v1/admin/studios/${studioId}/link-codes`, { token: OPERATOR }), w.deps)) as { code: string };
    const again = await link(w.deps, second.code, identity);
    expect(again.status).toBe(200);
    expect((bodyOf(again) as { daemonId: string }).daemonId).toBe(first.daemonId);
    // …and it spends that code too.
    expect((await link(w.deps, second.code, generateIdentity())).status).toBe(403);
  });

  it('refuse a wrong signature, a stale timestamp, and another studio', async () => {
    const w = await world();
    const { studioId, code } = await studioOf(w.deps);
    const identity = generateIdentity();
    const other = generateIdentity();

    // Someone else's signature over this key's registration.
    const forged = await handleHubRequest(
      request('POST', '/v1/link', { body: { code, key: identity.publicKey, name: 'x', at: w.deps.now, sig: signText(other, STUDIO_LABEL, `link:${code}:${w.deps.now}`) } }),
      w.deps,
    );
    expect(forged.status).toBe(403);

    // The right signature at the wrong time.
    expect((await link(w.deps, code, identity, w.deps.now - CLOCK_SKEW_MS - 1)).status).toBe(401);
    // Extra fields are not part of the body.
    expect((await link(w.deps, code, identity, w.deps.now, { name: 'x', extra: true })).status).toBe(400);

    // Register the key here; a code from another studio must not move it.
    expect((await link(w.deps, code, identity)).status).toBe(200);
    const elsewhere = await studioOf(w.deps);
    const moved = await link(w.deps, elsewhere.code, identity);
    expect(moved.status).toBe(409);
    expect((bodyOf(moved) as { error: string }).error).toBe('key-taken');
    // The refused registration did not spend the other studio's code.
    expect((await link(w.deps, elsewhere.code, generateIdentity())).status).toBe(200);
  });
});

describe('a daemon connection is signed', () => {
  it('accepts only its own key, within five minutes, with a strictly newer timestamp', async () => {
    const w = await world();
    const { daemonId, identity } = await registered(w);
    const other = generateIdentity();

    expect((await connect(w.deps, daemonId, identity)).ok).toBe(true);
    expect(await connect(w.deps, daemonId, other)).toMatchObject({ ok: false, status: 401, error: 'bad-signature' });
    expect(await connect(w.deps, daemonId, identity, w.deps.now - CLOCK_SKEW_MS - 1)).toMatchObject({ ok: false, status: 401, error: 'clock-skew' });
    expect(await connect(w.deps, 'A'.repeat(32), identity)).toMatchObject({ ok: false, status: 401, error: 'unknown-daemon' });

    // A replay of the same accepted timestamp is refused; one millisecond later is fine.
    const at = w.deps.now;
    await w.studio.putConn({ daemonId, lastAt: at, connectedAt: at, lastSeenAt: at, hello: true, synced: false });
    expect(await connect(w.deps, daemonId, identity, at)).toMatchObject({ ok: false, status: 409, error: 'replayed' });
    expect((await connect(w.deps, daemonId, identity, at + 1)).ok).toBe(true);

    // Revoking the device stops every connection.
    await w.hub.revokeDaemon(daemonId, w.deps.now);
    expect(await connect(w.deps, daemonId, identity, at + 2)).toMatchObject({ ok: false, status: 403, error: 'revoked' });
  });

  it('checks the same rules on the DO route', async () => {
    const w = await world();
    const { daemonId, identity } = await registered(w);
    const at = w.deps.now;
    const headers = { 'x-studio-daemon': daemonId, 'x-studio-at': String(at), 'x-studio-sig': signText(identity, STUDIO_LABEL, `connect:${daemonId}:${at}`) };
    const upgrade = request('GET', '/v1/daemon/ws', { headers });

    const ok = await handleStudioRequest(upgrade, { ...w.deps, studio: w.studio, studioId: 'st_test' }, { role: 'daemon', daemonId });
    expect(ok.status).toBe(200);
    const wrong = await handleStudioRequest(upgrade, { ...w.deps, studio: w.studio, studioId: 'st_test' }, { role: 'daemon', daemonId: 'B'.repeat(32) });
    expect(wrong.status).toBe(403);
    const notDaemon = await handleStudioRequest(upgrade, { ...w.deps, studio: w.studio, studioId: 'st_test' }, { role: 'operator' });
    expect(notDaemon.status).toBe(403);
  });

  it('enforces hello, then the full snapshots, then synced before any delivery', async () => {
    const w = await world();
    const daemonId = 'D'.repeat(32);
    const at = w.deps.now;
    await w.studio.putConn({ daemonId, lastAt: at, connectedAt: at, lastSeenAt: at, hello: false, synced: false });
    const deps = { ...w.deps, studio: w.studio, studioId: 'st_test' };

    const stale = await onDaemonMessage(daemonId, JSON.stringify({ t: 'synced' }), deps, at - 1);
    expect(stale).toEqual([expect.objectContaining({ to: 'close', tag: `daemon:${daemonId}`, code: 4002 })]);

    const early = await onDaemonMessage(daemonId, JSON.stringify({ t: 'synced' }), deps);
    expect(early).toEqual([expect.objectContaining({ to: 'close', tag: `daemon:${daemonId}`, code: 4003 })]);
    expect((await w.studio.conn(daemonId))?.synced).toBe(false);

    const hello = await onDaemonMessage(daemonId, JSON.stringify({ t: 'hello', proto: { major: 1, minor: 0 }, daemon: daemonId, projects: [] }), deps);
    expect(hello).toEqual([expect.objectContaining({ to: 'daemon', msg: expect.objectContaining({ t: 'welcome', studio: 'st_test' }) })]);
    expect((await w.studio.conn(daemonId))?.hello).toBe(true);

    const synced = await onDaemonMessage(daemonId, JSON.stringify({ t: 'synced' }), deps);
    expect(synced).toEqual([]);
    expect((await w.studio.conn(daemonId))?.synced).toBe(true);
  });
});

describe('incremental frames (BLG-68)', () => {
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

  /** A daemon with one mapped project, connected and out of hello. */
  async function ready(w: World): Promise<{ daemonId: string; deps: Deps & { studio: StudioStore; studioId: string } }> {
    const daemonId = 'D'.repeat(32);
    const at = w.deps.now;
    await w.studio.putConn({ daemonId, lastAt: at, connectedAt: at, lastSeenAt: at, hello: false, synced: false });
    await w.hub.createProject({ id: 'sp1', studioId: 'st_test', name: 'App', now: at });
    await w.hub.replaceDaemonProjects(daemonId, [{ id: 'dpp1', name: 'App' }], at);
    await w.hub.bindProject({ projectId: 'sp1', daemonId, daemonProjectId: 'dpp1', now: at });
    const deps = { ...w.deps, studio: w.studio, studioId: 'st_test' };
    await onDaemonMessage(daemonId, JSON.stringify({ t: 'hello', proto: { major: 1, minor: 1 }, daemon: daemonId, projects: [{ id: 'dpp1', name: 'App' }] }), deps);
    return { daemonId, deps };
  }

  it('applies a patch whose rev follows the cached one', async () => {
    const w = await world();
    const { daemonId, deps } = await ready(w);
    const full = await onDaemonMessage(daemonId, JSON.stringify({ t: 'for', project: 'dpp1', frame: { t: 'plan', rev: 1, view: viewOf('Before') } }), deps);
    expect(full).toEqual([expect.objectContaining({ to: 'app', projectId: 'sp1' })]);

    const patch = await onDaemonMessage(daemonId, JSON.stringify({ t: 'patch', project: 'dpp1', planRef: 'p1', rev: 2, set: { title: 'After' } }), deps);
    expect(patch).toEqual([expect.objectContaining({ to: 'app', projectId: 'sp1', frame: expect.objectContaining({ t: 'plan', rev: 2 }) })]);
    expect((await readView('sp1', 'p1', deps))?.view.title).toBe('After');
    // The daemon's patch is not trusted either: an unknown field makes the whole merged view bad.
    const bad = await onDaemonMessage(daemonId, JSON.stringify({ t: 'patch', project: 'dpp1', planRef: 'p1', rev: 3, set: { secret: 'x' } }), deps);
    expect(bad).toEqual([expect.objectContaining({ to: 'daemon', msg: { t: 'resync', project: 'dpp1', planRef: 'p1' } })]);
    expect((await readView('sp1', 'p1', deps))?.view.title).toBe('After');
  });

  it('asks for a full snapshot on a rev gap, and keeps the last good view', async () => {
    const w = await world();
    const { daemonId, deps } = await ready(w);
    await onDaemonMessage(daemonId, JSON.stringify({ t: 'for', project: 'dpp1', frame: { t: 'plan', rev: 4, view: viewOf('Cached') } }), deps);
    const gap = await onDaemonMessage(daemonId, JSON.stringify({ t: 'patch', project: 'dpp1', planRef: 'p1', rev: 9, set: { title: 'Skipped' } }), deps);
    expect(gap).toEqual([expect.objectContaining({ to: 'daemon', msg: { t: 'resync', project: 'dpp1', planRef: 'p1' } })]);
    expect((await readView('sp1', 'p1', deps))?.view.title).toBe('Cached');
  });

  it('a mapping tells the daemon to push that project', async () => {
    const w = await world();
    const { daemonId } = await ready(w);
    expect(routeOf('POST', '/v1/internal/resync')).toMatchObject({ name: 'internal-resync', area: 'studio' });

    const deps = { ...w.deps, studio: w.studio, studioId: 'st_test' };
    const reply = await handleStudioRequest(request('POST', '/v1/internal/resync', { body: { daemonId, project: 'dpp1' } }), deps, { role: 'operator' });
    expect(reply.status).toBe(200);
    expect(reply.effects).toEqual([{ to: 'daemon', daemonId, msg: { t: 'resync', project: 'dpp1' } }]);

    const refused = await handleStudioRequest(request('POST', '/v1/internal/resync', { body: { daemonId, project: 'dpp1' } }), deps, { role: 'daemon', daemonId });
    expect(refused.status).toBe(403);
  });

  it('accepts a patch frame strictly, but only the named fields', () => {
    const patch = { t: 'patch', project: 'dpp1', planRef: 'p1', rev: 2, set: { title: 'x' } };
    expect(DaemonUp.safeParse(patch).success).toBe(true);
    expect(DaemonUp.safeParse({ ...patch, extra: 1 }).success).toBe(false);
    expect(DaemonUp.safeParse({ ...patch, planRef: 'not a ref' }).success).toBe(false);
    const turns = Array.from({ length: 51 }, (_, i) => ({ id: `t${i}`, who: 'ai', text: 'x', at: i }));
    expect(DaemonUp.safeParse({ ...patch, turns }).success).toBe(false);
  });
});

describe('routing and envelopes', () => {
  it('sends each path to the Worker or a studio DO', () => {
    expect(routeOf('POST', '/v1/admin/studios/s1/link-codes')).toMatchObject({ name: 'admin-link-codes', area: 'hub', params: { sid: 's1' } });
    expect(routeOf('GET', '/v1/app/projects/p1/plans/m0/turns')).toMatchObject({ name: 'app-turns', area: 'studio', params: { pid: 'p1', ref: 'm0' } });
    expect(routeOf('GET', '/v1/app/projects/p1/previews/m0')).toMatchObject({ name: 'app-preview', area: 'studio', params: { pid: 'p1', m: 'm0' } });
    expect(routeOf('GET', '/v1/daemon/ws')).toMatchObject({ name: 'daemon-ws', area: 'studio' });
    expect(routeOf('GET', '/v1/nope')).toMatchObject({ name: 'not-found', area: 'none' });
  });

  it('parses the internal Worker → DO identity strictly', () => {
    expect(internalAuthOf('{"role":"operator"}')).toEqual({ role: 'operator' });
    expect(internalAuthOf('{"role":"app","customerId":"c1","projectId":"p1"}')).toEqual({ role: 'app', customerId: 'c1', projectId: 'p1' });
    expect(internalAuthOf('{"role":"app","customerId":"c1","projectId":"p1","extra":1}')).toBeUndefined();
    expect(internalAuthOf('{"role":"root"}')).toBeUndefined();
    expect(internalAuthOf(null)).toBeUndefined();
  });

  it('accepts only the named fields in both directions', () => {
    const hello = { t: 'hello', proto: { major: 1, minor: 0 }, daemon: 'abc', projects: [{ id: 'p1', name: 'api' }] };
    expect(DaemonUp.safeParse(hello).success).toBe(true);
    expect(DaemonUp.safeParse({ ...hello, extra: 1 }).success).toBe(false);
    expect(DaemonUp.safeParse({ t: 'for', project: 'p1', frame: { t: 'plan-gone', planRef: 'm0' } }).success).toBe(true);
    expect(DaemonUp.safeParse({ t: 'for', project: 'not a ref', frame: { t: 'plan-gone', planRef: 'm0' } }).success).toBe(false);
    expect(HubDown.safeParse({ t: 'welcome', studio: 's1', proto: { major: 1, minor: 0 } }).success).toBe(true);
    expect(HubDown.safeParse({ t: 'welcome', studio: 's1', proto: { major: 1, minor: 0 }, extra: 1 }).success).toBe(false);
    expect(HubDown.safeParse({ t: 'outdated' }).success).toBe(true);
  });
});
