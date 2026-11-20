import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { enqueue, take } from '../../../src/net/studio/queue.js';
import { memoryHub, memoryStudio, sha256Hex } from '../../../src/net/studio/store.js';
import { D1HubStore } from '../src/d1.js';
import {
  handleDeviceEnrollRequest,
  type EnrolledDeviceRecord,
  type EnrollStore,
  type InviteRecord,
} from '../src/devices-enroll.js';
import type { Env } from '../src/hub.js';

function createMockDb(seed: {
  customers: Array<{ id: string; email: string; name: string; status: 'invited' | 'active' | 'removed'; created_at: number }>;
  sessions: Array<{ token_hash: string; customer_id: string; created_at: number; expires_at: number; revoked_at: number | null }>;
}) {
  const db = {
    prepare(sql: string) {
      let args: unknown[] = [];
      const stmt = {
        bind(...values: unknown[]) {
          args = values;
          return stmt;
        },
        async first<T>() {
          if (sql.includes('FROM sessions')) {
            return (seed.sessions.find((s) => s.token_hash === String(args[0])) ?? null) as T | null;
          }
          if (sql.includes('FROM customers')) {
            return (seed.customers.find((c) => c.id === String(args[0])) ?? null) as T | null;
          }
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
  };
  return db as unknown as D1Database;
}

function createMemoryEnrollStore(initial: InviteRecord[]): EnrollStore & { devices: EnrolledDeviceRecord[] } {
  const invites = new Map(initial.map((inv) => [inv.id, { ...inv }]));
  const devices: EnrolledDeviceRecord[] = [];
  return {
    devices,
    async getInvite(id) {
      return invites.get(id);
    },
    async markInviteUsed(id, usedAt) {
      const inv = invites.get(id);
      if (!inv || inv.usedAt !== undefined) return false;
      invites.set(id, { ...inv, usedAt });
      return true;
    },
    async saveDevice(record) {
      devices.push(record);
    },
  };
}

describe('studio-hub device enroll & signed action forwarding', () => {
  it('enrolls on valid HMAC, returns node fingerprint, and rejects bad HMAC or reused invite', async () => {
    const token = 'session-tok-1';
    const tokenHash = await sha256Hex(token);
    const db = createMockDb({
      customers: [{ id: 'cust-1', email: 'c@example.com', name: 'Customer', status: 'active', created_at: 1000 }],
      sessions: [{ token_hash: tokenHash, customer_id: 'cust-1', created_at: 1000, expires_at: 99999999, revoked_at: null }],
    });
    const hub = new D1HubStore(db);
    const env = { DB: db, HUB_ORIGIN: 'https://hub.example' } as unknown as Env;

    const kBytes = Buffer.alloc(32, 9);
    const k = kBytes.toString('base64url');
    const pubBytes = Buffer.alloc(32, 7);
    const pubkey = pubBytes.toString('base64url');
    const validMac = createHmac('sha256', kBytes).update(pubBytes).digest('base64url');

    const store = createMemoryEnrollStore([
      { id: 'inv-1', k, nodeFingerprint: 'A1B2C3D4E5F67890', expiresAt: 50000 },
    ]);

    // 1. HMAC 错 -> 403 且不消费邀请码
    const badReq = new Request('https://hub.example/v1/app/devices/enroll', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ inviteId: 'inv-1', pubkey, mac: 'wrong-mac' }),
    });
    const badRes = await handleDeviceEnrollRequest(badReq, env, hub, 2000, store);
    expect(badRes?.status).toBe(403);
    expect(store.devices).toHaveLength(0);

    // 2. HMAC 对 -> 200 并返回节点指纹
    const okReq = new Request('https://hub.example/v1/app/devices/enroll', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ inviteId: 'inv-1', pubkey, mac: validMac }),
    });
    const okRes = await handleDeviceEnrollRequest(okReq, env, hub, 2000, store);
    expect(okRes?.status).toBe(200);
    const okJson = (await okRes!.json()) as { ok: boolean; fingerprint: string };
    expect(okJson.ok).toBe(true);
    expect(okJson.fingerprint).toBe('A1B2C3D4E5F67890');
    expect(store.devices).toHaveLength(1);

    // 3. 同一码再用一次 -> 409 invite-used
    const reuseReq = new Request('https://hub.example/v1/app/devices/enroll', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ inviteId: 'inv-1', pubkey, mac: validMac }),
    });
    const reuseRes = await handleDeviceEnrollRequest(reuseReq, env, hub, 2100, store);
    expect(reuseRes?.status).toBe(409);
  });

  it('forwards signed actions to daemon with signed envelope byte-for-byte intact', async () => {
    const hub = memoryHub();
    const studio = memoryStudio();
    const st = await hub.createStudio({ name: 'Studio', now: 1000 });
    await hub.createCustomer({ id: 'cust-1', email: 'c@example.com', name: 'Customer', now: 1000 });
    await hub.createProject({ id: 'proj-1', studioId: st.id, name: 'App', now: 1000 });
    await hub.addMember('proj-1', 'cust-1', 1000);
    await hub.createDaemon({ id: 'd-1', studioId: st.id, publicKey: '00'.repeat(32), name: 'Mac', now: 1000 });
    await hub.replaceDaemonProjects('d-1', [{ id: 'dp-1', name: 'api' }], 1000);
    await hub.bindProject({ projectId: 'proj-1', daemonId: 'd-1', daemonProjectId: 'dp-1', now: 1000 });
    await studio.putConn({ daemonId: 'd-1', lastAt: 999, connectedAt: 1000, lastSeenAt: 1000, hello: true, synced: true });
    await studio.putView({
      projectId: 'proj-1',
      planRef: 'p1',
      rev: 2,
      viewJson: JSON.stringify({
        planRef: 'p1',
        draftRev: 2,
        title: 'App',
        goal: 'g',
        stage: 'awaiting-start',
        waitingOn: 'customer',
        headline: 'h',
        progress: { done: 0, total: 1 },
        milestones: [],
        decisions: [],
        turns: [],
        typing: false,
        moreTurns: false,
        activity: [],
      }),
      updatedAt: 1000,
    });

    const signedEnvelope = {
      frame: {
        kind: 'gate.answer',
        payload: { gate: 'start', approved: true, draftRev: 2 },
        rev: 2,
        at: 1700000000123,
        deviceKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      },
      sig: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
    };
    const actionFrame = {
      t: 'action' as const,
      opId: '6f1c2a5e-3b7d-4c8e-9f0a-1b2c3d4e5f60',
      kind: 'gate.answer' as const,
      planRef: 'p1',
      payload: { gate: 'start' as const, approved: true, draftRev: 2 },
      rev: 2,
      signed: signedEnvelope,
    };

    const sub = await enqueue(
      actionFrame,
      { studio: st.id, projectId: 'proj-1', customerId: 'cust-1' },
      { hub, studio, now: 2000 },
    );
    expect(sub.ok).toBe(true);
    if (sub.ok) expect(sub.receipt.state).toBe('queued');

    const taken = await take('d-1', { hub, studio, now: 2100 });
    expect(taken.deliver).toHaveLength(1);
    expect(taken.deliver[0]!.action).toEqual(actionFrame);
    expect(JSON.stringify((taken.deliver[0]!.action as typeof actionFrame).signed)).toBe(JSON.stringify(signedEnvelope));
  });
});
