import React from 'react';
import { act, render } from '@testing-library/react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const kvStore = new Map<string, unknown>();
const secureStore = new Map<string, unknown>();

vi.mock('expo-crypto', () => ({
  getRandomBytes: vi.fn((n: number) => new Uint8Array(n).fill(5)),
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

vi.mock('./net', () => ({
  isOnline: () => true,
  subscribeOnline: () => () => {},
}));

vi.mock('./session', () => ({
  session: {
    token: () => 'tok-1',
    clear: vi.fn(),
  },
}));

vi.mock('./resume', () => ({
  onResume: () => () => {},
}));

describe('lib/use-signed-action', () => {
  const origFetch = globalThis.fetch;

  beforeEach(() => {
    vi.resetModules();
    kvStore.clear();
    secureStore.clear();
    delete process.env.EXPO_PUBLIC_DEMO;
    process.env.EXPO_PUBLIC_HUB_URL = 'https://hub.example';
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it('returns to idle with clear reason and skips onDone when node refuses unregistered-device', async () => {
    globalThis.fetch = vi.fn(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { opId: string };
      return new Response(
        JSON.stringify({ receipt: { t: 'receipt', opId: body.opId, state: 'refused', code: 'unregistered-device' } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;

    const keys = await import('./keys');
    await keys.ensureDeviceKey();
    const { useSignedAction } = await import('./use-signed-action');
    const { buildApproveStart } = await import('./signed-actions');

    const onDone = vi.fn();
    const onRefused = vi.fn();

    let api!: ReturnType<typeof useSignedAction>;
    function Harness() {
      api = useSignedAction('proj-1', 'pending:gate:proj-1:p1');
      return null;
    }

    await render(React.createElement(Harness));
    await act(async () => {
      await api.send((opId) => buildApproveStart({ opId, planRef: 'p1', draftRev: 1 }), { onDone, onRefused });
    });

    expect(api.buttonState).toBe('idle');
    expect(api.error).toContain('还没登记');
    expect(onDone).not.toHaveBeenCalled();
    expect(onRefused).toHaveBeenCalledWith('unregistered-device');
  });

  it('returns to idle with the same unregistered reason when local device key is missing', async () => {
    const { useSignedAction } = await import('./use-signed-action');
    const { buildApproveStart } = await import('./signed-actions');

    const onDone = vi.fn();
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    let api!: ReturnType<typeof useSignedAction>;
    function Harness() {
      api = useSignedAction('proj-1', 'pending:gate:proj-1:p1');
      return null;
    }

    await render(React.createElement(Harness));
    await act(async () => {
      await api.send((opId) => buildApproveStart({ opId, planRef: 'p1', draftRev: 1 }), { onDone });
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(api.buttonState).toBe('idle');
    expect(api.error).toContain('还没登记');
    expect(onDone).not.toHaveBeenCalled();
  });

  it('provides zh and en messages for all three signature refusal codes', async () => {
    const { signRefusalMessage } = await import('./strings/sign');
    for (const code of ['unregistered-device', 'bad-signature', 'stale-clock'] as const) {
      expect(signRefusalMessage('zh', code)).toBeTruthy();
      expect(signRefusalMessage('en', code)).toBeTruthy();
    }
  });
});
