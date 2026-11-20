/// <reference types="node" />
import { createPublicKey, generateKeyPairSync, randomUUID, type KeyObject } from 'node:crypto';
import React from 'react';
import { act, render } from '@testing-library/react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ack, enqueue, take } from '../../../src/net/studio/queue';
import { memoryHub, memoryStudio } from '../../../src/net/studio/store';
import { secretAad } from '../../../src/studio/protocol';
import { createDeviceTrustStore, openSealedBox } from '../../../src/studio/verify';
import { EnrollRelay } from '../../studio-hub/src/enroll-relay';

/**
 * M13 / SS-229 联调：一个已登记的手机填密钥、改项目设置，本机中台 + 假节点全链路（SS-226/227/228）。
 * 节点侧是真正的 `src/studio/verify.ts`，中台是真正的 queue 与 store，App 只替换 `fetch`。
 * 断言：验签通过、假节点解封出原值、设置生效、中台收到的字节没有明文、没登记的手机被拒并说明原因。
 */
const kvStore = new Map<string, unknown>();
const secureMem = new Map<string, unknown>();
let seedCounter = 0;

vi.mock('expo-crypto', () => ({
  getRandomBytes: (n: number) => new Uint8Array(n).fill((seedCounter % 250) + 1),
}));
vi.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'zh' }] }));
vi.mock('./secure', () => ({
  secure: {
    get: async <T,>(k: string) => secureMem.get(k) as T | undefined,
    set: async (k: string, v: unknown) => void secureMem.set(k, v),
    remove: async (k: string) => void secureMem.delete(k),
  },
}));
vi.mock('./kv', () => ({
  kv: {
    get: <T,>(k: string) => kvStore.get(k) as T | undefined,
    set: (k: string, v: unknown) => void kvStore.set(k, v),
    remove: (k: string) => void kvStore.delete(k),
  },
}));
vi.mock('./net', () => ({ isOnline: () => true, subscribeOnline: () => () => {} }));
vi.mock('./resume', () => ({ onResume: () => () => {} }));
vi.mock('./session', () => ({ session: { token: () => 'tok-1', clear: vi.fn() } }));

const BASE = 'https://hub.example';
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const rawPublic = (key: KeyObject): string =>
  (key.type === 'public' ? key : createPublicKey(key)).export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64url');

describe('phone secrets and project settings, end to end through the app client', () => {
  const origFetch = globalThis.fetch;

  beforeEach(() => {
    vi.resetModules();
    kvStore.clear();
    secureMem.clear();
    seedCounter = 0;
    process.env.EXPO_PUBLIC_HUB_URL = BASE;
    delete process.env.EXPO_PUBLIC_DEMO;
  });
  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  async function world() {
    const node = createDeviceTrustStore({ nodeFingerprint: 'A1B2C3D4E5F67890' });
    const k = Buffer.alloc(32, 7).toString('base64url');
    node.addInvite('inv-1', k);
    const relay = new EnrollRelay();

    // 假节点自己的 X25519 封装密钥（SS-226）：手机把值封给它，只有它解得开。
    const sealPair = generateKeyPairSync('x25519');
    const sealPublic = rawPublic(sealPair.publicKey);
    /** 节点真正解开的值与收到的设置，供断言。 */
    const opened: string[] = [];
    const settings: unknown[] = [];
    /** 中台收到的原始字节（每次动作的请求体）。 */
    const hubBytes: string[] = [];
    const verified: string[] = [];

    const hub = memoryHub();
    const studio = memoryStudio();
    const st = await hub.createStudio({ name: 'S', now: 1000 });
    await hub.createCustomer({ id: 'c1', email: 'c@example.com', name: 'C', now: 1000 });
    await hub.createProject({ id: 'proj-1', studioId: st.id, name: 'App', now: 1000 });
    await hub.addMember('proj-1', 'c1', 1000);
    await hub.createDaemon({ id: 'd1', studioId: st.id, publicKey: '00'.repeat(32), name: 'Mac', now: 1000 });
    await hub.replaceDaemonProjects('d1', [{ id: 'dp1', name: 'api' }], 1000);
    await hub.bindProject({ projectId: 'proj-1', daemonId: 'd1', daemonProjectId: 'dp1', now: 1000 });
    await studio.putConn({ daemonId: 'd1', lastAt: 999, connectedAt: 1000, lastSeenAt: 1000, hello: true, synced: true });
    await studio.putView({
      projectId: 'proj-1', planRef: 'p1', rev: 5, updatedAt: 1000,
      viewJson: JSON.stringify({ planRef: 'p1', draftRev: 5, title: 'T', goal: 'g', stage: 'awaiting-start', waitingOn: 'customer', headline: 'h', progress: { done: 0, total: 1 }, milestones: [], decisions: [], turns: [], typing: false, moreTurns: false, activity: [] }),
    });

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      if (url.pathname === '/v1/app/devices/enroll') {
        const reply = await relay.request(
          { t: 'enroll', reqId: randomUUID(), inviteId: body.inviteId as string, deviceId: 'dev_1', pubkey: body.pubkey as string, mac: body.mac as string },
          (frame) => {
            const result = node.enrollFrame(frame);
            queueMicrotask(() => relay.settle(JSON.stringify({ t: 'enroll-result', reqId: frame.reqId, ...(result.ok ? { ok: true, fingerprint: result.fingerprint } : { ok: false, code: result.code }) })));
            return true;
          },
          500,
        );
        return reply.status === 'ok' ? json(200, { ok: true, fingerprint: reply.fingerprint }) : json(403, { error: 'refused', code: reply.status === 'refused' ? reply.code : reply.status });
      }
      if (url.pathname === '/v1/app/projects/proj-1/actions') {
        hubBytes.push(String(init?.body ?? ''));
        const deps = { hub, studio, now: Date.now() };
        const queued = await enqueue(body, { studio: st.id, projectId: 'proj-1', customerId: 'c1' }, deps);
        if (!queued.ok) return json(queued.status, { error: queued.error });
        let receipt = queued.receipt;
        for (const item of (await take('d1', deps)).deliver) {
          const action = item.action as { opId: string; kind: string; planRef?: string; payload: Record<string, unknown> };
          const verdict = node.verifySignedAction(item.action as never);
          if (verdict.ok) {
            verified.push(action.kind);
            if (action.kind === 'secret.set') {
              const p = action.payload;
              const plain = openSealedBox(p.sealed as never, sealPublic, sealPair.privateKey, secretAad(String(p.projectId), String(p.envId), String(p.name)));
              if (plain) opened.push(plain.toString('utf8'));
              else verified.push('secret.set:unsealed-failed');
            } else if (action.kind === 'settings.update') {
              settings.push(action.payload.settings);
            }
          }
          const planRef = action.planRef ? { planRef: action.planRef } : {};
          const reply = verdict.ok
            ? { t: 'receipt' as const, opId: action.opId, state: 'done' as const, ...planRef }
            : { t: 'receipt' as const, opId: action.opId, state: 'refused' as const, code: verdict.code, ...planRef };
          await ack('d1', reply, deps);
          if (action.opId === body.opId) receipt = reply;
        }
        return json(200, { receipt });
      }
      return json(404, { error: 'not-found' });
    }) as typeof fetch;

    return { k, sealPublic, opened, settings, hubBytes, verified };
  }

  it('enrolls, sets a sealed secret and a project setting, and refuses an unregistered phone with a reason', async () => {
    const w = await world();
    const { enrollDevice, parseInvitePayload } = await import('./enrol');
    const { prepareActionForSend } = await import('./send');
    const { hub } = await import('./client');
    const { clearDeviceKey, ensureDeviceKey } = await import('./keys');
    const { buildSecretSet, buildUpdateSettings } = await import('./signed-actions');
    const { useSignedAction } = await import('./use-signed-action');

    const invite = parseInvitePayload(`${BASE}/join/inv-1#k=${w.k}&n=A1B2C3D4E5F67890`)!;
    expect((await enrollDevice(invite, { baseUrl: BASE, token: 'tok-1' })).ok).toBe(true);

    const plaintext = 'sk_live_51N7_phone_value';
    const secret = buildSecretSet({
      opId: randomUUID(),
      projectId: 'proj-1',
      envId: 'test',
      name: 'STRIPE_SECRET_KEY',
      purpose: '收款的密钥',
      value: plaintext,
      nodeSealKey: w.sealPublic,
    });
    const secretSent = await hub.send('proj-1', await prepareActionForSend(secret));
    expect(secretSent.ok).toBe(true);
    if (secretSent.ok) expect(secretSent.value.state).toBe('done');

    const settings = buildUpdateSettings({
      opId: randomUUID(),
      projectId: 'proj-1',
      delivery: 'repo',
      repoUrl: 'https://github.com/me/app',
    });
    const settingsSent = await hub.send('proj-1', await prepareActionForSend(settings));
    expect(settingsSent.ok).toBe(true);
    if (settingsSent.ok) expect(settingsSent.value.state).toBe('done');

    // 假节点验签通过、解封出原值、设置生效。
    expect(w.verified).toEqual(['secret.set', 'settings.update']);
    expect(w.opened).toEqual([plaintext]);
    expect(w.settings).toEqual([{ delivery: 'repo', repoUrl: 'https://github.com/me/app' }]);

    // 中台收到的字节与本机缓存的签名动作里都没有明文。
    for (const bytes of w.hubBytes) expect(bytes).not.toContain(plaintext);
    expect(JSON.stringify([...kvStore.entries()])).not.toContain(plaintext);

    // 换一把没登记的密钥：经真实的 hook 发，回到 idle 并写清原因。
    await clearDeviceKey();
    seedCounter = 100;
    await ensureDeviceKey();
    let api!: ReturnType<typeof useSignedAction>;
    function Harness() {
      api = useSignedAction('proj-1', 'pending:secret:proj-1:test:STRIPE_SECRET_KEY');
      return null;
    }
    await render(React.createElement(Harness));
    const onDone = vi.fn();
    await act(async () => {
      await api.send(
        (opId) =>
          buildSecretSet({
            opId,
            projectId: 'proj-1',
            envId: 'test',
            name: 'STRIPE_SECRET_KEY',
            purpose: '收款的密钥',
            value: 'sk_live_unregistered_value',
            nodeSealKey: w.sealPublic,
          }),
        { onDone },
      );
    });
    expect(api.buttonState).toBe('idle');
    expect(api.error).toContain('还没登记');
    expect(onDone).not.toHaveBeenCalled();
    expect(w.opened).toEqual([plaintext]);
    for (const bytes of w.hubBytes) expect(bytes).not.toContain('sk_live_unregistered_value');
  });
});
