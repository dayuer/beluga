import { en as pushEn, zh as pushZh } from './strings/push';
import type { Lang } from './strings/table.js';

export type PushPlatform = 'ios' | 'android';
export type PushPermissionStatus = 'granted' | 'denied' | 'unsupported';

export interface PushPermissionState {
  readonly status: PushPermissionStatus;
  readonly canAskAgain: boolean;
  readonly hint: string | null;
}

export interface RegisteredPushRecord {
  readonly device: string;
  readonly platform: PushPlatform;
  readonly token: string;
}

export interface PendingUnregisterRecord {
  readonly device: string;
  readonly token?: string;
}

export interface PushKvStore {
  get<T>(key: string): T | undefined;
  set(key: string, value: unknown): void;
  remove(key: string): void;
}

export interface PushNotificationsApi {
  getPermissionsAsync: () => Promise<{ granted: boolean; canAskAgain?: boolean }>;
  requestPermissionsAsync: () => Promise<{ granted: boolean; canAskAgain?: boolean }>;
  getDevicePushTokenAsync: () => Promise<{ type?: string; data: unknown }>;
  setNotificationChannelAsync?: (
    channelId: string,
    channel: { name: string; importance: number; lightColor?: string },
  ) => Promise<unknown>;
  readonly AndroidImportance?: { readonly HIGH: number; readonly DEFAULT: number };
}

export interface PushCoreDeps {
  readonly notifications?: PushNotificationsApi;
  readonly fetch?: typeof fetch;
  readonly openSettings?: () => Promise<void>;
  readonly getToken?: () => string | null;
  readonly subscribeSession?: (listener: () => void) => () => void;
  readonly isOnline?: () => boolean;
  readonly isDemo?: () => boolean;
  readonly baseUrl?: string;
  readonly platform?: string;
  readonly lang?: Lang;
  readonly kv?: PushKvStore;
  readonly randomId?: () => string;
  readonly isHydrated?: () => boolean;
  readonly channelLightColor?: string;
}

export type RegisterPushResult =
  | { readonly ok: true; readonly status: 'registered' | 'cached' | 'demo'; readonly device: string; readonly token: string }
  | { readonly ok: false; readonly reason: 'unhydrated' | 'disabled' | 'signed-out' | 'unsupported' | 'denied' | 'offline' | 'error'; readonly hint?: string };

const KV_PUSH_ENABLED = 'push:enabled';
const KV_DEVICE_ID = 'push:deviceId';
const KV_REGISTERED = 'push:registered';
const KV_PENDING_UNREGISTER = 'push:pendingUnregister';
const TIMEOUT_MS = 10_000;

function hubBase(deps: PushCoreDeps): string {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  const raw = deps.baseUrl ?? env?.EXPO_PUBLIC_HUB_URL ?? '';
  return raw.replace(/\/+$/, '');
}

function demoActive(deps: PushCoreDeps): boolean {
  if (deps.isDemo) return deps.isDemo();
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return env?.EXPO_PUBLIC_DEMO === '1';
}

function platformOf(deps: PushCoreDeps): PushPlatform | null {
  const os = deps.platform;
  if (os === 'ios' || os === 'android') return os;
  return null;
}

/** 拒绝通知权限时，在「设置 › 通知」展示的系统开启指引。 */
export function deniedPermissionHint(lang: Lang = 'zh', platform = 'ios'): string {
  const dict = lang === 'en' ? pushEn : pushZh;
  return platform === 'android' ? dict['push.denied.android'] : dict['push.denied.ios'];
}

/** 读取「设置 › 账号」中的通知总开关（默认开启；未完成启动补水时拒绝读取）。 */
export function getPushEnabled(
  store: Pick<PushKvStore, 'get'>,
  hydrated: () => boolean = () => true,
): boolean {
  if (!hydrated()) throw new Error('push: kv not hydrated');
  const saved = store.get<unknown>(KV_PUSH_ENABLED);
  return typeof saved === 'boolean' ? saved : true;
}

/** 更新通知总开关，并同步向中台注册或注销当前设备。 */
export async function setPushEnabled(enabled: boolean, deps: PushCoreDeps): Promise<void> {
  if (!deps.kv) throw new Error('push: kv store required');
  deps.kv.set(KV_PUSH_ENABLED, enabled);
  if (enabled) {
    await registerPush({ askPermission: true }, deps);
  } else {
    await unregisterPush(undefined, deps);
  }
}

export function getOrCreateDeviceId(deps: PushCoreDeps): string {
  const hydrated = deps.isHydrated ?? (() => true);
  if (!hydrated()) throw new Error('push: kv not hydrated');
  if (!deps.kv) throw new Error('push: kv store required');
  const existing = deps.kv.get<unknown>(KV_DEVICE_ID);
  if (typeof existing === 'string' && existing.trim().length > 0) {
    return existing;
  }
  const gen = deps.randomId ?? (() => globalThis.crypto.randomUUID());
  const id = `app-${gen()}`;
  deps.kv.set(KV_DEVICE_ID, id);
  return id;
}

async function ensureChannels(
  notifications: PushNotificationsApi,
  platform: PushPlatform,
  lang: Lang,
  lightColor?: string,
): Promise<void> {
  if (platform !== 'android' || typeof notifications.setNotificationChannelAsync !== 'function') return;
  const high = notifications.AndroidImportance?.HIGH ?? 4;
  const dict = lang === 'en' ? pushEn : pushZh;
  await notifications.setNotificationChannelAsync('needs-you', {
    name: dict['push.channel.needsYou'],
    importance: high,
    ...(lightColor ? { lightColor } : {}),
  });
}

/** 查询或请求系统通知权限；当拒绝权限时附带「设置 › 通知」开启说明。 */
export async function requestPushPermission(ask: boolean, deps: PushCoreDeps): Promise<PushPermissionState> {
  const platform = platformOf(deps);
  if (!platform || !deps.notifications) {
    return { status: 'unsupported', canAskAgain: false, hint: null };
  }
  const lang = deps.lang ?? 'zh';
  try {
    const now = await deps.notifications.getPermissionsAsync();
    if (now.granted) {
      await ensureChannels(deps.notifications, platform, lang, deps.channelLightColor);
      return { status: 'granted', canAskAgain: true, hint: null };
    }
    const canAsk = now.canAskAgain ?? true;
    if (!ask) {
      return { status: 'denied', canAskAgain: canAsk, hint: deniedPermissionHint(lang, platform) };
    }
    if (!canAsk) {
      await deps.openSettings?.();
      return { status: 'denied', canAskAgain: false, hint: deniedPermissionHint(lang, platform) };
    }
    const next = await deps.notifications.requestPermissionsAsync();
    if (next.granted) {
      await ensureChannels(deps.notifications, platform, lang, deps.channelLightColor);
      return { status: 'granted', canAskAgain: true, hint: null };
    }
    return {
      status: 'denied',
      canAskAgain: next.canAskAgain ?? false,
      hint: deniedPermissionHint(lang, platform),
    };
  } catch {
    return { status: 'unsupported', canAskAgain: false, hint: null };
  }
}

async function callPushApi(
  method: 'POST' | 'DELETE',
  sessionToken: string,
  body: Record<string, unknown>,
  deps: PushCoreDeps,
): Promise<{ readonly ok: boolean; readonly status: number }> {
  const doFetch = deps.fetch ?? (typeof fetch === 'undefined' ? undefined : fetch);
  if (!doFetch) return { ok: false, status: 0 };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await doFetch(`${hubBase(deps)}/v1/app/push-tokens`, {
      method,
      headers: {
        authorization: `Bearer ${sessionToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return { ok: res.ok, status: res.status };
  } catch {
    return { ok: false, status: 0 };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 请求权限、获取 APNs/FCM 原生设备令牌（getDevicePushTokenAsync，不走 Expo 推送服务），
 * 并 POST `/v1/app/push-tokens` 交给中台。
 */
export async function registerPush(
  options: { readonly askPermission?: boolean; readonly force?: boolean } = {},
  deps: PushCoreDeps,
): Promise<RegisterPushResult> {
  const hydrated = deps.isHydrated ?? (() => true);
  if (!hydrated()) {
    return { ok: false, reason: 'unhydrated' };
  }

  const store = deps.kv;
  if (!store) return { ok: false, reason: 'error' };
  if (!getPushEnabled(store, hydrated)) {
    return { ok: false, reason: 'disabled' };
  }

  const sessionToken = deps.getToken?.() ?? null;
  if (!sessionToken) {
    return { ok: false, reason: 'signed-out' };
  }

  const platform = platformOf(deps);
  if (!platform) {
    return { ok: false, reason: 'unsupported' };
  }

  if (demoActive(deps)) {
    const device = getOrCreateDeviceId(deps);
    return { ok: true, status: 'demo', device, token: 'demo-device-token' };
  }

  const perm = await requestPushPermission(options.askPermission ?? true, deps);
  if (perm.status === 'unsupported') return { ok: false, reason: 'unsupported' };
  if (perm.status === 'denied') return { ok: false, reason: 'denied', hint: perm.hint ?? undefined };

  const online = deps.isOnline ?? (() => true);
  if (!online()) return { ok: false, reason: 'offline' };

  const pending = store.get<PendingUnregisterRecord>(KV_PENDING_UNREGISTER);
  if (pending?.device) {
    const delRes = await callPushApi(
      'DELETE',
      sessionToken,
      { device: pending.device, ...(pending.token ? { token: pending.token } : {}) },
      deps,
    );
    if (delRes.ok || delRes.status === 404) {
      store.remove(KV_PENDING_UNREGISTER);
      store.remove(KV_REGISTERED);
    }
  }

  if (!deps.notifications) return { ok: false, reason: 'unsupported' };
  let rawDeviceToken: string;
  try {
    const tokenRes = await deps.notifications.getDevicePushTokenAsync();
    rawDeviceToken = typeof tokenRes.data === 'string' ? tokenRes.data.trim() : '';
  } catch {
    return { ok: false, reason: 'error' };
  }
  if (!rawDeviceToken) return { ok: false, reason: 'error' };

  const device = getOrCreateDeviceId(deps);
  const cached = store.get<RegisteredPushRecord>(KV_REGISTERED);
  if (
    !options.force &&
    cached &&
    cached.device === device &&
    cached.platform === platform &&
    cached.token === rawDeviceToken
  ) {
    return { ok: true, status: 'cached', device, token: rawDeviceToken };
  }

  const res = await callPushApi('POST', sessionToken, { device, platform, token: rawDeviceToken }, deps);
  if (!res.ok) return { ok: false, reason: 'error' };

  store.set(KV_REGISTERED, { device, platform, token: rawDeviceToken } satisfies RegisteredPushRecord);
  return { ok: true, status: 'registered', device, token: rawDeviceToken };
}

/**
 * 退出登录或关闭通知开关时向中台注销当前设备的推送令牌。
 * 仅在服务端删除成功（或返回 404）时清理本地缓存；失败时记入待补删队列，下次登录补删。
 */
export async function unregisterPush(sessionTokenOverride: string | undefined, deps: PushCoreDeps): Promise<boolean> {
  const store = deps.kv;
  if (!store) return false;
  const cached = store.get<RegisteredPushRecord>(KV_REGISTERED);
  const pending = store.get<PendingUnregisterRecord>(KV_PENDING_UNREGISTER);
  const device = cached?.device ?? pending?.device;
  const token = cached?.token ?? pending?.token;

  if (demoActive(deps) || !device) {
    store.remove(KV_REGISTERED);
    store.remove(KV_PENDING_UNREGISTER);
    return true;
  }

  const record: PendingUnregisterRecord = { device, ...(token ? { token } : {}) };
  const sessionToken = sessionTokenOverride ?? deps.getToken?.() ?? null;
  if (!sessionToken) {
    store.set(KV_PENDING_UNREGISTER, record);
    return false;
  }

  const online = deps.isOnline ?? (() => true);
  if (!online()) {
    store.set(KV_PENDING_UNREGISTER, record);
    return false;
  }

  const res = await callPushApi('DELETE', sessionToken, { device, ...(token ? { token } : {}) }, deps);
  if (res.ok || res.status === 404) {
    store.remove(KV_REGISTERED);
    store.remove(KV_PENDING_UNREGISTER);
    return true;
  }

  store.set(KV_PENDING_UNREGISTER, record);
  return false;
}

/**
 * 监听登录态变化：登录后（且通知开关开启时）自动登记设备推送令牌；
 * 退出登录时立即使用上一个会话令牌向中台注销，确保退出后不再收到推送。
 */
export function initPushRegistration(deps: PushCoreDeps): () => void {
  const getToken = deps.getToken ?? (() => null);
  const subscribeSession = deps.subscribeSession ?? (() => () => {});
  const hydrated = deps.isHydrated ?? (() => true);

  let disposed = false;
  let lastToken = hydrated() ? getToken() : null;

  if (hydrated() && lastToken) {
    void registerPush({ askPermission: true }, deps);
  }

  const unsub = subscribeSession(() => {
    if (disposed || !hydrated()) return;
    const nextToken = getToken();
    if (nextToken === lastToken) return;
    const prevToken = lastToken;
    lastToken = nextToken;
    if (!nextToken) {
      void unregisterPush(prevToken ?? undefined, deps);
    } else {
      void registerPush({ askPermission: true }, deps);
    }
  });

  return () => {
    disposed = true;
    unsub();
  };
}
