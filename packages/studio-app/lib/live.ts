import type { AppFrame } from '../../../src/studio/protocol.js';
import type { Hub } from './hub.js';

export interface LiveHandlers {
  readonly frame: (frame: AppFrame) => void;
  readonly state: (state: 'open' | 'closed') => void;
}

interface Entry {
  readonly handlers: Set<LiveHandlers>;
  state: 'open' | 'closed';
  close: () => void;
}

export type SubscribeResume = (onResume: () => void) => () => void;

/**
 * One WebSocket per project, shared by every screen that needs it. The hub's link is expensive and
 * the app used to open one socket per screen and one more per queued action; here the first
 * subscriber dials and each later one joins, and the last to leave closes it.
 *
 * 回到前台时通过可选的 `subscribeResume` 重建活跃连接，触发订阅方重新拉取一次最新状态。
 * 纯逻辑模块：不在顶层引用 react-native 或 ./client，默认单例在 lib/client.ts 组装。
 */
export function createLive(watch: Pick<Hub, 'watch'>, subscribeResume?: SubscribeResume) {
  const entries = new Map<string, Entry>();
  let stopResume: (() => void) | null = null;

  const dial = (pid: string, entry: Entry): (() => void) =>
    watch.watch(pid, {
      frame: (frame) => {
        for (const handler of [...entry.handlers]) handler.frame(frame);
      },
      state: (state) => {
        entry.state = state;
        for (const handler of [...entry.handlers]) handler.state(state);
      },
    });

  const ensureResumeListener = (): void => {
    if (stopResume || !subscribeResume) return;
    stopResume = subscribeResume(() => {
      for (const [pid, entry] of entries) {
        entry.close();
        entry.state = 'closed';
        entry.close = dial(pid, entry);
      }
    });
  };

  const dropResumeListenerIfIdle = (): void => {
    if (entries.size > 0 || !stopResume) return;
    stopResume();
    stopResume = null;
  };

  return {
    subscribe(pid: string, handlers: LiveHandlers): () => void {
      const existing = entries.get(pid);
      if (!existing) {
        const created: Entry = { handlers: new Set([handlers]), state: 'closed', close: () => {} };
        entries.set(pid, created);
        ensureResumeListener();
        // `watch` may answer `closed` synchronously (no session); the entry is already in the map.
        created.close = dial(pid, created);
      } else {
        existing.handlers.add(handlers);
        // A newcomer missed the earlier state callbacks: tell it what the socket is doing now.
        const state = existing.state;
        queueMicrotask(() => {
          if (existing.handlers.has(handlers)) handlers.state(state);
        });
      }

      let active = true;
      return () => {
        if (!active) return;
        active = false;
        const current = entries.get(pid);
        if (!current) return;
        current.handlers.delete(handlers);
        if (current.handlers.size === 0) {
          entries.delete(pid);
          current.close();
          dropResumeListenerIfIdle();
        }
      };
    },
  };
}
