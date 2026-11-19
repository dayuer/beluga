/**
 * APNs（.p8 -> ES256 JWT）与 FCM HTTP v1（服务账号 RS256 JWT 换取 access_token）推送发送器（SS-80）。
 * 密钥从 Worker secrets 读取；遇到失效令牌（Unregistered / BadDeviceToken）时自动从 push_tokens 删除。
 */

import { sendFcmNotification } from './push-fcm.js';
import { deletePushTokenByValue, listPushTokensForCustomer, type PushTokenRecord } from './push-tokens.js';

export interface PushEnv {
  readonly DB: D1Database;
  readonly APNS_KEY_ID?: string;
  readonly APNS_TEAM_ID?: string;
  readonly APNS_PRIVATE_KEY?: string;
  readonly APNS_BUNDLE_ID?: string;
  readonly APNS_SANDBOX?: string;
  readonly APNS_ENDPOINT?: string;
  readonly FCM_SERVICE_ACCOUNT_JSON?: string;
  readonly FCM_PROJECT_ID?: string;
  readonly FCM_CLIENT_EMAIL?: string;
  readonly FCM_PRIVATE_KEY?: string;
  readonly FCM_ENDPOINT?: string;
  readonly FCM_TOKEN_URI?: string;
}

export interface PushPayload {
  readonly title: string;
  readonly body: string;
  readonly path?: string;
  readonly data?: Record<string, string>;
}

export interface PushSendResult {
  readonly sent: number;
  readonly failed: number;
  readonly removed: number;
}

export interface PushOptions {
  readonly fetch?: typeof fetch;
  readonly now?: number;
}

const textEncoder = new TextEncoder();
const APNS_TOKEN_TTL_MS = 50 * 60 * 1000;
const apnsTokenCache = new Map<string, { readonly jwt: string; readonly issuedAtMs: number }>();

/** 仅用于测试清理模块级 APNs JWT 缓存。 */
export function clearApnsTokenCache(): void {
  apnsTokenCache.clear();
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlJson(value: unknown): string {
  return base64UrlEncode(textEncoder.encode(JSON.stringify(value)));
}

function pemToPkcs8Bytes(pem: string): Uint8Array<ArrayBuffer> {
  const normalized = pem.replace(/\\n/g, '\n');
  const body = normalized
    .replace(/-----BEGIN [A-Z0-9 ]+-----/g, '')
    .replace(/-----END [A-Z0-9 ]+-----/g, '')
    .replace(/\s+/g, '');
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** 使用 WebCrypto ES256 签发 APNs Provider JWT。 */
export async function signApnsJwt(input: {
  readonly keyId: string;
  readonly teamId: string;
  readonly privateKeyPem: string;
  readonly nowMs: number;
}): Promise<string> {
  const header = base64UrlJson({ alg: 'ES256', kid: input.keyId });
  const payload = base64UrlJson({ iss: input.teamId, iat: Math.floor(input.nowMs / 1000) });
  const signingInput = `${header}.${payload}`;

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToPkcs8Bytes(input.privateKeyPem),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    textEncoder.encode(signingInput),
  );
  return `${signingInput}.${base64UrlEncode(new Uint8Array(sig))}`;
}

function isApnsInvalidToken(status: number, bodyText: string): boolean {
  if (status === 410) return true;
  if (status !== 400) return false;
  try {
    const parsed = JSON.parse(bodyText) as { reason?: unknown };
    return (
      parsed.reason === 'BadDeviceToken' ||
      parsed.reason === 'Unregistered' ||
      parsed.reason === 'DeviceTokenNotForTopic'
    );
  } catch {
    return false;
  }
}

async function getApnsJwt(input: {
  readonly keyId: string;
  readonly teamId: string;
  readonly privateKeyPem: string;
  readonly nowMs: number;
}): Promise<string> {
  const cacheKey = `${input.teamId}:${input.keyId}`;
  const cached = apnsTokenCache.get(cacheKey);
  if (cached && input.nowMs - cached.issuedAtMs < APNS_TOKEN_TTL_MS) {
    return cached.jwt;
  }
  const jwt = await signApnsJwt(input);
  apnsTokenCache.set(cacheKey, { jwt, issuedAtMs: input.nowMs });
  return jwt;
}

async function sendApns(
  record: PushTokenRecord,
  payload: PushPayload,
  env: PushEnv,
  nowMs: number,
  fetchFn: typeof fetch,
): Promise<'ok' | 'invalid' | 'failed' | 'unconfigured'> {
  if (!env.APNS_KEY_ID || !env.APNS_TEAM_ID || !env.APNS_PRIVATE_KEY || !env.APNS_BUNDLE_ID) {
    return 'unconfigured';
  }
  const jwt = await getApnsJwt({
    keyId: env.APNS_KEY_ID,
    teamId: env.APNS_TEAM_ID,
    privateKeyPem: env.APNS_PRIVATE_KEY,
    nowMs,
  });
  const base =
    env.APNS_ENDPOINT ??
    (env.APNS_SANDBOX === 'true' || env.APNS_SANDBOX === '1'
      ? 'https://api.sandbox.push.apple.com'
      : 'https://api.push.apple.com');
  const url = `${base.replace(/\/+$/, '')}/3/device/${encodeURIComponent(record.token)}`;

  const apnsBody: Record<string, unknown> = {
    aps: {
      alert: { title: payload.title, body: payload.body },
      sound: 'default',
    },
    ...(payload.data ?? {}),
    ...(payload.path !== undefined ? { path: payload.path } : {}),
  };

  const res = await fetchFn(url, {
    method: 'POST',
    headers: {
      authorization: `bearer ${jwt}`,
      'apns-topic': env.APNS_BUNDLE_ID,
      'apns-push-type': 'alert',
      'content-type': 'application/json',
    },
    body: JSON.stringify(apnsBody),
  });

  if (res.ok) return 'ok';
  const text = await res.text();
  return isApnsInvalidToken(res.status, text) ? 'invalid' : 'failed';
}

/** 向指定客户的所有已登记设备发送推送，并在收到失效令牌响应时清理数据库记录。 */
export async function sendPushToCustomer(
  db: D1Database,
  env: PushEnv,
  customerId: string,
  payload: PushPayload,
  opts: PushOptions = {},
): Promise<PushSendResult> {
  const tokens = await listPushTokensForCustomer(db, customerId);
  if (tokens.length === 0) return { sent: 0, failed: 0, removed: 0 };

  const fetchFn = opts.fetch ?? fetch;
  const nowMs = opts.now ?? Date.now();

  let sent = 0;
  let failed = 0;
  let removed = 0;

  for (const record of tokens) {
    let outcome: 'ok' | 'invalid' | 'failed' | 'unconfigured' = 'failed';
    try {
      if (record.platform === 'ios') {
        outcome = await sendApns(record, payload, env, nowMs, fetchFn);
      } else {
        outcome = await sendFcmNotification(record, payload, env, nowMs, fetchFn);
      }
    } catch {
      outcome = 'failed';
    }

    if (outcome === 'ok') {
      sent++;
    } else if (outcome === 'invalid') {
      failed++;
      removed += await deletePushTokenByValue(db, record.token);
    } else if (outcome === 'failed') {
      failed++;
    }
  }

  return { sent, failed, removed };
}
