/**
 * 客户设备推送令牌登记与注销接口（SS-79）。
 * 路由：
 * - POST / PUT /v1/app/push-tokens       登记或更新当前登录客户在某台设备上的推送令牌
 * - DELETE     /v1/app/push-tokens       注销推送令牌（支持 path、query 或 JSON body 传 device/token）
 */

import { authCustomer, bearerOf } from '../../../src/net/studio/session.js';
import type { D1HubStore } from './d1.js';
import type { Env } from './hub.js';
import { jsonOf } from './reply.js';

export type PushPlatform = 'ios' | 'android';

export interface PushTokenRecord {
  readonly customerId: string;
  readonly device: string;
  readonly platform: PushPlatform;
  readonly token: string;
  readonly updatedAt: number;
}

interface PushTokenRow {
  readonly customer_id: string;
  readonly device: string;
  readonly platform: PushPlatform;
  readonly token: string;
  readonly updated_at: number;
}

const PUSH_TOKENS_PREFIX = '/v1/app/push-tokens';
const MAX_BODY_BYTES = 16_384;
const random = (n: number): Uint8Array => crypto.getRandomValues(new Uint8Array(n));
const NOOP_MAILER = { send: async (): Promise<void> => {} };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function nonEmptyString(v: unknown, maxLen: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  const trimmed = v.trim();
  if (trimmed.length === 0 || trimmed.length > maxLen) return undefined;
  return trimmed;
}

async function readJsonBody(req: Request): Promise<unknown> {
  try {
    const text = await req.text();
    if (text.length === 0) return {};
    if (text.length > MAX_BODY_BYTES) return undefined;
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** 登记或覆盖同一 (customer_id, device) 的推送令牌，保证同一设备只留一条。 */
export async function upsertPushToken(
  db: D1Database,
  input: {
    readonly customerId: string;
    readonly device: string;
    readonly platform: PushPlatform;
    readonly token: string;
    readonly now: number;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO push_tokens (customer_id, device, platform, token, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (customer_id, device) DO UPDATE SET
         platform = excluded.platform,
         token = excluded.token,
         updated_at = excluded.updated_at`,
    )
    .bind(input.customerId, input.device, input.platform, input.token, input.now)
    .run();
}

/** 注销当前客户指定设备或指定 token 的推送记录。 */
export async function deletePushToken(
  db: D1Database,
  input: { readonly customerId: string; readonly device?: string; readonly token?: string },
): Promise<number> {
  if (input.device !== undefined) {
    const res = await db
      .prepare('DELETE FROM push_tokens WHERE customer_id = ? AND device = ?')
      .bind(input.customerId, input.device)
      .run();
    return Number(res.meta.changes ?? 0);
  }
  if (input.token !== undefined) {
    const res = await db
      .prepare('DELETE FROM push_tokens WHERE customer_id = ? AND token = ?')
      .bind(input.customerId, input.token)
      .run();
    return Number(res.meta.changes ?? 0);
  }
  return 0;
}

/** 列出某位客户当前已登记的所有推送设备。 */
export async function listPushTokensForCustomer(db: D1Database, customerId: string): Promise<PushTokenRecord[]> {
  const { results } = await db
    .prepare('SELECT customer_id, device, platform, token, updated_at FROM push_tokens WHERE customer_id = ? ORDER BY updated_at DESC')
    .bind(customerId)
    .all<PushTokenRow>();
  return results.map((r) => ({
    customerId: r.customer_id,
    device: r.device,
    platform: r.platform,
    token: r.token,
    updatedAt: r.updated_at,
  }));
}

/** 根据失效的推送令牌删除对应记录（供 APNs / FCM 退信清理使用）。 */
export async function deletePushTokenByValue(db: D1Database, token: string): Promise<number> {
  const res = await db.prepare('DELETE FROM push_tokens WHERE token = ?').bind(token).run();
  return Number(res.meta.changes ?? 0);
}

/**
 * 处理 `/v1/app/push-tokens` 及 `/v1/app/push-tokens/:device` 请求。
 * 路径不匹配时返回 `undefined`，交由通用路由继续分发。
 */
export async function handlePushTokenRequest(
  req: Request,
  env: Env,
  hub: D1HubStore,
  now: number,
): Promise<Response | undefined> {
  const url = new URL(req.url);
  if (url.pathname !== PUSH_TOKENS_PREFIX && !url.pathname.startsWith(`${PUSH_TOKENS_PREFIX}/`)) {
    return undefined;
  }

  const extraPath = url.pathname.slice(PUSH_TOKENS_PREFIX.length);
  let pathDevice: string | undefined;
  if (extraPath.length > 0) {
    const raw = extraPath.slice(1);
    if (raw.includes('/') || raw.length === 0) return jsonOf({ error: 'not-found' }, 404);
    try {
      pathDevice = nonEmptyString(decodeURIComponent(raw), 256);
    } catch {
      return jsonOf({ error: 'invalid-device' }, 400);
    }
    if (!pathDevice) return jsonOf({ error: 'invalid-device' }, 400);
  }

  const auth = await authCustomer(bearerOf(req), {
    hub,
    now,
    random,
    mailer: NOOP_MAILER,
    origin: env.HUB_ORIGIN ?? '',
  });
  if (!auth.ok) return jsonOf({ error: auth.error }, auth.status);

  if (req.method === 'POST' || req.method === 'PUT') {
    if (pathDevice !== undefined) return jsonOf({ error: 'method-not-allowed' }, 405);
    const body = await readJsonBody(req);
    if (!isRecord(body)) return jsonOf({ error: 'invalid-body' }, 400);

    const device = nonEmptyString(body.device, 256);
    const platform = body.platform === 'ios' || body.platform === 'android' ? body.platform : undefined;
    const token = nonEmptyString(body.token, 4096);
    if (!device || !platform || !token) return jsonOf({ error: 'invalid-body' }, 400);

    await upsertPushToken(env.DB, {
      customerId: auth.customer.id,
      device,
      platform,
      token,
      now,
    });
    return jsonOf({ ok: true }, 200);
  }

  if (req.method === 'DELETE') {
    const queryDevice = nonEmptyString(url.searchParams.get('device'), 256);
    const queryToken = nonEmptyString(url.searchParams.get('token'), 4096);
    const body = await readJsonBody(req);
    const bodyDevice = isRecord(body) ? nonEmptyString(body.device, 256) : undefined;
    const bodyToken = isRecord(body) ? nonEmptyString(body.token, 4096) : undefined;

    const device = pathDevice ?? queryDevice ?? bodyDevice;
    const token = queryToken ?? bodyToken;
    if (!device && !token) return jsonOf({ error: 'invalid-body' }, 400);

    await deletePushToken(env.DB, {
      customerId: auth.customer.id,
      ...(device !== undefined ? { device } : {}),
      ...(token !== undefined ? { token } : {}),
    });
    return jsonOf({ ok: true }, 200);
  }

  return jsonOf({ error: 'method-not-allowed' }, 405);
}
