import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import http from 'node:http';
import Module from 'node:module';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ack, enqueue, take } from '../../src/net/studio/queue.js';
import { memoryHub, memoryStudio, sha256Hex } from '../../src/net/studio/store.js';
import { computeNodeFingerprint, createDeviceTrustStore } from '../../src/studio/verify.js';
import { handleDeviceEnrollRequest, type EnrollStore, type InviteRecord } from '../../packages/studio-hub/src/devices-enroll.js';
import type { Env } from '../../packages/studio-hub/src/hub.js';

(globalThis as { __DEV__?: boolean }).__DEV__ = false;

const { expoCryptoStub, expoSecureStub, expoLocStub, expoFsStub, rnStub } = vi.hoisted(() => {
  const { randomBytes: rb } = process.getBuiltinModule('node:crypto') as typeof import('node:crypto');
  const mod = process.getBuiltinModule('node:module') as unknown as {
    _load: (req: string, parent: unknown, isMain: boolean) => unknown;
  };
  const mem = new Map<string, string>();
  const state = { fill: 1, mem };
  (globalThis as Record<string, unknown>).__studioLiveState = state;

  const cryptoStub = {
    getRandomBytes: (n: number) => {
      const buf = rb(n);
      buf[0] = state.fill;
      return new Uint8Array(buf);
    },
  };
  const secureStub = {
    AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 2,
    getItemAsync: async (k: string) => state.mem.get(k) ?? null,
    setItemAsync: async (k: string, v: string) => {
      state.mem.set(k, v);
    },
    deleteItemAsync: async (k: string) => {
      state.mem.delete(k);
    },
  };
  const locStub = { getLocales: () => [{ languageCode: 'zh' }] };
  const fsStub = {
    Paths: { document: '/tmp' },
    File: class {
      exists = false;
      text = async () => '{}';
      create() {}
      write() {}
    },
  };
  const rn = {
    AppState: { addEventListener: () => ({ remove() {} }) },
    Platform: { OS: 'ios', select: (m: Record<string, unknown>) => m.ios ?? m.default },
  };

  const origLoad = mod._load.bind(mod);
  mod._load = (request: string, parent: unknown, isMain: boolean) => {
    if (request === 'expo-crypto' || request.includes('/node_modules/expo-crypto/')) return cryptoStub;
    if (request === 'expo-secure-store' || request.includes('/node_modules/expo-secure-store/')) return secureStub;
    if (request === 'expo-localization' || request.includes('/node_modules/expo-localization/')) return locStub;
    if (request === 'expo-file-system' || request.includes('/node_modules/expo-file-system/')) return fsStub;
    if (request === 'expo' || request.startsWith('expo/') || request.includes('/node_modules/expo/')) return {};
    if (request === 'react-native' || request.startsWith('react-native/') || request.includes('/node_modules/react-native/')) return rn;
    return origLoad(request, parent, isMain);
  };

  return {
    expoCryptoStub: cryptoStub,
    expoSecureStub: secureStub,
    expoLocStub: locStub,
    expoFsStub: fsStub,
    rnStub: rn,
  };
});

const liveState = (globalThis as Record<string, unknown>).__studioLiveState as { fill: number; mem: Map<string, string> };

vi.mock('expo-crypto', () => expoCryptoStub);
vi.mock('../../packages/studio-app/node_modules/expo-crypto/build/Crypto.js', () => expoCryptoStub);
vi.mock('../../packages/studio-app/lib/secure', () => ({
  secure: {
    get: async <T,>(k: string) => {
      const raw = liveState.mem.get(k);
      return raw ? (JSON.parse(raw) as T) : undefined;
    },
    set: async (k: string, v: unknown) => {
      liveState.mem.set(k, JSON.stringify(v));
    },
    remove: async (k: string) => {
      liveState.mem.delete(k);
    },
  },
}));
vi.mock('../../packages/studio-app/lib/kv', () => {
  const kvMap = new Map<string, unknown>();
  return {
    kv: {
      get: <T,>(k: string) => kvMap.get(k) as T | undefined,
      set: (k: string, v: unknown) => {
        kvMap.set(k, v);
      },
      remove: (k: string) => {
        kvMap.delete(k);
      },
    },
  };
});
vi.mock('../../packages/studio-app/lib/strings', () => ({
  detectLang: () => 'zh',
  t: (_lang: string, k: string) => k,
}));
vi.mock('expo-secure-store', () => expoSecureStub);
vi.mock('expo-localization', () => expoLocStub);
vi.mock('expo-file-system', () => expoFsStub);
vi.mock('react-native', () => rnStub);
vi.mock('../../packages/studio-app/node_modules/react-native/index.js', () => rnStub);

vi.mock('../../packages/studio-app/lib/net', () => ({
  isOnline: () => true,
  subscribeOnline: () => () => {},
}));

vi.mock('../../packages/studio-app/lib/resume', () => ({
  onResume: () => () => {},
}));

vi.mock('../../packages/studio-app/lib/session', () => ({
  session: { token: () => 'live-session-token', clear: () => {} },
}));

describe('studio-app signing live (local hub + fake node)', () => {
  let server: http.Server;
  let baseUrl = '';
  const token = 'live-session-token';
  const kBytes = Buffer.alloc(32, 0x42);
  const k = kBytes.toString('base64url');
  const { publicKey: nodePub } = generateKeyPairSync('ed25519');
  const nodeFingerprint = computeNodeFingerprint(nodePub.export({ type: 'spki', format: 'der' }));

  const trust = createDeviceTrustStore();
  const hub = memoryHub();
  const studio = memoryStudio();
  let studioId = '';

  const invites = new Map<string, InviteRecord>([
    ['inv-live-1', { id: 'inv-live-1', k, nodeFingerprint, expiresAt: Date.now() + 60_000 }],
  ]);

  const enrollStore: EnrollStore = {
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
      trust.enroll(record.pubkey);
    },
  };

  beforeAll(async () => {
    const tokenHash = await sha256Hex(token);
    const st = await hub.createStudio({ name: 'Live Studio', now: 1000 });
    studioId = st.id;
    await hub.createCustomer({ id: 'cust-live', email: 'c@example.com', name: 'Customer', now: 1000 });
    await hub.createProject({ id: 'proj-1', studioId, name: 'App', now: 1000 });
    await hub.addMember('proj-1', 'cust-live', 1000);
    await hub.createDaemon({ id: 'd-live', studioId, publicKey: '00'.repeat(32), name: 'FakeNode', now: 1000 });
    await hub.replaceDaemonProjects('d-live', [{ id: 'dp-1', name: 'api' }], 1000);
    await hub.bindProject({ projectId: 'proj-1', daemonId: 'd-live', daemonProjectId: 'dp-1', now: 1000 });
    await studio.putConn({ daemonId: 'd-live', lastAt: 999, connectedAt: 1000, lastSeenAt: 1000, hello: true, synced: true });
    await studio.putView({
      projectId: 'proj-1',
      planRef: 'p1',
      rev: 5,
      viewJson: JSON.stringify({
        planRef: 'p1',
        draftRev: 5,
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

    const mockD1 = {
      prepare(sql: string) {
        let args: unknown[] = [];
        const stmt = {
          bind(...v: unknown[]) {
            args = v;
            return stmt;
          },
          async first() {
            if (sql.includes('FROM sessions') && String(args[0]) === tokenHash) {
              return {
                token_hash: tokenHash,
                customer_id: 'cust-live',
                created_at: 1000,
                expires_at: Date.now() + 3600_000,
                revoked_at: null,
              };
            }
            if (sql.includes('FROM customers') && String(args[0]) === 'cust-live') {
              return { id: 'cust-live', email: 'c@example.com', name: 'Customer', status: 'active', created_at: 1000 };
            }
            return null;
          },
          async all() {
            return { results: [] };
          },
          async run() {
            return { meta: { changes: 0 } };
          },
        };
        return stmt;
      },
    } as unknown as D1Database;

    const { D1HubStore } = await import('../../packages/studio-hub/src/d1.js');
    const d1Hub = new D1HubStore(mockD1);

    server = http.createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const rawBody = Buffer.concat(chunks).toString('utf8');

      if (url.pathname === '/v1/app/devices/enroll' && req.method === 'POST') {
        const webReq = new Request(`http://127.0.0.1${url.pathname}`, {
          method: 'POST',
          headers: req.headers as Record<string, string>,
          body: rawBody,
        });
        const reply = await handleDeviceEnrollRequest(
          webReq,
          { DB: mockD1, HUB_ORIGIN: 'http://127.0.0.1' } as unknown as Env,
          d1Hub,
          Date.now(),
          enrollStore,
        );
        const text = await reply!.text();
        res.writeHead(reply!.status, { 'content-type': 'application/json' });
        res.end(text);
        return;
      }

      if (url.pathname === '/v1/app/projects/proj-1/actions' && req.method === 'POST') {
        const frame = JSON.parse(rawBody) as { opId: string; planRef?: string };
        const sub = await enqueue(frame, { studio: studioId, projectId: 'proj-1', customerId: 'cust-live' }, { hub, studio, now: Date.now() });
        if (!sub.ok) {
          res.writeHead(sub.status, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: sub.error }));
          return;
        }
        const taken = await take('d-live', { hub, studio, now: Date.now() });
        let finalReceipt = sub.receipt;
        for (const item of taken.deliver) {
          const verdict = trust.verifySignedAction(item.action);
          const daemonReceipt = verdict.ok
            ? { t: 'receipt' as const, opId: item.action.opId, state: 'done' as const, ...(item.action.planRef ? { planRef: item.action.planRef } : {}) }
            : { t: 'receipt' as const, opId: item.action.opId, state: 'refused' as const, code: verdict.code, ...(item.action.planRef ? { planRef: item.action.planRef } : {}) };
          await ack('d-live', daemonReceipt, { hub, studio, now: Date.now() });
          if (item.action.opId === frame.opId) finalReceipt = daemonReceipt;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ receipt: finalReceipt }));
        return;
      }

      res.writeHead(404);
      res.end();
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          baseUrl = `http://127.0.0.1:${addr.port}`;
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    vi.resetModules();
    liveState.mem.clear();
    liveState.fill = 1;
  });

  it('enrolls a phone, verifies all 6 signed actions on the fake node, and refuses an unregistered phone', async () => {
    const { enrollDevice, parseInvitePayload } = await import('../../packages/studio-app/lib/enrol.js');
    const { createHub } = await import('../../packages/studio-app/lib/hub.js');
    const { prepareActionForSend } = await import('../../packages/studio-app/lib/send.js');
    const { clearDeviceKey, ensureDeviceKey } = await import('../../packages/studio-app/lib/keys.js');
    const { mapSubmitToButtonState } = await import('../../packages/studio-app/lib/use-signed-action.js');
    const { signRefusalMessage } = await import('../../packages/studio-app/lib/strings/sign.js');
    const {
      buildAcceptDelivery,
      buildApproveChanges,
      buildApproveRelease,
      buildApproveStart,
      buildConfirmUnderstanding,
      buildRemoveDevice,
    } = await import('../../packages/studio-app/lib/signed-actions.js');

    // 1. 解析邀请链接并登记第一台手机
    const invite = parseInvitePayload(`https://hub.example/join/inv-live-1#k=${k}&n=${nodeFingerprint}`)!;
    const enrollRes = await enrollDevice(invite, { baseUrl, token, fetchFn: fetch });
    expect(enrollRes.ok).toBe(true);

    // 2. 用真实 hub.send 依次发送六个签名动作，全部验签通过
    const appHub = createHub({ base: baseUrl, session: () => token, fetch });
    const drafts = [
      buildConfirmUnderstanding({ opId: randomUUID(), planRef: 'p1', rev: 5 }),
      buildApproveStart({ opId: randomUUID(), planRef: 'p1', draftRev: 5 }),
      buildApproveChanges({ opId: randomUUID(), planRef: 'p1', draftRev: 5 }),
      buildAcceptDelivery({ opId: randomUUID(), planRef: 'p1', milestoneRef: 'm0', draftRev: 5 }),
      buildApproveRelease({ opId: randomUUID(), planRef: 'p1', releaseId: 'rel-1', draftRev: 5 }),
      buildRemoveDevice({ opId: randomUUID(), deviceId: 'dev-other' }),
    ];

    for (const draft of drafts) {
      const prepared = await prepareActionForSend(draft);
      const sent = await appHub.send('proj-1', prepared);
      expect(sent.ok, draft.kind).toBe(true);
      if (sent.ok) expect(sent.value.state, draft.kind).toBe('done');
    }

    // 3. 换成未登记的另一把设备密钥再发，假节点拒签并回到 idle + 原因
    await clearDeviceKey();
    liveState.fill = 2;
    await ensureDeviceKey();
    const unregDraft = buildApproveStart({ opId: randomUUID(), planRef: 'p1', draftRev: 5 });
    const unregPrepared = await prepareActionForSend(unregDraft);
    const unregRes = await appHub.send('proj-1', unregPrepared);
    expect(unregRes.ok).toBe(true);
    if (unregRes.ok) {
      expect(unregRes.value.state).toBe('refused');
      expect(unregRes.value.code).toBe('unregistered-device');
      const btnState = mapSubmitToButtonState({ phase: 'refused', opId: unregDraft.opId, code: unregRes.value.code });
      expect(btnState).toBe('idle');
      expect(signRefusalMessage('zh', unregRes.value.code!)).toContain('还没登记');
    }
  });
});
