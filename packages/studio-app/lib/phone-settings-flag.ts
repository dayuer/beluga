/**
 * 手机上填密钥、改项目设置的开关（SS-227 / SS-228，决定 secrets-phone-temp）。
 * 默认打开；Mac 版出来、这两件事能在桌面上做之后关掉（`EXPO_PUBLIC_PHONE_SETTINGS=0`）。
 * 两个入口（「环境与密钥」「项目与代码交付」）都只读这一个函数，关掉时页面回到只读。
 */
const OFF_VALUES = new Set(['0', 'false', 'off', 'no']);

export function phoneSettingsEnabled(value: string | undefined = process.env.EXPO_PUBLIC_PHONE_SETTINGS): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === undefined || normalized === '' ? true : !OFF_VALUES.has(normalized);
}
