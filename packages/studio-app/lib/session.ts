import { kv } from './kv';

/** What `POST /v1/login/verify` returned; the session plaintext lives only in this browser. */
export interface StoredSession {
  readonly session: string;
  readonly expiresAt: number;
  readonly customerId: string;
}

const KEY = 'session';
const listeners = new Set<() => void>();

const isSession = (v: unknown): v is StoredSession => {
  if (!v || typeof v !== 'object') return false;
  const s = v as Partial<StoredSession>;
  return typeof s.session === 'string' && s.session.length > 0 && typeof s.expiresAt === 'number' && Number.isFinite(s.expiresAt) && typeof s.customerId === 'string';
};

const read = (): StoredSession | undefined => {
  const s = kv.get<unknown>(KEY);
  if (!isSession(s)) {
    if (s !== undefined) kv.remove(KEY);
    return undefined;
  }
  if (s.expiresAt <= Date.now()) {
    kv.remove(KEY);
    return undefined;
  }
  return s;
};

const notify = (): void => {
  for (const l of listeners) l();
};

/**
 * The customer's session. `snapshot`/`subscribe` fit `useSyncExternalStore`, so the root layout
 * re-renders the moment a login or a 401 changes it. Expired sessions are cleared on read.
 */
export const session = {
  get(): StoredSession | undefined {
    return read();
  },
  token(): string | undefined {
    return read()?.session;
  },
  /** The token, or null: a stable snapshot for React. */
  snapshot(): string | null {
    return read()?.session ?? null;
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  set(value: StoredSession): void {
    kv.set(KEY, value);
    notify();
  },
  clear(): void {
    kv.remove(KEY);
    notify();
  },
};
