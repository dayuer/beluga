import type { RefusalCode } from '../../../src/studio/protocol.js';
import type { StringKey } from './strings/table.js';

/**
 * The submit state machine shared by the request screen and, in M6, chat / decisions / review.
 * A pure reducer (`submitNext`) so the transitions are testable without React Native or a browser.
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

/** The customer-language sentence for a refusal code lives in strings/table.ts. */
export const refusalKey = (code: RefusalCode): StringKey => `refusal.${code}` as StringKey;

export const randomOpId = (): string => {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = Math.floor(Math.random() * 16);
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};
