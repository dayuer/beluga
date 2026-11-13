import { createHub } from './hub';
import { session } from './session';

/**
 * One hub client for the app. Same origin by default (the dev proxy, and P2's Worker hosting the
 * app); `EXPO_PUBLIC_HUB_URL` can point it elsewhere. A 401 clears the session, and the guard in
 * `app/_layout.tsx` takes the customer back to /login.
 */
export const hub = createHub({
  session: () => session.token(),
  onSignedOut: () => session.clear(),
});
