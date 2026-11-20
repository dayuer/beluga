import { useEffect, useState } from 'react';

/**
 * 设备密钥接口桩（SS-32）：
 * A6 的 `keys-lib` 任务只替换本文件内的实现，不改动调用方（`SignedButton` 等）的签名与类型。
 */

export class DeviceKeyMissingError extends Error {
  readonly code = 'NO_DEVICE_KEY' as const;

  constructor(message = '没有密钥：这台设备尚未登记设备密钥') {
    super(message);
    this.name = 'DeviceKeyMissingError';
  }
}

/** 当前设备是否已登记可用于签名的设备密钥。桩实现固定返回 `false`。 */
export async function hasDeviceKey(): Promise<boolean> {
  return false;
}

/** 读取当前设备的 Ed25519 公钥字节；没有密钥时返回 `null`。 */
export async function publicKey(): Promise<Uint8Array | null> {
  return null;
}

/** 使用设备私钥对载荷字节签名；没有密钥时抛出 `DeviceKeyMissingError`。 */
export async function sign(_bytes: Uint8Array): Promise<Uint8Array> {
  throw new DeviceKeyMissingError();
}

/** 订阅/读取当前设备是否已有密钥，供 `SignedButton` 在渲染时决定禁用态与提示。 */
export function useHasDeviceKey(): { ready: boolean; hasKey: boolean } {
  const [state, setState] = useState<{ ready: boolean; hasKey: boolean }>({
    ready: false,
    hasKey: false,
  });

  useEffect(() => {
    let alive = true;
    void hasDeviceKey().then((hasKey) => {
      if (alive) setState({ ready: true, hasKey });
    });
    return () => {
      alive = false;
    };
  }, []);

  return state;
}
