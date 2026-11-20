import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mem = new Map<string, unknown>();
let nextRandom: Uint8Array = new Uint8Array(32);

vi.mock('expo-crypto', () => ({
  getRandomBytes: vi.fn((n: number) => nextRandom.slice(0, n)),
}));

vi.mock('./secure', () => ({
  secure: {
    get: vi.fn(async <T,>(k: string) => mem.get(k) as T | undefined),
    set: vi.fn(async (k: string, v: unknown) => {
      mem.set(k, v);
    }),
    remove: vi.fn(async (k: string) => {
      mem.delete(k);
    }),
  },
}));

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

describe('lib/keys', () => {
  beforeEach(() => {
    vi.resetModules();
    mem.clear();
    nextRandom = new Uint8Array(32);
  });

  it('reports missing key and throws DeviceKeyMissingError before enrollment', async () => {
    const keys = await import('./keys');
    await expect(keys.hasDeviceKey()).resolves.toBe(false);
    await expect(keys.publicKey()).resolves.toBeNull();
    await expect(keys.sealPublicKey()).resolves.toBeNull();
    await expect(keys.sign(new Uint8Array([1, 2, 3]))).rejects.toBeInstanceOf(keys.DeviceKeyMissingError);
  });

  it('matches RFC 8032 / @noble official Ed25519 test vector and X25519 public key', async () => {
    // RFC 8032 §7.1 TEST 1
    const seedHex = '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60';
    const expectedPubHex = 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a';
    const expectedSigHex =
      'e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e06522490155' +
      '5fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b';

    nextRandom = hexToBytes(seedHex);
    const keys = await import('./keys');

    const pub = await keys.ensureDeviceKey();
    expect(bytesToHex(pub)).toBe(expectedPubHex);
    await expect(keys.hasDeviceKey()).resolves.toBe(true);

    const sig = await keys.sign(new Uint8Array(0));
    expect(bytesToHex(sig)).toBe(expectedSigHex);
    expect(ed25519.verify(sig, new Uint8Array(0), pub)).toBe(true);

    const sealPub = await keys.sealPublicKey();
    expect(sealPub).not.toBeNull();
    expect(bytesToHex(sealPub!)).toBe(bytesToHex(x25519.getPublicKey(nextRandom)));

    // 再次调用 ensureDeviceKey 不覆盖已有密钥
    nextRandom = new Uint8Array(32).fill(0xff);
    const pubAgain = await keys.ensureDeviceKey();
    expect(bytesToHex(pubAgain)).toBe(expectedPubHex);

    // 私钥/种子不从模块导出
    expect(Object.keys(keys)).not.toContain('seed');
    expect(Object.keys(keys)).not.toContain('secret');
    expect(Object.keys(keys)).not.toContain('privateKey');
  });

  it('persists seed in secure.ts with AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY', async () => {
    vi.doUnmock('./secure');
    const setItemAsync = vi.fn(async () => {});
    const getItemAsync = vi.fn(async () => null);
    const deleteItemAsync = vi.fn(async () => {});
    vi.doMock('expo-secure-store', () => ({
      AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 2,
      setItemAsync,
      getItemAsync,
      deleteItemAsync,
    }));

    const { secure } = await import('./secure');
    await secure.set('device-secret', { seed: 'ab'.repeat(32) });
    expect(setItemAsync).toHaveBeenCalledWith(
      'device-secret',
      JSON.stringify({ seed: 'ab'.repeat(32) }),
      { keychainAccessible: 2 },
    );
  });
});
