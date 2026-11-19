import * as Haptics from 'expo-haptics';

/**
 * 手机触感封装（SS-31）：
 * - 一次动作最多一下（同一 tick 内去重）。
 * - 「还不行…」、取消、撤销不调用触感。
 */

let firedThisTick = false;

function runOncePerTick(fn: () => Promise<void> | void): void {
  if (firedThisTick) return;
  firedThisTick = true;
  queueMicrotask(() => {
    firedThisTick = false;
  });
  try {
    void Promise.resolve(fn()).catch(() => {});
  } catch {
    // 模拟器或不支持触感的设备静默忽略
  }
}

/** 切页签、切换分段控件时调用（选择反馈）。 */
export function select(): void {
  runOncePerTick(() => Haptics.selectionAsync());
}

/** 通过交付、批准开工、批准上线成功时调用（成功反馈）。 */
export function success(): void {
  runOncePerTick(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
}

/** 操作出错或校验失败时调用（警告反馈）。 */
export function warning(): void {
  runOncePerTick(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning));
}

/** 统一触感出口集合：包含 select / success / warning；「还不行」、取消、撤销不调用本对象。 */
export const haptics = {
  select,
  success,
  warning,
} as const;
