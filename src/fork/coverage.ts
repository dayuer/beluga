import type { Method } from '../ipc/api.js';
import type { Side } from '../companion/coverage.js';
import type { ExternalAccess } from '../external/coverage.js';
import type { MachineSide } from '../machines/coverage.js';

/**
 * This fork's API methods, classified for each screen and door. Upstream's tables stay as upstream
 * wrote them and spread these in with one line each, so syncing upstream never conflicts there
 * (docs/fork.md). The typecheck still fails when a method is missing from a table.
 */

export const PHONE_FORK = {} as const satisfies Partial<Record<Method, Side>>;

export const EXTERNAL_FORK = {} as const satisfies Partial<Record<Method, ExternalAccess>>;

export const MACHINE_FORK = {} as const satisfies Partial<Record<Method, MachineSide>>;
