/** The app's browser storage: localStorage, namespaced `synon:`. Same shape as the companion's
 * kv.web.ts. A missing or full storage is never fatal: the cache and drafts are a nicety. */
const PREFIX = 'synon:';

const store = (): Storage | undefined => (typeof localStorage === 'undefined' ? undefined : localStorage);

export const kv = {
  get<T>(key: string): T | undefined {
    try {
      const raw = store()?.getItem(PREFIX + key);
      return raw == null ? undefined : (JSON.parse(raw) as T);
    } catch {
      return undefined;
    }
  },
  set(key: string, value: unknown): void {
    try {
      store()?.setItem(PREFIX + key, JSON.stringify(value));
    } catch (e) {
      const dev = (globalThis as { __DEV__?: boolean }).__DEV__;
      if (dev) console.warn('[kv]', key, (e as Error).message);
    }
  },
  remove(key: string): void {
    try {
      store()?.removeItem(PREFIX + key);
    } catch {
      /* private mode */
    }
  },
  clear(): void {
    const s = store();
    if (!s) return;
    for (const k of Object.keys(s)) if (k.startsWith(PREFIX)) s.removeItem(k);
  },
};
