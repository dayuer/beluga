import type { Method } from '../ipc/api.js';
import type { Side } from '../companion/coverage.js';
import type { ExternalAccess } from '../external/coverage.js';
import type { MachineSide } from '../machines/coverage.js';

/**
 * This fork's API methods, classified for each screen and door. Upstream's tables stay as upstream
 * wrote them and spread these in with one line each, so syncing upstream never conflicts there
 * (docs/fork.md). The typecheck still fails when a method is missing from a table.
 */

export const PHONE_FORK = {
  // ACP agents are set up on the Mac (Settings › Agents); the phone picks them like any agent.
  'acp.agents': 'mac',
  'acp.search': 'mac',
  'acp.install': 'mac',
  'acp.addLocal': 'mac',
  'acp.remove': 'mac',
  'acp.restore': 'mac',
} as const satisfies Partial<Record<Method, Side>>;

/** Installing an agent puts someone else's program on this computer, and adding one runs a command: a person does those. */
const INSTALLS = 'It downloads or runs a program on this computer: a person adds agents, in Settings.';

export const EXTERNAL_FORK = {
  'acp.agents': 'ui_only',
  'acp.search': 'ui_only',
  'acp.install': { refused: INSTALLS },
  'acp.addLocal': { refused: INSTALLS },
  'acp.remove': 'ui_only',
  'acp.restore': 'ui_only',
} as const satisfies Partial<Record<Method, ExternalAccess>>;

export const MACHINE_FORK = {
  // Your app sets up a computer of yours as it does this Mac: its ACP agents too.
  'acp.agents': 'drive',
  'acp.search': 'drive',
  'acp.install': 'drive',
  'acp.addLocal': 'drive',
  'acp.remove': 'drive',
  'acp.restore': 'drive',
} as const satisfies Partial<Record<Method, MachineSide>>;
