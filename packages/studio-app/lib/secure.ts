import * as SecureStore from 'expo-secure-store';

/**
 * 本机敏感凭证存储（登录会话、设备密钥等）。
 * Android 使用 Keystore，iOS 使用 Keychain（AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY）。
 */
export const secure = {
  async get<T>(key: string): Promise<T | undefined> {
    const raw = await SecureStore.getItemAsync(key);
    if (!raw) return undefined;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return undefined;
    }
  },
  async set(key: string, value: unknown): Promise<void> {
    const raw = JSON.stringify(value);
    await SecureStore.setItemAsync(key, raw, {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
  },
  async remove(key: string): Promise<void> {
    await SecureStore.deleteItemAsync(key);
  },
};
