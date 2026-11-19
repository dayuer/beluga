import { describe, expect, it, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({
  DurableObject: class {},
}));

import { extractWaitingCards, notifyWaitingCards } from '../src/hub.js';
import type { PushEnv } from '../src/push.js';

function createDedupMockDb(members = [{ project_id: 'p1', customer_id: 'c1' }]) {
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

describe('SS-81 / SS-125 waiting card push dedup & deep links', () => {
  it('extracts all waiting card types with /request/<id>?card=<cardId> deep links', () => {
    // 1. decision + review + draftDiff + confirm
    const cards = extractWaitingCards('p1', {
      planRef: 'pl1',
      draftRev: 2,
      title: '测试计划',
      stage: 'drafting',
      typing: false,
      decisions: [{ decisionId: 'd1', question: '选方案A？', open: true }],
      milestones: [{ ref: 'm1', title: '前端', status: 'review' }],
      draftDiff: { draftRev: 2 },
    });
    expect(cards.map((c) => c.cardId)).toEqual([
      'p1:pl1:decision:d1',
      'p1:pl1:review:m1',
      'p1:pl1:draftDiff:2',
      'p1:pl1:confirm:2',
    ]);
    for (const c of cards) {
      expect(c.path).toBe(`/request/pl1?card=${encodeURIComponent(c.cardId)}`);
    }

    // 2. all pending customer-signed gates (start, changes, release, deliver)
    for (const kind of ['start', 'changes', 'release', 'deliver'] as const) {
      const gateCards = extractWaitingCards('p1', {
        planRef: 'pl2',
        draftRev: 3,
        title: '门禁计划',
        stage: 'running',
        decisions: [],
        milestones: [],
        gate: { kind, state: 'pending', draftRev: 3 },
      });
      expect(gateCards).toHaveLength(1);
      expect(gateCards[0]?.cardId).toBe(`p1:pl2:gate:${kind}:3`);
      expect(gateCards[0]?.path).toBe(`/request/pl2?card=${encodeURIComponent(`p1:pl2:gate:${kind}:3`)}`);
    }
  });

  it('notifies once per (customer, cardId) across repeated updates and separates projects with same planRef', async () => {
    const ecPair = (await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify'],
    )) as CryptoKeyPair;
    const apnsPem = toPkcs8Pem((await crypto.subtle.exportKey('pkcs8', ecPair.privateKey)) as ArrayBuffer);

    const { db } = createDedupMockDb([
      { project_id: 'p1', customer_id: 'c1' },
      { project_id: 'p2', customer_id: 'c1' },
    ]);
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

    // p1 首次到达 d1：通知 1 次
    expect(await notifyWaitingCards(db, env, 'p1', view1, { fetch: fakeFetch, now: 1000 })).toBe(1);
    // p1 同一卡在后续视图更新中仍处于 open：不再重复通知
    expect(await notifyWaitingCards(db, env, 'p1', view1, { fetch: fakeFetch, now: 2000 })).toBe(0);
    // p2 相同 planRef 和 decisionId：因为带 projectId，仍会通知 1 次
    expect(await notifyWaitingCards(db, env, 'p2', view1, { fetch: fakeFetch, now: 2500 })).toBe(1);

    expect(sentPayloads).toEqual([
      {
        path: '/request/pl1?card=p1%3Apl1%3Adecision%3Ad1',
        body: '是否开启微信支付？',
        cardId: 'p1:pl1:decision:d1',
      },
      {
        path: '/request/pl1?card=p2%3Apl1%3Adecision%3Ad1',
        body: '是否开启微信支付？',
        cardId: 'p2:pl1:decision:d1',
      },
    ]);
  });
});
