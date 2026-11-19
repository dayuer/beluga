import { useEffect, useState } from 'react';

/**
 * 全局轻量 UI 状态（SS-24）：
 * 目前持有 `drawerOpen`，用于底部抽屉打开时让 `TabBar` 隐藏让位。
 */

let drawerOpen = false;
const listeners = new Set<(open: boolean) => void>();

export function getDrawerOpen(): boolean {
  return drawerOpen;
}

export function setDrawerOpen(open: boolean): void {
  if (drawerOpen === open) return;
  drawerOpen = open;
  for (const listener of [...listeners]) {
    listener(open);
  }
}

export function useDrawerOpen(): boolean {
  const [open, setOpen] = useState(drawerOpen);
  useEffect(() => {
    setOpen(drawerOpen);
    listeners.add(setOpen);
    return () => {
      listeners.delete(setOpen);
    };
  }, []);
  return open;
}
