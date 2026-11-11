import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefusalCode, StudioAction, StudioPlatform, StudioReceipt } from '../../../src/studio/protocol';
import { hub } from './client';
import { clearDraft, clearPending, readPending, writePending } from './drafts';
import { isOnline } from './net';
import { session } from './session';
import type { StringKey } from './strings';

/**
 * The submit state machine shared by the request screen and, in M6, chat / decisions / review.
 * A pure reducer (`submitNext`) so the transitions are testable without a browser; `useNewRequest`
 * is the thin part that talks to the hub, keeps the opId across retries and watches receipts.
 */
export type SubmitPhase = 'idle' | 'sending' | 'queued' | 'done' | 'refused' | 'failed';

export interface SubmitState {
  readonly phase: SubmitPhase;
  readonly opId?: string;
  readonly code?: RefusalCode;
  readonly failure?: 'offline' | 'http' | 'expired';
}

export type SubmitEvent =
  | { readonly type: 'start'; readonly opId: string }
  | { readonly type: 'queued' }
  | { readonly type: 'done' }
  | { readonly type: 'refused'; readonly code: RefusalCode }
  | { readonly type: 'failed'; readonly failure: 'offline' | 'http' | 'expired' }
  | { readonly type: 'reset' };

export function submitNext(state: SubmitState, event: SubmitEvent): SubmitState {
  switch (event.type) {
    case 'start':
      return { phase: 'sending', opId: event.opId };
    case 'queued':
      return state.phase === 'sending' || state.phase === 'queued' ? { phase: 'queued', opId: state.opId } : state;
    case 'done':
      return state.phase === 'sending' || state.phase === 'queued' ? { phase: 'done', opId: state.opId } : state;
    case 'refused':
      return state.phase === 'sending' || state.phase === 'queued'
        ? { phase: 'refused', opId: state.opId, code: event.code }
        : state;
    case 'failed':
      return state.phase === 'sending' ? { phase: 'failed', opId: state.opId, failure: event.failure } : state;
    case 'reset':
      return { phase: 'idle' };
  }
}

/** The customer-language sentence for a refusal code lives in strings.ts. */
export const refusalKey = (code: RefusalCode): StringKey => `refusal.${code}` as StringKey;

const samePlatforms = (a: readonly StudioPlatform[], b: readonly StudioPlatform[]): boolean => {
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((v, i) => v === right[i]);
};

const randomOpId = (): string => {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = Math.floor(Math.random() * 16);
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

export interface NewRequest {
  readonly state: SubmitState;
  submit(goal: string, platforms: StudioPlatform[]): Promise<void>;
}

/**
 * `pid` is the hub project id. `onDone` runs one second after a `done` receipt; the screen goes
 * back to the project then. The link is a credential, but nothing here logs text.
 */
export function useNewRequest(pid: string, onDone: () => void): NewRequest {
  const [state, setState] = useState<SubmitState>({ phase: 'idle' });
  const stateRef = useRef(state);
  stateRef.current = state;
  const last = useRef<{ goal: string; platforms: StudioPlatform[] } | null>(null);
  const retried = useRef(false);
  const inFlight = useRef(false);
  const queryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const doneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = useCallback(() => {
    if (queryTimer.current) clearTimeout(queryTimer.current);
    if (doneTimer.current) clearTimeout(doneTimer.current);
    queryTimer.current = null;
    doneTimer.current = null;
  }, []);

  const settle = useCallback(
    (receipt: StudioReceipt) => {
      console.log('[settle]', receipt.state, receipt.opId, 'current', stateRef.current);
      if (receipt.opId !== stateRef.current.opId) return;
      if (receipt.state === 'queued') {
        const next = submitNext(stateRef.current, { type: 'queued' });
        console.log('[settle] queued ->', next);
        stateRef.current = next;
        setState(next);
        clearDraft(pid);
        return;
      }
      if (receipt.state === 'done') {
        clearTimers();
        const next: SubmitState = { phase: 'done', opId: receipt.opId };
        stateRef.current = next;
        setState(next);
        clearDraft(pid);
        clearPending(pid);
        doneTimer.current = setTimeout(onDone, 1000);
        return;
      }
      if (receipt.state === 'refused') {
        clearTimers();
        const next: SubmitState = { phase: 'refused', opId: receipt.opId, code: receipt.code };
        stateRef.current = next;
        setState(next);
        // The opId is terminal at the hub; a retry must be a new opId (and may edit the text).
        clearPending(pid);
        return;
      }
      // expired: the hub did not get to it; the text stays so the customer can send it again.
      clearTimers();
      const next: SubmitState = { phase: 'failed', opId: receipt.opId, failure: 'expired' };
      stateRef.current = next;
      setState(next);
      clearPending(pid);
    },
    [clearTimers, onDone, pid],
  );

  const query = useCallback(async () => {
    const payload = last.current;
    const opId = stateRef.current.opId;
    if (!payload || !opId || stateRef.current.phase !== 'queued') return;
    const action: StudioAction = {
      t: 'action',
      opId,
      kind: 'plan.create',
      payload: { goal: payload.goal, platforms: payload.platforms },
    };
    // Idempotent: the hub returns the current receipt, it does not add a second queue entry.
    const r = await hub.send(pid, action);
    if (r.ok) settle(r.value);
  }, [pid, settle]);

  const submit = useCallback(
    async (goal: string, platforms: StudioPlatform[]) => {
      const phase = stateRef.current.phase;
      if (inFlight.current || phase === 'sending' || phase === 'queued' || phase === 'done') return;
      inFlight.current = true;
      last.current = { goal, platforms };
      retried.current = false;

      const pending = readPending(pid);
      const reuse = pending !== undefined && pending.goal === goal && samePlatforms(pending.platforms, platforms);
      const opId = reuse ? pending.opId : randomOpId();
      writePending(pid, { opId, goal, platforms, updatedAt: Date.now() });
      // Update the ref in the same tick: a fast local answer must not arrive before React has
      // rendered the sending state, or its receipt would look like it belonged to another opId.
      console.log('[submit] start', phase, opId);
      const started: SubmitState = { phase: 'sending', opId };
      stateRef.current = started;
      setState(started);

      try {
        const action: StudioAction = { t: 'action', opId, kind: 'plan.create', payload: { goal, platforms } };
        const r = await hub.send(pid, action);
        console.log('[submit] result', r.ok, r.ok ? r.value : r.error);
        if (r.ok) {
          settle(r.value);
          return;
        }
        if (r.error.kind === 'signed-out') {
          session.clear();
          return;
        }
        const failure = r.error.kind === 'offline' ? 'offline' : 'http';
        const next = submitNext(stateRef.current, { type: 'failed', failure });
        stateRef.current = next;
        setState(next);
      } finally {
        inFlight.current = false;
      }
    },
    [pid, settle],
  );

  // While queued, a WS receipt (from a daemon that is online) settles it; on open, ask once with
  // the same opId in case the receipt was sent before the socket was listening.
  useEffect(() => {
    if (state.phase !== 'queued' || !state.opId) return;
    const close = hub.watch(pid, {
      frame: (f) => {
        if (f.t === 'receipt' && f.opId === state.opId) settle(f);
      },
      state: (s) => {
        if (s === 'open') void query();
      },
    });
    return close;
  }, [pid, state.phase, state.opId, settle, query]);

  // One idempotent status query after the queued answer: covers a WS frame that raced the HTTP
  // answer. It cannot add a second action (same opId, docs/studio-hub.md §7.1 step 4).
  useEffect(() => {
    if (state.phase !== 'queued') return;
    const id = setTimeout(() => void query(), 1500);
    queryTimer.current = id;
    return () => clearTimeout(id);
  }, [state.phase, query]);

  // A failed send retries once by itself when the network or the page comes back; after that the
  // customer taps Retry. Same opId, so the hub still only has one action.
  useEffect(() => {
    if (state.phase !== 'failed' || state.failure === 'expired' || retried.current) return;
    if (typeof window === 'undefined') return;
    const again = () => {
      if (retried.current || !last.current || !isOnline()) return;
      retried.current = true;
      void submit(last.current.goal, last.current.platforms);
    };
    const visible = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') again();
    };
    window.addEventListener('online', again);
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.removeEventListener('online', again);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [state.phase, state.failure, submit]);

  useEffect(() => {
    console.log('[state]', state);
  }, [state]);

  useEffect(() => () => clearTimers(), [clearTimers]);

  return { state, submit };
}
