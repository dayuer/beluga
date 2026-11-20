import { ed25519 } from '@noble/curves/ed25519.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const kvStore = new Map<string, unknown>();
const secureStore = new Map<string, unknown>();

vi.mock('expo-crypto', () => ({
  getRandomBytes: vi.fn((n: number) => new Uint8Array(n).fill(3)),
}));

vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageCode: 'zh' }],
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

vi.mock('./client', () => ({
  hub: { send: vi.fn() },
  live: { subscribe: vi.fn(() => () => {}) },
}));

vi.mock('./net', () => ({
  isOnline: () => true,
  subscribeOnline: () => () => {},
}));

vi.mock('./session', () => ({
  session: { clear: vi.fn() },
}));

describe('lib/send signing', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    kvStore.clear();
    secureStore.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('signs all S2 action kinds and verifies on a fake node', async () => {
    const keys = await import('./keys');
    const enrolledPub = await keys.ensureDeviceKey();
    const { encodeSignedFrame, fromBase64Url, toBase64Url } = await import('./signed');
    const { prepareActionForSend } = await import('./send');

    const kinds = [
      { kind: 'gate.answer', payload: { approved: true }, rev: 2 },
      { kind: 'request.confirm', payload: { requestId: 'req-1' }, rev: 1 },
      { kind: 'delivery.accept', payload: { milestoneRef: 'm1' }, rev: 4 },
      { kind: 'release.approve', payload: { releaseId: 'rel-1' }, rev: 5 },
      { kind: 'device.remove', payload: { deviceId: 'dev-2' } },
    ] as const;

    let prevAt = 0;
    for (const action of kinds) {
      const wrapped = (await prepareActionForSend(action)) as unknown as {
        kind: string;
        signed?: { frame: { kind: string; payload: unknown; rev?: number; at: number; deviceKey: string }; sig: string };
      };
      expect(wrapped.signed).toBeDefined();
      const { frame, sig } = wrapped.signed!;
      expect(frame.kind).toBe(action.kind);
      expect(frame.deviceKey).toBe(toBase64Url(enrolledPub));
      expect(frame.at).toBeGreaterThan(prevAt);
      prevAt = frame.at;

      const ok = ed25519.verify(fromBase64Url(sig), encodeSignedFrame(frame), enrolledPub);
      expect(ok).toBe(true);
    }

    // 非签名动作不包帧
    const chat = (await prepareActionForSend({
      t: 'action',
      opId: '00000000-0000-4000-8000-000000000001',
      kind: 'chat.send',
      planRef: 'p1',
      payload: { text: 'hello' },
    })) as unknown as { signed?: unknown };
    expect(chat.signed).toBeUndefined();
  });

  it('rejects missing device key and provides clear refusal messages', async () => {
    const keys = await import('./keys');
    const { prepareActionForSend } = await import('./send');
    const { signRefusalMessage } = await import('./strings/sign');

    await expect(
      prepareActionForSend({ kind: 'gate.answer', payload: { approved: true }, rev: 1 }),
    ).rejects.toBeInstanceOf(keys.DeviceKeyMissingError);

    expect(signRefusalMessage('zh', 'unregistered-device')).toContain('还没登记');
    expect(signRefusalMessage('zh', 'bad-signature')).toContain('签名校验未通过');
    expect(signRefusalMessage('zh', 'stale-clock')).toContain('时钟落后');
    expect(signRefusalMessage('zh', 'not-allowed')).toBeNull();
  });

  it('does not sign or send while inside the undo window when canceled', async () => {
    const keys = await import('./keys');
    await keys.ensureDeviceKey();
    const { prepareActionForSend } = await import('./send');
    const { createUndoController } = await import('./undo');

    const sent: unknown[] = [];
    const undo = createUndoController(10_000, () => {});

    undo.start(() => {
      void prepareActionForSend({ kind: 'delivery.accept', payload: { milestoneRef: 'm1' }, rev: 1 }).then((a) =>
        sent.push(a),
      );
    });

    vi.advanceTimersByTime(5_000);
    undo.cancel();
    vi.advanceTimersByTime(10_000);
    await Promise.resolve();

    expect(sent).toHaveLength(0);
    expect(kvStore.get('signed:last-at')).toBeUndefined();
  });
});
