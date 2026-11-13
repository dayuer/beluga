import { useCallback, useEffect, useRef, useState } from 'react';

export interface Undo {
  readonly active: boolean;
  /** Seconds left in the countdown, for the button's "Undo (10s)". */
  readonly remaining: number;
  start(fire: () => void): void;
  cancel(): void;
  flush(): void;
}

/**
 * The 10-second undo before a decision or an approval is sent (M5 §10.3, M6 §4.10/4.11). Leaving
 * the page (pagehide or unmount) counts as confirming: the action is sent at once, never lost.
 */
export function useUndoSend(ms = 10_000): Undo {
  const [active, setActive] = useState(false);
  const [remaining, setRemaining] = useState(Math.ceil(ms / 1000));
  const activeRef = useRef(false);
  const fireRef = useRef<(() => void) | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTimers = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    if (tick.current) clearInterval(tick.current);
    timer.current = null;
    tick.current = null;
  }, []);

  const fire = useCallback(() => {
    if (!activeRef.current) return;
    activeRef.current = false;
    setActive(false);
    clearTimers();
    const run = fireRef.current;
    fireRef.current = null;
    run?.();
  }, [clearTimers]);

  const start = useCallback(
    (run: () => void) => {
      clearTimers();
      activeRef.current = true;
      fireRef.current = run;
      setActive(true);
      setRemaining(Math.ceil(ms / 1000));
      const deadline = Date.now() + ms;
      tick.current = setInterval(() => setRemaining(Math.max(0, Math.ceil((deadline - Date.now()) / 1000))), 250);
      timer.current = setTimeout(fire, ms);
    },
    [clearTimers, fire, ms],
  );

  const cancel = useCallback(() => {
    activeRef.current = false;
    fireRef.current = null;
    setActive(false);
    clearTimers();
  }, [clearTimers]);

  const flush = useCallback(() => {
    if (activeRef.current) fire();
  }, [fire]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const hide = () => {
      if (activeRef.current) fire();
    };
    window.addEventListener('pagehide', hide);
    return () => {
      window.removeEventListener('pagehide', hide);
      if (activeRef.current) fire();
      clearTimers();
    };
  }, [clearTimers, fire]);

  return { active, remaining, start, cancel, flush };
}
