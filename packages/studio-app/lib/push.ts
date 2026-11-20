import { useEffect } from 'react';
import * as Crypto from 'expo-crypto';
import * as Notifications from 'expo-notifications';
import { Linking, Platform } from 'react-native';
import { isBooted } from './boot';
import { kv } from './kv';
import { isOnline } from './net';
import { session } from './session';
import { detectLang } from './strings';
import { en as pushEn, zh as pushZh } from './strings/push';
import type { Lang } from './strings/table.js';
import { ink } from './theme';

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

export interface PushDeps {
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
  readonly kv?: Pick<typeof kv, 'get' | 'set' | 'remove'>;
  readonly randomId?: () => string;
  readonly isHydrated?: () => boolean;
}

export type RegisterPushResult =
  | { readonly ok: true; readonly status: 'registered' | 'cached' | 'demo'; readonly device: string; readonly token: string }
  | { readonly ok: false; readonly reason: 'unhydrated' | 'disabled' | 'signed-out' | 'unsupported' | 'denied' | 'offline' | 'error'; readonly hint?: string };

const KV_PUSH_ENABLED = 'push:enabled';
const KV_DEVICE_ID = 'push:deviceId';
const KV_REGISTERED = 'push:registered';
const KV_PENDING_UNREGISTER = 'push:pendingUnregister';
const TIMEOUT_MS = 10_000;

interface PendingUnregisterRecord {
  readonly device: string;
  readonly token?: string;
}

function hubBase(deps: PushDeps): string {
  const raw = deps.baseUrl ?? process.env.EXPO_PUBLIC_HUB_URL ?? '';
  return raw.replace(/\/+$/, '');
}

function demoActive(deps: PushDeps): boolean {
  return deps.isDemo ? deps.isDemo() : process.env.EXPO_PUBLIC_DEMO === '1';
}

function platformOf(deps: PushDeps): PushPlatform | null {
  const os = deps.platform ?? Platform.OS;
  if (os === 'ios' || os === 'android') return os;
  return null;
}

/** 拒绝通知权限时，在「设置 › 通知」展示的系统开启指引。 */
export function deniedPermissionHint(lang: Lang = detectLang(), platform: string = Platform.OS): string {
  const dict = lang === 'en' ? pushEn : pushZh;
  return platform === 'android' ? dict['push.denied.android'] : dict['push.denied.ios'];
}

/** 读取「设置 › 账号」中的通知总开关（默认开启；未完成启动补水时拒绝读取）。 */
export function getPushEnabled(
  store: Pick<typeof kv, 'get'> = kv,
  hydrated: () => boolean = isBooted,
): boolean {
  if (!hydrated()) throw new Error('push: kv not hydrated');
  const saved = store.get<unknown>(KV_PUSH_ENABLED);
  return typeof saved === 'boolean' ? saved : true;
}

/** 更新通知总开关，并同步向中台注册或注销当前设备。 */
export async function setPushEnabled(enabled: boolean, deps: PushDeps = {}): Promise<void> {
  const store = deps.kv ?? kv;
  store.set(KV_PUSH_ENABLED, enabled);
  if (enabled) {
    await registerPush({ askPermission: true }, deps);
  } else {
    await unregisterPush(undefined, deps);
  }
}

export function getOrCreateDeviceId(deps: PushDeps = {}): string {
  const hydrated = deps.isHydrated ?? isBooted;
  if (!hydrated()) throw new Error('push: kv not hydrated');
  const store = deps.kv ?? kv;
  const existing = store.get<unknown>(KV_DEVICE_ID);
  if (typeof existing === 'string' && existing.trim().length > 0) {
    return existing;
  }
  const gen = deps.randomId ?? (() => Crypto.randomUUID());
  const id = `app-${gen()}`;
  store.set(KV_DEVICE_ID, id);
  return id;
}

async function ensureChannels(
  notifications: PushNotificationsApi,
  platform: PushPlatform,
  lang: Lang = detectLang(),
): Promise<void> {
  if (platform !== 'android' || typeof notifications.setNotificationChannelAsync !== 'function') return;
  const high = notifications.AndroidImportance?.HIGH ?? Notifications.AndroidImportance?.HIGH ?? 4;
  const dict = lang === 'en' ? pushEn : pushZh;
  await notifications.setNotificationChannelAsync('needs-you', {
    name: dict['push.channel.needsYou'],
    importance: high,
    lightColor: ink.peach,
  });
}

/** 打开系统通知设置页，供用户在被拒绝权限后手动开启。 */
export async function openNotificationSettings(deps: PushDeps = {}): Promise<void> {
  const open = deps.openSettings ?? (() => Linking.openSettings());
  await open();
}

/** 查询或请求系统通知权限；当拒绝权限时附带「设置 › 通知」开启说明。 */
export async function requestPushPermission(ask: boolean, deps: PushDeps = {}): Promise<PushPermissionState> {
  const platform = platformOf(deps);
  if (!platform) {
    return { status: 'unsupported', canAskAgain: false, hint: null };
  }
  const notifications = deps.notifications ?? (Notifications as unknown as PushNotificationsApi);
  const lang = deps.lang ?? detectLang();
  try {
    const now = await notifications.getPermissionsAsync();
    if (now.granted) {
      await ensureChannels(notifications, platform, lang);
      return { status: 'granted', canAskAgain: true, hint: null };
    }
    const canAsk = now.canAskAgain ?? true;
    if (!ask) {
      return { status: 'denied', canAskAgain: canAsk, hint: deniedPermissionHint(lang, platform) };
    }
    if (!canAsk) {
      await openNotificationSettings(deps);
      return { status: 'denied', canAskAgain: false, hint: deniedPermissionHint(lang, platform) };
    }
    const next = await notifications.requestPermissionsAsync();
    if (next.granted) {
      await ensureChannels(notifications, platform, lang);
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
  deps: PushDeps,
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
  deps: PushDeps = {},
): Promise<RegisterPushResult> {
  const hydrated = deps.isHydrated ?? isBooted;
  if (!hydrated()) {
    return { ok: false, reason: 'unhydrated' };
  }

  const store = deps.kv ?? kv;
  if (!getPushEnabled(store, hydrated)) {
    return { ok: false, reason: 'disabled' };
  }

  const getToken = deps.getToken ?? (() => session.snapshot());
  const sessionToken = getToken();
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

  const online = deps.isOnline ?? isOnline;
  if (!online()) return { ok: false, reason: 'offline' };

  // 若上次退出登录时注销推送失败，先用当前有效会话补删旧令牌再登记。
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

  const notifications = deps.notifications ?? (Notifications as unknown as PushNotificationsApi);
  let rawDeviceToken: string;
  try {
    const tokenRes = await notifications.getDevicePushTokenAsync();
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
export async function unregisterPush(sessionTokenOverride?: string, deps: PushDeps = {}): Promise<boolean> {
  const store = deps.kv ?? kv;
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
  const getToken = deps.getToken ?? (() => session.snapshot());
  const sessionToken = sessionTokenOverride ?? getToken();
  if (!sessionToken) {
    store.set(KV_PENDING_UNREGISTER, record);
    return false;
  }

  const online = deps.isOnline ?? isOnline;
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
export function initPushRegistration(deps: PushDeps = {}): () => void {
  const getToken = deps.getToken ?? (() => session.snapshot());
  const subscribeSession = deps.subscribeSession ?? session.subscribe;
  const hydrated = deps.isHydrated ?? isBooted;

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

/** React Hook：在根布局挂载期间维护推送注册与登出注销。 */
export function usePushRegistration(): void {
  useEffect(() => initPushRegistration(), []);
}
