import { describe, expect, it, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({
  DurableObject: class {},
}));

import { notifyWaitingCards } from '../src/hub.js';
import type { PushEnv } from '../src/push.js';

function createDedupMockDb() {
  const members = [{ project_id: 'p1', customer_id: 'c1' }];
  const pushTokens = [{ customer_id: 'c1', device: 'dev1', platform: 'ios', token: 'apns-tok-1', updated_at: 1 }];
  const pushDedup = new Set<string>();

  const db = {
    prepare(sql: string) {
      let args: unknown[] = [];
      const stmt = {
        bind(...values: unknown[]) {
          args = values;
          return stmt;
        },
        async all<T>() {
          if (sql.includes('FROM members WHERE project_id = ?')) {
            const pid = String(args[0]);
            return { results: members.filter((m) => m.project_id === pid) as T[] };
          }
          if (sql.includes('FROM push_tokens WHERE customer_id = ?')) {
            const cid = String(args[0]);
            return { results: pushTokens.filter((t) => t.customer_id === cid) as T[] };
          }
          return { results: [] as T[] };
        },
        async run() {
          if (sql.includes('INSERT OR IGNORE INTO push_dedup')) {
            const [cid, cardId] = args as [string, string];
            const key = `${cid}::${cardId}`;
            if (pushDedup.has(key)) return { meta: { changes: 0 } };
            pushDedup.add(key);
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 0 } };
        },
      };
      return stmt;
    },
  };

  return { db: db as unknown as D1Database, pushDedup };
}

function toPkcs8Pem(pkcs8: ArrayBuffer): string {
  const b64 = Buffer.from(pkcs8).toString('base64');
  const lines = b64.match(/.{1,64}/g)?.join('\n') ?? b64;
  return `-----BEGIN PRIVATE KEY-----\n${lines}\n-----END PRIVATE KEY-----`;
}

describe('SS-81 waiting card push dedup', () => {
  it('notifies once per (customer, cardId) across repeated plan updates and carries path', async () => {
    const ecPair = (await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify'],
    )) as CryptoKeyPair;
    const apnsPem = toPkcs8Pem((await crypto.subtle.exportKey('pkcs8', ecPair.privateKey)) as ArrayBuffer);

    const { db } = createDedupMockDb();
    const sentPayloads: Array<{ path?: string; body?: string; cardId?: string }> = [];

    const fakeFetch: typeof fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        aps?: { alert?: { body?: string } };
        path?: string;
        cardId?: string;
      };
      sentPayloads.push({
        path: body.path,
        body: body.aps?.alert?.body,
        cardId: body.cardId,
      });
      return new Response('{}', { status: 200 });
    };

    const env: PushEnv = {
      DB: db,
      APNS_KEY_ID: 'K1',
      APNS_TEAM_ID: 'T1',
      APNS_PRIVATE_KEY: apnsPem,
      APNS_BUNDLE_ID: 'studio.synon.app',
      APNS_ENDPOINT: 'https://apns.fake',
    };

    const view1 = {
      planRef: 'pl1',
      title: '支付改造',
      decisions: [{ decisionId: 'd1', question: '是否开启微信支付？', open: true }],
      milestones: [{ ref: 'm1', title: '后端接口', status: 'working' }],
    };

    // 首次到达 d1：通知 1 次
    const first = await notifyWaitingCards(db, env, 'p1', view1, { fetch: fakeFetch, now: 1000 });
    expect(first).toBe(1);

    // 同一卡在后续视图更新中仍处于 open：不再重复通知
    const second = await notifyWaitingCards(db, env, 'p1', view1, { fetch: fakeFetch, now: 2000 });
    expect(second).toBe(0);

    // 同一计划新增 m1 验收卡：只通知新卡 m1
    const view2 = {
      planRef: 'pl1',
      title: '支付改造',
      decisions: [{ decisionId: 'd1', question: '是否开启微信支付？', open: true }],
      milestones: [{ ref: 'm1', title: '后端接口', status: 'review' }],
    };
    const third = await notifyWaitingCards(db, env, 'p1', view2, { fetch: fakeFetch, now: 3000 });
    expect(third).toBe(1);

    expect(sentPayloads).toEqual([
      { path: '/project/p1/plan/pl1', body: '是否开启微信支付？', cardId: 'pl1:decision:d1' },
      { path: '/project/p1/plan/pl1', body: '请验收：后端接口', cardId: 'pl1:review:m1' },
    ]);
  });
});
