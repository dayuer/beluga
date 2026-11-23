import { type ExternalLookup, externalRequester, isExternalRequester, type TrustLevel } from '../../core/trust.js';
import { runtimeFor } from '../../agent/runtime/registry.js';
import { canHold, ToolRefusal } from '../domain/decide.js';
import { isExpired } from '../domain/grant.js';
import { fitsLevel, unfitWhy } from '../domain/runtime-fit.js';
import type { GrantStore } from '../ports/grant-store.js';

/**
 * Who stands behind an `ext:` requester, read from the grant book each time. Nothing is held, so a
 * revoke or a suspension counts at the run's next step. A level its route can't hold is refused.
 */
export function grantLookup(grants: Pick<GrantStore, 'list'>, now: () => number): ExternalLookup {
  return (requester) => {
    if (!isExternalRequester(requester)) return undefined;
    const grant = grants.list().find((g) => externalRequester(g.id) === requester);
    if (!grant || isExpired(grant, now())) return undefined;
    return { name: grant.name, level: canHold(grant.route, grant.level, grant.allowRemoteFull) && grant.suspendedAt === undefined ? grant.level : 'blocked' };
  };
}

/** Whether a runtime stops at Beluga's gate before each step. An unknown one doesn't. */
export const asksEachStep = (runtime: string): boolean => runtimeFor(runtime)?.capabilities.canGateEveryTool === true;

/** Whether a runtime's own sandbox keeps every step in the run's folders, secrets out (Codex). An unknown one doesn't. */
export const confinesEachStep = (runtime: string): boolean => runtimeFor(runtime)?.capabilities.hasSandbox === true;

/** Whether a run at this level may go on a runtime (domain/runtime-fit.ts). Read at each launch and send. */
export const runtimeAllowed = (level: TrustLevel, runtime: string): boolean => fitsLevel(level, { asksEachStep: asksEachStep(runtime), confined: confinesEachStep(runtime) });

export function needAllowedRuntime(level: TrustLevel, runtime: string): void {
  if (!runtimeAllowed(level, runtime)) throw new ToolRefusal('level_denied', unfitWhy(level, runtime));
}
