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
 * `createLive` takes the watch function so the ref counting can be tested without a browser; the
 * app uses the singleton below.
 */
export function createLive(watch: Pick<Hub, 'watch'>) {
  const entries = new Map<string, Entry>();

  return {
    subscribe(pid: string, handlers: LiveHandlers): () => void {
      const existing = entries.get(pid);
      let entry: Entry;
      if (!existing) {
        const created: Entry = { handlers: new Set([handlers]), state: 'closed', close: () => {} };
        entries.set(pid, created);
        // `watch` may answer `closed` synchronously (no session); the entry is already in the map.
        created.close = watch.watch(pid, {
          frame: (frame) => {
            for (const handler of [...created.handlers]) handler.frame(frame);
          },
          state: (state) => {
            created.state = state;
            for (const handler of [...created.handlers]) handler.state(state);
          },
        });
        entry = created;
      } else {
        existing.handlers.add(handlers);
        // A newcomer missed the earlier state callbacks: tell it what the socket is doing now.
        const state = existing.state;
        queueMicrotask(() => {
          if (existing.handlers.has(handlers)) handlers.state(state);
        });
        entry = existing;
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
        }
      };
    },
  };
}

/** The app's one live link table. */
export const live = createLive(hub);
