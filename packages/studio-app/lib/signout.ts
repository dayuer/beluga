import { setBadgeCount } from './badge';
import { hub } from './client';
import { unregisterPush } from './push';
import { session } from './session';
import { signOut as signOutCore, type SignOutDeps } from './signout-core';

export type { SignOutDeps };

export async function signOut(deps: SignOutDeps = {}): Promise<void> {
  return signOutCore({
    getToken: deps.getToken ?? (() => session.token()),
    unregisterPush: deps.unregisterPush ?? ((tok?: string) => unregisterPush(tok)),
    hubLogout: deps.hubLogout ?? (() => hub.logout()),
    clearSession: deps.clearSession ?? (() => session.clear()),
    clearBadge: deps.clearBadge ?? (() => setBadgeCount(0)),
  });
}
