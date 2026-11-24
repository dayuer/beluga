import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ownerAcpServers } from '../src/agent/runtime/acp/owner-servers.js';
import { AGY_MCP_NOTE, agyMcpReady, agyOwnMcpNames } from '../src/agent/runtime/antigravity/mcp.js';
import { createAgyBackend } from '../src/agent/runtime/antigravity/runner.js';
import { ScriptedAgy } from '../src/agent/runtime/antigravity/scripted.js';
import { agyCalls } from '../src/agent/runtime/antigravity/tools.js';
import type { OwnerMcpEntry } from '../src/agent/runtime/claude/owner-mcp.js';
import type { AgentRunInput } from '../src/agent/types.js';
import { room } from './runtime-conformance.js';

/**
 * Antigravity and MCP: your Claude Code's servers go to your own runs too, its first turn waits
 * until its servers have connected (a turn that starts before has none of them), its call_mcp_tool
 * is judged as the tool it calls, and it's told how to compare a screen with its design.
 */

const cwd = mkdtempSync(path.join(os.tmpdir(), 'beluga-agy-mcp-'));

const entry = (name: string, config: Record<string, unknown>): OwnerMcpEntry => ({ name, config: config as OwnerMcpEntry['config'], from: 'user' });

describe('your own MCP servers as an ACP session takes them', () => {
  it('sends commands with their variables, and HTTP servers with their headers', () => {
    const out = ownerAcpServers(
      [entry('figma', { type: 'stdio', command: 'npx', args: ['-y', 'figma-mcp'], env: { KEY: 'k' } }), entry('reader', { type: 'http', url: 'https://r.example/mcp', headers: { Authorization: 'Bearer t' } }), entry('feed', { type: 'sse', url: 'https://f.example/sse', headers: { 'X-Key': 'x' } })],
      new Set(),
    );
    expect(out).toEqual([
      { name: 'figma', command: 'npx', args: ['-y', 'figma-mcp'], env: [{ name: 'KEY', value: 'k' }] },
      { type: 'http', name: 'reader', url: 'https://r.example/mcp', headers: [{ name: 'Authorization', value: 'Bearer t' }] },
      { type: 'sse', name: 'feed', url: 'https://f.example/sse', headers: [{ name: 'X-Key', value: 'x' }] },
    ]);
  });

  it('leaves out one that signs in through Claude Code, and one named like a server the run has', () => {
    const out = ownerAcpServers(
      [entry('claude_design', { type: 'http', url: 'https://api.example/design/mcp' }), entry('beluga', { type: 'http', url: 'http://127.0.0.1:7778/mcp', headers: { A: 'b' } }), entry('chrome-devtools-mcp', { command: 'npx', args: [] }), entry('context7', { command: 'npx' })],
      new Set(['beluga', 'beluga_board', 'chrome-devtools-mcp']),
    );
    expect(out.map((s) => s.name)).toEqual(['context7']);
  });

  it('names a plugin’s server the way an agent takes it into its tool names, once', () => {
    const out = ownerAcpServers([entry('plugin:design:figma', { command: 'a' }), entry('plugin:design/figma', { command: 'b' })], new Set());
    expect(out).toEqual([{ name: 'plugin_design_figma', command: 'a', args: [], env: [] }]);
  });
});

describe('Antigravity’s MCP servers connecting', () => {
  it('reads the servers on in its own config', () => {
    const file = path.join(cwd, 'mcp_config.json');
    writeFileSync(file, JSON.stringify({ mcpServers: { context7: { command: 'npx' }, off: { command: 'x', disabled: true }, 'chrome-devtools-mcp': { command: 'npx' } } }));
    expect(agyOwnMcpNames(file)).toEqual(['context7', 'chrome-devtools-mcp']);
    expect(agyOwnMcpNames(path.join(cwd, 'none.json'))).toEqual([]);
  });

  it('waits until each server has written its tools since the start, and gives up on one after the cap, for good', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'beluga-agy-mcp-dir-'));
    const since = 1_700_000_000_000;
    const write = (name: string, at: number): void => {
      mkdirSync(path.join(dir, name), { recursive: true });
      const file = path.join(dir, name, 'tool.json');
      writeFileSync(file, '{}');
      utimesSync(file, at / 1000, at / 1000);
      utimesSync(path.join(dir, name), at / 1000, at / 1000);
    };
    write('beluga_board', since + 1_000);
    write('stale', since - 60_000);
    let t = 0;
    const sleeps: number[] = [];
    const missing = new Set<string>();
    // context7 connects while it waits; `stale` (written before the start) never does.
    const deps = { dir, own: ['context7'], capMs: 5_000, now: () => t, missing, sleep: async (ms: number) => {
      sleeps.push(ms);
      t += ms;
      if (sleeps.length === 3) write('context7', since + 2_000);
    } };
    const first = await agyMcpReady(['beluga_board', 'stale'], since, deps);
    expect(first.ready.sort()).toEqual(['beluga_board', 'context7']);
    expect(first.late).toEqual(['stale']);
    expect(missing.has('stale')).toBe(true);
    // Next time `stale` isn't waited for: everything else is there, so no wait at all.
    sleeps.length = 0;
    const second = await agyMcpReady(['beluga_board', 'stale'], since, deps);
    expect(second).toEqual({ ready: ['beluga_board', 'context7'], late: [] });
    expect(sleeps).toEqual([]);
  });
});

describe('Antigravity’s call_mcp_tool, judged as the tool it calls', () => {
  it('names a server of yours and its tool, with the tool’s own arguments', () => {
    expect(agyCalls('call_mcp_tool', { ServerName: 'chrome-devtools-mcp', ToolName: 'take_screenshot', Arguments: { fullPage: true } }, cwd)).toEqual([
      { name: 'mcp__chrome-devtools-mcp__take_screenshot', input: { fullPage: true } },
    ]);
  });

  it('names one of Beluga’s own by its Beluga name', () => {
    expect(agyCalls('call_mcp_tool', { ServerName: 'beluga_board', ToolName: 'task_get', Arguments: { key: 'SHP-1' } }, cwd, ['beluga', 'beluga_board'], new Set(['mcp__beluga_board__task_get']))).toEqual([
      { name: 'mcp__beluga_board__task_get', input: { key: 'SHP-1' } },
    ]);
  });
});

describe('a run on Antigravity, with MCP', () => {
  const input = (extra: Partial<AgentRunInput> = {}): AgentRunInput => ({ prompt: 'hello', requesterName: 'kay', viaAgent: false, context: [], scope: 'folder', signal: new AbortController().signal, onEvent: () => undefined, onFileTouched: () => undefined, canUseTool: async () => true, ...extra });
  const yours = (): OwnerMcpEntry[] => [entry('figma', { command: 'npx', args: ['figma-mcp'] }), entry('claude_design', { type: 'http', url: 'https://api.example/design/mcp' })];

  it('sends your own servers in your own runs, waits for them before the first turn, and says how to use MCP', async () => {
    const agy = new ScriptedAgy();
    const waited: Array<{ names: readonly string[]; promptsBefore: number }> = [];
    const backend = createAgyBackend({ cwd, autoEdit: true, additionalDirectories: [], bridge: room, connect: agy.connect, ownerServers: yours, mcpReady: async (names) => void waited.push({ names, promptsBefore: agy.sent('session/prompt').length }) });
    expect(await backend.run(input({ ownerMcp: true }))).toBe('echo: hello');
    const sent = agy.sent('session/new')[0]!.mcpServers as Array<{ name: string }>;
    expect(sent.map((s) => s.name)).toContain('figma');
    expect(sent.map((s) => s.name)).not.toContain('claude_design');
    expect(waited).toHaveLength(1);
    expect(waited[0]!.promptsBefore).toBe(0);
    expect(waited[0]!.names).toEqual(expect.arrayContaining(['figma', 'beluga']));
    expect([...agy.appended.values()][0]).toContain(AGY_MCP_NOTE);
  });

  it('sends none of yours in a run that isn’t yours, or a guest’s', async () => {
    for (const extra of [{}, { ownerMcp: true, guest: true }] as Array<Partial<AgentRunInput>>) {
      const agy = new ScriptedAgy();
      const backend = createAgyBackend({ cwd, autoEdit: true, additionalDirectories: [], bridge: room, connect: agy.connect, ownerServers: yours, mcpReady: async () => undefined });
      await backend.run(input(extra)).catch(() => undefined);
      const sent = (agy.sent('session/new')[0]?.mcpServers ?? []) as Array<{ name: string }>;
      expect(sent.map((s) => s.name)).not.toContain('figma');
    }
  });
});
