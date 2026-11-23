import { acpAgents } from './agents.js';
import { findAcpCommand } from './connection.js';
import { createAcpRuntime } from './index.js';
import type { AcpAgentSpec } from './spec.js';
import type { AgentRuntime, RuntimeId } from '../types.js';

/**
 * Where the runtime registry (runtime/registry.ts) reaches the ACP agents (BLG-ACP), one call each:
 * the agents this computer offers, one by its id, and how to sign in to one. Kept here so the
 * registry, upstream's file, changes by a line per use (docs/fork.md).
 */

/** Ids with a runtime of their own: an ACP agent never stands in for one. */
const OWN = new Set(['claude', 'codex', 'opencode', 'copilot', 'antigravity', 'local']);

/** One runtime per ACP agent spec, made once (a changed spec, a new one). */
const made = new Map<string, { readonly key: string; readonly rt: AgentRuntime }>();
function runtimeOf(spec: AcpAgentSpec): AgentRuntime {
  const key = JSON.stringify([spec.label, spec.command, spec.args, spec.env ?? {}]);
  const had = made.get(spec.id);
  if (had?.key === key) return had.rt;
  const rt = createAcpRuntime(spec);
  made.set(spec.id, { key, rt });
  return rt;
}

/** The ACP agents this computer offers: the ones you added, and the built-in ones whose CLI is here. */
export function acpRuntimes(): AgentRuntime[] {
  return acpAgents.list().filter((spec) => !OWN.has(spec.id)).map(runtimeOf);
}

/** The ACP agent an AgentRef names ('cursor', 'acp-…'); undefined for one that isn't here. */
export function acpRuntimeFor(id: RuntimeId | undefined): AgentRuntime | undefined {
  if (!id || OWN.has(id)) return undefined;
  const spec = acpAgents.get(id);
  return spec ? runtimeOf(spec) : undefined;
}

/** How to sign in to an ACP agent, as a command for Terminal; undefined for one with none. */
export function acpSignInCommand(id: RuntimeId): readonly string[] | undefined {
  const spec = OWN.has(id) ? undefined : acpAgents.get(id);
  const cmd = spec?.signIn?.command;
  if (!spec || !cmd?.length) return undefined;
  // Its own command found where the agent is (an installer's folder the Mac app's PATH lacks).
  return cmd[0] === spec.command ? [findAcpCommand(spec) ?? cmd[0]!, ...cmd.slice(1)] : [...cmd];
}
