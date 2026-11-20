import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { getRandomBytes } from 'expo-crypto';
import { useEffect, useState } from 'react';
import { secure } from './secure';

/**
 * 设备密钥管理（SS-70 / SS-180）：
 * - 32 字节随机种子存放在 `lib/secure.ts`（iOS Keychain `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY` / Android Keystore），卸载重装不保留。
 * - Ed25519 用于动作签名，X25519 封装密钥由 `sha256('synon-studio-seal-v1' || seed)` 域分离派生；私钥种子只在本文件模块内存里，绝不导出。
 * - `loadSeed` 与 `ensureDeviceKey` 使用单飞锁去重，避免并发重复生成或覆盖。
 */

const SECRET_KEY = 'device-secret';
const SEAL_DOMAIN = new TextEncoder().encode('synon-studio-seal-v1');

interface DeviceSecret {
  readonly seed: string;
}

let cachedSeed: Uint8Array | null | undefined;
let inflightLoad: Promise<Uint8Array | null> | null = null;
let inflightEnsure: Promise<Uint8Array> | null = null;
const listeners = new Set<(hasKey: boolean) => void>();

export class DeviceKeyMissingError extends Error {
  readonly code = 'NO_DEVICE_KEY' as const;

  constructor(message = '没有密钥：这台设备尚未登记设备密钥') {
    super(message);
    this.name = 'DeviceKeyMissingError';
  }
}

function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    out += bytes[i]!.toString(16).padStart(2, '0');
  }
  return out;
}

function hexToBytes(hex: string): Uint8Array | null {
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) return null;
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function notify(hasKey: boolean): void {
  for (const fn of listeners) fn(hasKey);
}

function deriveSealSecret(seed: Uint8Array): Uint8Array {
  const input = new Uint8Array(SEAL_DOMAIN.length + seed.length);
  input.set(SEAL_DOMAIN, 0);
  input.set(seed, SEAL_DOMAIN.length);
  return sha256(input);
}

async function loadSeed(): Promise<Uint8Array | null> {
  if (cachedSeed !== undefined) return cachedSeed;
  if (inflightLoad) return inflightLoad;
  inflightLoad = (async () => {
    const stored = await secure.get<DeviceSecret>(SECRET_KEY);
    const parsed = stored && typeof stored.seed === 'string' ? hexToBytes(stored.seed) : null;
    cachedSeed = parsed;
    return parsed;
  })().finally(() => {
    inflightLoad = null;
  });
  return inflightLoad;
}

/** 当前设备是否已登记可用于签名的设备密钥。 */
export async function hasDeviceKey(): Promise<boolean> {
  return (await loadSeed()) !== null;
}

/** 若尚无设备密钥则生成 32 字节随机种子并写入安全存储；并发调用只生成一次，返回 Ed25519 公钥字节。 */
export async function ensureDeviceKey(): Promise<Uint8Array> {
  if (inflightEnsure) return inflightEnsure;
  inflightEnsure = (async () => {
    let seed = await loadSeed();
    if (!seed) {
      seed = getRandomBytes(32);
      await secure.set(SECRET_KEY, { seed: bytesToHex(seed) } satisfies DeviceSecret);
      cachedSeed = seed;
      notify(true);
    }
    return ed25519.getPublicKey(seed);
  })().finally(() => {
    inflightEnsure = null;
  });
  return inflightEnsure;
}

/** 读取当前设备的 Ed25519 公钥字节；没有密钥时返回 `null`。 */
export async function publicKey(): Promise<Uint8Array | null> {
  const seed = await loadSeed();
  return seed ? ed25519.getPublicKey(seed) : null;
}

/** 读取当前设备的 X25519 封装公钥字节（域分离派生）；没有密钥时返回 `null`。 */
export async function sealPublicKey(): Promise<Uint8Array | null> {
  const seed = await loadSeed();
  return seed ? x25519.getPublicKey(deriveSealSecret(seed)) : null;
}

/** 使用设备私钥对载荷字节签名；没有密钥时抛出 `DeviceKeyMissingError`。 */
export async function sign(bytes: Uint8Array): Promise<Uint8Array> {
  const seed = await loadSeed();
  if (!seed) throw new DeviceKeyMissingError();
  return ed25519.sign(bytes, seed);
}

/** 清除本机设备密钥（用于重设或测试）。 */
export async function clearDeviceKey(): Promise<void> {
  await secure.remove(SECRET_KEY);
  cachedSeed = null;
  notify(false);
}

/** 订阅/读取当前设备是否已有密钥，供 `SignedButton` 在渲染时决定禁用态与提示。 */
export function useHasDeviceKey(): { ready: boolean; hasKey: boolean } {
  const [state, setState] = useState<{ ready: boolean; hasKey: boolean }>({
    ready: false,
    hasKey: false,
  });

  useEffect(() => {
    let alive = true;
    const onChange = (hasKey: boolean) => {
      if (alive) setState({ ready: true, hasKey });
    };
    listeners.add(onChange);
    void hasDeviceKey().then((hasKey) => {
      if (alive) setState({ ready: true, hasKey });
    });
    return () => {
      alive = false;
      listeners.delete(onChange);
    };
  }, []);

  return state;
}
