import { useEffect, useState } from 'react';

/**
 * 全局轻量 UI 状态（SS-24 / SS-139）：
 * 使用引用计数跟踪打开的抽屉数量，多个 Drawer / ConfirmSheet 叠开时，
 * 只有最后一个关掉或卸载后才恢复底部页签显示。
 */

let drawerCount = 0;
const listeners = new Set<(open: boolean) => void>();

function notify(prevOpen: boolean): void {
  const nextOpen = drawerCount > 0;
  if (prevOpen === nextOpen) return;
  for (const listener of [...listeners]) {
    listener(nextOpen);
  }
}

export function getDrawerOpen(): boolean {
  return drawerCount > 0;
}

export function getDrawerCount(): number {
  return drawerCount;
}

/**
 * 登记一个打开的抽屉，返回幂等的释放函数（关闭或卸载时调用）。
 */
export function acquireDrawer(): () => void {
  const prevOpen = drawerCount > 0;
  drawerCount += 1;
  notify(prevOpen);

  let released = false;
  return () => {
    if (released) return;
    released = true;
    const before = drawerCount > 0;
    drawerCount = Math.max(0, drawerCount - 1);
    notify(before);
  };
}

/** 兼容旧调用方：单次设置开关（推荐使用 `acquireDrawer()`）。 */
export function setDrawerOpen(open: boolean): void {
  const prevOpen = drawerCount > 0;
  drawerCount = open ? Math.max(1, drawerCount) : 0;
  notify(prevOpen);
}

/** 重置计数（仅供单测清理）。 */
export function resetDrawerCount(): void {
  const prevOpen = drawerCount > 0;
  drawerCount = 0;
  notify(prevOpen);
}

export function useDrawerOpen(): boolean {
  const [open, setOpen] = useState(getDrawerOpen);
  useEffect(() => {
    setOpen(getDrawerOpen());
    listeners.add(setOpen);
    return () => {
      listeners.delete(setOpen);
    };
  }, []);
  return open;
}
