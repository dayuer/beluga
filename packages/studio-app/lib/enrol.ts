import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { ensureDeviceKey, sealPublicKey } from './keys';
import { kv } from './kv';
import { isOnline } from './net';
import { session } from './session';
import { fromBase64Url, toBase64Url } from './signed';

/**
 * 邀请链接与扫码加设备共用的登记逻辑（SS-73 / SS-74）：
 * 1) 解析 `inviteId`、`k`（一次性密钥）、`n`（节点公钥指纹）；
 * 2) 生成设备密钥并计算 `mac = HMAC-SHA256(k, pubkey)`；
 * 3) 发送 `device.enroll`，校验节点回传指纹并防止一次性码重复提交。
 */

export interface InviteParams {
  readonly inviteId: string;
  readonly k: string;
  readonly n: string;
}

export type EnrollErrorReason = 'used' | 'expired' | 'fingerprint-mismatch' | 'offline' | 'waiting' | 'failed';

export type EnrollResult =
  | { readonly ok: true; readonly pubkey: string }
  | { readonly ok: false; readonly reason: EnrollErrorReason; readonly detail?: string };

const usedInviteKey = (inviteId: string) => `enroll:used:${inviteId}`;

export function normalizeFingerprint(fp: string): string {
  return fp.replace(/[\s:-]+/g, '').toUpperCase();
}

/** 从完整邀请链接或路由参数中提取 `{ inviteId, k, n }`；缺任一字段返回 `null`。 */
export function parseInvitePayload(raw: string): InviteParams | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const url = trimmed.startsWith('/')
      ? new URL(trimmed, 'https://local.invalid')
      : new URL(trimmed);

    const pathname =
      url.protocol === 'synon:' && url.host
        ? `/${url.host}${url.pathname}`
        : url.pathname;
    const segments = pathname.split('/').filter(Boolean);
    if (segments[0] !== 'join' || segments.length !== 2) return null;
    const inviteId = decodeURIComponent(segments[1]!).trim();

    const hashParams = new URLSearchParams(url.hash.replace(/^#/, ''));
    const k = (hashParams.get('k') ?? url.searchParams.get('k') ?? '').trim();
    const n = (hashParams.get('n') ?? url.searchParams.get('n') ?? '').trim();
    if (!inviteId || !k || !n) return null;
    return { inviteId, k, n };
  } catch {
    return null;
  }
}

function decodeInviteKey(k: string): Uint8Array {
  try {
    if (/^[A-Za-z0-9_-]+$/.test(k) && k.length >= 16) {
      return fromBase64Url(k);
    }
  } catch {
    // 回退到 UTF-8 编码
  }
  return new TextEncoder().encode(k);
}

/** 计算 `HMAC-SHA256(k, pubkey)` 并编码为 base64url。 */
export function computeEnrollMac(k: string, pubkey: Uint8Array): string {
  const mac = hmac(sha256, decodeInviteKey(k), pubkey);
  return toBase64Url(mac);
}

function mapServerError(code: string | undefined, status: number): EnrollErrorReason {
  const norm = (code ?? '').toLowerCase();
  if (norm === 'invite-used' || norm === 'used' || norm === 'already-used' || status === 409) {
    return 'used';
  }
  if (norm === 'invite-expired' || norm === 'expired' || status === 410) {
    return 'expired';
  }
  if (norm === 'fingerprint-mismatch' || norm === 'bad-fingerprint') {
    return 'fingerprint-mismatch';
  }
  return 'failed';
}

export interface EnrollOptions {
  readonly baseUrl?: string;
  readonly fetchFn?: typeof fetch;
  readonly token?: string;
}

/** 执行 `device.enroll` 登记：一次性码本地防重、生成密钥、算 HMAC 并核对节点指纹。 */
export async function enrollDevice(invite: InviteParams, options: EnrollOptions = {}): Promise<EnrollResult> {
  if (kv.get<boolean>(usedInviteKey(invite.inviteId))) {
    return { ok: false, reason: 'used' };
  }
  if (!isOnline()) {
    return { ok: false, reason: 'offline' };
  }

  const doFetch = options.fetchFn ?? (typeof fetch === 'undefined' ? undefined : fetch);
  if (!doFetch) {
    return { ok: false, reason: 'offline' };
  }

  const pub = await ensureDeviceKey();
  const sealPub = await sealPublicKey();
  const pubkey = toBase64Url(pub);
  const mac = computeEnrollMac(invite.k, pub);

  // 直接写 process.env.EXPO_PUBLIC_HUB_URL：Expo 只内联这种静态写法（经 globalThis 读不到）。
  const envBase = process.env.EXPO_PUBLIC_HUB_URL;
  const base = (options.baseUrl ?? envBase ?? '').replace(/\/+$/, '');
  const token = options.token ?? session.token();

  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await doFetch(`${base}/v1/app/devices/enroll`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        t: 'device.enroll',
        inviteId: invite.inviteId,
        pubkey,
        ...(sealPub ? { sealPubkey: toBase64Url(sealPub) } : {}),
        mac,
      }),
    });
  } catch {
    return { ok: false, reason: 'offline' };
  }

  let body: { error?: string; code?: string; fingerprint?: string; waiting?: boolean } | undefined;
  try {
    body = (await res.json()) as { error?: string; code?: string; fingerprint?: string; waiting?: boolean };
  } catch {
    body = undefined;
  }

  // The node is offline or slow: the invite is not spent, the customer just waits (waiting-not-failed).
  if (res.status === 202 || body?.waiting) return { ok: false, reason: 'waiting' };

  if (!res.ok) {
    const reason = mapServerError(body?.code ?? body?.error, res.status);
    if (reason === 'used') kv.set(usedInviteKey(invite.inviteId), true);
    return { ok: false, reason, detail: body?.error };
  }

  if (body?.fingerprint && normalizeFingerprint(body.fingerprint) !== normalizeFingerprint(invite.n)) {
    return { ok: false, reason: 'fingerprint-mismatch' };
  }

  kv.set(usedInviteKey(invite.inviteId), true);
  return { ok: true, pubkey };
}
