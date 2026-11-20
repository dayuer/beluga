import { useSyncExternalStore } from 'react';

type BootTask = () => Promise<void>;

const pending = new Set<Promise<void>>();
const listeners = new Set<() => void>();
let booted = true;

const notify = (): void => {
  for (const listener of listeners) listener();
};

/**
 * 在模块加载时注册启动前的异步补水任务（如读取 SecureStore 或本地缓存文件）。
 * 若没有任何模块注册，useBooted() 直接返回 true，不拖慢首屏。
 */
export function registerBoot(fn: BootTask): void {
  const wasBooted = booted;
  booted = false;
  if (wasBooted) notify();
  let task: Promise<void>;
  try {
    task = Promise.resolve(fn()).catch(() => {
      // 单个补水失败不阻塞启动，各模块自行回退到未登录/空缓存状态。
    });
  } catch {
    task = Promise.resolve();
  }
  pending.add(task);
  void task.finally(() => {
    pending.delete(task);
    if (pending.size === 0 && !booted) {
      booted = true;
      notify();
    }
  });
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const snapshot = (): boolean => booted;

/** 当前是否已完成所有启动异步补水。 */
export function isBooted(): boolean {
  return booted;
}

/** 所有注册的启动补水任务完成后返回 true；无注册任务时立即可用。 */
export function useBooted(): boolean {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
