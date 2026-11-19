import { registerBoot } from './boot';
import { secure } from './secure';

/** What `POST /v1/login/verify` returned; persisted in SecureStore and mirrored in memory. */
export interface StoredSession {
  readonly session: string;
  readonly expiresAt: number;
  readonly customerId: string;
}

const KEY = 'session';
const listeners = new Set<() => void>();
let cached: StoredSession | undefined;

const isSession = (v: unknown): v is StoredSession => {
  if (!v || typeof v !== 'object') return false;
  const s = v as Partial<StoredSession>;
  return (
    typeof s.session === 'string' &&
    s.session.length > 0 &&
    typeof s.expiresAt === 'number' &&
    Number.isFinite(s.expiresAt) &&
    typeof s.customerId === 'string'
  );
};

const notify = (): void => {
  for (const l of listeners) l();
};

async function hydrate(): Promise<void> {
  const s = await secure.get<unknown>(KEY);
  if (!isSession(s)) {
    if (s !== undefined) await secure.remove(KEY);
    cached = undefined;
    return;
  }
  if (s.expiresAt <= Date.now()) {
    await secure.remove(KEY);
    cached = undefined;
    return;
  }
  cached = s;
  notify();
}

registerBoot(hydrate);

const read = (): StoredSession | undefined => {
  if (!cached) return undefined;
  if (cached.expiresAt <= Date.now()) {
    cached = undefined;
    void secure.remove(KEY);
    return undefined;
  }
  return cached;
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
    cached = value;
    notify();
    void secure.set(KEY, value);
  },
  clear(): void {
    cached = undefined;
    notify();
    void secure.remove(KEY);
  },
};
