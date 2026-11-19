import { AppState } from 'react-native';
import type { AppFrame } from '../../../src/studio/protocol';
import { hub } from './client';
import type { Hub } from './hub';

export interface LiveHandlers {
  readonly frame: (frame: AppFrame) => void;
  readonly state: (state: 'open' | 'closed') => void;
}

interface Entry {
  readonly handlers: Set<LiveHandlers>;
  state: 'open' | 'closed';
  close: () => void;
}

/**
 * One WebSocket per project, shared by every screen that needs it. The hub's link is expensive and
 * the app used to open one socket per screen and one more per queued action; here the first
 * subscriber dials and each later one joins, and the last to leave closes it.
 *
 * 回到前台（AppState 变为 active）时重建活跃连接，触发订阅方重新拉取一次最新状态。
 * `createLive` takes the watch function so the ref counting can be tested without a native shell.
 */
export function createLive(watch: Pick<Hub, 'watch'>) {
  const entries = new Map<string, Entry>();
  let appSub: { remove: () => void } | null = null;
  let lastAppState: string = AppState?.currentState ?? 'active';

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

  const ensureAppListener = (): void => {
    if (appSub || typeof AppState?.addEventListener !== 'function') return;
    lastAppState = AppState.currentState ?? 'active';
    appSub = AppState.addEventListener('change', (next) => {
      const wasActive = lastAppState === 'active';
      lastAppState = next;
      if (!wasActive && next === 'active') {
        for (const [pid, entry] of entries) {
          entry.close();
          entry.state = 'closed';
          entry.close = dial(pid, entry);
        }
      }
    });
  };

  const dropAppListenerIfIdle = (): void => {
    if (entries.size > 0 || !appSub) return;
    appSub.remove();
    appSub = null;
  };

  return {
    subscribe(pid: string, handlers: LiveHandlers): () => void {
      const existing = entries.get(pid);
      if (!existing) {
        const created: Entry = { handlers: new Set([handlers]), state: 'closed', close: () => {} };
        entries.set(pid, created);
        ensureAppListener();
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
          dropAppListenerIfIdle();
        }
      };
    },
  };
}

/** The app's one live link table. */
export const live = createLive(hub);
