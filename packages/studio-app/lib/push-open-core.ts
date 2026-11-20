import { parseDeepLink } from './links';

export interface NotificationResponseLike {
  readonly actionIdentifier?: string;
  readonly notification?: {
    readonly request?: {
      readonly identifier?: string;
      readonly content?: {
        readonly data?: unknown;
      };
    };
  };
}

export interface NotificationsOpenApi {
  readonly DEFAULT_ACTION_IDENTIFIER?: string;
  getLastNotificationResponseAsync?: () => Promise<NotificationResponseLike | null | undefined>;
  getLastNotificationResponse?: () => NotificationResponseLike | null | undefined;
  addNotificationResponseReceivedListener: (
    listener: (response: NotificationResponseLike) => void,
  ) => { remove: () => void };
}

export interface PushOpenOptions {
  readonly navigate?: (path: string) => void;
  readonly notifications?: NotificationsOpenApi;
  readonly hubUrl?: string;
  readonly handled?: Set<string>;
  /** 是否已完成登录；未登录时先暂存目标路由，登录后再跳转。 */
  readonly isAuthenticated?: () => boolean;
  readonly subscribeAuth?: (listener: () => void) => () => void;
}

const DEFAULT_ACTION = 'expo.modules.notifications.actions.DEFAULT';
const MAX_HANDLED = 100;
const globalHandled = new Set<string>();

function readDataObject(raw: unknown): Record<string, unknown> | null {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * 从通知点击载荷中提取并校验应用内路由；仅响应默认点击动作（不提供批准等额外按钮）。
 */
export function extractPushPath(
  response: NotificationResponseLike | null | undefined,
  hubUrl?: string,
  defaultActionId = DEFAULT_ACTION,
): string | null {
  if (!response) return null;
  if (response.actionIdentifier && response.actionIdentifier !== defaultActionId) {
    return null;
  }
  const data = readDataObject(response.notification?.request?.content?.data);
  if (!data) return null;
  const rawPath = typeof data.path === 'string' ? data.path : null;
  return parseDeepLink(rawPath, hubUrl);
}

function responseKey(response: NotificationResponseLike): string | null {
  const id = response.notification?.request?.identifier;
  if (!id) return null;
  return `${id}:${response.actionIdentifier ?? ''}`;
}

function rememberHandled(handled: Set<string>, key: string): boolean {
  if (handled.has(key)) return false;
  if (handled.size >= MAX_HANDLED) {
    const oldest = handled.values().next().value;
    if (oldest !== undefined) handled.delete(oldest);
  }
  handled.add(key);
  return true;
}

/**
 * 监听通知点击（后台/前台）与冷启动的 lastNotificationResponse，
 * 将 payload.path 交给 lib/links.ts 解析后跳转到 `/request/<id>?card=<cardId>`。
 */
export function initPushOpen(options: PushOpenOptions = {}): () => void {
  if (!options.notifications || !options.navigate) {
    return () => {};
  }
  const notifications = options.notifications;
  const navigate = options.navigate;
  const handled = options.handled ?? globalHandled;
  const defaultActionId = notifications.DEFAULT_ACTION_IDENTIFIER ?? DEFAULT_ACTION;
  const isAuthenticated = options.isAuthenticated ?? (() => true);

  let disposed = false;
  let pendingTarget: string | null = null;

  const flushPending = (): void => {
    if (disposed || !pendingTarget || !isAuthenticated()) return;
    const next = pendingTarget;
    pendingTarget = null;
    navigate(next);
  };

  const handle = (response: NotificationResponseLike | null | undefined): void => {
    if (disposed || !response) return;
    const target = extractPushPath(response, options.hubUrl, defaultActionId);
    if (!target) return;
    const key = responseKey(response);
    if (key && !rememberHandled(handled, key)) return;
    if (isAuthenticated()) {
      pendingTarget = null;
      navigate(target);
    } else {
      pendingTarget = target;
    }
  };

  const unsubAuth = options.subscribeAuth ? options.subscribeAuth(flushPending) : undefined;
  const sub = notifications.addNotificationResponseReceivedListener(handle);

  if (typeof notifications.getLastNotificationResponseAsync === 'function') {
    void notifications
      .getLastNotificationResponseAsync()
      .then(handle)
      .catch(() => undefined);
  } else if (typeof notifications.getLastNotificationResponse === 'function') {
    try {
      handle(notifications.getLastNotificationResponse());
    } catch {
      // 忽略冷启动读取异常，避免影响应用启动。
    }
  }

  return () => {
    disposed = true;
    sub.remove();
    unsubAuth?.();
  };
}

/** 仅用于测试清理模块级去重记录。 */
export function resetPushOpenForTest(): void {
  globalHandled.clear();
}
