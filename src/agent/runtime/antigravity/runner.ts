import { type AcpBackendOptions, createAcpBackend } from '../acp/runner.js';
import type { AgentBackend } from '../../types.js';
import { antigravityExtension } from './extension.js';
import type { AgySignIn } from './sign-in.js';
import { ANTIGRAVITY, ANTIGRAVITY_API } from './spec.js';

export interface AgyBackendOptions extends AcpBackendOptions {
  /** Where Antigravity keeps its conversations (its own notes, a plan or a task list, are written there). */
  readonly dataDir?: string;
  /** Which of the two it is (sign-in.ts); unset: your Google account. */
  readonly signIn?: AgySignIn;
}

/**
 * Runs turns on Antigravity through `agy acp`, the CLI's own ACP server signed in with your Google
 * account, on the ACP core (acp/runner.ts) with what Antigravity does past ACP (extension.ts): its
 * instructions in its system prompt, its thinking levels, its ask_question, /compact and its quota.
 */
export function createAgyBackend(opts: AgyBackendOptions): AgentBackend {
  return createAcpBackend(opts.signIn === 'api-key' ? ANTIGRAVITY_API : ANTIGRAVITY, antigravityExtension({ ...(opts.dataDir ? { dataDir: opts.dataDir } : {}), ...(opts.bin ? { bin: opts.bin } : {}), ...(opts.signIn ? { signIn: opts.signIn } : {}) }), opts);
}
