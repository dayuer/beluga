import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { agyGeminiHome } from './rules-free.js';
import { agyDataDir } from './sessions.js';

/**
 * Antigravity's MCP servers in a run. It connects them after session/new answers (its own config's,
 * ~/.gemini/config/mcp_config.json, and the ones Beluga sends), and a turn that starts before has
 * none of them for the whole turn, however long it runs. As each one connects, agy writes its tools'
 * schemas into <its data folder>/mcp/<server>/ (agy 1.5.12): that's how Beluga knows it's there.
 */

/** Waiting past this long, the first turn goes without the servers still missing. */
export const MCP_READY_CAP_MS = 20_000;
const POLL_MS = 200;

/** Servers that didn't connect within the cap once (one that needs a sign-in, a broken command): not waited for again this daemon. */
const neverReady = new Set<string>();

/** The servers on in Antigravity's own config (not `disabled`). */
export function agyOwnMcpNames(file: string = path.join(agyGeminiHome(), 'config', 'mcp_config.json')): string[] {
  try {
    const servers = (JSON.parse(readFileSync(file, 'utf8')) as { mcpServers?: Record<string, { disabled?: unknown }> }).mcpServers ?? {};
    return Object.entries(servers)
      .filter(([, s]) => s && typeof s === 'object' && s.disabled !== true)
      .map(([name]) => name);
  } catch {
    return [];
  }
}

/** When agy last wrote a server's tools (0: never). */
function writtenAt(dir: string): number {
  try {
    return Math.max(statSync(dir).mtimeMs, ...readdirSync(dir).map((f) => statSync(path.join(dir, f)).mtimeMs));
  } catch {
    return 0;
  }
}

export interface McpReadyDeps {
  /** Where agy writes each server's tools (its data folder's mcp/). */
  readonly dir?: string;
  /** Its own config's servers. */
  readonly own?: readonly string[];
  readonly capMs?: number;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
  /** Servers known not to connect (tests: their own). */
  readonly missing?: Set<string>;
}

/**
 * Resolves once every server (`names`, and agy's own) has written its tools since `since` (its
 * process started), or after MCP_READY_CAP_MS: then the ones still missing aren't waited for again.
 * What it saw: the ones that connected, and the ones it gave up on.
 */
export async function agyMcpReady(names: readonly string[], since: number, deps: McpReadyDeps = {}): Promise<{ readonly ready: string[]; readonly late: string[] }> {
  const dir = deps.dir ?? path.join(agyDataDir(), 'mcp');
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const missing = deps.missing ?? neverReady;
  const wanted = [...new Set([...names, ...(deps.own ?? agyOwnMcpNames())])].filter((n) => !missing.has(n));
  const until = now() + (deps.capMs ?? MCP_READY_CAP_MS);
  const ready = new Set<string>();
  for (;;) {
    for (const name of wanted) if (!ready.has(name) && writtenAt(path.join(dir, name)) >= since) ready.add(name);
    if (ready.size === wanted.length || now() >= until) break;
    await sleep(POLL_MS);
  }
  const late = wanted.filter((n) => !ready.has(n));
  for (const name of late) missing.add(name);
  return { ready: [...ready], late };
}

/**
 * What agy is told about MCP and comparing a screen with its design, after Beluga's instructions: it
 * guessed at servers a request named (claude_design, which only Claude Code has) and called them.
 */
export const AGY_MCP_NOTE = [
  'MCP servers: call them with call_mcp_tool; each tool\'s schema is in your data folder at mcp/<server>/<tool>.json. Only the servers there are yours.',
  'A server a request or a plan names that you don\'t have (claude_design is Claude Code\'s) isn\'t yours to call: say so once and do the work another way, never guess at its tools.',
  'Comparing a screen with its design: take the design page\'s screenshot in a browser (chrome-devtools-mcp when you have it, else a headless browser from run_command), the app\'s with its own tool (xcrun simctl io <device> screenshot for a simulator), and look at both PNGs with read_file before you say they match.',
].join('\n');
