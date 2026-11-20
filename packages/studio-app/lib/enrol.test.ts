import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const kvStore = new Map<string, unknown>();
const secureStore = new Map<string, unknown>();

vi.mock('expo-crypto', () => ({
  getRandomBytes: vi.fn((n: number) => new Uint8Array(n).fill(7)),
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

vi.mock('./net', () => ({
  isOnline: () => true,
}));

vi.mock('./session', () => ({
  session: { token: () => 'tok-123' },
}));

describe('lib/enrol', () => {
  beforeEach(() => {
    vi.resetModules();
    kvStore.clear();
    secureStore.clear();
  });

  it('parses https and synon invite links', async () => {
    const { parseInvitePayload } = await import('./enrol');
    expect(parseInvitePayload('https://hub.example/join/inv-1#k=secretKey1234567890&n=A1B2C3D4E5F67890')).toEqual({
      inviteId: 'inv-1',
      k: 'secretKey1234567890',
      n: 'A1B2C3D4E5F67890',
    });
    expect(parseInvitePayload('synon://join/inv-2#k=secretKey1234567890&n=1122334455667788')).toEqual({
      inviteId: 'inv-2',
      k: 'secretKey1234567890',
      n: '1122334455667788',
    });
    expect(parseInvitePayload('https://hub.example/join/inv-3')).toBeNull();
  });

  it('computes HMAC-SHA256(k, pubkey), prevents reuse of one-time code, and reports clear errors', async () => {
    const { enrollDevice, parseInvitePayload } = await import('./enrol');
    const { fromBase64Url, toBase64Url } = await import('./signed');

    const kBytes = new Uint8Array(32).fill(9);
    const k = toBase64Url(kBytes);
    const invite = parseInvitePayload(`https://hub.example/join/inv-once#k=${k}&n=A1B2C3D4E5F67890`)!;

    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('https://hub.example/v1/app/devices/enroll');
      const body = JSON.parse(String(init?.body)) as { pubkey: string; mac: string };
      const expectedMac = toBase64Url(hmac(sha256, kBytes, fromBase64Url(body.pubkey)));
      expect(body.mac).toBe(expectedMac);
      return new Response(JSON.stringify({ ok: true, fingerprint: 'a1b2-c3d4-e5f6-7890' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const okRes = await enrollDevice(invite, { baseUrl: 'https://hub.example', fetchFn: fetchFn as unknown as typeof fetch });
    expect(okRes.ok).toBe(true);

    // 同一一次性码第二次使用应直接拒绝，不再发请求
    const secondRes = await enrollDevice(invite, { baseUrl: 'https://hub.example', fetchFn: fetchFn as unknown as typeof fetch });
    expect(secondRes).toEqual({ ok: false, reason: 'used' });
    expect(fetchFn).toHaveBeenCalledTimes(1);

    // 过期码与指纹不符
    const expiredInvite = { ...invite, inviteId: 'inv-expired' };
    const expiredFetch = vi.fn(async () => new Response(JSON.stringify({ code: 'invite-expired' }), { status: 410 }));
    await expect(
      enrollDevice(expiredInvite, { baseUrl: 'https://hub.example', fetchFn: expiredFetch as unknown as typeof fetch }),
    ).resolves.toMatchObject({ ok: false, reason: 'expired' });

    const mismatchInvite = { ...invite, inviteId: 'inv-mismatch' };
    const mismatchFetch = vi.fn(async () => new Response(JSON.stringify({ fingerprint: 'FFFF0000FFFF0000' }), { status: 200 }));
    await expect(
      enrollDevice(mismatchInvite, { baseUrl: 'https://hub.example', fetchFn: mismatchFetch as unknown as typeof fetch }),
    ).resolves.toMatchObject({ ok: false, reason: 'fingerprint-mismatch' });
  });
});
