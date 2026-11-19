import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../../../src/net/studio/store.js';
import { D1HubStore } from '../src/d1.js';
import {
  handlePushTokenRequest,
  listPushTokensForCustomer,
  type PushPlatform,
} from '../src/push-tokens.js';
import type { Env } from '../src/hub.js';

interface MockTokenRow {
  customer_id: string;
  device: string;
  platform: PushPlatform;
  token: string;
  updated_at: number;
}

function createMockDb(seed: {
  customers: Array<{ id: string; email: string; name: string; status: 'invited' | 'active' | 'removed'; created_at: number }>;
  sessions: Array<{ token_hash: string; customer_id: string; created_at: number; expires_at: number; revoked_at: number | null }>;
}) {
  const pushTokens: MockTokenRow[] = [];

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
            const hash = String(args[0]);
            const row = seed.sessions.find((s) => s.token_hash === hash) ?? null;
            return row as T | null;
          }
          if (sql.includes('FROM customers')) {
            const id = String(args[0]);
            const row = seed.customers.find((c) => c.id === id) ?? null;
            return row as T | null;
          }
          return null;
        },
        async all<T>() {
          if (sql.includes('FROM push_tokens')) {
            const customerId = String(args[0]);
            const rows = pushTokens
              .filter((r) => r.customer_id === customerId)
              .sort((a, b) => b.updated_at - a.updated_at);
            return { results: rows as T[] };
          }
          return { results: [] as T[] };
        },
        async run() {
          if (sql.includes('INSERT INTO push_tokens')) {
            const [customerId, device, platform, token, updatedAt] = args as [
              string,
              string,
              PushPlatform,
              string,
              number,
            ];
            const idx = pushTokens.findIndex((r) => r.customer_id === customerId && r.device === device);
            const next: MockTokenRow = {
              customer_id: customerId,
              device,
              platform,
              token,
              updated_at: updatedAt,
            };
            if (idx >= 0) pushTokens[idx] = next;
            else pushTokens.push(next);
            return { meta: { changes: 1 } };
          }
          if (sql.includes('DELETE FROM push_tokens WHERE customer_id = ? AND device = ?')) {
            const [customerId, device] = args as [string, string];
            const before = pushTokens.length;
            for (let i = pushTokens.length - 1; i >= 0; i--) {
              if (pushTokens[i]?.customer_id === customerId && pushTokens[i]?.device === device) {
                pushTokens.splice(i, 1);
              }
            }
            return { meta: { changes: before - pushTokens.length } };
          }
          if (sql.includes('DELETE FROM push_tokens WHERE customer_id = ? AND token = ?')) {
            const [customerId, token] = args as [string, string];
            const before = pushTokens.length;
            for (let i = pushTokens.length - 1; i >= 0; i--) {
              if (pushTokens[i]?.customer_id === customerId && pushTokens[i]?.token === token) {
                pushTokens.splice(i, 1);
              }
            }
            return { meta: { changes: before - pushTokens.length } };
          }
          return { meta: { changes: 0 } };
        },
      };
      return stmt;
    },
  };

  return { db: db as unknown as D1Database, pushTokens };
}

async function setup() {
  const now = 1_700_000_000_000;
  const tokenA = 'session-token-a';
  const tokenB = 'session-token-b';
  const { db, pushTokens } = createMockDb({
    customers: [
      { id: 'c1', email: 'a@example.com', name: 'A', status: 'active', created_at: now - 10_000 },
      { id: 'c2', email: 'b@example.com', name: 'B', status: 'active', created_at: now - 10_000 },
    ],
    sessions: [
      {
        token_hash: await sha256Hex(tokenA),
        customer_id: 'c1',
        created_at: now - 5_000,
        expires_at: now + 60_000,
        revoked_at: null,
      },
      {
        token_hash: await sha256Hex(tokenB),
        customer_id: 'c2',
        created_at: now - 5_000,
        expires_at: now + 60_000,
        revoked_at: null,
      },
    ],
  });
  const hub = new D1HubStore(db);
  const env = { DB: db } as Env;
  return { db, pushTokens, hub, env, now, tokenA, tokenB };
}

describe('SS-79 push-tokens', () => {
  it('requires valid customer session', async () => {
    const { env, hub, now } = await setup();
    const res = await handlePushTokenRequest(
      new Request('https://hub.example/v1/app/push-tokens', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ device: 'iphone-1', platform: 'ios', token: 'apns-1' }),
      }),
      env,
      hub,
      now,
    );
    expect(res?.status).toBe(401);
  });

  it('rejects invalid payload', async () => {
    const { env, hub, now, tokenA } = await setup();
    const res = await handlePushTokenRequest(
      new Request('https://hub.example/v1/app/push-tokens', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${tokenA}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ device: 'iphone-1', platform: 'web', token: 'tok' }),
      }),
      env,
      hub,
      now,
    );
    expect(res?.status).toBe(400);
  });

  it('keeps only one record when the same device re-registers', async () => {
    const { db, env, hub, now, tokenA } = await setup();

    const r1 = await handlePushTokenRequest(
      new Request('https://hub.example/v1/app/push-tokens', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${tokenA}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ device: 'dev-1', platform: 'ios', token: 'apns-old' }),
      }),
      env,
      hub,
      now,
    );
    expect(r1?.status).toBe(200);

    const r2 = await handlePushTokenRequest(
      new Request('https://hub.example/v1/app/push-tokens', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${tokenA}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ device: 'dev-1', platform: 'ios', token: 'apns-new' }),
      }),
      env,
      hub,
      now + 1_000,
    );
    expect(r2?.status).toBe(200);

    const list = await listPushTokensForCustomer(db, 'c1');
    expect(list).toHaveLength(1);
    expect(list[0]).toEqual({
      customerId: 'c1',
      device: 'dev-1',
      platform: 'ios',
      token: 'apns-new',
      updatedAt: now + 1_000,
    });
  });

  it('removes token on unregister and isolates across customers', async () => {
    const { db, env, hub, now, tokenA, tokenB } = await setup();

    await handlePushTokenRequest(
      new Request('https://hub.example/v1/app/push-tokens', {
        method: 'POST',
        headers: { authorization: `Bearer ${tokenA}`, 'content-type': 'application/json' },
        body: JSON.stringify({ device: 'dev-1', platform: 'android', token: 'fcm-a' }),
      }),
      env,
      hub,
      now,
    );
    await handlePushTokenRequest(
      new Request('https://hub.example/v1/app/push-tokens', {
        method: 'POST',
        headers: { authorization: `Bearer ${tokenB}`, 'content-type': 'application/json' },
        body: JSON.stringify({ device: 'dev-1', platform: 'ios', token: 'apns-b' }),
      }),
      env,
      hub,
      now,
    );

    // 客户 A 注销自己的 dev-1，不影响客户 B 的 dev-1
    const del = await handlePushTokenRequest(
      new Request('https://hub.example/v1/app/push-tokens/dev-1', {
        method: 'DELETE',
        headers: { authorization: `Bearer ${tokenA}` },
      }),
      env,
      hub,
      now + 500,
    );
    expect(del?.status).toBe(200);

    expect(await listPushTokensForCustomer(db, 'c1')).toEqual([]);
    expect(await listPushTokensForCustomer(db, 'c2')).toHaveLength(1);
  });
});
