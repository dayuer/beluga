import { createHmac, generateKeyPairSync, sign as nodeSign, type KeyObject } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ack, enqueue, take } from '../src/net/studio/queue.js';
import { memoryHub, memoryStudio } from '../src/net/studio/store.js';
import { AppFrame, StudioAction, StudioReceipt } from '../src/studio/protocol.js';
import { canonicalJson, createDeviceTrustStore } from '../src/studio/verify.js';

const OP = '6f1c2a5e-3b7d-4c8e-9f0a-1b2c3d4e5f60';

const envelope = (kind: string, payload: unknown, rev?: number) => ({
  frame: {
    kind,
    payload,
    ...(rev !== undefined ? { rev } : {}),
    at: 1700000000000,
    deviceKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  },
  sig: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
});

describe('S2 signed StudioAction & refusal codes', () => {
  it('parses all five S2 signed action kinds (six constructors)', () => {
    const actions = [
      { t: 'action', opId: OP, kind: 'request.confirm', planRef: 'p1', payload: {}, rev: 1, signed: envelope('request.confirm', {}, 1) },
      {
        t: 'action',
        opId: OP,
        kind: 'gate.answer',
        planRef: 'p1',
        payload: { gate: 'start', approved: true, draftRev: 2 },
        rev: 2,
        signed: envelope('gate.answer', { gate: 'start', approved: true, draftRev: 2 }, 2),
      },
      {
        t: 'action',
        opId: OP,
        kind: 'gate.answer',
        planRef: 'p1',
        payload: { gate: 'changes', approved: true, draftRev: 3 },
        rev: 3,
        signed: envelope('gate.answer', { gate: 'changes', approved: true, draftRev: 3 }, 3),
      },
      {
        t: 'action',
        opId: OP,
        kind: 'delivery.accept',
        planRef: 'p1',
        payload: { milestoneRef: 'm0', draftRev: 4 },
        rev: 4,
        signed: envelope('delivery.accept', { milestoneRef: 'm0', draftRev: 4 }, 4),
      },
      {
        t: 'action',
        opId: OP,
        kind: 'release.approve',
        planRef: 'p1',
        payload: { releaseId: 'rel-1', draftRev: 5 },
        rev: 5,
        signed: envelope('release.approve', { releaseId: 'rel-1', draftRev: 5 }, 5),
      },
      {
        t: 'action',
        opId: OP,
        kind: 'device.remove',
        payload: { deviceId: 'dev-1' },
        signed: envelope('device.remove', { deviceId: 'dev-1' }),
      },
    ];

    for (const action of actions) {
      expect(StudioAction.safeParse(action).success, action.kind).toBe(true);
    }
  });

  it('rejects signed actions missing signed envelope', () => {
    expect(
      StudioAction.safeParse({ t: 'action', opId: OP, kind: 'request.confirm', planRef: 'p1', payload: {}, rev: 1 }).success,
    ).toBe(false);
  });

  it('parses unregistered-device, bad-signature, and stale-clock receipts via StudioReceipt and AppFrame', () => {
    for (const code of ['unregistered-device', 'bad-signature', 'stale-clock'] as const) {
      const receipt = { t: 'receipt', opId: OP, state: 'refused', code };
      expect(StudioReceipt.parse(receipt)).toEqual(receipt);
      expect(AppFrame.parse(receipt)).toEqual(receipt);
    }
  });
});

// --- Node side: verify.ts (node:crypto only) and the hub queue ---

const kBytes = Buffer.alloc(32, 9);
const phone = generateKeyPairSync('ed25519');
const rawPub = phone.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32);
const pubB64 = rawPub.toString('base64url');
const goodMac = createHmac('sha256', kBytes).update(rawPub).digest('base64url');

const signedBy = (priv: KeyObject, deviceKey: string, kind: string, payload: unknown, rev: number | undefined, at: number) => {
  const frame = { kind, payload, ...(rev !== undefined ? { rev } : {}), at, deviceKey };
  return { kind, payload, ...(rev !== undefined ? { rev } : {}), signed: { frame, sig: nodeSign(null, Buffer.from(canonicalJson(frame)), priv).toString('base64url') } };
};
const signedByPhone = (kind: string, payload: unknown, rev: number | undefined, at: number) => signedBy(phone.privateKey, pubB64, kind, payload, rev, at);

describe('node-side device trust (src/studio/verify.ts)', () => {
  const enrolled = () => {
    const node = createDeviceTrustStore({ nodeFingerprint: 'A1B2C3D4E5F67890' });
    node.addInvite('inv-1', kBytes.toString('base64url'));
    expect(node.enrollFrame({ inviteId: 'inv-1', pubkey: pubB64, mac: goodMac, deviceId: 'dev_1' })).toEqual({ ok: true, fingerprint: 'A1B2C3D4E5F67890' });
    return node;
  };

  it('enrollWithInvite and enrollFrame check the mac; an invite works once', () => {
    const node = createDeviceTrustStore();
    expect(node.enrollWithInvite({ k: kBytes.toString('base64url'), pubkey: pubB64, mac: 'nope' })).toBe(false);
    expect(node.enrollWithInvite({ k: kBytes.toString('base64url'), pubkey: pubB64, mac: goodMac })).toBe(true);
    const n2 = createDeviceTrustStore();
    n2.addInvite('inv-1', kBytes.toString('base64url'));
    expect(n2.enrollFrame({ inviteId: 'inv-x', pubkey: pubB64, mac: goodMac })).toEqual({ ok: false, code: 'unknown-invite' });
    expect(n2.enrollFrame({ inviteId: 'inv-1', pubkey: pubB64, mac: 'bad' })).toEqual({ ok: false, code: 'bad-mac' });
    expect(n2.enrollFrame({ inviteId: 'inv-1', pubkey: pubB64, mac: goodMac }).ok).toBe(true);
    expect(n2.enrollFrame({ inviteId: 'inv-1', pubkey: pubB64, mac: goodMac })).toEqual({ ok: false, code: 'invite-used' });
  });

  it('accepts all five signed kinds and refuses unregistered, bad signature and a clock that goes back', () => {
    const node = enrolled();
    const actions: Array<[string, unknown, number | undefined]> = [
      ['request.confirm', {}, 1],
      ['gate.answer', { gate: 'start', approved: true, draftRev: 1 }, 1],
      ['gate.answer', { gate: 'changes', approved: true, draftRev: 1 }, 1],
      ['delivery.accept', { milestoneRef: 'm0', draftRev: 1 }, 1],
      ['release.approve', { releaseId: 'r1' }, undefined],
    ];
    actions.forEach(([kind, payload, rev], i) => expect(node.verifySignedAction(signedByPhone(kind, payload, rev, 100 + i)), kind).toEqual({ ok: true }));

    const other = generateKeyPairSync('ed25519');
    const otherKey = other.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64url');
    expect(node.verifySignedAction(signedBy(other.privateKey, otherKey, 'request.confirm', {}, 1, 500))).toEqual({ ok: false, code: 'unregistered-device' });

    const tampered = signedByPhone('request.confirm', {}, 1, 600);
    tampered.signed.sig = Buffer.alloc(64).toString('base64url');
    expect(node.verifySignedAction(tampered)).toEqual({ ok: false, code: 'bad-signature' });
    expect(node.verifySignedAction(signedByPhone('request.confirm', {}, 1, 50))).toEqual({ ok: false, code: 'stale-clock' });
  });

  it('a verified device.remove takes the device off the trust list', () => {
    const node = enrolled();
    expect(node.verifySignedAction(signedByPhone('device.remove', { deviceId: 'dev_1' }, undefined, 700))).toEqual({ ok: true });
    expect(node.isEnrolled(pubB64)).toBe(false);
    expect(node.verifySignedAction(signedByPhone('request.confirm', {}, 1, 701))).toEqual({ ok: false, code: 'unregistered-device' });
  });
});

describe('hub queue carries a signed action untouched and returns the node refusal', () => {
  it('enqueue → take → ack', async () => {
    const hub = memoryHub();
    const studio = memoryStudio();
    const st = await hub.createStudio({ name: 'S', now: 1000 });
    await hub.createCustomer({ id: 'c1', email: 'c@example.com', name: 'C', now: 1000 });
    await hub.createProject({ id: 'p1', studioId: st.id, name: 'App', now: 1000 });
    await hub.addMember('p1', 'c1', 1000);
    await hub.createDaemon({ id: 'd1', studioId: st.id, publicKey: '00'.repeat(32), name: 'Mac', now: 1000 });
    await hub.replaceDaemonProjects('d1', [{ id: 'dp1', name: 'api' }], 1000);
    await hub.bindProject({ projectId: 'p1', daemonId: 'd1', daemonProjectId: 'dp1', now: 1000 });
    await studio.putConn({ daemonId: 'd1', lastAt: 999, connectedAt: 1000, lastSeenAt: 1000, hello: true, synced: true });
    await studio.putView({
      projectId: 'p1', planRef: 'plan1', rev: 3, updatedAt: 1000,
      viewJson: JSON.stringify({ planRef: 'plan1', draftRev: 3, title: 'T', goal: 'g', stage: 'awaiting-start', waitingOn: 'customer', headline: 'h', progress: { done: 0, total: 1 }, milestones: [], decisions: [], turns: [], typing: false, moreTurns: false, activity: [] }),
    });
    const node = createDeviceTrustStore();
    const signedAction = { t: 'action' as const, opId: OP, planRef: 'plan1', ...signedByPhone('request.confirm', {}, 3, 100) };
    const deps = { hub, studio, now: 2000 };

    const queued = await enqueue(signedAction, { studio: st.id, projectId: 'p1', customerId: 'c1' }, deps);
    expect(queued.ok && queued.receipt.state).toBe('queued');
    const { deliver } = await take('d1', deps);
    expect(deliver).toHaveLength(1);
    expect(deliver[0]!.action).toEqual(signedAction);

    const verdict = node.verifySignedAction(deliver[0]!.action as never);
    expect(verdict).toEqual({ ok: false, code: 'unregistered-device' });
    const acked = await ack('d1', { t: 'receipt', opId: OP, planRef: 'plan1', state: 'refused', code: 'unregistered-device' }, deps);
    expect(acked.ok).toBe(true);
  });
});
