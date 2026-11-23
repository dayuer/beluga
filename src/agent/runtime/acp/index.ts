import type { AgentRuntime } from '../types.js';
import { acpComplete } from './complete.js';
import type { AcpConnect } from './connection.js';
import { createAcpBackend } from './runner.js';
import { ACP_CAPABILITIES, type AcpAgentSpec } from './spec.js';
import { acpStatus } from './status.js';

/**
 * A runtime for one ACP agent (BLG-ACP): Cursor, Grok, Kiro, a Registry agent or a command of
 * yours, all on the same runner; `connect` swaps how it's reached (tests script one).
 */
export function createAcpRuntime(spec: AcpAgentSpec, deps: { readonly connect?: AcpConnect; readonly status?: AgentRuntime['status'] } = {}): AgentRuntime {
  const side = deps.connect ? { connect: deps.connect } : {};
  return {
    id: spec.id,
    label: spec.label,
    capabilities: ACP_CAPABILITIES,
    // `executablePath` is Claude Code's (the Mac app's pinned binary): never this agent's.
    create: ({ executablePath: _claudePath, ...opts }) => createAcpBackend(spec, { ...opts, ...(deps.connect ? { connect: deps.connect } : {}) }),
    complete: (req) => acpComplete(spec, req, side),
    status: deps.status ?? (() => acpStatus(spec, deps.connect ? { connect: deps.connect } : {})),
  };
}

export type { AcpAgentSpec } from './spec.js';
