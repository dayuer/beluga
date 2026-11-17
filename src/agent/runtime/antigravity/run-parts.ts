import { type RunEnd, RunFailedError, classifyRun } from '../../../shared/run-failure.js';
import type { ConfigOption } from '../opencode/acp.js';
import { AGY_LIMIT, AGY_SIGNED_OUT } from './status.js';

/** Claude's aliases and a Beluga default mean nothing to Antigravity: those run on its own choice. */
const CLAUDE_ALIASES = /^(default|opus|sonnet|haiku|best|opusplan)(\[1m\])?$/i;

/** A model Antigravity knows (`gemini-3.8-flash`, `claude-opus-4-6-thinking`), or undefined for its own. */
export function agyModel(model: string | undefined): string | undefined {
  if (!model || CLAUDE_ALIASES.test(model.trim()) || model.includes('[') || model.includes('/')) return undefined;
  return model.trim();
}

/** Beluga's efforts as Antigravity's thinking levels (it has low, medium and high). */
export function agyThought(effort: string | undefined): string | undefined {
  if (!effort) return undefined;
  if (effort === 'xhigh' || effort === 'max') return 'high';
  if (effort === 'minimal') return 'low';
  return effort;
}

/** A session mode's value by what it's for: `plan`, or `default` (asks before edits and commands, so Beluga judges each). */
export function modeValue(options: readonly ConfigOption[], name: 'plan' | 'default'): string | undefined {
  return options.find((o) => o.id === 'mode')?.options.find((o) => o.value === name)?.value;
}

/** Beluga's instructions for a run, as what Antigravity adds to its own system prompt (its `_meta.antigravity.systemPrompt.append`). */
export function systemMeta(text: string): { readonly antigravity: { readonly systemPrompt: { readonly append: string } } } {
  return { antigravity: { systemPrompt: { append: text } } };
}

/** A failed Antigravity run, told as Antigravity's (not Claude Code's): a limit, a sign-in, or what it said. */
export function agyFailure(end: RunEnd): Error {
  const said = [end.error, end.result, ...(end.stderr ?? [])].filter(Boolean).join('\n');
  if (AGY_LIMIT.test(said)) return new RunFailedError({ kind: 'usage_limit', detail: said.slice(0, 8000), runtime: 'antigravity' });
  if (AGY_SIGNED_OUT.test(said)) return new RunFailedError({ kind: 'signed_out', detail: said.slice(0, 8000), runtime: 'antigravity' });
  return new RunFailedError({ ...classifyRun(end), runtime: 'antigravity' });
}

/** What Antigravity is told after a turn it ended silently on a declined step: why, and to answer. */
export const declinedNote = (why: readonly string[]): string => `Beluga declined that step: ${[...new Set(why)].join(' ')} Carry on without it: answer the person now, saying what you couldn't do.`;
