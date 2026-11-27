import type { OwnerMcpEntry } from '../claude/owner-mcp.js';
import type { AcpHttpMcpServer, AcpMcpServer } from '../opencode/acp.js';

/** One MCP server over SSE, as ACP's session/new takes it (the same fields as over HTTP). */
export interface AcpSseMcpServer extends Omit<AcpHttpMcpServer, 'type'> {
  readonly type: 'sse';
}

export type AcpOwnerServer = AcpMcpServer | AcpHttpMcpServer | AcpSseMcpServer;

/** A server's name as an ACP agent takes it into its tool names (`mcp_<server>_<tool>`): letters, digits, `_` and `-`. */
export const acpServerName = (name: string): string => name.replace(/[^A-Za-z0-9_-]+/g, '_');

const pairs = (record: unknown): Array<{ name: string; value: string }> =>
  record && typeof record === 'object' ? Object.entries(record as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === 'string').map(([name, value]) => ({ name, value })) : [];

/**
 * Your own MCP servers (the ones your Claude Code has, owner-mcp.ts) as an ACP agent's session takes
 * them, so an agent in your own runs has the servers your Claude has. Left out: one named like a
 * server the run has already (`taken`: Beluga's own suites, the agent's own config), and one over
 * HTTP with no headers to send: it signs in with OAuth through Claude Code (claude_design), which
 * the agent can't.
 */
export function ownerAcpServers(entries: readonly OwnerMcpEntry[], taken: ReadonlySet<string>): AcpOwnerServer[] {
  const out: AcpOwnerServer[] = [];
  const named = new Set([...taken].map(acpServerName));
  for (const { name: raw, config } of entries) {
    const name = acpServerName(raw);
    if (!name || named.has(name)) continue;
    const c = config as { type?: string; command?: unknown; args?: unknown; env?: unknown; url?: unknown; headers?: unknown };
    const type = c.type ?? (typeof c.command === 'string' ? 'stdio' : undefined);
    if (type === 'stdio' && typeof c.command === 'string') {
      out.push({ name, command: c.command, args: Array.isArray(c.args) ? c.args.filter((a): a is string => typeof a === 'string') : [], env: pairs(c.env) });
    } else if ((type === 'http' || type === 'sse') && typeof c.url === 'string') {
      const headers = pairs(c.headers);
      if (!headers.length) continue;
      out.push({ type, name, url: c.url, headers });
    } else continue;
    named.add(name);
  }
  return out;
}
