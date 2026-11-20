import { useCallback } from 'react';
import type { PrimaryButtonState } from '../components/PrimaryButton';
import { useSend, type SendHandlers, type SendableAction } from './send';
import { detectLang } from './strings';
import { signRefusalFallback, signRefusalMessage, signT } from './strings/sign';
import type { SubmitState } from './submit';

export interface SignedActionController {
  readonly buttonState: PrimaryButtonState;
  readonly error: string | null;
  send(build: (opId: string) => SendableAction, handlers?: SendHandlers): Promise<void>;
  retry(): Promise<void>;
  reset(): void;
}

export function mapSubmitToButtonState(state: SubmitState): PrimaryButtonState {
  if (state.phase === 'sending' || state.phase === 'queued') return 'working';
  if (state.phase === 'done') return 'done';
  return 'idle';
}

/**
 * Signed-action send controller (SS-177 / SS-212):
 * maps `sending`/`queued` -> `working`, `done` -> `done`, `refused`/`failed` -> `idle`
 * with localized messages from `lib/strings/sign.ts`.
 */
export function useSignedAction(pid: string, key: string): SignedActionController {
  const sender = useSend(pid, key);
  const lang = detectLang();
  const buttonState = mapSubmitToButtonState(sender.state);

  let error: string | null = null;
  if (sender.state.phase === 'refused') {
    const code = sender.state.code ?? 'not-allowed';
    error = signRefusalMessage(lang, code) ?? signRefusalFallback(lang, code);
  } else if (sender.state.phase === 'failed') {
    if (sender.state.failure === 'offline') {
      error = signT(lang, 'sign.waitingOffline');
    } else if (sender.state.failure === 'expired') {
      error = signT(lang, 'sign.expired');
    } else {
      error = signT(lang, 'sign.sendFailed');
    }
  }

  const send = useCallback(
    async (build: (opId: string) => SendableAction, handlers: SendHandlers = {}) => {
      await sender.send(build, handlers);
    },
    [sender],
  );

  return {
    buttonState,
    error,
    send,
    retry: sender.retry,
    reset: sender.reset,
  };
}
