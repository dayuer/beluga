import type { AgentRuntime, RuntimeCapabilities } from '../types.js';
import { agyComplete } from './complete.js';
import { AGY_API_ID, type AgySignIn } from './sign-in.js';
import type { AgyConnect } from './connection.js';
import { createAgyBackend } from './runner.js';
import { agyStatus } from './status.js';

/** Antigravity through `agy acp`, with your own Antigravity plan: what it can and can't do of what Beluga asks. */
export const ANTIGRAVITY_CAPABILITIES: RuntimeCapabilities = {
  // It asks Beluga before commands, writes and MCP tools, and each is judged as Claude's are. But it
  // reads files (inside the folder and out, .env files too) without asking, and its permission
  // rules don't reach reads over ACP: no friends' tasks, no guests.
  canGateEveryTool: false,
  hasSandbox: false,
  // One prompt at a time: a message sent while it works waits for its own turn; Send now stops the turn (session/cancel).
  canSteer: false,
  canInterrupt: true,
  // Its own Plan mode: it looks, then the plan comes to you (Beluga turns its writes down until you approve).
  hasPlanMode: true,
  hasSubagents: false,
  hasBackgroundAgents: false,
  // Tokens per turn and the context meter. Not its quota: only its internal APIs have it, and
  // Google said reading them can get an account flagged (quota.ts stays for when ACP says it).
  hasUsage: true,
  // session/load; it can't branch a conversation.
  canResume: true,
  canFork: false,
  // Its question form doesn't reach a client over ACP, but its ask_question call carries the
  // question whole: Beluga asks it for Antigravity, and your answer is its next turn (questions.ts).
  canAskUser: true,
  // Its own /compact.
  hasCompaction: true,
  hasModelList: true,
  hasProcess: true,
  // Its own skills and commands run as typed; Claude Code's custom commands are expanded for it (opencode/skills.ts).
  skills: 'native',
  promptImages: true,
  // It takes a client's MCP servers over stdio and HTTP; Beluga's go over HTTP, as Copilot's do.
  toolMounts: ['http'],
};

/**
 * An Antigravity runtime: on your Google account (`antigravity`), or on a Gemini API key
 * (`antigravity-api`, sign-in.ts). `connect` swaps how it's reached (tests and the demo script one).
 */
export function createAntigravityRuntime(deps: { readonly connect?: AgyConnect; readonly status?: AgentRuntime['status']; readonly signIn?: AgySignIn } = {}): AgentRuntime {
  const api = deps.signIn === 'api-key';
  const side = { ...(deps.connect ? { connect: deps.connect, drop: async () => undefined } : {}), ...(deps.signIn ? { signIn: deps.signIn } : {}) };
  return {
    id: api ? AGY_API_ID : 'antigravity',
    label: api ? 'Antigravity (API key)' : 'Antigravity',
    capabilities: ANTIGRAVITY_CAPABILITIES,
    // `executablePath` is Claude Code's (the Mac app's pinned binary): never Antigravity's. It finds its own (findAgy, BELUGA_AGY_PATH).
    create: ({ executablePath: _claudePath, ...opts }) => createAgyBackend({ ...opts, ...(deps.connect ? { connect: deps.connect } : {}), ...(deps.signIn ? { signIn: deps.signIn } : {}) }),
    complete: (req) => agyComplete(req, side),
    status: deps.status ?? (() => agyStatus({ ...(deps.connect ? { connect: deps.connect } : {}), ...(deps.signIn ? { signIn: deps.signIn } : {}) })),
  };
}

export const antigravityRuntime: AgentRuntime = createAntigravityRuntime();
/** Antigravity on a Gemini API key: an agent of its own, for plans and everything Beluga starts on its own. */
export const antigravityApiRuntime: AgentRuntime = createAntigravityRuntime({ signIn: 'api-key' });
