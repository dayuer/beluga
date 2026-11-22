import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

export interface AppStateLike {
  readonly currentState?: string | null;
  addEventListener(type: 'change', listener: (state: string) => void): { remove: () => void };
}

/**
 * 订阅 App 从后台（background / inactive）回到前台（active）的事件。
 * 仅在状态从非 active 切回 active 时触发 `fn`；active -> active 不触发。
 */
export function onResume(fn: () => void, appState: AppStateLike | undefined = AppState): () => void {
  if (!appState || typeof appState.addEventListener !== 'function') return () => {};
  let last = appState.currentState ?? 'active';
  const sub = appState.addEventListener('change', (next) => {
    const wasActive = last === 'active';
    last = next;
    if (!wasActive && next === 'active') fn();
  });
  return () => sub.remove();
}

/** React Hook：在组件挂载期间订阅回前台事件并自动调用最新回调。 */
export function useOnResume(fn: () => void, appState: AppStateLike | undefined = AppState): void {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => onResume(() => ref.current(), appState), [appState]);
}
