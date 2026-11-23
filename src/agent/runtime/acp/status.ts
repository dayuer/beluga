import os from 'node:os';
import type { RuntimeStatus } from '../types.js';
import { type AcpConnect, acpMissingWords, findAcpCommand, spawnAcp } from './connection.js';
import { type AcpSession, acpModelRows, acpSignedOut } from './parts.js';
import type { AcpAgentSpec } from './spec.js';

const CACHE_MS = 60_000;
const cache = new Map<string, { readonly at: number; readonly status: Promise<RuntimeStatus> }>();

/** How to sign in to it, in words: its own, else ACP's plain advice. */
export const acpSignInWords = (spec: Pick<AcpAgentSpec, 'label' | 'signIn' | 'command'>): string => spec.signIn?.words ?? `Run ${spec.command} in Terminal once to sign in to ${spec.label}`;

/**
 * An ACP agent on this computer: not installed, not signed in, or ready with its models. It
 * opens a session to find out (no message is sent, so nothing of your plan is used), then stops.
 * Kept a minute per agent. Never signs in.
 */
export async function acpStatus(spec: AcpAgentSpec, deps: { readonly bin?: string; readonly connect?: AcpConnect; readonly now?: number } = {}): Promise<RuntimeStatus> {
  const now = deps.now ?? Date.now();
  const key = `${spec.id}\0${spec.command}\0${spec.args.join('\0')}`;
  const hit = cache.get(key);
  if (!deps.connect && hit && now - hit.at < CACHE_MS) return hit.status;
  const status = check(spec, deps);
  if (!deps.connect) cache.set(key, { at: now, status });
  return status;
}

/** Forget what was found (an agent just installed or removed). */
export function forgetAcpStatus(): void {
  cache.clear();
}

async function check(spec: AcpAgentSpec, deps: { readonly bin?: string; readonly connect?: AcpConnect }): Promise<RuntimeStatus> {
  const bin = deps.bin ?? (deps.connect ? undefined : findAcpCommand(spec));
  if (!bin && !deps.connect) return { state: 'missing', fix: acpMissingWords(spec), models: [] };
  const cwd = os.tmpdir();
  let failed: unknown;
  const conn = await (deps.connect ?? spawnAcp(spec))({ cwd, ...(bin ? { bin } : {}) }).catch((err: unknown) => {
    failed = err;
    return undefined;
  });
  if (!conn) return acpSignedOut(failed) ? { state: 'signed_out', fix: acpSignInWords(spec), models: [] } : { state: 'missing', fix: failed instanceof Error ? failed.message : acpMissingWords(spec), models: [] };
  try {
    const s = await conn.rpc.request<AcpSession>('session/new', { cwd, mcpServers: [] }, 30_000);
    return { state: 'ready', models: acpModelRows(s) };
  } catch (err) {
    if (acpSignedOut(err)) return { state: 'signed_out', fix: acpSignInWords(spec), models: [] };
    // Anything else (no network, a timeout): it's there as far as Beluga can tell; a run says what's wrong.
    return { state: 'ready', models: acpModelRows(undefined) };
  } finally {
    await conn.proc.kill();
  }
}
