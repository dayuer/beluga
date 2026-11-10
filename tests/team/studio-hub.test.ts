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
  routeOf,
  type ConnectCheck,
  type Deps,
  type HubReply,
  verifyDaemonConnect,
} from '../../src/net/studio/handler.js';
import { memoryHub, memoryStudio, sha256Hex, type HubStore, type StudioStore } from '../../src/net/studio/store.js';

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
    await w.studio.putConn({ daemonId, lastAt: at, connectedAt: at, lastSeenAt: at, synced: false });
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

    const ok = await handleStudioRequest(upgrade, { ...w.deps, studio: w.studio }, { role: 'daemon', daemonId });
    expect(ok.status).toBe(200);
    const wrong = await handleStudioRequest(upgrade, { ...w.deps, studio: w.studio }, { role: 'daemon', daemonId: 'B'.repeat(32) });
    expect(wrong.status).toBe(403);
    const notDaemon = await handleStudioRequest(upgrade, { ...w.deps, studio: w.studio }, { role: 'operator' });
    expect(notDaemon.status).toBe(403);
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
