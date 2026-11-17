import { kv } from './kv';

/** A last-known answer and when it was fetched, for the two "last synced" lines. */
export interface Cached<T> {
  readonly value: T;
  readonly fetchedAt: number;
}

const isCached = <T,>(v: unknown): v is Cached<T> => {
  if (!v || typeof v !== 'object') return false;
  const c = v as Partial<Cached<T>>;
  return 'value' in c && typeof c.fetchedAt === 'number' && Number.isFinite(c.fetchedAt);
};

/** Keys: `projects`, `plans:<pid>` (the `synon:cache:` prefix is added here). */
export const cache = {
  get<T>(key: string): Cached<T> | undefined {
    const value = kv.get<unknown>(`cache:${key}`);
    return isCached<T>(value) ? value : undefined;
  },
  set<T>(key: string, value: T, fetchedAt: number = Date.now()): void {
    kv.set(`cache:${key}`, { value, fetchedAt });
  },
  remove(key: string): void {
    kv.remove(`cache:${key}`);
  },
};
