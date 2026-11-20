import { setBadgeCount } from './badge';
import { hub } from './client';
import { unregisterPush } from './push';
import { session } from './session';

export interface SignOutDeps {
  readonly getToken?: () => string | undefined;
  readonly unregisterPush?: (sessionToken?: string) => Promise<boolean>;
  readonly hubLogout?: () => Promise<unknown>;
  readonly clearSession?: () => void;
  readonly clearBadge?: () => Promise<unknown>;
}

/**
 * 退出登录标准流程（SS-165）：
 * 1. 先带当前有效会话向中台注销推送令牌（失败会在本地记下待补删，下次登录补删）；
 * 2. 再调用 POST /v1/logout 吊销服务端会话；
 * 3. 最后清理本地会话并把应用图标角标清零。
 */
export async function signOut(deps: SignOutDeps = {}): Promise<void> {
  const getToken = deps.getToken ?? (() => session.token());
  const unregister = deps.unregisterPush ?? ((tok?: string) => unregisterPush(tok));
  const hubLogout = deps.hubLogout ?? (() => hub.logout());
  const clearSession = deps.clearSession ?? (() => session.clear());
  const clearBadge = deps.clearBadge ?? (() => setBadgeCount(0));

  const currentToken = getToken();
  if (currentToken) {
    await unregister(currentToken).catch(() => false);
  }
  await hubLogout().catch(() => undefined);
  clearSession();
  await clearBadge().catch(() => undefined);
}
