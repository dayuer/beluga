import { useEffect } from 'react';
import * as Crypto from 'expo-crypto';
import * as Notifications from 'expo-notifications';
import { Linking, Platform } from 'react-native';
import { isBooted } from './boot';
import { kv } from './kv';
import { isOnline } from './net';
import {
  deniedPermissionHint as deniedPermissionHintCore,
  getOrCreateDeviceId as getOrCreateDeviceIdCore,
  getPushEnabled as getPushEnabledCore,
  initPushRegistration as initPushRegistrationCore,
  registerPush as registerPushCore,
  requestPushPermission as requestPushPermissionCore,
  setPushEnabled as setPushEnabledCore,
  unregisterPush as unregisterPushCore,
  type PushCoreDeps,
  type PushNotificationsApi,
  type PushPermissionState,
  type RegisterPushResult,
} from './push-core';
import { session } from './session';
import { detectLang } from './strings';
import type { Lang } from './strings/table.js';
import { ink } from './theme';

export type {
  PendingUnregisterRecord,
  PushCoreDeps as PushDeps,
  PushNotificationsApi,
  PushPermissionState,
  PushPermissionStatus,
  PushPlatform,
  RegisteredPushRecord,
  RegisterPushResult,
} from './push-core';

function withDefaults(deps: PushCoreDeps = {}): PushCoreDeps {
  return {
    notifications: deps.notifications ?? (Notifications as unknown as PushNotificationsApi),
    fetch: deps.fetch,
    openSettings: deps.openSettings ?? (() => Linking.openSettings()),
    getToken: deps.getToken ?? (() => session.snapshot()),
    subscribeSession: deps.subscribeSession ?? session.subscribe,
    isOnline: deps.isOnline ?? isOnline,
    isDemo: deps.isDemo ?? (() => process.env.EXPO_PUBLIC_DEMO === '1'),
    baseUrl: deps.baseUrl,
    platform: deps.platform ?? Platform.OS,
    lang: deps.lang ?? detectLang(),
    kv: deps.kv ?? kv,
    randomId: deps.randomId ?? (() => Crypto.randomUUID()),
    isHydrated: deps.isHydrated ?? isBooted,
    channelLightColor: deps.channelLightColor ?? ink.peach,
  };
}

export function deniedPermissionHint(lang: Lang = detectLang(), platform: string = Platform.OS): string {
  return deniedPermissionHintCore(lang, platform);
}

export function getPushEnabled(
  store: Pick<typeof kv, 'get'> = kv,
  hydrated: () => boolean = isBooted,
): boolean {
  return getPushEnabledCore(store, hydrated);
}

export async function setPushEnabled(enabled: boolean, deps: PushCoreDeps = {}): Promise<void> {
  return setPushEnabledCore(enabled, withDefaults(deps));
}

export function getOrCreateDeviceId(deps: PushCoreDeps = {}): string {
  return getOrCreateDeviceIdCore(withDefaults(deps));
}

export async function openNotificationSettings(deps: PushCoreDeps = {}): Promise<void> {
  await withDefaults(deps).openSettings?.();
}

export async function requestPushPermission(ask: boolean, deps: PushCoreDeps = {}): Promise<PushPermissionState> {
  return requestPushPermissionCore(ask, withDefaults(deps));
}

export async function registerPush(
  options: { readonly askPermission?: boolean; readonly force?: boolean } = {},
  deps: PushCoreDeps = {},
): Promise<RegisterPushResult> {
  return registerPushCore(options, withDefaults(deps));
}

export async function unregisterPush(sessionTokenOverride?: string, deps: PushCoreDeps = {}): Promise<boolean> {
  return unregisterPushCore(sessionTokenOverride, withDefaults(deps));
}

export function initPushRegistration(deps: PushCoreDeps = {}): () => void {
  return initPushRegistrationCore(withDefaults(deps));
}

/** React Hook：在根布局挂载期间维护推送注册与登出注销。 */
export function usePushRegistration(): void {
  useEffect(() => initPushRegistration(), []);
}
