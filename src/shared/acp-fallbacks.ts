import type { FallbackId, FeatureId, RuntimeFallback } from './runtime-fallbacks.js';

/**
 * What any ACP agent does instead where it can't do what Claude does (BLG-ACP): Cursor, Grok Build,
 * Kiro, a Registry agent, a command of yours. Every runtime Beluga doesn't run with code of its
 * own is one, so these stand for each. docs/parity.fork.md's "Agent runs on ACP agents" table names
 * each one, and tests/fork-acp-parity.test.ts checks the two agree. Browser-safe, as
 * runtime-fallbacks.ts is.
 */

/** Runtimes Beluga runs with code of its own; any other is an ACP agent. */
const OWN_RUNTIMES = new Set(['claude', 'codex', 'opencode', 'copilot', 'antigravity', 'local', 'fake']);

/** Whether a runtime id is an ACP agent's. */
export const isAcpRuntime = (runtime: string): boolean => !OWN_RUNTIMES.has(runtime);

export const ACP_FALLBACKS: Readonly<Partial<Record<FallbackId, RuntimeFallback>>> = {
  compact: { capability: 'hasCompaction', reason: 'This agent keeps its own context over ACP, so there’s no Compact for it; a /compact of its own runs as typed.' },
  fork: { capability: 'canFork', reason: 'On this agent a fork starts a new conversation: the files come along, the chat so far doesn’t.' },
  rewind: { capability: 'canFork', reason: 'On this agent, going back puts the files back but starts a new conversation from your edited message.' },
  // agent-wording: claude (the way out is the Claude runtime, by name)
  guests: { capability: 'canGateEveryTool', reason: 'ACP agents can run some steps without Beluga asking, so this one doesn’t answer guests. Switch this conversation to Claude for them.' },
  // agent-wording: claude (the way out is the Claude runtime, by name)
  friends: { capability: 'canGateEveryTool', reason: 'ACP agents can run some steps without Beluga asking, so friends’ tasks go to Claude (or Codex) instead.' },
};

/** What an ACP agent doesn't have at all: a side question (it can't branch its session), its own terminal view, steering. */
export const ACP_MISSING: readonly FeatureId[] = ['btw', 'terminal', 'steer'];

/** An ACP agent's fallbacks; undefined for a runtime with its own. */
export const acpFallbacks = (runtime: string): Readonly<Partial<Record<FallbackId, RuntimeFallback>>> | undefined => (isAcpRuntime(runtime) ? ACP_FALLBACKS : undefined);

/** What an ACP agent lacks; undefined for a runtime with its own. */
export const acpMissing = (runtime: string): readonly FeatureId[] | undefined => (isAcpRuntime(runtime) ? ACP_MISSING : undefined);
