import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { RefusalCode, StudioAction, StudioReceipt } from '../../../src/studio/protocol';
import { hub, live } from './client';
import { DeviceKeyMissingError } from './keys';
import { kv } from './kv';
import { isOnline, subscribeOnline } from './net';
import { session } from './session';
import { signFrame, type SignedEnvelope } from './signed';
import { randomOpId, submitNext, type SubmitState } from './submit';

/** S2 规定必须携带设备签名的动作类型。 */
export const SIGNED_ACTION_KINDS = new Set<string>([
  'gate.answer',
  'request.confirm',
  'delivery.accept',
  'release.approve',
  'device.remove',
]);

export interface SignableAction {
  readonly t?: 'action';
  readonly opId?: string;
  readonly kind: string;
  readonly planRef?: string;
  readonly payload: unknown;
  readonly rev?: number;
  readonly signed?: SignedEnvelope;
}

export type SendableAction = StudioAction | SignableAction;

/** The pending record `synon:pending:<kind>:<pid>:<ref>[:sub]`: the opId survives a reload. */
interface PendingSend {
  readonly opId: string;
  readonly updatedAt: number;
}

export type SendFailure = 'offline' | 'http' | 'expired';

export interface SendHandlers {
  readonly onQueued?: (receipt: StudioReceipt) => void;
  readonly onDone?: (receipt: StudioReceipt) => void;
  readonly onRefused?: (code: RefusalCode) => void;
  readonly onExpired?: () => void;
  readonly onFailed?: (failure: SendFailure) => void;
}

export interface Sender {
  readonly state: SubmitState;
  /** Send one action; `build` is called with the opId the hub will see. */
  send(build: (opId: string) => SendableAction, handlers?: SendHandlers): Promise<void>;
  /** After a failure: same opId; after refused/expired: a new one. */
  retry(): Promise<void>;
  reset(): void;
}

const signedCacheKey = (opId: string) => `signed:op:${opId}`;
const signedByOpId = new Map<string, StudioAction>();

function clearSignedCache(opId: string | undefined): void {
  if (!opId) return;
  signedByOpId.delete(opId);
  kv.remove(signedCacheKey(opId));
}

export async function prepareActionForSend(raw: SendableAction): Promise<StudioAction> {
  if (!SIGNED_ACTION_KINDS.has(raw.kind)) {
    return raw as StudioAction;
  }
  const opId = typeof raw.opId === 'string' && raw.opId.length > 0 ? raw.opId : undefined;
  if (opId) {
    const cached = signedByOpId.get(opId) ?? kv.get<StudioAction>(signedCacheKey(opId));
    if (cached) {
      signedByOpId.set(opId, cached);
      return cached;
    }
  }
  const rev = 'rev' in raw ? raw.rev : undefined;
  const envelope = await signFrame({
    kind: raw.kind,
    payload: raw.payload,
    ...(rev !== undefined ? { rev } : {}),
  });
  const prepared = {
    ...raw,
    signed: envelope,
  } as unknown as StudioAction;
  if (opId) {
    signedByOpId.set(opId, prepared);
    kv.set(signedCacheKey(opId), prepared);
  }
  return prepared;
}
/** `pending:<kind>:<pid>[:<ref>[:<sub>]]`, the app's one pending-key shape. */
export function pendingKey(kind: string, pid: string, ...refs: string[]): string {
  return ['pending', kind, pid, ...refs].join(':');
}

const readPending = (key: string): PendingSend | undefined => {
  const p = kv.get<Partial<PendingSend>>(key);
  return p && typeof p.opId === 'string' && typeof p.updatedAt === 'number' ? { opId: p.opId, updatedAt: p.updatedAt } : undefined;
};

/**
 * One action's send state: the M5 submit machine (`submitNext`) with the action and pending key
 * supplied by the caller. A network failure reuses the opId and retries once by itself; refused
 * and expired are terminal at the hub, so the next try gets a new opId. HTTP and socket receipts
 * are merged by opId; the state only moves forward.
 */
export function useSend(pid: string, key: string): Sender {
  const [state, setState] = useState<SubmitState>({ phase: 'idle' });
  const stateRef = useRef(state);
  stateRef.current = state;
  const buildRef = useRef<((opId: string) => SendableAction) | null>(null);
  const handlersRef = useRef<SendHandlers>({});
  const inFlight = useRef(false);
  const autoRetried = useRef(false);

  const set = useCallback((next: SubmitState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const settle = useCallback(
    (receipt: StudioReceipt) => {
      const current = stateRef.current;
      if (receipt.opId !== current.opId) return;
      if (receipt.state === 'queued') {
        const next = submitNext(current, { type: 'queued' });
        set(next);
        handlersRef.current.onQueued?.(receipt);
        return;
      }
      if (receipt.state === 'done') {
        const next = submitNext(current, { type: 'done' });
        set(next);
        kv.remove(key);
        clearSignedCache(current.opId);
        handlersRef.current.onDone?.(receipt);
        return;
      }
      if (receipt.state === 'refused') {
        const next = submitNext(current, { type: 'refused', code: receipt.code! });
        set(next);
        kv.remove(key);
        clearSignedCache(current.opId);
        handlersRef.current.onRefused?.(receipt.code!);
        return;
      }
      // `expired` is a receipt state, not a local event: it can arrive while queued.
      set({ phase: 'failed', opId: current.opId, failure: 'expired' });
      kv.remove(key);
      clearSignedCache(current.opId);
      handlersRef.current.onFailed?.('expired');
      handlersRef.current.onExpired?.();
    },
    [key, set],
  );

  const run = useCallback(
    async (auto: boolean) => {
      const build = buildRef.current;
      if (!build) return;
      const phase = stateRef.current.phase;
      if (inFlight.current || phase === 'sending' || phase === 'queued' || phase === 'done') return;
      if (!auto) autoRetried.current = false;
      inFlight.current = true;
      try {
        // A network failure keeps its opId; a refusal or expiry is terminal, so a new one.
        const reusable = phase === 'failed' && stateRef.current.failure !== 'expired';
        const stored = readPending(key);
        const opId = reusable && stored ? stored.opId : (stored?.opId && phase === 'idle' ? stored.opId : randomOpId());
        kv.set(key, { opId, updatedAt: Date.now() } satisfies PendingSend);
        const started: SubmitState = { phase: 'sending', opId };
        set(started);
        let prepared: StudioAction;
        try {
          prepared = await prepareActionForSend(build(opId));
        } catch (err) {
          if (err instanceof DeviceKeyMissingError) {
            const refused = submitNext(started, { type: 'refused', code: 'not-allowed' });
            set(refused);
            kv.remove(key);
            handlersRef.current.onRefused?.('not-allowed');
            return;
          }
          throw err;
        }
        const answer = await hub.send(pid, prepared);
        if (answer.ok) {
          settle(answer.value);
          return;
        }
        if (answer.error.kind === 'signed-out') {
          session.clear();
          return;
        }
        const failure = answer.error.kind === 'offline' ? 'offline' : 'http';
        set(submitNext(stateRef.current, { type: 'failed', failure }));
        handlersRef.current.onFailed?.(failure);
      } finally {
        inFlight.current = false;
      }
    },
    [key, pid, set, settle],
  );

  const send = useCallback(
    async (build: (opId: string) => SendableAction, handlers: SendHandlers = {}) => {
      buildRef.current = build;
      handlersRef.current = handlers;
      await run(false);
    },
    [run],
  );

  const retry = useCallback(async () => {
    await run(autoRetried.current ? true : false);
  }, [run]);

  const reset = useCallback(() => {
    clearSignedCache(stateRef.current.opId);
    kv.remove(key);
    buildRef.current = null;
    handlersRef.current = {};
    autoRetried.current = false;
    set({ phase: 'idle' });
  }, [key, set]);

  // While the action is live, a socket receipt settles it; on an open socket, ask once more with
  // the same opId (the hub's idempotency makes that a status query, not a second action).
  useEffect(() => {
    if ((state.phase !== 'sending' && state.phase !== 'queued') || !state.opId) return;
    const opId = state.opId;
    const close = live.subscribe(pid, {
      frame: (frame) => {
        if (frame.t === 'receipt' && frame.opId === opId) settle(frame);
      },
      state: (socket) => {
        if (socket !== 'open' || stateRef.current.phase !== 'queued' || !buildRef.current) return;
        void prepareActionForSend(buildRef.current(opId))
          .then((prepared) => hub.send(pid, prepared))
          .then((answer) => {
            if (answer.ok) settle(answer.value);
          });
      },
    });
    return close;
  }, [pid, state.phase, state.opId, settle]);

  // One automatic retry when the network or the app comes back to foreground; after that, the button says retry.
  useEffect(() => {
    if (state.phase !== 'failed' || state.failure === 'expired' || autoRetried.current) return;
    const again = () => {
      if (autoRetried.current || !buildRef.current || !isOnline()) return;
      autoRetried.current = true;
      void run(true);
    };
    const unsubOnline = subscribeOnline((online) => {
      if (online) again();
    });
    const appSub =
      typeof AppState?.addEventListener === 'function'
        ? AppState.addEventListener('change', (next) => {
            if (next === 'active') again();
          })
        : null;
    return () => {
      unsubOnline();
      appSub?.remove();
    };
  }, [run, state.phase, state.failure]);

  return { state, send, retry, reset };
}
