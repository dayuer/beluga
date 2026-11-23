import { z } from 'zod';

/**
 * ACP agents (BLG-ACP), Settings › Agents › ACP agents on the Mac: the ones this computer offers
 * (built-in ones whose CLI is here, ones from the ACP Registry, commands of yours), the Registry
 * searched, one installed, a command of yours added, one removed. Browser-safe: zod only.
 */

const runtimeId = z.string().regex(/^[a-z][\w-]{0,31}$/);
const arg = z.string().max(1024);

export const ACP_API = {
  // This computer's ACP agents → AcpAgentsView: each with where it came from and whether it's here.
  'acp.agents': { args: z.tuple([]) },
  // The ACP Registry's agents whose name has every word of the query ('' for all) → RegistryHit[].
  'acp.search': { args: z.tuple([z.string().max(200)]) },
  // Install one from the Registry, at its version (you pressed Install) → { ok, runtime, version } | { ok: false, error }.
  'acp.install': { args: z.tuple([z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/)]) },
  // Add a command of yours as an agent (its name, command, ACP arguments, variables) → { ok, id } | { ok: false, error }.
  'acp.addLocal': { args: z.tuple([z.object({ label: z.string().min(1).max(64), command: z.string().min(1).max(1024), args: z.array(arg).max(32).optional(), env: z.record(z.string().max(128), z.string().max(4096)).optional() }).strict()]) },
  // Remove an added agent (and what Beluga downloaded for it), or turn a built-in one off → whether it was there.
  'acp.remove': { args: z.tuple([runtimeId]) },
  // Turn a built-in agent back on.
  'acp.restore': { args: z.tuple([runtimeId]) },
} as const;
