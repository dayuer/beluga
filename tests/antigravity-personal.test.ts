import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { agyComplete } from '../src/agent/runtime/antigravity/complete.js';
import { createAntigravityRuntime } from '../src/agent/runtime/antigravity/index.js';
import { AGY_API_ID, agyApiArgs, agySignInEnv, setAgyApiKeySource } from '../src/agent/runtime/antigravity/sign-in.js';
import { agyStatus } from '../src/agent/runtime/antigravity/status.js';
import { createAgyBackend } from '../src/agent/runtime/antigravity/runner.js';
import { ScriptedAgy } from '../src/agent/runtime/antigravity/scripted.js';
import type { AgentRunInput } from '../src/agent/types.js';
import { room } from './runtime-conformance.js';

/**
 * Antigravity's two sign-ins (sign-in.ts). Both take any run, yours or Beluga's own; the API-key one
 * is an agent of its own, in its own folder. Neither inherits the variables that pick a sign-in.
 */

const dir = mkdtempSync(path.join(os.tmpdir(), 'beluga-agy-sign-in-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
afterEach(() => setAgyApiKeySource(() => process.env.GEMINI_API_KEY));

function input(prompt: string, extra: Partial<AgentRunInput> = {}): AgentRunInput {
  return { prompt, requesterName: 'kay', viaAgent: false, context: [], scope: 'folder', signal: new AbortController().signal, onEvent: () => undefined, onFileTouched: () => undefined, canUseTool: async () => true, ...extra };
}

const google = (agy: ScriptedAgy) => createAgyBackend({ cwd: dir, autoEdit: true, additionalDirectories: [], bridge: room, connect: agy.connect });

describe('Antigravity on your Google account', () => {
  it('answers what you sent yourself', async () => {
    expect(await google(new ScriptedAgy()).run(input('hello', { byYourHand: true }))).toBe('echo: hello');
  });

  it('takes what Beluga, a Sentinel or another agent sends too, with no note of its own', async () => {
    for (const extra of [{}, { viaAgent: true }, { sentinelRun: true }] as Array<Partial<AgentRunInput>>) {
      const agy = new ScriptedAgy();
      expect(await google(agy).run(input('hello', extra))).toBe('echo: hello');
      expect(agy.sent('session/prompt')).toHaveLength(1);
    }
  });

  it('still names a worktree or drafts a task for you (a side call, as other ACP clients make)', async () => {
    const agy = new ScriptedAgy();
    expect(await agyComplete({ prompt: 'ask hello', system: 'Name this worktree.', cwd: dir }, { connect: agy.connect, drop: async () => true })).toBeTruthy();
  });
});

describe('what picks the sign-in', () => {
  const shell = { PATH: '/bin', GEMINI_API_KEY: 'from-shell', GOOGLE_API_KEY: 'g', GOOGLE_GENAI_USE_VERTEXAI: 'true', GOOGLE_CLOUD_PROJECT: 'p', HOME: '/h' };

  it('on your Google account: none of your shell’s keys or projects, so it uses the account', () => {
    expect(agySignInEnv('google', shell)).toEqual({ PATH: '/bin', HOME: '/h' });
  });

  it('on the API key: the key from Settings › Environment, never your shell’s', () => {
    expect(agySignInEnv('api-key', shell, 'from-settings')).toEqual({ PATH: '/bin', HOME: '/h', GEMINI_API_KEY: 'from-settings' });
    expect(agySignInEnv('api-key', shell, undefined)).toEqual({ PATH: '/bin', HOME: '/h' });
  });
});

describe('Antigravity (API key)', () => {
  it('is an agent of its own', () => {
    const rt = createAntigravityRuntime({ signIn: 'api-key' });
    expect(rt.id).toBe(AGY_API_ID);
    expect(rt.label).toBe('Antigravity (API key)');
  });

  it('with no key, says how to add one without starting agy', async () => {
    setAgyApiKeySource(() => undefined);
    const status = await agyStatus({ signIn: 'api-key' });
    expect(status.state).toBe('signed_out');
    expect(status.fix).toMatch(/GEMINI_API_KEY/);
  });

  it('runs what Beluga starts on its own too', async () => {
    const agy = new ScriptedAgy();
    const api = createAgyBackend({ cwd: dir, autoEdit: true, additionalDirectories: [], bridge: room, connect: agy.connect, signIn: 'api-key' });
    expect(await api.run(input('hello', { sentinelRun: true }))).toBe('echo: hello');
  });

  it.skipIf(process.platform === 'win32')('gets a folder of its own: yours linked in but the global rules and agy’s data, its settings on the API key', async () => {
    const real = path.join(dir, 'gemini');
    const own = path.join(dir, 'agy-api');
    mkdirSync(path.join(real, 'antigravity-cli'), { recursive: true });
    mkdirSync(path.join(real, 'skills'), { recursive: true });
    writeFileSync(path.join(real, 'GEMINI.md'), 'global rules');
    writeFileSync(path.join(real, 'antigravity-cli', 'settings.json'), JSON.stringify({ model: 'x' }));
    const args = await agyApiArgs({ real, dir: own });
    expect(args).toEqual([`--gemini-dir=${own}`]);
    expect(lstatSync(path.join(own, 'skills')).isSymbolicLink()).toBe(true);
    expect(realpathSync(path.join(own, 'skills'))).toBe(realpathSync(path.join(real, 'skills')));
    expect(existsSync(path.join(own, 'GEMINI.md'))).toBe(false);
    // Its own data, never yours: your settings stay as they were.
    expect(lstatSync(path.join(own, 'antigravity-cli')).isSymbolicLink()).toBe(false);
    expect(JSON.parse(readFileSync(path.join(own, 'antigravity-cli', 'settings.json'), 'utf8'))).toEqual({ auth: { type: 'gemini-api-key' } });
    expect(JSON.parse(readFileSync(path.join(real, 'antigravity-cli', 'settings.json'), 'utf8'))).toEqual({ model: 'x' });
    // Again: what agy added to its settings stays, the sign-in stays on the key.
    writeFileSync(path.join(own, 'antigravity-cli', 'settings.json'), JSON.stringify({ auth: { type: 'oauth-personal' }, colorScheme: 'dark' }));
    await agyApiArgs({ real, dir: own });
    expect(JSON.parse(readFileSync(path.join(own, 'antigravity-cli', 'settings.json'), 'utf8'))).toEqual({ auth: { type: 'gemini-api-key' }, colorScheme: 'dark' });
  });
});

describe('Antigravity’s tool budget (it keeps about 42 KB of a client’s tools)', () => {
  it('gets the plan’s tools first, and says which of Beluga’s it left out', async () => {
    const agy = new ScriptedAgy();
    const any: any = new Proxy(() => any, { get: (_t, k) => (k === 'then' ? undefined : any), apply: () => any });
    const progress: string[] = [];
    const run = createAgyBackend({ cwd: dir, autoEdit: true, additionalDirectories: [], bridge: room, connect: agy.connect, signIn: 'api-key' });
    await run.run(input('hello', { planTools: any, sentinelTools: any, dashboardTools: any, phoneTools: any, onEvent: (kind, text) => void (kind === 'progress' && progress.push(text)) }));
    const servers = (agy.sent('session/new')[0] as { mcpServers: Array<{ name: string }> }).mcpServers.map((m) => m.name);
    expect(servers[0]).toBe('beluga_plan');
    expect(servers).not.toContain('beluga_sentinel');
    expect(progress.join('\n')).toMatch(/left out its .*sentinel/);
  });
});
