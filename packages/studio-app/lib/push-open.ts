import { useEffect, useRef } from 'react';
import * as Notifications from 'expo-notifications';
import { router, type Href } from 'expo-router';
import { Platform } from 'react-native';
import {
  extractPushPath as extractPushPathCore,
  initPushOpen as initPushOpenCore,
  resetPushOpenForTest,
  type NotificationResponseLike,
  type NotificationsOpenApi,
  type PushOpenOptions,
} from './push-open-core';

export { resetPushOpenForTest, type NotificationResponseLike, type NotificationsOpenApi, type PushOpenOptions };

export function extractPushPath(
  response: NotificationResponseLike | null | undefined,
  hubUrl = process.env.EXPO_PUBLIC_HUB_URL,
  defaultActionId = Notifications.DEFAULT_ACTION_IDENTIFIER ?? 'expo.modules.notifications.actions.DEFAULT',
): string | null {
  return extractPushPathCore(response, hubUrl, defaultActionId);
}

export function initPushOpen(options: PushOpenOptions = {}): () => void {
  if (Platform.OS === 'web' && !options.notifications) {
    return () => {};
  }
  return initPushOpenCore({
    ...options,
    notifications: options.notifications ?? (Notifications as unknown as NotificationsOpenApi),
    navigate: options.navigate ?? ((path: string) => router.push(path as Href)),
    hubUrl: options.hubUrl ?? process.env.EXPO_PUBLIC_HUB_URL,
  });
}

/** React Hook：在根布局挂载期间监听推送点击与冷启动唤醒；未登录时先暂存，登录后再跳。 */
export function usePushOpen(authenticated = true, navigate?: (path: string) => void): void {
  const navRef = useRef(navigate);
  navRef.current = navigate;
  const authRef = useRef(authenticated);
  authRef.current = authenticated;
  const authListenersRef = useRef(new Set<() => void>());

  useEffect(() => {
    if (!authenticated) return;
    for (const listener of authListenersRef.current) listener();
  }, [authenticated]);

  useEffect(
    () =>
      initPushOpen({
        isAuthenticated: () => authRef.current,
        subscribeAuth: (listener) => {
          authListenersRef.current.add(listener);
          return () => {
            authListenersRef.current.delete(listener);
          };
        },
        navigate: (path) => {
          if (navRef.current) navRef.current(path);
          else router.push(path as Href);
        },
      }),
    [],
  );
}
