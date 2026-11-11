import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cache } from './cache';
import { hub } from './client';
import type { HubError } from './hub';
import type { PlanRes } from './hub-schema';
import { live } from './live';
import { useOnline } from './net';

export type PlanView = PlanRes['view'];

export interface PlanStore {
  readonly view: PlanView | undefined;
  readonly rev: number;
  /** The customer's own network. */
  readonly online: boolean;
  /** The studio's socket: false once it closes; optimistic before the first open. */
  readonly studioOnline: boolean;
  readonly fetchedAt: number;
  readonly loading: boolean;
  readonly gone: boolean;
  readonly error: HubError | null;
  readonly refresh: () => Promise<void>;
}

const planCacheKey = (pid: string, ref: string): string => `plan:${pid}:${ref}`;

/**
 * One plan's view: the cached copy first (it survives a reload), then a full GET, then live
 * frames. Frames only move forward (`rev >= current`); every socket open takes a full GET again,
 * because the hub does not send a snapshot when a socket opens (docs/studio-hub.md §7).
 */
export function usePlanView(pid: string | undefined, ref: string | undefined): PlanStore {
  const cached = useMemo(() => (pid && ref ? cache.get<PlanRes>(planCacheKey(pid, ref)) : undefined), [pid, ref]);
  const [view, setView] = useState<PlanView | undefined>(cached?.value.view);
  const [rev, setRev] = useState(0);
  const [fetchedAt, setFetchedAt] = useState(cached?.fetchedAt ?? 0);
  const [loading, setLoading] = useState(cached === undefined);
  const [gone, setGone] = useState(false);
  const [error, setError] = useState<HubError | null>(null);
  const [studioOnline, setStudioOnline] = useState(true);
  const online = useOnline();
  const revRef = useRef(0);
  const cacheAt = useRef(0);

  const refresh = useCallback(async () => {
    if (!pid || !ref) return;
    const answer = await hub.plan(pid, ref);
    if (answer.ok) {
      const at = Date.now();
      setView(answer.value.view);
      setFetchedAt(at);
      setError(null);
      setLoading(false);
      setGone(false);
      cache.set(planCacheKey(pid, ref), answer.value, at);
      return;
    }
    if (answer.error.kind === 'signed-out') return;
    if (answer.error.kind === 'http' && answer.error.status === 404) {
      setGone(true);
      setView(undefined);
      setLoading(false);
      cache.remove(planCacheKey(pid, ref));
      return;
    }
    setError(answer.error);
    setLoading(false);
    // A cached view stays on screen; the banner says it is old.
  }, [pid, ref]);

  // The first answer: on mount. A later socket open does the same (see the state callback).
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // A new pid/ref in the same mounted screen starts from that plan's cache, not the old view.
  useEffect(() => {
    const first = pid && ref ? cache.get<PlanRes>(planCacheKey(pid, ref)) : undefined;
    setView(first?.value.view);
    setFetchedAt(first?.fetchedAt ?? 0);
    setLoading(first === undefined);
    setRev(0);
    revRef.current = 0;
    setGone(false);
    setError(null);
  }, [pid, ref]);

  // One socket per project, shared with the project page and the request screen.
  useEffect(() => {
    if (!pid || !ref) return;
    return live.subscribe(pid, {
      frame: (frame) => {
        if (frame.t === 'plan' && frame.view.planRef === ref) {
          if (frame.rev < revRef.current) return;
          const gap = frame.rev > revRef.current + 1;
          revRef.current = frame.rev;
          setRev(frame.rev);
          setView(frame.view);
          setGone(false);
          setError(null);
          setLoading(false);
          setStudioOnline(true);
          const now = Date.now();
          // A full view can be large (50 turns); keep the cache close, not on every frame.
          if (now - cacheAt.current >= 1000) {
            cacheAt.current = now;
            cache.set(planCacheKey(pid, ref), { view: frame.view, updatedAt: now }, now);
          }
          // A skipped revision means a frame was missed: take the full view in the background.
          if (gap) void refresh();
        } else if (frame.t === 'plan-gone' && frame.planRef === ref) {
          setGone(true);
          setView(undefined);
          cache.remove(planCacheKey(pid, ref));
        }
      },
      state: (state) => {
        setStudioOnline(state === 'open');
        if (state === 'open') void refresh();
      },
    });
  }, [pid, ref, refresh]);

  return { view, rev, online, studioOnline, fetchedAt, loading, gone, error, refresh };
}
