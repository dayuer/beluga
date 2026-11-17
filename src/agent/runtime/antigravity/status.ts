import os from 'node:os';
import type { ConfigOption, SessionResponse } from '../opencode/acp.js';
import type { RuntimeStatus } from '../types.js';
import { type AgyConnect, findAgy, spawnAgy } from './connection.js';
import { dropAgySession } from './sessions.js';

export const AGY_MISSING = 'Install the Antigravity CLI: curl -fsSL https://antigravity.google/cli/install.sh | bash';
export const AGY_SIGN_IN = 'Run agy in Terminal once to sign in with your Google account';

/** Antigravity's words for "nobody is signed in" (ACP's auth_required, -32000). */
export const AGY_SIGNED_OUT = /auth(entication)?[ _]required|not (logged|signed) in|unauthenticated|no (saved )?(session|credentials)|log ?in (with|first)|\b401\b|invalid_grant|keyring/i;
/** Its words when your plan's quota has run out (a 429, RESOURCE_EXHAUSTED, the weekly or five-hour limit). */
export const AGY_LIMIT = /quota|rate.?limit|resource.?exhausted|limit (reached|exceeded)|exceeded|\b429\b/i;

/** The session's options a picker reads: its models, and the thinking levels the current one takes. */
export function modelRows(options: readonly ConfigOption[] | undefined): RuntimeStatus['models'] {
  const model = options?.find((o) => o.id === 'model' || o.category === 'model');
  const levels = options?.find((o) => o.id === 'thought_level' || o.category === 'thought_level')?.options.map((o) => o.value) ?? [];
  return (model?.options ?? []).map((o) => ({ value: o.value, label: o.name, description: o.description ?? '', ...(o.value === model?.currentValue && levels.length ? { efforts: levels } : {}) }));
}

const CACHE_MS = 60_000;
let cached: { readonly at: number; readonly status: Promise<RuntimeStatus> } | undefined;

/**
 * Antigravity on this Mac: not installed, not signed in, or ready with the models your plan has.
 * It opens a session to find out (no message is sent, so nothing of your quota is used), then
 * drops it. Kept a minute. Never signs in.
 */
export async function agyStatus(deps: { readonly bin?: string; readonly connect?: AgyConnect; readonly now?: number } = {}): Promise<RuntimeStatus> {
  const now = deps.now ?? Date.now();
  if (!deps.connect && cached && now - cached.at < CACHE_MS) return cached.status;
  const status = check(deps);
  if (!deps.connect) cached = { at: now, status };
  return status;
}

async function check(deps: { readonly bin?: string; readonly connect?: AgyConnect }): Promise<RuntimeStatus> {
  const bin = deps.bin ?? (deps.connect ? undefined : findAgy());
  if (!bin && !deps.connect) return { state: 'missing', fix: AGY_MISSING, models: [] };
  const cwd = os.tmpdir();
  const conn = await (deps.connect ?? spawnAgy)({ cwd, ...(bin ? { bin } : {}) }).catch(() => undefined);
  if (!conn) return { state: 'missing', fix: AGY_MISSING, models: [] };
  try {
    const s = await conn.rpc.request<SessionResponse>('session/new', { cwd, mcpServers: [] }, 60_000);
    if (s.sessionId && !deps.connect) void dropAgySession(s.sessionId).catch(() => false);
    return { state: 'ready', models: modelRows(s.configOptions) };
  } catch (err) {
    const words = err instanceof Error ? err.message : String(err);
    if (AGY_SIGNED_OUT.test(words)) return { state: 'signed_out', fix: AGY_SIGN_IN, models: [] };
    // Anything else (no network, a timeout): it's there and signed in as far as Beluga can tell; a run says what's wrong.
    return { state: 'ready', models: [] };
  } finally {
    await conn.proc.kill();
  }
}
