import type { Method } from '../ipc/api.js';
import type { Side } from '../companion/coverage.js';
import type { ExternalAccess } from '../external/coverage.js';
import type { MachineSide } from '../machines/coverage.js';

/**
 * This fork's API methods, classified for each screen and door. Upstream's tables stay as upstream
 * wrote them and spread these in with one line each, so syncing upstream never conflicts there
 * (docs/fork.md). The typecheck still fails when a method is missing from a table.
 */

/** Who works each kind of plan role (by tier): a pick from a list, so the phone does it too. */
export const PHONE_FORK = {
  'plans.setCheckAgent': 'phone',
  'plans.setArchAgent': 'phone',
  'plans.setFixAgent': 'phone',
} as const satisfies Partial<Record<Method, Side>>;

export const EXTERNAL_FORK = {
  'plans.setCheckAgent': 'covered',
  'plans.setArchAgent': 'covered',
  'plans.setFixAgent': 'covered',
} as const satisfies Partial<Record<Method, ExternalAccess>>;

export const MACHINE_FORK = {
  'plans.setCheckAgent': 'drive',
  'plans.setArchAgent': 'drive',
  'plans.setFixAgent': 'drive',
} as const satisfies Partial<Record<Method, MachineSide>>;
