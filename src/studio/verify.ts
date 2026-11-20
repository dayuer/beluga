import { createHash, createHmac, createPublicKey, timingSafeEqual, verify } from 'node:crypto';

/**
 * S2 节点端设备登记与签名帧校验（SS-175）：
 * 供真实 daemon 与 `fake-daemon.mjs` 共用同一套验签、单调时钟与拒绝码逻辑。
 */

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

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

/** 规范化 JSON（键排序、无空白、忽略 undefined），与 App 侧 `lib/signed.ts` 完全一致。 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalizeJsonValue(value));
}

/** 计算节点公钥指纹（SHA-256 前 16 位大写十六进制）。 */
export function computeNodeFingerprint(pubKeyBytes: Buffer | Uint8Array): string {
  return createHash('sha256').update(pubKeyBytes).digest('hex').slice(0, 16).toUpperCase();
}

function decodeInviteKey(k: string): Buffer {
  if (/^[A-Za-z0-9_-]+$/.test(k) && k.length >= 16) {
    return Buffer.from(k, 'base64url');
  }
  return Buffer.from(k, 'utf8');
}

/** 核对 `mac = HMAC-SHA256(k, pubkey)`。 */
export function verifyEnrollMac(k: string, pubkeyB64: string, macB64: string): boolean {
  try {
    const keyBuf = decodeInviteKey(k);
    const pubBuf = Buffer.from(pubkeyB64, 'base64url');
    const macBuf = Buffer.from(macB64, 'base64url');
    const expected = createHmac('sha256', keyBuf).update(pubBuf).digest();
    return expected.length === macBuf.length && timingSafeEqual(expected, macBuf);
  } catch {
    return false;
  }
}

export function verifyEd25519Frame(frame: Record<string, unknown>, sigB64: string, deviceKeyB64: string): boolean {
  try {
    const rawPub = Buffer.from(deviceKeyB64, 'base64url');
    if (rawPub.length !== 32) return false;
    const spki = Buffer.concat([ED25519_SPKI_PREFIX, rawPub]);
    const keyObj = createPublicKey({ key: spki, format: 'der', type: 'spki' });
    const sigBuf = Buffer.from(sigB64, 'base64url');
    const msgBuf = Buffer.from(canonicalJson(frame), 'utf8');
    return verify(null, msgBuf, keyObj, sigBuf);
  } catch {
    return false;
  }
}

export type VerifyResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: 'unregistered-device' | 'bad-signature' | 'stale-clock' };

export const SIGNED_ACTION_KINDS = new Set<string>([
  'request.confirm',
  'gate.answer',
  'delivery.accept',
  'release.approve',
  'device.remove',
]);

export function createDeviceTrustStore() {
  const devices = new Map<string, { lastAt: number }>();

  return {
    enroll(pubkey: string): void {
      if (!devices.has(pubkey)) {
        devices.set(pubkey, { lastAt: 0 });
      }
    },

    enrollWithInvite(opts: { readonly k: string; readonly pubkey: string; readonly mac: string }): boolean {
      if (!verifyEnrollMac(opts.k, opts.pubkey, opts.mac)) return false;
      this.enroll(opts.pubkey);
      return true;
    },

    isEnrolled(deviceKey: string): boolean {
      return devices.has(deviceKey);
    },

    verifySignedAction(action: {
      readonly kind?: string;
      readonly payload?: unknown;
      readonly rev?: number;
      readonly signed?: {
        readonly frame?: {
          readonly kind?: string;
          readonly payload?: unknown;
          readonly rev?: number;
          readonly at?: number;
          readonly deviceKey?: string;
        };
        readonly sig?: string;
      };
    }): VerifyResult {
      const signed = action?.signed;
      const frame = signed?.frame;
      const sig = signed?.sig;
      if (!frame || typeof sig !== 'string' || typeof frame.deviceKey !== 'string') {
        return { ok: false, code: 'bad-signature' };
      }

      const entry = devices.get(frame.deviceKey);
      if (!entry) {
        return { ok: false, code: 'unregistered-device' };
      }

      if (
        frame.kind !== action.kind ||
        frame.rev !== action.rev ||
        canonicalJson(frame.payload) !== canonicalJson(action.payload)
      ) {
        return { ok: false, code: 'bad-signature' };
      }

      if (!verifyEd25519Frame(frame as unknown as Record<string, unknown>, sig, frame.deviceKey)) {
        return { ok: false, code: 'bad-signature' };
      }

      if (typeof frame.at !== 'number' || !Number.isFinite(frame.at) || frame.at <= entry.lastAt) {
        return { ok: false, code: 'stale-clock' };
      }

      entry.lastAt = frame.at;
      return { ok: true };
    },
  };
}
