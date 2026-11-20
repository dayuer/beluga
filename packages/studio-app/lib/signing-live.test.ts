/// <reference types="node" />
import { randomUUID } from 'node:crypto';
import React from 'react';
import { act, render } from '@testing-library/react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ack, enqueue, take } from '../../../src/net/studio/queue';
import { memoryHub, memoryStudio } from '../../../src/net/studio/store';
import { createDeviceTrustStore } from '../../../src/studio/verify';
import { EnrollRelay } from '../../studio-hub/src/enroll-relay';

/**
 * Enroll → six signed actions pass → an unregistered phone is refused (SS-211).
 * The node side is the real src/studio/verify.ts; the hub side is the real queue and relay, reached
 * through the app's own client (only `fetch` is replaced). The D1-backed enroll route has its own
 * test in packages/studio-hub.
 */
const kv = new Map<string, unknown>();
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
    get: <T,>(k: string) => kv.get(k) as T | undefined,
    set: (k: string, v: unknown) => void kv.set(k, v),
    remove: (k: string) => void kv.delete(k),
  },
}));
vi.mock('./net', () => ({ isOnline: () => true, subscribeOnline: () => () => {} }));
vi.mock('./resume', () => ({ onResume: () => () => {} }));
vi.mock('./session', () => ({ session: { token: () => 'tok-1', clear: vi.fn() } }));

const BASE = 'https://hub.example';
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('signing, end to end through the app client', () => {
  const origFetch = globalThis.fetch;

  beforeEach(() => {
    vi.resetModules();
    kv.clear();
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
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, string>) : {};
      if (url.pathname === '/v1/app/devices/enroll') {
        // The hub relays the frame to the node and passes its answer back; it never sees k.
        const reply = await relay.request(
          { t: 'enroll', reqId: randomUUID(), inviteId: body.inviteId!, deviceId: 'dev_1', pubkey: body.pubkey!, mac: body.mac! },
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
        const deps = { hub, studio, now: Date.now() };
        const queued = await enqueue(body, { studio: st.id, projectId: 'proj-1', customerId: 'c1' }, deps);
        if (!queued.ok) return json(queued.status, { error: queued.error });
        let receipt = queued.receipt;
        for (const item of (await take('d1', deps)).deliver) {
          const action = item.action as { opId: string; planRef?: string };
          const verdict = node.verifySignedAction(item.action as never);
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

    return { k };
  }

  it('enrolls with an invite, the six actions verify, and an unregistered phone is refused with a reason', async () => {
    const { k } = await world();
    const { enrollDevice, parseInvitePayload } = await import('./enrol');
    const { prepareActionForSend } = await import('./send');
    const { hub } = await import('./client');
    const { clearDeviceKey, ensureDeviceKey } = await import('./keys');
    const { useSignedAction } = await import('./use-signed-action');
    const a = await import('./signed-actions');

    const invite = parseInvitePayload(`${BASE}/join/inv-1#k=${k}&n=A1B2C3D4E5F67890`)!;
    const enrolled = await enrollDevice(invite, { baseUrl: BASE, token: 'tok-1' });
    expect(enrolled.ok).toBe(true);

    const drafts = [
      a.buildConfirmUnderstanding({ opId: randomUUID(), planRef: 'p1', rev: 5 }),
      a.buildApproveStart({ opId: randomUUID(), planRef: 'p1', draftRev: 5 }),
      a.buildApproveChanges({ opId: randomUUID(), planRef: 'p1', draftRev: 5 }),
      a.buildAcceptDelivery({ opId: randomUUID(), planRef: 'p1', milestoneRef: 'm0', draftRev: 5 }),
      a.buildApproveRelease({ opId: randomUUID(), planRef: 'p1', releaseId: 'rel-1', draftRev: 5 }),
      a.buildRemoveDevice({ opId: randomUUID(), deviceId: 'dev_other' }),
    ];
    for (const draft of drafts) {
      const sent = await hub.send('proj-1', await prepareActionForSend(draft));
      expect(sent.ok, draft.kind).toBe(true);
      if (sent.ok) expect(sent.value.state, `${draft.kind} ${sent.value.code ?? ''}`).toBe('done');
    }

    // A different, never-enrolled key signs the next action, through the real hook.
    await clearDeviceKey();
    seedCounter = 100;
    await ensureDeviceKey();
    let api!: ReturnType<typeof useSignedAction>;
    function Harness() {
      api = useSignedAction('proj-1', 'pending:gate:proj-1:p1');
      return null;
    }
    await render(React.createElement(Harness));
    const onDone = vi.fn();
    await act(async () => {
      await api.send((opId) => a.buildApproveStart({ opId, planRef: 'p1', draftRev: 5 }), { onDone });
    });
    expect(api.buttonState).toBe('idle');
    expect(api.error).toContain('还没登记');
    expect(onDone).not.toHaveBeenCalled();
  });
});
