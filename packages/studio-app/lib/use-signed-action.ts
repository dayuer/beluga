import { useCallback } from 'react';
import type { PrimaryButtonState } from '../components/PrimaryButton';
import { useSend, type SendHandlers, type SendableAction } from './send';
import { detectLang } from './strings';
import { signRefusalMessage } from './strings/sign';
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
 * 封装带签名的动作发送状态（SS-177）：
 * - `sending` / `queued` -> 按钮 `working`
 * - `done` -> 按钮 `done`
 * - `refused` -> 按钮回到 `idle`，用 `signRefusalMessage` 给出明确原因，不触发成功回调
 */
export function useSignedAction(pid: string, key: string): SignedActionController {
  const sender = useSend(pid, key);
  const lang = detectLang();
  const buttonState = mapSubmitToButtonState(sender.state);

  let error: string | null = null;
  if (sender.state.phase === 'refused') {
    const code = sender.state.code ?? 'not-allowed';
    error =
      signRefusalMessage(lang, code) ??
      (lang === 'en' ? `Action refused (${code}).` : `操作被拒绝（${code}）。`);
  } else if (sender.state.phase === 'failed') {
    if (sender.state.failure === 'offline') {
      error = lang === 'en' ? 'You are offline. Reconnect and try again.' : '当前没有网络，连上网后再试。';
    } else if (sender.state.failure === 'expired') {
      error = lang === 'en' ? 'Request expired. Please try again.' : '操作已过期，请再试一次。';
    } else {
      error = lang === 'en' ? 'Request failed. Please try again.' : '发送失败，请再试一次。';
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
