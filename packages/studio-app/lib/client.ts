import { AppState } from 'react-native';
import { createHub } from './hub';
import { createLive, type SubscribeResume } from './live';
import { isOnline } from './net';
import { session } from './session';

/**
 * One hub client for the app. Same origin by default (the dev proxy, and P2's Worker hosting the
 * app); `EXPO_PUBLIC_HUB_URL` can point it elsewhere. A 401 clears the session, and the guard in
 * `app/_layout.tsx` takes the customer back to /login.
 */
export const hub = createHub({
  base: process.env.EXPO_PUBLIC_HUB_URL || undefined,
  session: () => session.token(),
  onSignedOut: () => session.clear(),
  isOnline,
});

const subscribeAppResume: SubscribeResume = (onResume) => {
  if (typeof AppState?.addEventListener !== 'function') return () => {};
  let last: string = AppState.currentState ?? 'active';
  const sub = AppState.addEventListener('change', (next) => {
    const wasActive = last === 'active';
    last = next;
    if (!wasActive && next === 'active') onResume();
  });
  return () => sub.remove();
};

/** The app's one live link table. */
export const live = createLive(hub, subscribeAppResume);
