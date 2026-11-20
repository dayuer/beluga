import { describe, expect, it } from 'vitest';
import { StudioAction, StudioReceipt, AppFrame } from '../../../src/studio/protocol.js';
import { ReceiptRes } from './hub-schema';
import {
  buildAcceptDelivery,
  buildApproveChanges,
  buildApproveRelease,
  buildApproveStart,
  buildConfirmUnderstanding,
  buildRemoveDevice,
} from './signed-actions';

const OP = '6f1c2a5e-3b7d-4c8e-9f0a-1b2c3d4e5f60';

function withEnvelope<T extends { kind: string; payload: unknown; rev?: number }>(action: T) {
  return {
    ...action,
    signed: {
      frame: {
        kind: action.kind,
        payload: action.payload,
        ...(action.rev !== undefined ? { rev: action.rev } : {}),
        at: 1700000000001,
        deviceKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      },
      sig: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
    },
  };
}

describe('lib/signed-actions', () => {
  it('constructs all six signed actions that pass StudioAction.parse', () => {
    const built = [
      buildConfirmUnderstanding({ opId: OP, planRef: 'p1', rev: 1 }),
      buildApproveStart({ opId: OP, planRef: 'p1', draftRev: 2 }),
      buildApproveChanges({ opId: OP, planRef: 'p1', draftRev: 3 }),
      buildAcceptDelivery({ opId: OP, planRef: 'p1', milestoneRef: 'm0', draftRev: 4 }),
      buildApproveRelease({ opId: OP, planRef: 'p1', releaseId: 'rel-1', draftRev: 5 }),
      buildRemoveDevice({ opId: OP, deviceId: 'dev-1' }),
    ];

    for (const action of built) {
      const parsed = StudioAction.parse(withEnvelope(action));
      expect(parsed.kind).toBe(action.kind);
    }
  });

  it('parses unregistered-device refusal via both HTTP ReceiptRes and WS AppFrame', () => {
    const receipt = { t: 'receipt' as const, opId: OP, state: 'refused' as const, code: 'unregistered-device' as const };
    expect(ReceiptRes.parse({ receipt })).toEqual({ receipt });
    expect(AppFrame.parse(receipt)).toEqual(receipt);
    expect(StudioReceipt.parse(receipt)).toEqual(receipt);
  });
});
