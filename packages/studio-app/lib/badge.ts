import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { onResume } from './resume';
import { session } from './session';
import { fetchTodos, type TodosResult } from './todo-store';

export interface BadgeNotificationsApi {
  setBadgeCountAsync: (count: number) => Promise<boolean | void>;
}

export interface BadgeDeps {
  readonly notifications?: BadgeNotificationsApi;
  readonly fetchTodos?: (force?: boolean) => Promise<TodosResult>;
  readonly getToken?: () => string | null;
  readonly subscribeSession?: (listener: () => void) => () => void;
  readonly subscribeResume?: (fn: () => void) => () => void;
  readonly platform?: string;
}

let currentCount = 0;

function normalizeCount(count: number): number {
  if (!Number.isFinite(count)) return 0;
  return Math.max(0, Math.floor(count));
}

/** 返回当前内存记录的角标数（主要用于测试与乐观减一）。 */
export function getBadgeCount(): number {
  return currentCount;
}

/** 仅用于测试重置模块级角标计数。 */
export function resetBadgeForTest(): void {
  currentCount = 0;
}

/** 直接设置 App 图标角标数（自动截断为非负整数；Web 端忽略）。 */
export async function setBadgeCount(count: number, deps: BadgeDeps = {}): Promise<number> {
  const next = normalizeCount(count);
  currentCount = next;
  const platform = deps.platform ?? Platform.OS;
  if (platform === 'web' && !deps.notifications) return next;
  const notifications = deps.notifications ?? Notifications;
  try {
    await notifications.setBadgeCountAsync(next);
  } catch {
    // 部分平台或模拟器不支持角标时静默降级，不阻断主流程。
  }
  return next;
}

/** 从 todo-store 拉取「要你做的」数量并更新角标；未登录时清零。 */
export async function syncBadge(force = false, deps: BadgeDeps = {}): Promise<number> {
  const getToken = deps.getToken ?? (() => session.snapshot());
  if (!getToken()) {
    return setBadgeCount(0, deps);
  }
  const load = deps.fetchTodos ?? fetchTodos;
  try {
    const result = await load(force);
    return setBadgeCount(result.todos.length, deps);
  } catch {
    return currentCount;
  }
}

/** 处理掉一张待办卡时立即将角标减一（最低为 0），避免等待网络刷新才变化。 */
export async function decrementBadge(delta = 1, deps: BadgeDeps = {}): Promise<number> {
  const step = Number.isFinite(delta) ? Math.max(0, Math.floor(delta)) : 1;
  return setBadgeCount(currentCount - step, deps);
}

/**
 * 订阅回前台（onResume）与登录态变化（session.subscribe），保持图标角标与待办数一致；
 * 退出登录时自动清零。
 */
export function initBadgeSync(deps: BadgeDeps = {}): () => void {
  const getToken = deps.getToken ?? (() => session.snapshot());
  const subscribeSession = deps.subscribeSession ?? session.subscribe;
  const subscribeResume = deps.subscribeResume ?? ((fn: () => void) => onResume(fn));

  let disposed = false;
  let lastToken = getToken();

  const runSync = (force: boolean): void => {
    if (disposed) return;
    void syncBadge(force, deps);
  };

  runSync(false);

  const unsubResume = subscribeResume(() => {
    runSync(true);
  });

  const unsubSession = subscribeSession(() => {
    if (disposed) return;
    const nextToken = getToken();
    if (nextToken === lastToken) return;
    lastToken = nextToken;
    if (!nextToken) {
      void setBadgeCount(0, deps);
    } else {
      runSync(true);
    }
  });

  return () => {
    disposed = true;
    unsubResume();
    unsubSession();
  };
}

/** React Hook：在根布局挂载期间自动同步角标。 */
export function useBadgeSync(): void {
  useEffect(() => initBadgeSync(), []);
}
