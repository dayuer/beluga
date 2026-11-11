import { AppFrame, StudioAction, type StudioReceipt } from '../../../src/studio/protocol';
import {
  PlansRes,
  ProjectsRes,
  ReceiptRes,
  VerifyRes,
  formatIssues,
  parse,
  type PlansRes as PlansResponse,
  type ProjectsRes as ProjectsResponse,
  type VerifyRes as VerifyResponse,
} from './hub-schema';

/**
 * The app's door to the hub. Every call resolves to a value or a typed error — nothing here
 * throws. A bad response is a `schema` error with the path and zod's detail, so the screen can say
 * "refresh / update" instead of crashing on raw JSON.
 */
export type HubError =
  | { kind: 'offline' }
  | { kind: 'signed-out' }
  | { kind: 'denied'; error: string }
  | { kind: 'http'; status: number; error: string }
  | { kind: 'schema'; where: string; detail: string };

export type R<T> = { ok: true; value: T } | { ok: false; error: HubError };

export interface WatchHandlers {
  readonly frame: (frame: AppFrame) => void;
  readonly state: (state: 'open' | 'closed') => void;
}

export interface Hub {
  requestLink(email: string): Promise<R<void>>;
  verify(token: string): Promise<R<VerifyResponse>>;
  logout(): Promise<R<void>>;
  projects(): Promise<R<ProjectsResponse>>;
  plans(pid: string): Promise<R<PlansResponse>>;
  send(pid: string, action: StudioAction): Promise<R<StudioReceipt>>;
  watch(pid: string, handlers: WatchHandlers): () => void;
}

export interface HubOptions {
  /** Same origin by default (the dev proxy, and P2's Worker hosting the app). */
  readonly base?: string;
  readonly session: () => string | undefined;
  readonly onSignedOut?: () => void;
  /** Injected in tests; defaults to the platform's fetch/WebSocket. */
  readonly fetch?: typeof fetch;
  readonly WebSocket?: typeof WebSocket;
}

const envBase = (): string | undefined => {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return env?.EXPO_PUBLIC_HUB_URL;
};

const errorText = (json: unknown): string =>
  json && typeof json === 'object' && typeof (json as { error?: unknown }).error === 'string'
    ? (json as { error: string }).error
    : 'request-failed';

const offline: R<never> = { ok: false, error: { kind: 'offline' } };
const TIMEOUT_MS = 10_000;

export function createHub(options: HubOptions): Hub {
  const base = (options.base ?? envBase() ?? '').replace(/\/+$/, '');
  const doFetch = options.fetch ?? (typeof fetch === 'undefined' ? undefined : fetch);
  const WS = options.WebSocket ?? (typeof WebSocket === 'undefined' ? undefined : WebSocket);

  const request = async <T>(path: string, init: RequestInit, decode: (json: unknown) => R<T>): Promise<R<T>> => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return offline;
    if (!doFetch) return offline;
    const token = options.session();
    const headers = new Headers(init.headers);
    if (token) headers.set('authorization', `Bearer ${token}`);
    if (init.body !== undefined) headers.set('content-type', 'application/json');

    let res: Response;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      res = await doFetch(base + path, { ...init, headers, signal: controller.signal });
    } catch {
      return offline;
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text().catch(() => '');
    let json: unknown;
    let badJson = false;
    if (text.length > 0) {
      try {
        json = JSON.parse(text) as unknown;
      } catch {
        badJson = true;
      }
    }

    if (res.status === 401) {
      options.onSignedOut?.();
      return { ok: false, error: { kind: 'signed-out' } };
    }
    if (res.status === 403) return { ok: false, error: { kind: 'denied', error: errorText(json) } };
    if (!res.ok) return { ok: false, error: { kind: 'http', status: res.status, error: errorText(json) } };
    if (badJson) return { ok: false, error: { kind: 'schema', where: path, detail: 'response is not JSON' } };
    return decode(json);
  };

  const decodeWith = <T>(where: string, schema: Parameters<typeof parse>[0]) => (json: unknown): R<T> => {
    const result = parse(schema, json);
    return result.ok ? { ok: true, value: result.value as T } : { ok: false, error: { kind: 'schema', where, detail: result.detail } };
  };

  const socketUrl = (pid: string): string => {
    const path = `/v1/app/projects/${encodeURIComponent(pid)}/ws`;
    if (base) return `${base.replace(/^http/, 'ws')}${path}`;
    const loc = (globalThis as { location?: { protocol: string; host: string } }).location;
    if (!loc) throw new Error('no location for the WebSocket');
    return `${loc.protocol === 'https:' ? 'wss:' : 'ws:'}//${loc.host}${path}`;
  };

  return {
    requestLink(email: string): Promise<R<void>> {
      return request('/v1/login', { method: 'POST', body: JSON.stringify({ email }) }, () => ({ ok: true, value: undefined }));
    },

    verify(token: string): Promise<R<VerifyResponse>> {
      return request('/v1/login/verify', { method: 'POST', body: JSON.stringify({ token }) }, decodeWith<VerifyResponse>('/v1/login/verify', VerifyRes));
    },

    logout(): Promise<R<void>> {
      return request('/v1/logout', { method: 'POST' }, () => ({ ok: true, value: undefined }));
    },

    projects(): Promise<R<ProjectsResponse>> {
      return request('/v1/app/projects', { method: 'GET' }, decodeWith<ProjectsResponse>('/v1/app/projects', ProjectsRes));
    },

    plans(pid: string): Promise<R<PlansResponse>> {
      const path = `/v1/app/projects/${encodeURIComponent(pid)}/plans`;
      return request(path, { method: 'GET' }, decodeWith<PlansResponse>(path, PlansRes));
    },

    send(pid: string, action: StudioAction): Promise<R<StudioReceipt>> {
      const checked = parse(StudioAction, action);
      if (!checked.ok) return Promise.resolve({ ok: false, error: { kind: 'schema', where: 'action', detail: checked.detail } });
      const path = `/v1/app/projects/${encodeURIComponent(pid)}/actions`;
      return request(path, { method: 'POST', body: JSON.stringify(checked.value) }, decodeWith<StudioReceipt>(path, ReceiptRes));
    },

    watch(pid: string, handlers: WatchHandlers): () => void {
      let closed = false;
      let ws: WebSocket | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let attempt = 0;

      const schedule = (): void => {
        if (closed) return;
        if (!options.session()) {
          handlers.state('closed');
          return;
        }
        const delays = [1000, 2000, 4000, 8000, 15000, 30000];
        const wait = delays[Math.min(attempt, delays.length - 1)] ?? 30000;
        attempt += 1;
        timer = setTimeout(connect, wait);
      };

      const connect = (): void => {
        if (closed) return;
        const token = options.session();
        if (!token || !WS) {
          handlers.state('closed');
          return;
        }
        let url: string;
        try {
          url = socketUrl(pid);
        } catch {
          handlers.state('closed');
          return;
        }
        try {
          ws = new WS(url, ['synon.v1', `bearer.${token}`]);
        } catch {
          schedule();
          return;
        }
        ws.onopen = () => {
          attempt = 0;
          handlers.state('open');
        };
        ws.onmessage = (event: MessageEvent) => {
          let json: unknown;
          try {
            json = JSON.parse(String(event.data)) as unknown;
          } catch {
            console.warn('[studio] dropped a frame that is not JSON');
            return;
          }
          const frame = AppFrame.safeParse(json);
          if (!frame.success) {
            console.warn('[studio] dropped an unknown frame:', formatIssues(frame.error));
            return;
          }
          handlers.frame(frame.data);
        };
        ws.onerror = () => {
          try {
            ws?.close();
          } catch {
            /* already closing */
          }
        };
        ws.onclose = () => {
          if (closed) return;
          handlers.state('closed');
          schedule();
        };
      };

      connect();

      return () => {
        closed = true;
        if (timer) clearTimeout(timer);
        try {
          ws?.close();
        } catch {
          /* already closed */
        }
      };
    },
  };
}
