import { describe, expect, it } from 'vitest';
import { AppFrame, StudioAction, StudioReceipt } from '../src/studio/protocol.js';

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
