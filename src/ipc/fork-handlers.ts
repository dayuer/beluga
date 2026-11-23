import { createHash } from 'node:crypto';
import type { Session } from '../core/session.js';
import { type CheckDeps, checkEndpoint } from '../fork/endpoint-check.js';
import type { Args } from './api.js';
import type { Handlers } from './handlers.js';

/**
 * This fork's handlers, spread into upstream's table with one line (docs/fork.md): `env.saveEndpoint`
 * checked first (fork/endpoint-check.ts). Coming after upstream's own entry,
 * it takes that method's place; upstream's handler stays as it was.
 */

type SaveChange = Args<'env.saveEndpoint'>[0];

export interface CheckedSaveDeps extends CheckDeps {
  readonly now?: () => number;
}

/** How long a save that didn't pass the check can be pressed again to save it anyway. */
export const SAVE_ANYWAY_MS = 10 * 60_000;

/** The settings' error line: one sentence the Mac's Chinese table has, with what went wrong in it, and the hint after. */
export const notSaved = (words: string, hint: string): string => `Not saved: ${words}. Press Save again to save it anyway.${hint ? ` ${hint}` : ''}`;

/**
 * Save an endpoint once a run on it would work: its address, key and models are tried first. What
 * didn't pass is refused with what went wrong; the same thing saved again within SAVE_ANYWAY_MS is
 * saved anyway (a proxy that's down for now, a model that's still being set up). A change that
 * leaves the address, key and models as they were (a new name) isn't checked.
 */
export function checkedSave(deps: CheckedSaveDeps = {}): (s: Pick<Session, 'env' | 'local'>, change: SaveChange) => Promise<string> {
  /** What didn't pass (a hash: the key is in it), and when. */
  const refused = new Map<string, number>();
  return async (s, change) => {
    const now = (deps.now ?? Date.now)();
    const before = change.id ? s.env.endpoints().find((e) => e.id === change.id) : undefined;
    // Gone already: say so now, as saving would, without trying it first.
    if (change.id && !before) return s.env.saveEndpoint(change);
    const baseUrl = change.baseUrl.trim().replace(/\/+$/, '');
    const key = change.key === undefined ? before?.key : change.key || undefined;
    const models = [...new Set((change.models ?? before?.models ?? []).map((m) => m.trim()).filter(Boolean))];
    const same = before !== undefined && before.baseUrl === baseUrl && (before.key ?? undefined) === key && JSON.stringify(before.models) === JSON.stringify(models);
    if (!same) {
      const what = createHash('sha256').update(JSON.stringify([baseUrl, key ?? '', models])).digest('hex');
      for (const [k, at] of refused) if (now - at > SAVE_ANYWAY_MS) refused.delete(k);
      // Pressed again after it didn't pass: saved anyway.
      if (refused.has(what)) refused.delete(what);
      else {
        const got = await checkEndpoint({ baseUrl, ...(key ? { key } : {}), models }, deps);
        if (!got.ok) {
          refused.set(what, now);
          throw new Error(notSaved(got.words, got.hint));
        }
      }
    }
    const saved = s.env.saveEndpoint(change);
    await s.local.look();
    return saved;
  };
}

/** This daemon's checked save (tests/fork-endpoint-check.test.ts holds HANDLERS to it: the override rests on where the spread stands). */
export const SAVE_ENDPOINT = checkedSave();

/** Optional in its type, so taking upstream's place isn't a "specified more than once" error. */
const ENDPOINT_HANDLERS: Partial<Pick<Handlers, 'env.saveEndpoint'>> = {
  'env.saveEndpoint': SAVE_ENDPOINT,
};

export const FORK_HANDLERS = {
  ...ENDPOINT_HANDLERS,
};
