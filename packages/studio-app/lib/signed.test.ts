import { ed25519 } from '@noble/curves/ed25519.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const kvStore = new Map<string, unknown>();
const secureStore = new Map<string, unknown>();

vi.mock('expo-crypto', () => ({
  getRandomBytes: vi.fn((n: number) => {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i += 1) out[i] = i + 1;
    return out;
  }),
}));

vi.mock('./secure', () => ({
  secure: {
    get: vi.fn(async <T,>(k: string) => secureStore.get(k) as T | undefined),
    set: vi.fn(async (k: string, v: unknown) => {
      secureStore.set(k, v);
    }),
    remove: vi.fn(async (k: string) => {
      secureStore.delete(k);
    }),
  },
}));

vi.mock('./kv', () => ({
  kv: {
    get: vi.fn(<T,>(k: string) => kvStore.get(k) as T | undefined),
    set: vi.fn((k: string, v: unknown) => {
      kvStore.set(k, v);
    }),
    remove: vi.fn((k: string) => {
      kvStore.delete(k);
    }),
  },
}));

describe('lib/signed', () => {
  beforeEach(() => {
    vi.resetModules();
    kvStore.clear();
    secureStore.clear();
  });

  it('produces sorted compact canonical JSON', async () => {
    const { canonicalJson } = await import('./signed');
    const out = canonicalJson({
      kind: 'gate.answer',
      payload: { z: 1, a: { d: true, c: 'x' }, skip: undefined },
      rev: 3,
      at: 100,
      deviceKey: 'pk',
    });
    expect(out).toBe('{"at":100,"deviceKey":"pk","kind":"gate.answer","payload":{"a":{"c":"x","d":true},"z":1},"rev":3}');
  });

  it('keeps `at` strictly increasing even when system clock jumps backward', async () => {
    const keys = await import('./keys');
    await keys.ensureDeviceKey();
    const { signFrame } = await import('./signed');

    const f1 = await signFrame({ kind: 'gate.answer', payload: { approved: true }, rev: 1 }, 5000);
    // 时钟回拨到 1000
    const f2 = await signFrame({ kind: 'gate.answer', payload: { approved: true }, rev: 1 }, 1000);
    // 同毫秒连发
    const f3 = await signFrame({ kind: 'gate.answer', payload: { approved: true }, rev: 1 }, 5001);

    expect(f1.frame.at).toBe(5000);
    expect(f2.frame.at).toBe(5001);
    expect(f3.frame.at).toBe(5002);
    expect(kvStore.get('signed:last-at')).toBe(5002);
  });

  it('produces identical signatures for the same frame and passes node-side Ed25519 verification', async () => {
    const keys = await import('./keys');
    const pub = await keys.ensureDeviceKey();
    const { encodeSignedFrame, fromBase64Url, signExistingFrame, signFrame, toBase64Url } = await import('./signed');

    const first = await signFrame({ kind: 'delivery.accept', payload: { milestoneRef: 'm1' }, rev: 4 }, 9000);
    const second = await signExistingFrame(first.frame);

    expect(second.sig).toBe(first.sig);
    expect(first.frame.deviceKey).toBe(toBase64Url(pub));

    // 模拟节点端（S2）验签：用规范化 JSON 字节 + 登记公钥验签
    const verified = ed25519.verify(
      fromBase64Url(first.sig),
      encodeSignedFrame(first.frame),
      fromBase64Url(first.frame.deviceKey),
    );
    expect(verified).toBe(true);
  });
});
