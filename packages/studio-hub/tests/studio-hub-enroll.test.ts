import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { enqueue, take } from '../../../src/net/studio/queue.js';
import { memoryHub, memoryStudio, sha256Hex } from '../../../src/net/studio/store.js';
import { D1HubStore } from '../src/d1.js';
import { handleDeviceEnrollRequest } from '../src/devices-enroll.js';
import type { Env } from '../src/hub.js';

function createSqliteD1(): { d1: D1Database; raw: DatabaseSync } {
  const raw = new DatabaseSync(':memory:');
  const schema = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../schema.sql'), 'utf8');
  raw.exec(schema);

  const prepare = (sql: string) => {
    let args: unknown[] = [];
    const stmt = {
      bind(...values: unknown[]) {
        args = values;
        return stmt;
      },
      async first<T>() {
        const row = raw.prepare(sql).get(...(args as never[]));
        return (row ?? null) as T | null;
      },
      async all<T>() {
        const results = raw.prepare(sql).all(...(args as never[]));
        return { results: results as T[] };
      },
      async run() {
        const res = raw.prepare(sql).run(...(args as never[]));
        return { meta: { changes: Number(res.changes) } };
      },
    };
    return stmt;
  };

  const d1 = {
    prepare,
    async batch(stmts: ReturnType<typeof prepare>[]) {
      const out = [];
      for (const s of stmts) out.push(await s.run());
      return out;
    },
  } as unknown as D1Database;

  return { d1, raw };
}

describe('studio-hub device enroll routing (real schema.sql + d1EnrollStore)', () => {
  it('routes enroll via studio_invites without storing k, rejects used/expired, and cleans up studio_devices on customer deletion', async () => {
    const { d1, raw } = createSqliteD1();
    const token = 'session-tok-1';
    const tokenHash = await sha256Hex(token);

    raw.prepare('INSERT INTO studios (id, name, created_at) VALUES (?, ?, ?)').run('st-1', 'Studio', 1000);
    raw.prepare('INSERT INTO daemons (id, studio_id, public_key, name, created_at) VALUES (?, ?, ?, ?, ?)').run('d-1', 'st-1', '00'.repeat(32), 'Mac', 1000);
    raw.prepare("INSERT INTO customers (id, email, name, status, created_at) VALUES (?, ?, ?, 'active', ?)").run('cust-1', 'c@example.com', 'Customer', 1000);
    raw.prepare('INSERT INTO sessions (token_hash, customer_id, created_at, expires_at, revoked_at) VALUES (?, ?, ?, ?, NULL)').run(tokenHash, 'cust-1', 1000, 99999999);
    raw.prepare('INSERT INTO studio_invites (id, studio_id, daemon_id, expires_at, used_at) VALUES (?, ?, ?, ?, NULL)').run('inv-1', 'st-1', 'd-1', 50000);
    raw.prepare('INSERT INTO studio_invites (id, studio_id, daemon_id, expires_at, used_at) VALUES (?, ?, ?, ?, NULL)').run('inv-exp', 'st-1', 'd-1', 1500);

    const hub = new D1HubStore(d1);
    const env = { DB: d1, HUB_ORIGIN: 'https://hub.example' } as unknown as Env;

    const kBytes = Buffer.alloc(32, 9);
    const pubBytes = Buffer.alloc(32, 7);
    const pubkey = pubBytes.toString('base64url');
    const mac = createHmac('sha256', kBytes).update(pubBytes).digest('base64url');

    // 1. 过期邀请被拒
    const expReq = new Request('https://hub.example/v1/app/devices/enroll', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ inviteId: 'inv-exp', pubkey, mac }),
    });
    const expRes = await handleDeviceEnrollRequest(expReq, env, hub, 2000);
    expect(expRes?.status).toBe(410);

    // 2. 有效邀请走默认 d1EnrollStore + 节点转发，成功标记已用并保存设备
    const okReq = new Request('https://hub.example/v1/app/devices/enroll', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ inviteId: 'inv-1', pubkey, mac }),
    });
    const okRes = await handleDeviceEnrollRequest(okReq, env, hub, 2000, {
      forward: async (input) => {
        expect(input.invite.studioId).toBe('st-1');
        expect(input.invite.daemonId).toBe('d-1');
        return { ok: true, fingerprint: 'A1B2C3D4E5F67890' };
      },
    });
    expect(okRes?.status).toBe(200);
    const okJson = (await okRes!.json()) as { ok: boolean; studioId: string; fingerprint: string };
    expect(okJson).toMatchObject({ ok: true, studioId: 'st-1', fingerprint: 'A1B2C3D4E5F67890' });

    // 3. 用过的邀请再试被拒
    const reuseReq = new Request('https://hub.example/v1/app/devices/enroll', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ inviteId: 'inv-1', pubkey, mac }),
    });
    const reuseRes = await handleDeviceEnrollRequest(reuseReq, env, hub, 2100);
    expect(reuseRes?.status).toBe(409);

    // 4. 删客户时 studio_devices 一并清理
    expect(raw.prepare('SELECT COUNT(*) AS cnt FROM studio_devices WHERE customer_id = ?').get('cust-1')).toEqual({ cnt: 1 });
    await hub.removeCustomer('cust-1', 3000);
    expect(raw.prepare('SELECT COUNT(*) AS cnt FROM studio_devices WHERE customer_id = ?').get('cust-1')).toEqual({ cnt: 0 });
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
