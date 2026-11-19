import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

/**
 * 原生联网状态检测：参考 companion `lib/link/online.ts`，通过并发轻量 HEAD 探测判断手机
 * 是否真的能连上网（飞行模式 / 断网时 fetch 直接失败）。
 */
const PROBES = [
  'https://www.cloudflare.com/cdn-cgi/trace',
  'https://connectivitycheck.gstatic.com/generate_204',
];

let currentOnline = true;
const listeners = new Set<(online: boolean) => void>();
let inFlight: Promise<boolean> | null = null;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let appStateSub: { remove: () => void } | null = null;

function notify(next: boolean): void {
  if (next === currentOnline) return;
  currentOnline = next;
  for (const listener of [...listeners]) {
    listener(next);
  }
}

export async function checkOnline(timeoutMs = 4_000): Promise<boolean> {
  const one = async (url: string): Promise<boolean> => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      await fetch(url, { method: 'HEAD', signal: ctl.signal, cache: 'no-store' });
      return true;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  };
  const answers = await Promise.all(PROBES.map(one));
  return answers.some(Boolean);
}

/** 主动探测一次并更新在线状态，并发调用会复用同一个探测请求。 */
export function refreshOnline(): Promise<boolean> {
  if (inFlight) return inFlight;
  inFlight = checkOnline()
    .then((next) => {
      notify(next);
      return next;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

function schedulePoll(): void {
  if (pollTimer) clearTimeout(pollTimer);
  if (listeners.size === 0) {
    pollTimer = null;
    return;
  }
  // 离线时更频繁地探测（3s），在线时保持低频（10s）以捕捉飞行模式切换。
  const delay = currentOnline ? 10_000 : 3_000;
  pollTimer = setTimeout(() => {
    void refreshOnline().finally(schedulePoll);
  }, delay);
}

function ensureWatching(): void {
  if (!appStateSub && typeof AppState?.addEventListener === 'function') {
    appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshOnline();
    });
  }
  if (!pollTimer) {
    void refreshOnline().finally(schedulePoll);
  }
}

function stopWatchingIfIdle(): void {
  if (listeners.size > 0) return;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  if (appStateSub) {
    appStateSub.remove();
    appStateSub = null;
  }
}

/** 当前是否在线（乐观初始为 true，由原生探测与请求结果更新）。 */
export const isOnline = (): boolean => currentOnline;

/** 订阅在线状态变化，返回取消订阅函数。 */
export function subscribeOnline(listener: (online: boolean) => void): () => void {
  listeners.add(listener);
  ensureWatching();
  return () => {
    listeners.delete(listener);
    stopWatchingIfIdle();
  };
}

/** React Hook：实时返回当前是否在线。 */
export function useOnline(): boolean {
  const [online, setOnline] = useState(isOnline);
  useEffect(() => {
    setOnline(isOnline());
    return subscribeOnline(setOnline);
  }, []);
  return online;
}
