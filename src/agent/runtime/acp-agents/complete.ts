import { ToolHost } from '../../tool-host.js';
import { CompletionError, type CompletionRequest } from '../types.js';
import { type PermissionRequest, type PromptResponse, type SessionUpdate, permissionAnswer } from '../opencode/acp.js';
import { sidePrompt } from '../opencode/complete.js';
import { type AcpConnect, spawnAcp } from './connection.js';
import { acpCalls, acpInput, acpTool, belugaToolOf } from './dialect.js';
import { type AcpSession, acpModel, httpServers, stdioServers } from './parts.js';
import type { AcpAgentSpec } from './spec.js';

export interface AcpSideDeps {
  readonly connect?: AcpConnect;
  readonly bin?: string;
  readonly toolHost?: ToolHost;
}

let host: ToolHost | undefined;

/**
 * A side call on an ACP agent (agent/side-calls.ts): one prompt in a session of its own, its
 * request marked as input (sidePrompt: the agent keeps its own prompt). It may use only the tools
 * it was given, each one asked about (vetTool) when the agent asks; Beluga's suites, when given,
 * are mounted for this call alone. On the agent's own model unless one it offers was named.
 */
export async function acpComplete(spec: AcpAgentSpec, req: CompletionRequest, deps: AcpSideDeps = {}): Promise<string> {
  if (req.signal?.aborted) throw new Error('aborted');
  const mounted = req.suites
    ? await (deps.toolHost ?? (host ??= new ToolHost())).mount(req.suites, async (name, input) => {
        const verdict = req.vetTool?.(name, input);
        return verdict && !verdict.allow ? verdict.reason : undefined;
      })
    : undefined;
  const suites = Object.keys(mounted?.http ?? {});
  const conn = await (deps.connect ?? spawnAcp(spec))({ cwd: req.cwd, ...(deps.bin ? { bin: deps.bin } : {}) }).catch(() => undefined);
  if (!conn) {
    mounted?.close();
    throw new CompletionError('failed');
  }
  const stop = (): void => void conn.proc.kill();
  req.signal?.addEventListener('abort', stop, { once: true });
  let sid = '';
  let text = '';
  const calls = new Map<string, { tool: string; raw: Record<string, unknown> }>();
  try {
    if (req.signal?.aborted) throw new Error('aborted');
    const { rpc } = conn;
    rpc.onNotification((method, params) => {
      if (method !== 'session/update' || !sid || params.sessionId !== sid) return;
      const u = params.update as SessionUpdate;
      if (u.sessionUpdate === 'agent_message_chunk' && u.content.type === 'text' && u.content.text) text += u.content.text;
      if (u.sessionUpdate === 'tool_call' || u.sessionUpdate === 'tool_call_update') {
        const known = calls.get(u.toolCallId) ?? { tool: acpTool(u, suites), raw: {} };
        known.raw = { ...known.raw, ...acpInput(u) };
        calls.set(u.toolCallId, known);
      }
      // A step starts: what was said before it wasn't the answer.
      if (u.sessionUpdate === 'tool_call') text = '';
    });
    rpc.onRequest(async (method, params) => {
      if (method !== 'session/request_permission') throw new Error(`${method} isn’t supported in Beluga`);
      const p = params as unknown as PermissionRequest;
      const known = calls.get(p.toolCall.toolCallId) ?? { tool: acpTool(p.toolCall, suites), raw: {} };
      const raw = { ...known.raw, ...acpInput(p.toolCall) };
      if (belugaToolOf(known.tool, suites)) return permissionAnswer(p, true);
      for (const c of acpCalls(known.tool, raw, req.cwd, suites)) {
        if (!req.tools?.includes(c.name)) return permissionAnswer(p, false);
        const verdict = req.vetTool?.(c.name, c.input);
        if (verdict && !verdict.allow) return permissionAnswer(p, false);
      }
      return permissionAnswer(p, true);
    });
    const servers = mounted ? (conn.init.agentCapabilities?.mcpCapabilities?.http ? httpServers(mounted.http) : stdioServers(mounted.servers)) : [];
    const session = await rpc.request<AcpSession>('session/new', { cwd: req.cwd, mcpServers: servers });
    sid = session.sessionId!;
    const model = acpModel(req.model);
    const offered = session.configOptions?.find((o) => o.id === 'model' || o.category === 'model');
    if (model && offered?.options.some((o) => o.value === model) && offered.currentValue !== model) await rpc.request('session/set_config_option', { sessionId: sid, configId: offered.id, value: model }).catch(() => undefined);
    const images = conn.init.agentCapabilities?.promptCapabilities?.image ? (req.images ?? []) : [];
    const blocks = [...images.map((img) => ({ type: 'image' as const, mimeType: img.mime, data: img.data })), { type: 'text' as const, text: sidePrompt(req) }];
    const res = await Promise.race([rpc.request<PromptResponse>('session/prompt', { sessionId: sid, prompt: blocks }), rpc.closed.then(() => Promise.reject(new Error(`${spec.label} stopped`)))]);
    if (req.signal?.aborted) throw new Error('aborted');
    if (res.stopReason === 'max_turn_requests') throw new CompletionError('max_turns');
    if (res.stopReason !== 'end_turn' && res.stopReason !== 'max_tokens') throw new CompletionError('failed');
    if (!text.trim()) throw new CompletionError('no_answer');
    return text.trim();
  } catch (err) {
    if (req.signal?.aborted) throw new Error('aborted');
    throw err instanceof CompletionError ? err : new CompletionError('failed');
  } finally {
    req.signal?.removeEventListener('abort', stop);
    mounted?.close();
    await conn.proc.kill();
  }
}
