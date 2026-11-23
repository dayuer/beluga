import { type RunEnd, RunFailedError, classifyRun } from '../../../shared/run-failure.js';
import type { HttpServerConfig, StdioServerConfig } from '../../tool-host.js';
import { CodexRpcError } from '../codex/rpc.js';
import type { AcpHttpMcpServer, AcpMcpServer, ConfigOption, SessionResponse } from '../opencode/acp.js';
import type { RuntimeStatus } from '../types.js';

/**
 * What every ACP agent's session says about its models and modes, in either shape: ACP's
 * `configOptions` (a select per option: model, mode, thought_level) or the older `models` /
 * `modes` (availableModels + currentModelId, set with session/set_model; availableModes +
 * currentModeId, set with session/set_mode). Beluga reads both, and sets each the way it came.
 */
export interface AcpSession extends SessionResponse {
  readonly models?: { readonly availableModels?: ReadonlyArray<{ readonly modelId: string; readonly name?: string; readonly description?: string | null }>; readonly currentModelId?: string };
  readonly modes?: { readonly availableModes?: ReadonlyArray<{ readonly id: string; readonly name?: string; readonly description?: string | null }>; readonly currentModeId?: string };
}

/** ACP's error code for "sign in first" (`auth_required`). */
export const ACP_AUTH_REQUIRED = -32000;
/** Any agent's words for "nobody is signed in". */
export const ACP_SIGNED_OUT = /auth(entication)?[ _]required|not (logged|signed) in|unauthenticated|please (log|sign) ?in|\b401\b|invalid[_ ](api[_ ])?key|no api key|missing api key/i;
/** Any agent's words for a plan or quota that ran out. */
export const ACP_LIMIT = /resource.?exhausted|quota|rate.?limit|usage limit|insufficient (credits|balance)|\b402\b|\b429\b/i;

/** Signed out, as an ACP error says it: by its code, else its words. */
export const acpSignedOut = (err: unknown): boolean => (err instanceof CodexRpcError && err.code === ACP_AUTH_REQUIRED) || ACP_SIGNED_OUT.test(err instanceof Error ? err.message : String(err));

/** A failed run, told as this agent's: a limit, a sign-in, or what it said. */
export function acpFailure(end: RunEnd, runtime: string): Error {
  const said = [end.error, end.result, ...(end.stderr ?? [])].filter(Boolean).join('\n');
  if (ACP_LIMIT.test(said)) return new RunFailedError({ kind: 'usage_limit', detail: said.slice(0, 8000), runtime });
  if (ACP_SIGNED_OUT.test(said)) return new RunFailedError({ kind: 'signed_out', detail: said.slice(0, 8000), runtime });
  return new RunFailedError({ ...classifyRun(end), runtime });
}

const optionOf = (s: Pick<AcpSession, 'configOptions'>, ...ids: string[]): ConfigOption | undefined => s.configOptions?.find((o) => ids.includes(o.id) || (o.category !== undefined && ids.includes(o.category)));

/** The agent's own choice, first in every list: '' runs on whatever model it's set to. */
export const OWN_MODEL = { value: '', label: 'Default', description: 'The model the agent is set to' } as const;

/** The session's models as picker rows (its own choice first), with the thinking levels the current one takes. */
export function acpModelRows(s: AcpSession | undefined): RuntimeStatus['models'] {
  if (!s) return [OWN_MODEL];
  const model = optionOf(s, 'model');
  const levels = optionOf(s, 'thought_level', 'effort', 'reasoning_effort')?.options.map((o) => o.value) ?? [];
  const rows = model
    ? model.options.map((o) => ({ value: o.value, label: o.name, description: o.description ?? '', ...(o.value === model.currentValue && levels.length ? { efforts: levels } : {}) }))
    : (s.models?.availableModels ?? []).map((m) => ({ value: m.modelId, label: m.name ?? m.modelId, description: m.description ?? '' }));
  return [OWN_MODEL, ...rows.filter((r) => r.value)];
}

/** Claude's aliases and a Beluga default mean nothing to another agent: those run on its own choice. */
const CLAUDE_ALIASES = /^(default|opus|sonnet|haiku|best|opusplan)(\[1m\])?$/i;

/** A model for an ACP agent: undefined for its own default (an alias of Claude's, a local model's `[…]` value). */
export function acpModel(model: string | undefined): string | undefined {
  if (!model || CLAUDE_ALIASES.test(model.trim()) || model.startsWith('[')) return undefined;
  return model.trim();
}

/** Which mode value a session calls `name` (`plan`, or its working mode), in either shape. */
export function acpMode(s: AcpSession, name: 'plan' | 'work'): { readonly via: 'config' | 'modes'; readonly value: string } | undefined {
  const words = name === 'plan' ? [/^plan$/i, /#plan$/i, /plan/i] : [/^(agent|code|default|build|act|edit|accept ?edits?|auto)$/i, /#(agent|code|default|build)$/i];
  const config = optionOf(s, 'mode');
  if (config) {
    for (const w of words) {
      const hit = config.options.find((o) => w.test(o.value) || w.test(o.name));
      if (hit) return { via: 'config', value: hit.value };
    }
    return undefined;
  }
  for (const w of words) {
    const hit = s.modes?.availableModes?.find((m) => w.test(m.id) || (m.name ? w.test(m.name) : false));
    if (hit) return { via: 'modes', value: hit.id };
  }
  return undefined;
}

/** Beluga's tool suites as ACP's http MCP servers. */
export function httpServers(servers: Readonly<Record<string, HttpServerConfig>>): AcpHttpMcpServer[] {
  return Object.entries(servers).map(([name, s]) => ({ type: 'http', name, url: s.url, headers: Object.entries(s.headers).map(([k, value]) => ({ name: k, value })) }));
}

/** Beluga's tool suites as ACP's stdio MCP servers (every agent takes these). */
export function stdioServers(servers: Readonly<Record<string, StdioServerConfig>>): AcpMcpServer[] {
  return Object.entries(servers).map(([name, s]) => ({ name, command: s.command, args: [...s.args], env: Object.entries(s.env).map(([k, value]) => ({ name: k, value })) }));
}

/** Beluga's instructions for a run, ahead of the first message: no ACP agent has a way to take a system prompt that they all share. */
export function withInstructions(instructions: string, prompt: string): string {
  return instructions.trim() ? `<beluga-instructions>\n${instructions.trim()}\n</beluga-instructions>\n\n${prompt}` : prompt;
}
