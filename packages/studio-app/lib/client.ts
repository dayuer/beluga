import { createDemoHub } from './demo';
import { createHub } from './hub';
import { createLive } from './live';
import { isOnline } from './net';
import { onResume } from './resume';
import { session } from './session';

export const isDemoMode = (): boolean => process.env.EXPO_PUBLIC_DEMO === '1';

/**
 * One hub client for the app. Same origin by default (the dev proxy, and P2's Worker hosting the
 * app); `EXPO_PUBLIC_HUB_URL` can point it elsewhere. When `EXPO_PUBLIC_DEMO=1`, returns local
 * demo fixtures without issuing any network requests.
 */
export const hub = isDemoMode()
  ? createDemoHub()
  : createHub({
      base: process.env.EXPO_PUBLIC_HUB_URL || undefined,
      session: () => session.token(),
      onSignedOut: () => session.clear(),
      isOnline,
    });

/** The app's one live link table. */
export const live = createLive(hub, (cb) => onResume(cb));
