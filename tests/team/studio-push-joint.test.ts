import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({
  DurableObject: class {},
}));

import { registerPush, unregisterPush, type PushNotificationsApi } from '../../packages/studio-app/lib/push-core.js';
import { extractPushPath } from '../../packages/studio-app/lib/push-open-core.js';
import { signOut } from '../../packages/studio-app/lib/signout-core.js';
import { notifyWaitingCards, type PlanFrameView } from '../../packages/studio-hub/src/hub.js';
import { clearApnsTokenCache, type PushEnv } from '../../packages/studio-hub/src/push.js';
import { handlePushTokenRequest, type PushPlatform } from '../../packages/studio-hub/src/push-tokens.js';
import type { D1HubStore } from '../../packages/studio-hub/src/d1.js';
import { memoryHub, sha256Hex } from '../../src/net/studio/store.js';

interface TokenRow {
  customer_id: string;
  device: string;
  platform: PushPlatform;
  token: string;
  updated_at: number;
}

function createJointDb(members: Array<{ project_id: string; customer_id: string }>) {
  const pushTokens: TokenRow[] = [];
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
            return {
              results: pushTokens
                .filter((r) => r.customer_id === cid)
                .sort((a, b) => b.updated_at - a.updated_at) as T[],
            };
          }
          return { results: [] as T[] };
        },
        async run() {
          if (sql.includes('INSERT INTO push_tokens')) {
            const [customer_id, device, platform, token, updated_at] = args as [
              string,
              string,
              PushPlatform,
              string,
              number,
            ];
            const idx = pushTokens.findIndex((r) => r.customer_id === customer_id && r.device === device);
            const row: TokenRow = { customer_id, device, platform, token, updated_at };
            if (idx >= 0) pushTokens[idx] = row;
            else pushTokens.push(row);
            return { meta: { changes: 1 } };
          }
          if (sql.includes('DELETE FROM push_tokens WHERE customer_id = ? AND device = ?')) {
            const [cid, dev] = args as [string, string];
            const before = pushTokens.length;
            for (let i = pushTokens.length - 1; i >= 0; i--) {
              if (pushTokens[i]?.customer_id === cid && pushTokens[i]?.device === dev) pushTokens.splice(i, 1);
            }
            return { meta: { changes: before - pushTokens.length } };
          }
          if (sql.includes('DELETE FROM push_tokens WHERE customer_id = ? AND token = ?')) {
            const [cid, tok] = args as [string, string];
            const before = pushTokens.length;
            for (let i = pushTokens.length - 1; i >= 0; i--) {
              if (pushTokens[i]?.customer_id === cid && pushTokens[i]?.token === tok) pushTokens.splice(i, 1);
            }
            return { meta: { changes: before - pushTokens.length } };
          }
          if (sql.includes('INSERT OR IGNORE INTO push_dedup')) {
            const [cid, cardId] = args as [string, string];
            const key = `${cid}::${cardId}`;
            if (pushDedup.has(key)) return { meta: { changes: 0 } };
            pushDedup.add(key);
            return { meta: { changes: 1 } };
          }
          if (sql.includes('DELETE FROM push_dedup WHERE customer_id = ? AND card_id = ?')) {
            const [cid, cardId] = args as [string, string];
            const deleted = pushDedup.delete(`${cid}::${cardId}`) ? 1 : 0;
            return { meta: { changes: deleted } };
          }
          return { meta: { changes: 0 } };
        },
      };
      return stmt;
    },
  };

  return { db: db as unknown as D1Database, pushTokens };
}

function toPkcs8Pem(pkcs8: ArrayBuffer): string {
  const b64 = Buffer.from(pkcs8).toString('base64');
  const lines = b64.match(/.{1,64}/g)?.join('\n') ?? b64;
  return `-----BEGIN PRIVATE KEY-----\n${lines}\n-----END PRIVATE KEY-----`;
}

function makeMemoryKv() {
  const map = new Map<string, unknown>();
  return {
    get: <T,>(k: string) => map.get(k) as T | undefined,
    set: (k: string, v: unknown) => {
      map.set(k, v);
    },
    remove: (k: string) => {
      map.delete(k);
    },
  };
}

function makeWaitingView(decisionId: string): PlanFrameView {
  return {
    planRef: 'plan-joint-1',
    draftRev: 1,
    title: '联调方案',
    stage: 'running',
    typing: false,
    decisions: [{ decisionId, question: '请确认这一步', open: true }],
    milestones: [],
  };
}

describe('studio-app + studio-hub push joint flow (SS-166)', () => {
  beforeEach(() => {
    clearApnsTokenCache();
  });

  it('deduplicates repeated waiting cards, routes payload via extractPushPath, and stops pushing after signOut', async () => {
    const now = 1_768_000_000_000;
    const customerId = 'cust-joint-1';
    const projectId = 'proj-joint-1';
    const rawSessionToken = 'sess-joint-valid';
    const sessionTokenHash = await sha256Hex(rawSessionToken);

    const hubStore = memoryHub();
    await hubStore.createCustomer({
      id: customerId,
      email: 'joint@example.test',
      name: 'Joint User',
      now,
    });
    await hubStore.activateCustomer(customerId);
    await hubStore.createSession({
      tokenHash: sessionTokenHash,
      customerId,
      now,
      ttl: 3_600_000,
    });

    const { db, pushTokens } = createJointDb([{ project_id: projectId, customer_id: customerId }]);

    const ecPair = (await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify'],
    )) as CryptoKeyPair;
    const apnsPem = toPkcs8Pem((await crypto.subtle.exportKey('pkcs8', ecPair.privateKey)) as ArrayBuffer);

    const env = {
      DB: db,
      HUB_ORIGIN: 'https://hub.joint.test',
      APNS_KEY_ID: 'KEYJOINT',
      APNS_TEAM_ID: 'TEAMJOINT',
      APNS_PRIVATE_KEY: apnsPem,
      APNS_BUNDLE_ID: 'com.synon.studio',
      APNS_ENDPOINT: 'https://apns.fake',
    } as unknown as PushEnv & { readonly HUB_ORIGIN: string };

    const apnsPayloads: Array<Record<string, unknown>> = [];
    const apnsFetch: typeof fetch = async (_url, init) => {
      apnsPayloads.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
      return new Response('{}', { status: 200 });
    };

    const appFetch: typeof fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const req = new Request(url, init);
      const reply = await handlePushTokenRequest(req, env as never, hubStore as unknown as D1HubStore, now);
      if (reply) return reply;
      return new Response(JSON.stringify({ error: 'not-found' }), { status: 404 });
    };

    const fakeNotifications: PushNotificationsApi = {
      AndroidImportance: { HIGH: 4, DEFAULT: 3 },
      getPermissionsAsync: async () => ({ granted: true, canAskAgain: true }),
      requestPermissionsAsync: async () => ({ granted: true, canAskAgain: true }),
      getDevicePushTokenAsync: async () => ({ type: 'ios', data: 'apns-joint-token-1' }),
      setNotificationChannelAsync: async () => {},
    };

    const memKv = makeMemoryKv();
    let currentSession: string | undefined = rawSessionToken;

    const pushDeps = {
      kv: memKv,
      notifications: fakeNotifications,
      fetch: appFetch,
      getToken: () => currentSession ?? null,
      baseUrl: 'https://hub.joint.test',
      platform: 'ios',
      randomId: () => 'joint-uuid-1',
      isHydrated: () => true,
      isOnline: () => true,
      isDemo: () => false,
    };

    // 1. Register device push token via real handlePushTokenRequest.
    const reg = await registerPush({ askPermission: true }, pushDeps);
    expect(reg.ok).toBe(true);
    expect(pushTokens).toHaveLength(1);

    // 2. Push the same waiting card twice -> hub deduplicates and fake APNs receives only 1 push.
    const view1 = makeWaitingView('dec-1');
    const sent1 = await notifyWaitingCards(db, env, projectId, view1, { fetch: apnsFetch, now });
    const sent2 = await notifyWaitingCards(db, env, projectId, view1, { fetch: apnsFetch, now: now + 1000 });
    expect(sent1).toBe(1);
    expect(sent2).toBe(0);
    expect(apnsPayloads).toHaveLength(1);

    // Payload routed through extractPushPath yields /request/<id>?card=<cardId>.
    const routed = extractPushPath({
      actionIdentifier: 'expo.modules.notifications.actions.DEFAULT',
      notification: { request: { identifier: 'apns-msg-1', content: { data: apnsPayloads[0] } } },
    });
    const expectedCardId = `${projectId}:plan-joint-1:decision:dec-1`;
    expect(routed).toBe(`/request/plan-joint-1?card=${encodeURIComponent(expectedCardId)}`);

    // 3. signOut() unregisters push token before revoking session -> new waiting card sends 0 pushes.
    await signOut({
      getToken: () => currentSession,
      unregisterPush: (tok?: string) => unregisterPush(tok, pushDeps),
      hubLogout: async () => {
        await hubStore.revokeSession(sessionTokenHash, now + 1500);
      },
      clearSession: () => {
        currentSession = undefined;
      },
      clearBadge: async () => {},
    });

    expect(pushTokens).toHaveLength(0);
    const sentAfterLogout = await notifyWaitingCards(
      db,
      env,
      projectId,
      makeWaitingView('dec-2'),
      { fetch: apnsFetch, now: now + 2000 },
    );
    expect(sentAfterLogout).toBe(0);
    expect(apnsPayloads).toHaveLength(1);
  });
});
