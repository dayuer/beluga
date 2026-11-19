/**
 * FCM HTTP v1 推送发送器（SS-119）。
 * 使用服务账号私钥（RS256，WebCrypto）签发 JWT 换取 OAuth access token，
 * 并缓存至过期前（默认提前 60 秒刷新）；遇到 UNREGISTERED / INVALID_ARGUMENT 时由上层删掉失效令牌。
 */

import type { PushEnv, PushPayload } from './push.js';
import type { PushTokenRecord } from './push-tokens.js';

export interface FcmServiceAccount {
  readonly projectId: string;
  readonly clientEmail: string;
  readonly privateKey: string;
  readonly tokenUri: string;
}

interface CachedToken {
  readonly accessToken: string;
  readonly expiresAtMs: number;
}

const textEncoder = new TextEncoder();
const TOKEN_REFRESH_SKEW_MS = 60_000;
const tokenCache = new Map<string, CachedToken>();

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

/** 仅用于测试清理模块级 access token 缓存。 */
export function clearFcmTokenCache(): void {
  tokenCache.clear();
}

/** 使用 WebCrypto RS256 签发 Google OAuth2 JWT 断言。 */
export async function signServiceAccountJwt(input: {
  readonly clientEmail: string;
  readonly privateKeyPem: string;
  readonly tokenUri: string;
  readonly nowMs: number;
}): Promise<string> {
  const iat = Math.floor(input.nowMs / 1000);
  const header = base64UrlJson({ alg: 'RS256', typ: 'JWT' });
  const payload = base64UrlJson({
    iss: input.clientEmail,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: input.tokenUri,
    iat,
    exp: iat + 3600,
  });
  const signingInput = `${header}.${payload}`;

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToPkcs8Bytes(input.privateKeyPem),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    textEncoder.encode(signingInput),
  );
  return `${signingInput}.${base64UrlEncode(new Uint8Array(sig))}`;
}

export function parseFcmAccount(env: PushEnv): FcmServiceAccount | undefined {
  if (env.FCM_SERVICE_ACCOUNT_JSON) {
    try {
      const parsed = JSON.parse(env.FCM_SERVICE_ACCOUNT_JSON) as Record<string, unknown>;
      const projectId = typeof parsed.project_id === 'string' ? parsed.project_id : env.FCM_PROJECT_ID;
      const clientEmail = typeof parsed.client_email === 'string' ? parsed.client_email : env.FCM_CLIENT_EMAIL;
      const privateKey = typeof parsed.private_key === 'string' ? parsed.private_key : env.FCM_PRIVATE_KEY;
      const tokenUri =
        env.FCM_TOKEN_URI ??
        (typeof parsed.token_uri === 'string' ? parsed.token_uri : 'https://oauth2.googleapis.com/token');
      if (projectId && clientEmail && privateKey) {
        return { projectId, clientEmail, privateKey, tokenUri };
      }
    } catch {
      return undefined;
    }
  }
  if (env.FCM_PROJECT_ID && env.FCM_CLIENT_EMAIL && env.FCM_PRIVATE_KEY) {
    return {
      projectId: env.FCM_PROJECT_ID,
      clientEmail: env.FCM_CLIENT_EMAIL,
      privateKey: env.FCM_PRIVATE_KEY,
      tokenUri: env.FCM_TOKEN_URI ?? 'https://oauth2.googleapis.com/token',
    };
  }
  return undefined;
}

export async function getFcmAccessToken(
  account: FcmServiceAccount,
  nowMs: number,
  fetchFn: typeof fetch,
): Promise<string> {
  const cacheKey = `${account.projectId}:${account.clientEmail}:${account.tokenUri}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && nowMs < cached.expiresAtMs - TOKEN_REFRESH_SKEW_MS) {
    return cached.accessToken;
  }

  const assertion = await signServiceAccountJwt({
    clientEmail: account.clientEmail,
    privateKeyPem: account.privateKey,
    tokenUri: account.tokenUri,
    nowMs,
  });
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  });
  const res = await fetchFn(account.tokenUri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    throw new Error(`fcm-oauth-failed:${res.status}`);
  }
  const data = (await res.json()) as { access_token?: unknown; expires_in?: unknown };
  if (typeof data.access_token !== 'string' || data.access_token.length === 0) {
    throw new Error('fcm-oauth-missing-token');
  }
  const expiresInSec = typeof data.expires_in === 'number' && data.expires_in > 0 ? data.expires_in : 3600;
  tokenCache.set(cacheKey, {
    accessToken: data.access_token,
    expiresAtMs: nowMs + expiresInSec * 1000,
  });
  return data.access_token;
}

export function isFcmInvalidToken(status: number, bodyText: string): boolean {
  if (status === 404) return true;
  if (status !== 400 && status !== 403) return false;
  try {
    const parsed = JSON.parse(bodyText) as {
      error?: { status?: unknown; details?: Array<{ errorCode?: unknown }> };
    };
    const errStatus = parsed.error?.status;
    if (errStatus === 'NOT_FOUND' || errStatus === 'UNREGISTERED') return true;
    const details = parsed.error?.details;
    if (Array.isArray(details)) {
      return details.some((d) => d.errorCode === 'UNREGISTERED' || d.errorCode === 'INVALID_ARGUMENT');
    }
    return false;
  } catch {
    return bodyText.includes('UNREGISTERED');
  }
}

/** 通过 FCM HTTP v1 向一台 Android 设备发送推送。 */
export async function sendFcmNotification(
  record: PushTokenRecord,
  payload: PushPayload,
  env: PushEnv,
  nowMs: number,
  fetchFn: typeof fetch,
): Promise<'ok' | 'invalid' | 'failed' | 'unconfigured'> {
  const account = parseFcmAccount(env);
  if (!account) return 'unconfigured';

  const accessToken = await getFcmAccessToken(account, nowMs, fetchFn);
  const base = (env.FCM_ENDPOINT ?? 'https://fcm.googleapis.com').replace(/\/+$/, '');
  const url = `${base}/v1/projects/${encodeURIComponent(account.projectId)}/messages:send`;

  const data: Record<string, string> = {
    ...(payload.data ?? {}),
    ...(payload.path !== undefined ? { path: payload.path } : {}),
  };

  const res = await fetchFn(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      message: {
        token: record.token,
        notification: { title: payload.title, body: payload.body },
        ...(Object.keys(data).length > 0 ? { data } : {}),
      },
    }),
  });

  if (res.ok) return 'ok';
  const text = await res.text();
  return isFcmInvalidToken(res.status, text) ? 'invalid' : 'failed';
}
