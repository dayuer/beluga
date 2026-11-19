import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { StudioAction, StudioPlatform, StudioReceipt } from '../../../src/studio/protocol';
import { hub, live } from './client';
import { clearDraft, clearPending, readPending, writePending } from './drafts';
import { isOnline, subscribeOnline } from './net';
import { session } from './session';
import {
  randomOpId,
  refusalKey,
  submitNext,
  type SubmitEvent,
  type SubmitPhase,
  type SubmitState,
} from './submit-machine';

export { randomOpId, refusalKey, submitNext, type SubmitEvent, type SubmitPhase, type SubmitState };

const samePlatforms = (a: readonly StudioPlatform[], b: readonly StudioPlatform[]): boolean => {
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((v, i) => v === right[i]);
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
    const close = live.subscribe(pid, {
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

  // A failed send retries once by itself when the network or the app comes back to foreground;
  // after that the customer taps Retry. Same opId, so the hub still only has one action.
  useEffect(() => {
    if (state.phase !== 'failed' || state.failure === 'expired' || retried.current) return;
    const again = () => {
      if (retried.current || !last.current || !isOnline()) return;
      retried.current = true;
      void submit(last.current.goal, last.current.platforms);
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
  }, [state.phase, state.failure, submit]);

  useEffect(() => {
    console.log('[state]', state);
  }, [state]);

  useEffect(() => () => clearTimers(), [clearTimers]);

  return { state, submit };
}
