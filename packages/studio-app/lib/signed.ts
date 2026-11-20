import { publicKey, sign } from './keys';
import { kv } from './kv';

/**
 * 签名帧与单调时钟（SS-71）：
 * 按 S2 规范对 `{kind, payload, rev?, at, deviceKey}` 做键排序无空白规范化 JSON 签名，
 * 并通过 `kv` 持久化上次 `at`，确保时钟回拨或同毫秒连发时 `at` 仍严格递增、防重放。
 */

const LAST_AT_KEY = 'signed:last-at';
let memoryLastAt = 0;

const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function toBase64Url(bytes: Uint8Array): string {
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

export function fromBase64Url(input: string): Uint8Array {
  const clean = input.replace(/=+$/, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let pos = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const c0 = B64URL.indexOf(clean[i]!);
    const c1 = B64URL.indexOf(clean[i + 1]!);
    const c2 = i + 2 < clean.length ? B64URL.indexOf(clean[i + 2]!) : 0;
    const c3 = i + 3 < clean.length ? B64URL.indexOf(clean[i + 3]!) : 0;
    if (c0 < 0 || c1 < 0 || c2 < 0 || c3 < 0) {
      throw new Error('Invalid base64url string');
    }
    const triplet = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3;
    out[pos++] = (triplet >> 16) & 0xff;
    if (i + 2 < clean.length) out[pos++] = (triplet >> 8) & 0xff;
    if (i + 3 < clean.length) out[pos++] = triplet & 0xff;
  }
  return out.subarray(0, pos);
}

function normalizeJsonValue(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map((item) => (item === undefined ? null : normalizeJsonValue(item)));
  }
  const record = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    const v = record[key];
    if (v !== undefined) {
      sorted[key] = normalizeJsonValue(v);
    }
  }
  return sorted;
}

/** 规范化 JSON（对象键递归字典序排列、无空白、忽略 undefined 字段）。 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalizeJsonValue(value));
}

export interface SignedFrameInput {
  readonly kind: string;
  readonly payload: unknown;
  readonly rev?: number;
}

export interface SignedFrame {
  readonly kind: string;
  readonly payload: unknown;
  readonly rev?: number;
  readonly at: number;
  readonly deviceKey: string;
}

export interface SignedEnvelope {
  readonly frame: SignedFrame;
  readonly sig: string;
}

/** 分配严格递增的时间戳 `at = max(now, prev + 1)`，并持久化到 `kv`。 */
export function nextMonotonicAt(now = Date.now()): number {
  const stored = kv.get<number>(LAST_AT_KEY);
  const prev = Math.max(memoryLastAt, typeof stored === 'number' && Number.isFinite(stored) ? stored : 0);
  const next = Math.max(now, prev + 1);
  memoryLastAt = next;
  kv.set(LAST_AT_KEY, next);
  return next;
}

/** 将签名帧编码为待签名的规范化 UTF-8 字节。 */
export function encodeSignedFrame(frame: SignedFrame): Uint8Array {
  return new TextEncoder().encode(canonicalJson(frame));
}

/** 对已有签名帧做 Ed25519 签名（同一帧两次签名结果完全一致）。 */
export async function signExistingFrame(frame: SignedFrame): Promise<SignedEnvelope> {
  const bytes = encodeSignedFrame(frame);
  const signature = await sign(bytes);
  return {
    frame,
    sig: toBase64Url(signature),
  };
}

/** 构造带单调 `at` 与 `deviceKey` 的帧并签名。 */
export async function signFrame(input: SignedFrameInput, now = Date.now()): Promise<SignedEnvelope> {
  const pub = await publicKey();
  const deviceKey = pub ? toBase64Url(pub) : '';
  const at = nextMonotonicAt(now);
  const frame: SignedFrame = {
    kind: input.kind,
    payload: input.payload,
    ...(input.rev !== undefined ? { rev: input.rev } : {}),
    at,
    deviceKey,
  };
  return signExistingFrame(frame);
}
