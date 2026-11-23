import type { RuntimeCapabilities } from '../types.js';

/**
 * One Agent Client Protocol agent Beluga runs through the generic ACP runtime (acp/runner.ts): how
 * to start it, what it's called, how to set it up. Built-in ones (catalog.ts: Cursor, Grok, Kiro,
 * Muse, Pi, fx, Gemini, Qwen…), ones installed from the ACP Registry (registry.ts) and local
 * commands you add (agents.ts) are all this shape, so one runtime serves them all.
 */
export interface AcpAgentSpec {
  /** Its runtime id (an AgentRef's `runtime`): /^[a-z][\w-]{0,31}$/. */
  readonly id: string;
  /** Its name for people ("Cursor", "Gemini CLI"). */
  readonly label: string;
  /** The executable: a name looked up on PATH (and the usual install folders), or a full path. */
  readonly command: string;
  /** Its arguments for speaking ACP over stdio (`acp`, `--acp`, `agent stdio`…). */
  readonly args: readonly string[];
  /** Variables it needs for ACP (Muse's MUSE_EXPERIMENTAL_ACP=on), over the run's own. */
  readonly env?: Readonly<Record<string, string>>;
  /** Where it came from: Beluga's own list, the ACP Registry, or a command you added. */
  readonly source: 'builtin' | 'registry' | 'local';
  /** How to install it, in words (a built-in one that isn't there yet). */
  readonly install?: string;
  /** How to sign in to it: words, and the command for Terminal when it has one. */
  readonly signIn?: { readonly words: string; readonly command?: readonly string[] };
  /** Folders besides PATH where its installer puts it (`~/.local/bin`), `~` for your home. */
  readonly searchDirs?: readonly string[];
  /** The variable that points Beluga at its executable instead (BELUGA_CURSOR_PATH). */
  readonly pathVar?: string;
  /** Its ACP Registry entry, when it came from there (or is one), and the version installed. */
  readonly registryId?: string;
  readonly version?: string;
  readonly website?: string;
  readonly description?: string;
}

/** A runtime id Beluga accepts (the room protocol's AgentRef rule). */
export const RUNTIME_ID = /^[a-z][\w-]{0,31}$/;

/** A runtime id for an agent from the ACP Registry or a local command: `acp-<its id>`, as the room protocol takes it. */
export function acpRuntimeId(agentId: string): string {
  const slug = agentId
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `acp-${slug || 'agent'}`.slice(0, 32).replace(/-+$/, '');
}

/**
 * What any ACP agent can do of what Beluga asks, before it says more about itself. ACP lets an
 * agent run its own tools without asking (most read files and run read-only commands freely), and
 * Beluga can't rely on its sandbox: so it can't gate every step, and gets no friends' tasks or
 * guests (types.ts safetyFor). One prompt at a time (no steer); session/cancel stops a turn; plan
 * mode is its own when it offers one, else Beluga's (writes turned down until you approve); its
 * models and modes come from the session's config options.
 */
export const ACP_CAPABILITIES: RuntimeCapabilities = {
  canGateEveryTool: false,
  hasSandbox: false,
  canSteer: false,
  canInterrupt: true,
  hasPlanMode: true,
  hasSubagents: false,
  hasBackgroundAgents: false,
  hasUsage: true,
  // session/load when it says it can (loadSession); otherwise a new conversation, said so.
  canResume: true,
  canFork: false,
  canAskUser: false,
  hasCompaction: false,
  hasModelList: true,
  hasProcess: true,
  // Claude Code's commands are expanded for it (opencode/skills.ts); its own run as typed.
  skills: 'mapped',
  promptImages: true,
  // Beluga's tools over HTTP when it takes them so, else over stdio (which every ACP agent takes).
  toolMounts: ['http', 'stdio'],
};

/** A spec as it's checked before it's used: a bad one is refused, with why. */
export function specProblem(spec: Pick<AcpAgentSpec, 'id' | 'label' | 'command' | 'args'>): string | undefined {
  if (!RUNTIME_ID.test(spec.id)) return `“${spec.id}” can’t be an agent’s id (lowercase letters, digits, - and _, up to 32).`;
  if (!spec.label.trim() || spec.label.length > 64) return 'Give the agent a name (up to 64 characters).';
  if (!spec.command.trim()) return 'Say which command starts the agent.';
  if (/[\n\r\0]/.test(spec.command) || spec.args.some((a) => /[\n\r\0]/.test(a))) return 'A command or argument can’t have line breaks in it.';
  if (spec.args.length > 32) return 'That’s too many arguments (up to 32).';
  return undefined;
}
