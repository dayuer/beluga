import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, unknown>();

vi.mock('./secure', () => ({
  secure: {
    get: vi.fn(async (k: string) => store.get(k)),
    set: vi.fn(async (k: string, v: unknown) => {
      store.set(k, v);
    }),
    remove: vi.fn(async (k: string) => {
      store.delete(k);
    }),
  },
}));

describe('session', () => {
  beforeEach(() => {
    store.clear();
    vi.resetModules();
  });

  it('hydrates valid token from SecureStore and clears it on clear()', async () => {
    const future = Date.now() + 60_000;
    store.set('session', { session: 'tok-123', expiresAt: future, customerId: 'cust-1' });

    const { session } = await import('./session');
    // 等待 registerBoot 触发的 hydrate 完成
    await Promise.resolve();
    await Promise.resolve();

    expect(session.token()).toBe('tok-123');
    expect(session.snapshot()).toBe('tok-123');

    const listener = vi.fn();
    const unsub = session.subscribe(listener);

    session.clear();
    expect(session.token()).toBeUndefined();
    expect(session.snapshot()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.has('session')).toBe(false);

    session.set({ session: 'tok-456', expiresAt: future, customerId: 'cust-1' });
    expect(session.token()).toBe('tok-456');
    expect(store.get('session')).toMatchObject({ session: 'tok-456' });
    expect(listener).toHaveBeenCalledTimes(2);

    unsub();
  });
});
