import { type AcpSideDeps, acpComplete } from '../acp/complete.js';
import type { CompletionRequest } from '../types.js';
import { antigravityExtension } from './extension.js';
import type { AgyLogin } from './login.js';
import { ANTIGRAVITY } from './spec.js';

export interface AgySideDeps extends AcpSideDeps {
  /** How agy is signed in; unset: its own settings (login.ts). */
  readonly login?: () => AgyLogin;
}

/**
 * A side call on Antigravity (agent/side-calls.ts): one prompt in a conversation of its own
 * (dropped after), its request marked as input (sidePrompt: Antigravity keeps its own system
 * prompt). It may use only the tools it was given, each one asked about (vetTool) when Antigravity
 * asks; Beluga's suites, when given, are mounted for this call alone. A model of Antigravity's
 * when one was named; 'haiku' (small and fast) is its default model at its lowest thinking level.
 */
export function agyComplete(req: CompletionRequest, deps: AgySideDeps = {}): Promise<string> {
  return acpComplete(ANTIGRAVITY, antigravityExtension({ ...(deps.bin ? { bin: deps.bin } : {}), ...(deps.login ? { login: deps.login } : {}) }), req, deps);
}
