/// <reference types="node" />
import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { SECRET_MAX_BYTES, SECRET_SEAL_LABEL, secretAad, StudioAction, StudioReceipt, AppFrame } from '../../../src/studio/protocol.js';
import { openSealedBox } from '../../../src/studio/verify';
import { ReceiptRes } from './hub-schema';
import {
  buildAcceptDelivery,
  buildApproveChanges,
  buildApproveRelease,
  buildApproveStart,
  buildConfirmUnderstanding,
  buildRemoveDevice,
  buildSecretSet,
  buildUpdateSettings,
} from './signed-actions';

// 封装用到的随机数与本地存储：这里只要确定、不碰原生模块。
let randomCounter = 0;
vi.mock('expo-crypto', () => ({
  getRandomBytes: (n: number) => {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i += 1) out[i] = (randomCounter++ % 251) + 1;
    return out;
  },
}));
vi.mock('./kv', () => ({ kv: { get: () => undefined, set: () => {}, remove: () => {} } }));
vi.mock('./secure', () => ({ secure: { get: async () => undefined, set: async () => {}, remove: async () => {} } }));

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

describe('M13 secret.set / settings.update builders', () => {
  const nodeSealKey = () => {
    const pair = generateKeyPairSync('x25519');
    const publicKey = pair.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64url');
    return { pair, publicKey };
  };

  it('seals the value for the node — it opens it, and the plaintext is not in the action', () => {
    const { pair, publicKey } = nodeSealKey();
    const value = 'sk_live_app_side_value';
    const draft = buildSecretSet({
      opId: OP,
      projectId: 'proj-1',
      envId: 'test',
      name: 'STRIPE_SECRET_KEY',
      purpose: '收款的密钥',
      value,
      nodeSealKey: publicKey,
    });

    expect(StudioAction.parse(withEnvelope(draft)).kind).toBe('secret.set');
    const opened = openSealedBox(draft.payload.sealed, publicKey, pair.privateKey, secretAad('proj-1', 'test', 'STRIPE_SECRET_KEY'));
    expect(opened?.toString('utf8')).toBe(value);
    for (const wire of [JSON.stringify(draft), JSON.stringify(withEnvelope(draft))]) {
      expect(wire).not.toContain(value);
      expect(wire).not.toContain(SECRET_SEAL_LABEL + ':');
    }
  });

  it('refuses an empty or oversized value before sealing', () => {
    const { publicKey } = nodeSealKey();
    const base = { opId: OP, projectId: 'proj-1', envId: 'test', name: 'API_TOKEN', purpose: '接口', nodeSealKey: publicKey };
    expect(() => buildSecretSet({ ...base, value: '' })).toThrow();
    expect(() => buildSecretSet({ ...base, value: 'x'.repeat(SECRET_MAX_BYTES + 1) })).toThrow();
  });

  it('builds settings.update with only the whitelisted fields', () => {
    const draft = buildUpdateSettings({ opId: OP, projectId: 'proj-1', delivery: 'repo', repoUrl: 'https://github.com/me/app' });
    expect(StudioAction.parse(withEnvelope(draft)).kind).toBe('settings.update');
    expect(draft.payload).toEqual({ projectId: 'proj-1', settings: { delivery: 'repo', repoUrl: 'https://github.com/me/app' } });
  });
});
