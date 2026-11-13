import { useEffect, useState } from 'react';

/** `navigator.onLine`, with a guard for environments that don't have one. */
export const isOnline = (): boolean => typeof navigator === 'undefined' || navigator.onLine !== false;

/** True while the browser thinks it has a network. Fetch failures are a separate signal. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(isOnline);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  return online;
}
