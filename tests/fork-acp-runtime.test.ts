import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { BUILTIN_ACP_AGENTS, builtinAcpAgent } from '../src/agent/runtime/acp-agents/catalog.js';
import { findAcpCommand, spawnAcp } from '../src/agent/runtime/acp-agents/connection.js';
import { acpCalls, acpInput, acpTool, belugaToolOf } from '../src/agent/runtime/acp-agents/dialect.js';
import { createAcpRuntime } from '../src/agent/runtime/acp-agents/index.js';
import { acpFailure, acpMode, acpModel, acpModelRows, withInstructions } from '../src/agent/runtime/acp-agents/parts.js';
import { ACP_CAPABILITIES, RUNTIME_ID, acpRuntimeId, specProblem } from '../src/agent/runtime/acp-agents/spec.js';
import { acpStatus } from '../src/agent/runtime/acp-agents/status.js';
import { ScriptedCopilot } from '../src/agent/runtime/copilot/scripted.js';
import { safetyFor } from '../src/agent/runtime/types.js';
import { fallbackFor, runtimeHas } from '../src/shared/runtime-fallbacks.js';
import { runtimeChoices } from '../src/shared/agent-runtimes.js';
import { runtimeConformance } from './runtime-conformance.js';

// The generic ACP runtime (Cursor, Grok, Kiro, a Registry agent…) over a scripted ACP agent:
// Copilot's, which names its tools by ACP kind and words for people, as most ACP agents do.
const scripted = new ScriptedCopilot();
runtimeConformance('acp (generic)', () => createAcpRuntime(builtinAcpAgent('cursor')!, { connect: scripted.connect }));

describe('ACP agents Beluga knows by name', () => {
  it('has the agents T3 Code runs as its own, each a valid, unique runtime id', () => {
    const ids = BUILTIN_ACP_AGENTS.map((a) => a.id);
    for (const id of ['cursor', 'grok', 'kiro', 'muse', 'pi', 'fx']) expect(ids).toContain(id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const a of BUILTIN_ACP_AGENTS) {
      expect(a.id).toMatch(RUNTIME_ID);
      expect(specProblem(a)).toBeUndefined();
      expect(['claude', 'codex', 'opencode', 'copilot', 'antigravity', 'local']).not.toContain(a.id);
    }
  });

  it('starts each in its ACP mode, as the ACP Registry does', () => {
    expect(builtinAcpAgent('cursor')).toMatchObject({ command: 'cursor-agent', args: ['acp'] });
    expect(builtinAcpAgent('grok')).toMatchObject({ command: 'grok', args: ['agent', 'stdio'] });
    expect(builtinAcpAgent('kiro')).toMatchObject({ command: 'kiro-cli', args: ['acp', '--agent-engine=v3'] });
    expect(builtinAcpAgent('muse')).toMatchObject({ command: 'muse', args: ['acp'], env: { MUSE_EXPERIMENTAL_ACP: 'on' } });
  });

  it('makes a runtime id for a Registry agent or a command of yours that the room protocol takes', () => {
    expect(acpRuntimeId('gemini')).toBe('acp-gemini');
    expect(acpRuntimeId('My Agent!')).toBe('acp-my-agent');
    expect(acpRuntimeId('x'.repeat(60))).toMatch(RUNTIME_ID);
    expect(acpRuntimeId('x'.repeat(60)).length).toBeLessThanOrEqual(32);
  });
});

describe('what an ACP agent may do', () => {
  it("can't gate every step, so takes no friends' tasks or guests", () => {
    expect(safetyFor(ACP_CAPABILITIES, { vetTool: () => ({ allow: true }) } as never)).toMatchObject({ kind: 'sandbox', refuse: expect.stringContaining('friends') });
    expect(safetyFor(ACP_CAPABILITIES, { guest: true } as never)).toMatchObject({ kind: 'sandbox', refuse: expect.stringContaining('guests') });
  });

  it('says why where it does differently, for any runtime that is an ACP agent', () => {
    for (const id of ['cursor', 'acp-gemini']) {
      expect(fallbackFor(id, 'fork')).toMatch(/new conversation/);
      expect(fallbackFor(id, 'guests')).toMatch(/guests/);
      expect(runtimeHas(id, 'btw')).toBe(false);
      expect(runtimeHas(id, 'steer')).toBe(false);
    }
    // Claude, Codex and the others keep their own.
    expect(fallbackFor('claude', 'fork')).toBeUndefined();
    expect(runtimeHas('claude', 'btw')).toBe(true);
    expect(fallbackFor('codex', 'compact')).toMatch(/Codex/);
  });

  it('lists ACP agents in the pickers after the known ones', () => {
    const choices = runtimeChoices((id) => (id === 'claude' || id === 'cursor' ? {} : undefined), [{ id: 'cursor', label: 'Cursor' }, { id: 'claude', label: 'Dup' }]);
    expect(choices.map((c) => c.id).slice(-2)).toEqual(['local', 'cursor']);
    expect(choices.find((c) => c.id === 'cursor')).toMatchObject({ available: true, label: 'Cursor' });
    expect(choices.filter((c) => c.id === 'claude')).toHaveLength(1);
  });
});

describe('any ACP agent’s tools, as Beluga judges them', () => {
  const cwd = path.join(os.tmpdir(), 'proj');
  const suites = ['beluga', 'beluga_board'];

  it('knows Beluga’s own tools in every way agents name them, the longest suite first', () => {
    for (const name of ['beluga_board-task_get', 'beluga_board_task_get', 'mcp_beluga_board_task_get', 'mcp__beluga_board__task_get', 'beluga_board/task_get']) expect(belugaToolOf(name, suites)).toBe('mcp__beluga_board__task_get');
    expect(belugaToolOf('github_create_issue', suites)).toBeUndefined();
  });

  it('reads a call by its ACP kind, its input in any case, and its locations', () => {
    expect(acpTool({ kind: 'read', title: 'Reading a file' }, suites)).toBe('read');
    expect(acpTool({ kind: 'read', title: 'beluga-list_peers' }, suites)).toBe('beluga-list_peers');
    expect(acpTool({ kind: 'other', name: 'run_command' }, suites)).toBe('run_command');
    expect(acpCalls('read', acpInput({ rawInput: { Path: 'a.ts' } }), cwd)).toEqual([{ name: 'Read', input: { file_path: path.join(cwd, 'a.ts') } }]);
    expect(acpCalls('read', acpInput({ rawInput: {}, locations: [{ path: path.join(cwd, 'b.ts') }, { path: path.join(cwd, 'c.ts') }] }), cwd).map((c) => c.input.file_path)).toEqual([path.join(cwd, 'b.ts'), path.join(cwd, 'c.ts')]);
    expect(acpCalls('execute', { CommandLine: 'ls -la' }, cwd)).toEqual([{ name: 'Bash', input: { command: 'ls -la' } }]);
    expect(acpCalls('execute', { cmd: ['git', 'status'] }, cwd)).toEqual([{ name: 'Bash', input: { command: 'git status' } }]);
    expect(acpCalls('edit', { file_path: 'x.ts', old_string: 'a', new_string: 'b' }, cwd)).toEqual([{ name: 'Edit', input: { file_path: path.join(cwd, 'x.ts') } }]);
    expect(acpCalls('edit', { path: 'new.ts', content: 'hello' }, cwd)[0]!.name).toBe('Write');
    expect(acpCalls('delete', { path: 'old.ts' }, cwd)[0]).toEqual({ name: 'Write', input: { file_path: path.join(cwd, 'old.ts') } });
    expect(acpCalls('fetch', { url: 'https://x.dev' }, cwd)).toEqual([{ name: 'WebFetch', input: { url: 'https://x.dev' } }]);
    expect(acpCalls('think', {}, cwd)).toEqual([]);
    expect(acpCalls('mcp_beluga_board_task_get', { key: 'K-1' }, cwd, suites)).toEqual([{ name: 'mcp__beluga_board__task_get', input: { key: 'K-1' } }]);
    expect(acpCalls('github_issue', { a: 1 }, cwd, suites)[0]!.name).toBe('mcp__acp__github_issue');
  });

  it('turns a patch into one step per file it touches', () => {
    const patch = '*** Begin Patch\n*** Add File: a.ts\n+x\n*** Update File: b.ts\n@@\n*** End Patch';
    expect(acpCalls('edit', acpInput({ rawInput: patch as unknown as Record<string, unknown> }), cwd)).toEqual([
      { name: 'Write', input: { file_path: path.join(cwd, 'a.ts') } },
      { name: 'Edit', input: { file_path: path.join(cwd, 'b.ts') } },
    ]);
  });
});

describe('an ACP session’s models and modes, in either shape', () => {
  it('reads configOptions, with the current model’s thinking levels, its own choice first', () => {
    const rows = acpModelRows({ configOptions: [{ id: 'model', currentValue: 'm1', options: [{ value: 'm1', name: 'M1' }, { value: 'm2', name: 'M2' }] }, { id: 'thought_level', currentValue: 'low', options: [{ value: 'low', name: 'Low' }, { value: 'high', name: 'High' }] }] });
    expect(rows.map((r) => r.value)).toEqual(['', 'm1', 'm2']);
    expect(rows[1]!.efforts).toEqual(['low', 'high']);
  });

  it('reads the older models and modes', () => {
    const s = { models: { availableModels: [{ modelId: 'gemini-3-pro', name: 'Gemini 3 Pro' }], currentModelId: 'gemini-3-pro' }, modes: { availableModes: [{ id: 'default', name: 'Default' }, { id: 'plan', name: 'Plan' }], currentModeId: 'default' } };
    expect(acpModelRows(s).map((r) => r.label)).toEqual(['Default', 'Gemini 3 Pro']);
    expect(acpMode(s, 'plan')).toEqual({ via: 'modes', value: 'plan' });
    expect(acpMode(s, 'work')).toEqual({ via: 'modes', value: 'default' });
    expect(acpMode({ configOptions: [{ id: 'mode', currentValue: 'x#agent', options: [{ value: 'x#agent', name: 'Agent' }, { value: 'x#plan', name: 'Plan' }] }] }, 'plan')).toEqual({ via: 'config', value: 'x#plan' });
    expect(acpMode({}, 'plan')).toBeUndefined();
  });

  it('runs on its own model for Claude’s aliases', () => {
    expect(acpModel('opus')).toBeUndefined();
    expect(acpModel('sonnet[1m]')).toBeUndefined();
    expect(acpModel('gpt-5')).toBe('gpt-5');
    expect(acpModel('openai/gpt-5')).toBe('openai/gpt-5');
  });

  it('puts Beluga’s instructions ahead of the first message, and says a failure as the agent’s', () => {
    expect(withInstructions('Be brief.', 'hello')).toMatch(/^<beluga-instructions>\nBe brief\.\n<\/beluga-instructions>\n\nhello$/);
    expect(withInstructions('', 'hello')).toBe('hello');
    expect(acpFailure({ error: '429 Too Many Requests' }, 'cursor').message).toMatch(/usage_limit/);
    expect(acpFailure({ error: 'Authentication required' }, 'cursor').message).toMatch(/signed_out/);
  });
});

describe('finding and starting an ACP agent', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'beluga-acp-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('finds it by its variable, a full path, PATH, or its installer’s folders', () => {
    const p = path.posix;
    const runs = (f: string): boolean => ['/opt/x/agent', '/home/u/.local/bin/cursor-agent', '/usr/bin/grok'].includes(f);
    const env = { PATH: '/usr/bin' };
    expect(findAcpCommand({ command: 'cursor-agent', searchDirs: ['~/.local/bin'] }, env, 'linux', runs, '/home/u')).toBe(p.join('/home/u/.local/bin', 'cursor-agent'));
    expect(findAcpCommand({ command: 'grok' }, env, 'linux', runs, '/home/u')).toBe('/usr/bin/grok');
    expect(findAcpCommand({ command: '/opt/x/agent' }, env, 'linux', runs, '/home/u')).toBe('/opt/x/agent');
    expect(findAcpCommand({ command: 'grok', pathVar: 'G' }, { ...env, G: '/opt/x/agent' }, 'linux', runs, '/home/u')).toBe('/opt/x/agent');
    expect(findAcpCommand({ command: 'kiro-cli' }, env, 'linux', runs, '/home/u')).toBeUndefined();
  });

  it('says how to install one that isn’t here', async () => {
    const status = await acpStatus({ ...builtinAcpAgent('kiro')!, command: path.join(dir, 'nope'), pathVar: 'BELUGA_NO_SUCH_AGENT' });
    expect(status).toMatchObject({ state: 'missing', fix: expect.stringContaining('kiro.dev') });
  });

  // A real process speaking ACP over stdio: node standing in for the agent (Windows runs node, not a script by name).
  it('spawns it with its ACP arguments and variables, shakes hands, and opens a session', async () => {
    const agent = path.join(dir, 'agent.cjs');
    writeFileSync(
      agent,
      `const rl = require('readline').createInterface({ input: process.stdin });
const send = (m) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\\n');
rl.on('line', (line) => {
  const m = JSON.parse(line);
  if (m.method === 'initialize') send({ id: m.id, result: { protocolVersion: 1, agentInfo: { name: 'node', version: process.argv[2] + ':' + process.env.ACP_TEST_VAR }, agentCapabilities: { loadSession: false } } });
  else if (m.method === 'session/new') send({ id: m.id, result: { sessionId: 's1', models: { availableModels: [{ modelId: 'tiny', name: 'Tiny' }], currentModelId: 'tiny' } } });
  else if (m.id !== undefined) send({ id: m.id, error: { code: -32601, message: 'no' } });
});`,
    );
    const spec = { id: 'acp-node', label: 'Node agent', command: process.execPath, args: [agent, 'acp-mode'], env: { ACP_TEST_VAR: 'on' }, source: 'local' as const };
    const conn = await spawnAcp(spec)({ cwd: dir });
    try {
      expect(conn.init.agentInfo?.version).toBe('acp-mode:on');
    } finally {
      await conn.proc.kill();
    }
    const status = await acpStatus(spec);
    expect(status).toMatchObject({ state: 'ready' });
    expect(status.models.map((m) => m.value)).toEqual(['', 'tiny']);
  });
});
