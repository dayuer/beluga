import type { Lang } from './table.js';

export const zh = {
  'sign.unregisteredDevice': '这台手机还没登记，无法确认。请先在「我 › 设备」完成登记。',
  'sign.badSignature': '设备签名校验未通过，操作已被拒绝。请重新登记这台设备后再试。',
  'sign.staleClock': '设备时钟落后或签名已过期，请校准手机时间后再试。',
} as const;

export const en: Record<keyof typeof zh, string> = {
  'sign.unregisteredDevice': 'This phone is not enrolled yet. Enroll it under Me › Devices first.',
  'sign.badSignature': 'Device signature verification failed. Re-enroll this device and try again.',
  'sign.staleClock': 'Your device clock is behind or the signature expired. Sync your clock and try again.',
};

export type SignRefusalCode = 'unregistered-device' | 'bad-signature' | 'stale-clock';

const CODE_KEY: Record<string, keyof typeof zh> = {
  'unregistered-device': 'sign.unregisteredDevice',
  'unknown-device': 'sign.unregisteredDevice',
  'device-not-enrolled': 'sign.unregisteredDevice',
  'bad-signature': 'sign.badSignature',
  'invalid-signature': 'sign.badSignature',
  'stale-clock': 'sign.staleClock',
  'clock-behind': 'sign.staleClock',
  replay: 'sign.staleClock',
};

export function signT(lang: Lang, key: keyof typeof zh): string {
  return lang === 'en' ? en[key] : zh[key];
}

/** 将节点返回的签名拒绝码映射为面向客户的说明文案；非签名拒绝码返回 `null`。 */
export function signRefusalMessage(lang: Lang, code: string): string | null {
  const key = CODE_KEY[code];
  return key ? signT(lang, key) : null;
}
