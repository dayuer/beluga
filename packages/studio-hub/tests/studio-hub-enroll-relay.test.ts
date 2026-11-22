import { createHmac, generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../../../src/net/studio/store.js';
import { canonicalJson, createDeviceTrustStore } from '../../../src/studio/verify.js';
import { D1HubStore } from '../src/d1.js';
import { handleDeviceEnrollRequest, relayForwarder, type EnrolledDeviceRecord, type EnrollStore, type InviteRecord } from '../src/devices-enroll.js';
import { EnrollRelay, type EnrollRequestFrame } from '../src/enroll-relay.js';
import type { Env } from '../src/hub.js';

const TOKEN = 'session-tok-1';

function sessionDb(tokenHash: string): D1Database {
  return {
    prepare(sql: string) {
      let args: unknown[] = [];
      const stmt = {
        bind(...v: unknown[]) {
          args = v;
          return stmt;
        },
        async first<T>() {
          if (sql.includes('FROM sessions') && String(args[0]) === tokenHash) {
            return { token_hash: tokenHash, customer_id: 'cust-1', created_at: 1000, expires_at: 99_999_999, revoked_at: null } as T;
          }
          if (sql.includes('FROM customers')) return { id: 'cust-1', email: 'c@example.com', name: 'C', status: 'active', created_at: 1000 } as T;
          return null;
        },
        async all<T>() {
          return { results: [] as T[] };
        },
        async run() {
          return { meta: { changes: 0 } };
        },
      };
      return stmt;
    },
  } as unknown as D1Database;
}

function memoryEnrollStore(invites: InviteRecord[]): EnrollStore & { devices: EnrolledDeviceRecord[]; invites: Map<string, InviteRecord> } {
  const map = new Map(invites.map((i) => [i.id, i]));
  const devices: EnrolledDeviceRecord[] = [];
  return {
    devices,
    invites: map,
    async getInvite(id) {
      return map.get(id);
    },
    async markInviteUsed(id, at) {
      const inv = map.get(id);
      if (!inv || inv.usedAt !== undefined) return false;
      map.set(id, { ...inv, usedAt: at });
      return true;
    },
    async saveDevice(r) {
      devices.push(r);
    },
  };
}

/** A hub DO's relay endpoint wired to a fake node (or to nobody when `online` is false). */
function doCall(relay: EnrollRelay, node: ReturnType<typeof createDeviceTrustStore> | undefined) {
  return async (_studioId: string, _path: string, body: unknown): Promise<Response> => {
    const b = body as { inviteId: string; deviceId: string; pubkey: string; sealPubkey?: string; mac: string };
    const reply = await relay.request(
      { t: 'enroll', reqId: crypto.randomUUID(), inviteId: b.inviteId, deviceId: b.deviceId, pubkey: b.pubkey, mac: b.mac },
      (frame: EnrollRequestFrame) => {
        if (!node) return false;
        const result = node.enrollFrame(frame);
        queueMicrotask(() =>
          relay.settle(JSON.stringify({ t: 'enroll-result', reqId: frame.reqId, ...(result.ok ? { ok: true, fingerprint: result.fingerprint } : { ok: false, code: result.code }) })),
        );
        return true;
      },
      200,
    );
    return new Response(JSON.stringify(reply), { status: 200 });
  };
}

async function setup(online: boolean) {
  const tokenHash = await sha256Hex(TOKEN);
  const db = sessionDb(tokenHash);
  const hub = new D1HubStore(db);
  const env = { DB: db, HUB_ORIGIN: 'https://hub.example' } as unknown as Env;
  const kBytes = Buffer.alloc(32, 9);
  const node = createDeviceTrustStore({ nodeFingerprint: 'A1B2C3D4E5F67890' });
  node.addInvite('inv-1', kBytes.toString('base64url'));
  const store = memoryEnrollStore([{ id: 'inv-1', studioId: 'st-1', daemonId: 'd-1', expiresAt: 50_000 }]);
  const relay = new EnrollRelay();
  const forward = relayForwarder(env, doCall(relay, online ? node : undefined));
  const phone = generateKeyPairSync('ed25519');
  const rawPub = phone.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32);
  const enroll = (mac: string) =>
    handleDeviceEnrollRequest(
      new Request('https://hub.example/v1/app/devices/enroll', {
        method: 'POST',
        headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify({ inviteId: 'inv-1', pubkey: rawPub.toString('base64url'), mac }),
      }),
      env,
      hub,
      2000,
      { store, forward },
    );
  const goodMac = createHmac('sha256', kBytes).update(rawPub).digest('base64url');
  return { enroll, goodMac, store, node, phone, pubB64: rawPub.toString('base64url') };
}

describe('device.enroll relay: app → hub → node → fingerprint', () => {
  it('the node checks the mac, remembers the key and answers with its fingerprint', async () => {
    const w = await setup(true);
    const res = await w.enroll(w.goodMac);
    expect(res?.status).toBe(200);
    expect(await res!.json()).toMatchObject({ ok: true, fingerprint: 'A1B2C3D4E5F67890' });
    expect(w.node.isEnrolled(w.pubB64)).toBe(true);
    expect(w.store.invites.get('inv-1')?.usedAt).toBe(2000);
  });

  it('a wrong mac is refused by the node and the invite stays unspent', async () => {
    const w = await setup(true);
    const res = await w.enroll(Buffer.alloc(32, 1).toString('base64url'));
    expect(res?.status).toBe(403);
    expect(await res!.json()).toMatchObject({ code: 'bad-mac' });
    expect(w.node.isEnrolled(w.pubB64)).toBe(false);
    expect(w.store.invites.get('inv-1')?.usedAt).toBeUndefined();
    expect(w.store.devices).toHaveLength(0);
  });

  it('an offline node is waiting, not failed, and the invite stays unspent', async () => {
    const w = await setup(false);
    const res = await w.enroll(w.goodMac);
    expect(res?.status).toBe(202);
    expect(await res!.json()).toMatchObject({ waiting: true });
    expect(w.store.invites.get('inv-1')?.usedAt).toBeUndefined();
  });
});

describe('device.remove takes the device off the node trust list', () => {
  it('after a verified device.remove, the removed device is unregistered-device', async () => {
    const w = await setup(true);
    await w.enroll(w.goodMac);
    const signed = (kind: string, payload: unknown, rev: number | undefined, at: number) => {
      const frame = { kind, payload, ...(rev !== undefined ? { rev } : {}), at, deviceKey: w.pubB64 };
      const sig = sign(null, Buffer.from(canonicalJson(frame)), w.phone.privateKey).toString('base64url');
      return { kind, payload, ...(rev !== undefined ? { rev } : {}), signed: { frame, sig } };
    };
    expect(w.node.verifySignedAction(signed('gate.answer', { gate: 'start', approved: true, draftRev: 1 }, 1, 100)).ok).toBe(true);
    expect(w.node.verifySignedAction(signed('device.remove', { deviceId: w.pubB64 }, undefined, 101)).ok).toBe(true);
    expect(w.node.verifySignedAction(signed('gate.answer', { gate: 'start', approved: true, draftRev: 1 }, 1, 102))).toEqual({ ok: false, code: 'unregistered-device' });
  });
});

describe('EnrollRelay', () => {
  it('times out as timeout (waiting) when the node never answers', async () => {
    const relay = new EnrollRelay();
    const reply = await relay.request({ t: 'enroll', reqId: 'r1', inviteId: 'i', deviceId: 'd', pubkey: 'p', mac: 'm' }, () => true, 10);
    expect(reply).toEqual({ status: 'timeout' });
  });
});
