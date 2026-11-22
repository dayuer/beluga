/**
 * 设备登记路由接口（SS-174 / SS-209）：
 * `POST /v1/app/devices/enroll`
 * 中台不存、也不核对一次性密钥 `k`；仅校验客户会话、查询 `studio_invites` 路由、
 * 标记一次性码已用，并将 `device.enroll` 帧转发给节点核对 HMAC 与登记公钥。
 */

import { authCustomer, bearerOf } from '../../../src/net/studio/session.js';
import { randomToken, sha256Hex } from '../../../src/net/studio/store.js';
import type { D1HubStore } from './d1.js';
import type { Env } from './hub.js';
import { jsonOf } from './reply.js';

export interface InviteRecord {
  readonly id: string;
  readonly studioId: string;
  readonly daemonId?: string;
  readonly expiresAt: number;
  readonly usedAt?: number;
}

export interface EnrolledDeviceRecord {
  readonly deviceId: string;
  readonly customerId: string;
  readonly studioId: string;
  readonly pubkey: string;
  readonly sealPubkey?: string;
  readonly enrolledAt: number;
}

export interface EnrollStore {
  getInvite(inviteId: string): Promise<InviteRecord | undefined>;
  markInviteUsed(inviteId: string, usedAt: number): Promise<boolean>;
  saveDevice(record: EnrolledDeviceRecord): Promise<void>;
}

export interface EnrollForwardInput {
  readonly invite: InviteRecord;
  readonly customerId: string;
  readonly deviceId: string;
  readonly pubkey: string;
  readonly sealPubkey?: string;
  readonly mac: string;
}

export type EnrollForwardResult =
  | { readonly ok: true; readonly fingerprint?: string }
  | { readonly ok: false; readonly status: number; readonly error: string; readonly code?: string };

export type EnrollForwarder = (input: EnrollForwardInput) => Promise<EnrollForwardResult>;

const ENROLL_PATH = '/v1/app/devices/enroll';
const MAX_BODY_BYTES = 16_384;
const NOOP_MAILER = { send: async (): Promise<void> => {} };
const random = (n: number): Uint8Array => crypto.getRandomValues(new Uint8Array(n));

export function d1EnrollStore(db: D1Database): EnrollStore {
  return {
    async getInvite(inviteId) {
      const row = await db
        .prepare('SELECT id, studio_id, daemon_id, expires_at, used_at FROM studio_invites WHERE id = ?')
        .bind(inviteId)
        .first<{ id: string; studio_id: string; daemon_id: string | null; expires_at: number; used_at: number | null }>();
      if (!row) return undefined;
      return {
        id: row.id,
        studioId: row.studio_id,
        ...(row.daemon_id !== null ? { daemonId: row.daemon_id } : {}),
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
          'INSERT INTO studio_devices (device_id, customer_id, studio_id, pubkey, seal_pubkey, enrolled_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .bind(record.deviceId, record.customerId, record.studioId, record.pubkey, record.sealPubkey ?? null, record.enrolledAt)
        .run();
    },
  };
}

export async function handleDeviceEnrollRequest(
  req: Request,
  env: Env,
  hub: D1HubStore,
  now: number,
  options: { readonly store?: EnrollStore; readonly forward?: EnrollForwarder } = {},
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

  const store = options.store ?? d1EnrollStore(env.DB);
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

  const deviceId = `dev_${randomToken(12)}`;

  let fingerprint: string | undefined;
  if (options.forward) {
    const forwarded = await options.forward({
      invite,
      customerId: auth.customer.id,
      deviceId,
      pubkey,
      ...(sealPubkey ? { sealPubkey } : {}),
      mac,
    });
    if (!forwarded.ok) {
      return jsonOf(
        { error: forwarded.error, code: forwarded.code ?? forwarded.error, ...(forwarded.status === 202 ? { waiting: true } : {}) },
        forwarded.status,
      );
    }
    fingerprint = forwarded.fingerprint;
  }

  const consumed = await store.markInviteUsed(inviteId, now);
  if (!consumed) {
    return jsonOf({ error: 'invite-used', code: 'invite-used' }, 409);
  }

  await store.saveDevice({
    deviceId,
    customerId: auth.customer.id,
    studioId: invite.studioId,
    pubkey,
    ...(sealPubkey ? { sealPubkey } : {}),
    enrolledAt: now,
  });

  return jsonOf(
    {
      ok: true,
      deviceId,
      studioId: invite.studioId,
      pubkey,
      ...(fingerprint ? { fingerprint } : {}),
    },
    200,
  );
}

/** The Worker's forwarder: through the invite's studio DO to its daemon. Offline or slow is waiting, never a failure. */
export function relayForwarder(env: Env, call: (studioId: string, path: string, body: unknown) => Promise<Response>): EnrollForwarder {
  return async (input) => {
    if (!input.invite.daemonId) return { ok: false, status: 202, error: 'waiting', code: 'waiting' };
    const res = await call(input.invite.studioId, '/v1/internal/enroll', {
      daemonId: input.invite.daemonId,
      inviteId: input.invite.id,
      deviceId: input.deviceId,
      pubkey: input.pubkey,
      ...(input.sealPubkey ? { sealPubkey: input.sealPubkey } : {}),
      mac: input.mac,
    });
    const reply = (await res.json().catch(() => undefined)) as
      | { status: 'ok'; fingerprint: string }
      | { status: 'refused'; code: string }
      | { status: 'offline' | 'timeout' }
      | undefined;
    if (!res.ok || !reply) return { ok: false, status: 502, error: 'relay-failed' };
    if (reply.status === 'ok') return { ok: true, fingerprint: reply.fingerprint };
    if (reply.status === 'refused') return { ok: false, status: reply.code === 'invite-used' ? 409 : 403, error: reply.code, code: reply.code };
    return { ok: false, status: 202, error: 'waiting', code: 'waiting' };
  };
}

const INVITES_PATH = '/v1/admin/invites';

/** `POST /v1/admin/invites` (operator token): a node-issued invite's route, never its secret. Local dev and the fake node use it. */
export async function handleInviteRouteRequest(req: Request, env: Env, store?: { put(invite: InviteRecord): Promise<void> }): Promise<Response | undefined> {
  if (new URL(req.url).pathname !== INVITES_PATH) return undefined;
  if (req.method !== 'POST') return jsonOf({ error: 'method-not-allowed' }, 405);
  const bearer = bearerOf(req) ?? '';
  const expected = env.OPERATOR_TOKEN ?? '';
  if (!expected || (await sha256Hex(bearer)) !== (await sha256Hex(expected))) return jsonOf({ error: 'not-yours' }, 403);
  const body = (await req.json().catch(() => undefined)) as { inviteId?: string; studioId?: string; daemonId?: string; expiresAt?: number } | undefined;
  if (!body?.inviteId || !body.studioId || typeof body.expiresAt !== 'number') return jsonOf({ error: 'bad-args' }, 400);
  const record: InviteRecord = { id: body.inviteId, studioId: body.studioId, ...(body.daemonId ? { daemonId: body.daemonId } : {}), expiresAt: body.expiresAt };
  await (store ?? d1InviteRoutes(env.DB)).put(record);
  return jsonOf({ ok: true }, 200);
}

function d1InviteRoutes(db: D1Database): { put(invite: InviteRecord): Promise<void> } {
  return {
    async put(invite) {
      await db
        .prepare('INSERT OR IGNORE INTO studio_invites (id, studio_id, daemon_id, expires_at, used_at) VALUES (?, ?, ?, ?, NULL)')
        .bind(invite.id, invite.studioId, invite.daemonId ?? null, invite.expiresAt)
        .run();
    },
  };
}
