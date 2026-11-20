import crypto from 'node:crypto';

export class UnavailabilityError extends Error {
  readonly code = 'ERR_UNAVAILABLE';
  constructor(moduleName: string, propertyName: string) {
    super(`The method or property ${moduleName}.${propertyName} is not available on this platform.`);
  }
}

export class CodedError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export class NativeModule {}

const secureStoreMem = new Map<string, string>();

export const requireNativeModule = (moduleName: string) => {
  if (moduleName === 'ExpoCrypto') {
    return {
      getRandomValues(array: Uint8Array) {
        crypto.randomFillSync(array);
        return array;
      },
      randomUUID() {
        return crypto.randomUUID();
      },
    };
  }
  if (moduleName === 'ExpoCryptoAES') {
    class EncryptionKey {}
    class SealedData {}
    return {
      EncryptionKey,
      SealedData,
    };
  }
  if (moduleName === 'ExpoSecureStore') {
    return {
      getValueWithKeyAsync: async (key: string) => secureStoreMem.get(key) ?? null,
      setValueWithKeyAsync: async (value: string, key: string) => {
        secureStoreMem.set(key, value);
      },
      deleteValueWithKeyAsync: async (key: string) => {
        secureStoreMem.delete(key);
      },
      getValueWithKeySync: (key: string) => secureStoreMem.get(key) ?? null,
      setValueWithKeySync: (value: string, key: string) => {
        secureStoreMem.set(key, value);
      },
      canUseBiometricAuthentication: () => false,
    };
  }
  return {};
};

export default {
  UnavailabilityError,
  CodedError,
  NativeModule,
  requireNativeModule,
};
