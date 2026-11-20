/**
 * 设备登记接口（SS-174）：
 * `POST /v1/app/devices/enroll`
 * 校验客户会话、核对 `mac = HMAC-SHA256(k, pubkey)`、消费一次性邀请码并返回节点指纹。
 */

import { authCustomer, bearerOf } from '../../../src/net/studio/session.js';
import { randomToken } from '../../../src/net/studio/store.js';
import type { D1HubStore } from './d1.js';
import type { Env } from './hub.js';
import { jsonOf } from './reply.js';

export interface InviteRecord {
  readonly id: string;
  readonly k: string;
  readonly nodeFingerprint: string;
  readonly expiresAt: number;
  readonly usedAt?: number;
}

export interface EnrolledDeviceRecord {
  readonly deviceId: string;
  readonly customerId: string;
  readonly pubkey: string;
  readonly sealPubkey?: string;
  readonly enrolledAt: number;
}

export interface EnrollStore {
  getInvite(inviteId: string): Promise<InviteRecord | undefined>;
  markInviteUsed(inviteId: string, usedAt: number): Promise<boolean>;
  saveDevice(record: EnrolledDeviceRecord): Promise<void>;
}

const ENROLL_PATH = '/v1/app/devices/enroll';
const MAX_BODY_BYTES = 16_384;
const NOOP_MAILER = { send: async (): Promise<void> => {} };
const random = (n: number): Uint8Array => crypto.getRandomValues(new Uint8Array(n));
const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function toBase64Url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = i + 1 < bytes.length ? bytes[i + 1]! : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2]! : 0;
    const triplet = (a << 16) | (b << 8) | c;
    out += B64URL[(triplet >> 18) & 0x3f];
    out += B64URL[(triplet >> 12) & 0x3f];
    if (i + 1 < bytes.length) out += B64URL[(triplet >> 6) & 0x3f];
    if (i + 2 < bytes.length) out += B64URL[triplet & 0x3f];
  }
  return out;
}

function fromBase64Url(input: string): Uint8Array {
  const clean = input.replace(/=+$/, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let pos = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const c0 = B64URL.indexOf(clean[i]!);
    const c1 = B64URL.indexOf(clean[i + 1]!);
    const c2 = i + 2 < clean.length ? B64URL.indexOf(clean[i + 2]!) : 0;
    const c3 = i + 3 < clean.length ? B64URL.indexOf(clean[i + 3]!) : 0;
    if (c0 < 0 || c1 < 0 || c2 < 0 || c3 < 0) throw new Error('Invalid base64url');
    const triplet = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3;
    out[pos++] = (triplet >> 16) & 0xff;
    if (i + 2 < clean.length) out[pos++] = (triplet >> 8) & 0xff;
    if (i + 3 < clean.length) out[pos++] = triplet & 0xff;
  }
  return out.subarray(0, pos);
}

function decodeInviteKey(k: string): Uint8Array {
  try {
    if (/^[A-Za-z0-9_-]+$/.test(k) && k.length >= 16) {
      return fromBase64Url(k);
    }
  } catch {
    // 回退到 UTF-8
  }
  return new TextEncoder().encode(k);
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a[i]! ^ b[i]!;
  }
  return diff === 0;
}

async function verifyEnrollMac(k: string, pubkeyB64: string, macB64: string): Promise<boolean> {
  try {
    const keyBytes = decodeInviteKey(k);
    const pubBytes = fromBase64Url(pubkeyB64);
    const macBytes = fromBase64Url(macB64);
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyBytes as BufferSource,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const expected = new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, pubBytes as BufferSource));
    return timingSafeEqual(expected, macBytes);
  } catch {
    return false;
  }
}

export function d1EnrollStore(db: D1Database): EnrollStore {
  return {
    async getInvite(inviteId) {
      const row = await db
        .prepare('SELECT id, k, node_fingerprint, expires_at, used_at FROM studio_invites WHERE id = ?')
        .bind(inviteId)
        .first<{ id: string; k: string; node_fingerprint: string; expires_at: number; used_at: number | null }>();
      if (!row) return undefined;
      return {
        id: row.id,
        k: row.k,
        nodeFingerprint: row.node_fingerprint,
        expiresAt: row.expires_at,
        ...(row.used_at !== null ? { usedAt: row.used_at } : {}),
      };
    },
    async markInviteUsed(inviteId, usedAt) {
      const res = await db
        .prepare('UPDATE studio_invites SET used_at = ? WHERE id = ? AND used_at IS NULL')
        .bind(usedAt, inviteId)
        .run();
      return (res.meta?.changes ?? 0) > 0;
    },
    async saveDevice(record) {
      await db
        .prepare(
          'INSERT INTO studio_devices (device_id, customer_id, pubkey, seal_pubkey, enrolled_at) VALUES (?, ?, ?, ?, ?)',
        )
        .bind(record.deviceId, record.customerId, record.pubkey, record.sealPubkey ?? null, record.enrolledAt)
        .run();
    },
  };
}

export async function handleDeviceEnrollRequest(
  req: Request,
  env: Env,
  hub: D1HubStore,
  now: number,
  storeOverride?: EnrollStore,
): Promise<Response | undefined> {
  const url = new URL(req.url);
  if (url.pathname !== ENROLL_PATH) return undefined;
  if (req.method !== 'POST') return jsonOf({ error: 'method-not-allowed' }, 405);

  const auth = await authCustomer(bearerOf(req), {
    hub,
    now,
    random,
    mailer: NOOP_MAILER,
    origin: env.HUB_ORIGIN ?? '',
  });
  if (!auth.ok) return jsonOf({ error: auth.error }, auth.status);

  let rawText: string;
  try {
    rawText = await req.text();
  } catch {
    return jsonOf({ error: 'bad-body' }, 400);
  }
  if (rawText.length === 0 || rawText.length > MAX_BODY_BYTES) {
    return jsonOf({ error: 'bad-body' }, 400);
  }

  let body: Record<string, unknown>;
  try {
    const parsed = JSON.parse(rawText) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return jsonOf({ error: 'bad-body' }, 400);
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return jsonOf({ error: 'bad-body' }, 400);
  }

  const inviteId = typeof body.inviteId === 'string' ? body.inviteId.trim() : '';
  const pubkey = typeof body.pubkey === 'string' ? body.pubkey.trim() : '';
  const mac = typeof body.mac === 'string' ? body.mac.trim() : '';
  const sealPubkey = typeof body.sealPubkey === 'string' ? body.sealPubkey.trim() : undefined;
  if (!inviteId || !pubkey || !mac) {
    return jsonOf({ error: 'bad-args', code: 'bad-args' }, 400);
  }

  const store = storeOverride ?? d1EnrollStore(env.DB);
  const invite = await store.getInvite(inviteId);
  if (!invite) {
    return jsonOf({ error: 'unknown-invite', code: 'unknown-invite' }, 404);
  }
  if (invite.usedAt !== undefined) {
    return jsonOf({ error: 'invite-used', code: 'invite-used' }, 409);
  }
  if (now > invite.expiresAt) {
    return jsonOf({ error: 'invite-expired', code: 'invite-expired' }, 410);
  }

  const macOk = await verifyEnrollMac(invite.k, pubkey, mac);
  if (!macOk) {
    return jsonOf({ error: 'bad-mac', code: 'bad-mac' }, 403);
  }

  const consumed = await store.markInviteUsed(inviteId, now);
  if (!consumed) {
    return jsonOf({ error: 'invite-used', code: 'invite-used' }, 409);
  }

  const deviceId = `dev_${randomToken(12)}`;
  await store.saveDevice({
    deviceId,
    customerId: auth.customer.id,
    pubkey,
    ...(sealPubkey ? { sealPubkey } : {}),
    enrolledAt: now,
  });

  return jsonOf(
    {
      ok: true,
      deviceId,
      pubkey,
      fingerprint: invite.nodeFingerprint,
    },
    200,
  );
}
