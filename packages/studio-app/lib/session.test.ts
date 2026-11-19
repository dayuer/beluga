import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, unknown>();
let pendingGet: ((v: unknown) => void) | null = null;

vi.mock('./secure', () => ({
  secure: {
    get: vi.fn((k: string) => {
      if (pendingGet) {
        return new Promise((resolve) => {
          pendingGet = resolve;
        });
      }
      return Promise.resolve(store.get(k));
    }),
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
    pendingGet = null;
    vi.resetModules();
  });

  it('hydrates valid token from SecureStore and clears it on clear()', async () => {
    const future = Date.now() + 60_000;
    store.set('session', { session: 'tok-123', expiresAt: future, customerId: 'cust-1' });

    const { session } = await import('./session');
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

  it('does not overwrite a session set during hydration with stale SecureStore data', async () => {
    let finishGet!: (v: unknown) => void;
    pendingGet = () => {};
    const { secure } = await import('./secure');
    vi.mocked(secure.get).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishGet = resolve;
        }),
    );

    const future = Date.now() + 60_000;
    const { session } = await import('./session');

    // 补水期间写入新会话
    session.set({ session: 'new-tok', expiresAt: future, customerId: 'cust-new' });

    // 旧的 SecureStore 读取晚到返回
    finishGet({ session: 'old-tok', expiresAt: future, customerId: 'cust-old' });
    await Promise.resolve();
    await Promise.resolve();

    expect(session.token()).toBe('new-tok');
    expect(session.get()?.customerId).toBe('cust-new');
  });
});
