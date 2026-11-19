import { describe, expect, it } from 'vitest';
import { sendPushToCustomer, type PushEnv } from '../src/push.js';
import { clearFcmTokenCache } from '../src/push-fcm.js';
import type { PushPlatform } from '../src/push-tokens.js';

interface TokenRow {
  customer_id: string;
  device: string;
  platform: PushPlatform;
  token: string;
  updated_at: number;
}

function createPushMockDb(initial: TokenRow[]) {
  const rows = [...initial];
  const db = {
    prepare(sql: string) {
      let args: unknown[] = [];
      const stmt = {
        bind(...values: unknown[]) {
          args = values;
          return stmt;
        },
        async all<T>() {
          if (sql.includes('FROM push_tokens WHERE customer_id = ?')) {
            const cid = String(args[0]);
            return { results: rows.filter((r) => r.customer_id === cid) as T[] };
          }
          return { results: [] as T[] };
        },
        async run() {
          if (sql.includes('DELETE FROM push_tokens WHERE token = ?')) {
            const tok = String(args[0]);
            const before = rows.length;
            for (let i = rows.length - 1; i >= 0; i--) {
              if (rows[i]?.token === tok) rows.splice(i, 1);
            }
            return { meta: { changes: before - rows.length } };
          }
          return { meta: { changes: 0 } };
        },
      };
      return stmt;
    },
  };
  return { db: db as unknown as D1Database, rows };
}

function toPkcs8Pem(pkcs8: ArrayBuffer): string {
  const b64 = Buffer.from(pkcs8).toString('base64');
  const lines = b64.match(/.{1,64}/g)?.join('\n') ?? b64;
  return `-----BEGIN PRIVATE KEY-----\n${lines}\n-----END PRIVATE KEY-----`;
}

function base64UrlToBytes(str: string): Uint8Array {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + pad;
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

describe('SS-80 push sender (APNs + FCM)', () => {
  it('signs ES256/RS256 JWTs, sends to APNs/FCM, and removes unregistered tokens', async () => {
    const ecPair = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify'],
    );
    const apnsPem = toPkcs8Pem(await crypto.subtle.exportKey('pkcs8', ecPair.privateKey));

    const rsaPair = await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify'],
    );
    const fcmPem = toPkcs8Pem(await crypto.subtle.exportKey('pkcs8', rsaPair.privateKey));

    const { db, rows } = createPushMockDb([
      { customer_id: 'c1', device: 'iphone-ok', platform: 'ios', token: 'apns-good', updated_at: 100 },
      { customer_id: 'c1', device: 'iphone-gone', platform: 'ios', token: 'apns-dead', updated_at: 99 },
      { customer_id: 'c1', device: 'android-ok', platform: 'android', token: 'fcm-good', updated_at: 98 },
      { customer_id: 'c1', device: 'android-gone', platform: 'android', token: 'fcm-dead', updated_at: 97 },
    ]);

    const calls: Array<{ url: string; headers: Record<string, string>; body: string }> = [];

    const fakeFetch: typeof fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const headers = Object.fromEntries(new Headers(init?.headers).entries());
      const body = typeof init?.body === 'string' ? init.body : '';
      calls.push({ url, headers, body });

      if (url === 'https://oauth.fake/token') {
        const params = new URLSearchParams(body);
        const assertion = params.get('assertion') ?? '';
        const [h, p, s] = assertion.split('.');
        expect(h).toBeTruthy();
        expect(p).toBeTruthy();
        expect(s).toBeTruthy();
        const valid = await crypto.subtle.verify(
          'RSASSA-PKCS1-v1_5',
          rsaPair.publicKey,
          base64UrlToBytes(s!),
          new TextEncoder().encode(`${h}.${p}`),
        );
        expect(valid).toBe(true);
        return new Response(JSON.stringify({ access_token: 'fcm-access-123' }), { status: 200 });
      }

      if (url.startsWith('https://apns.fake/3/device/')) {
        const auth = headers.authorization ?? '';
        expect(auth.startsWith('bearer ')).toBe(true);
        const jwt = auth.slice('bearer '.length);
        const [h, p, s] = jwt.split('.');
        const valid = await crypto.subtle.verify(
          { name: 'ECDSA', hash: 'SHA-256' },
          ecPair.publicKey,
          base64UrlToBytes(s!),
          new TextEncoder().encode(`${h}.${p}`),
        );
        expect(valid).toBe(true);
        expect(headers['apns-topic']).toBe('studio.synon.app');

        if (url.endsWith('/apns-dead')) {
          return new Response(JSON.stringify({ reason: 'Unregistered' }), { status: 410 });
        }
        return new Response('{}', { status: 200 });
      }

      if (url === 'https://fcm.fake/v1/projects/proj-1/messages:send') {
        expect(headers.authorization).toBe('Bearer fcm-access-123');
        const payload = JSON.parse(body) as { message: { token: string; data?: { path?: string } } };
        expect(payload.message.data?.path).toBe('/project/p1/plan/pl1');
        if (payload.message.token === 'fcm-dead') {
          return new Response(
            JSON.stringify({ error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } }),
            { status: 404 },
          );
        }
        return new Response(JSON.stringify({ name: 'projects/proj-1/messages/1' }), { status: 200 });
      }

      return new Response('unexpected', { status: 500 });
    };

    const env: PushEnv = {
      DB: db,
      APNS_KEY_ID: 'KEY123',
      APNS_TEAM_ID: 'TEAM123',
      APNS_PRIVATE_KEY: apnsPem,
      APNS_BUNDLE_ID: 'studio.synon.app',
      APNS_ENDPOINT: 'https://apns.fake',
      FCM_SERVICE_ACCOUNT_JSON: JSON.stringify({
        project_id: 'proj-1',
        client_email: 'fcm@proj-1.iam.gserviceaccount.com',
        private_key: fcmPem,
        token_uri: 'https://oauth.fake/token',
      }),
      FCM_ENDPOINT: 'https://fcm.fake',
    };

    clearFcmTokenCache();
    const result = await sendPushToCustomer(
      db,
      env,
      'c1',
      {
        title: '等你确认',
        body: '有一个新事项需要你确认',
        path: '/project/p1/plan/pl1',
      },
      { fetch: fakeFetch, now: 1_700_000_000_000 },
    );

    expect(result).toEqual({ sent: 2, failed: 2, removed: 2 });
    expect(rows.map((r) => r.token)).toEqual(['apns-good', 'fcm-good']);
    // 10 分钟后再次发送：FCM access token 在有效期内被复用，不重复请求 OAuth
    const second = await sendPushToCustomer(
      db,
      env,
      'c1',
      {
        title: '再次提醒',
        body: '仍有事项等待确认',
        path: '/project/p1/plan/pl1',
      },
      { fetch: fakeFetch, now: 1_700_000_600_000 },
    );
    expect(second).toEqual({ sent: 2, failed: 0, removed: 0 });
    expect(calls.filter((c) => c.url === 'https://oauth.fake/token')).toHaveLength(1);
  });
});
