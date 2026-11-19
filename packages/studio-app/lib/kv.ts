/** The app's browser storage: localStorage, namespaced `synon:`. Same shape as the companion's
 * kv.web.ts. A missing or full storage is never fatal: the cache and drafts are a nicety. */
const PREFIX = 'synon:';
const memory = new Map<string, string>();

const store = (): Storage | undefined => (typeof localStorage === 'undefined' ? undefined : localStorage);

export const kv = {
  get<T>(key: string): T | undefined {
    try {
      const s = store();
      const raw = s ? s.getItem(PREFIX + key) : memory.get(PREFIX + key);
      return raw == null ? undefined : (JSON.parse(raw) as T);
    } catch {
      return undefined;
    }
  },
  set(key: string, value: unknown): void {
    try {
      const serialized = JSON.stringify(value);
      const s = store();
      if (s) s.setItem(PREFIX + key, serialized);
      else memory.set(PREFIX + key, serialized);
    } catch (e) {
      const dev = (globalThis as { __DEV__?: boolean }).__DEV__;
      if (dev) console.warn('[kv]', key, (e as Error).message);
    }
  },
  remove(key: string): void {
    try {
      const s = store();
      if (s) s.removeItem(PREFIX + key);
      else memory.delete(PREFIX + key);
    } catch {
      /* private mode */
    }
  },
  clear(): void {
    const s = store();
    if (s) {
      for (const k of Object.keys(s)) if (k.startsWith(PREFIX)) s.removeItem(k);
      return;
    }
    for (const k of [...memory.keys()]) if (k.startsWith(PREFIX)) memory.delete(k);
  },
};
