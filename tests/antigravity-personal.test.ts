import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { agyComplete } from '../src/agent/runtime/antigravity/complete.js';
import { antigravityExtension } from '../src/agent/runtime/antigravity/extension.js';
import { AGY_PERSONAL, agyLogin } from '../src/agent/runtime/antigravity/login.js';
import { createAgyBackend } from '../src/agent/runtime/antigravity/runner.js';
import { ScriptedAgy } from '../src/agent/runtime/antigravity/scripted.js';
import { CompletionError } from '../src/agent/runtime/types.js';
import type { AgentRunInput } from '../src/agent/types.js';
import { room } from './runtime-conformance.js';

/**
 * Antigravity on your personal Google account (login.ts): Google's terms let only you drive it, so
 * Beluga is only a screen for it. It takes what you sent yourself, never a run Beluga started on
 * its own, and Beluga adds no turn of its own, makes no side call on it and reads no quota. Signed in
 * with an API key, Beluga drives it as any agent (antigravity-flow.test.ts).
 */

const dir = mkdtempSync(path.join(os.tmpdir(), 'beluga-agy-login-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const personal = () => 'personal' as const;

function input(prompt: string, extra: Partial<AgentRunInput> = {}): AgentRunInput & { events: Array<[string, string]> } {
  const events: Array<[string, string]> = [];
  return { prompt, requesterName: 'kay', viaAgent: false, context: [], scope: 'folder', signal: new AbortController().signal, onEvent: (k, t) => void events.push([k, t]), onFileTouched: () => undefined, canUseTool: async () => true, events, ...extra };
}

const backend = (agy: ScriptedAgy) => createAgyBackend({ cwd: dir, autoEdit: true, additionalDirectories: [], bridge: room, connect: agy.connect, login: personal });

describe('how agy is signed in', () => {
  const settings = (name: string, body: string): string => {
    const file = path.join(dir, `${name}.json`);
    writeFileSync(file, body);
    return file;
  };

  it('reads an API key or Vertex as an API sign-in', () => {
    expect(agyLogin(settings('key', JSON.stringify({ security: { auth: { selectedType: 'gemini-api-key' } } })))).toBe('api');
    expect(agyLogin(settings('vertex', JSON.stringify({ security: { auth: { selectedType: 'vertex-ai' } } })))).toBe('api');
  });

  it('takes a Google sign-in, no settings, unreadable ones or a type it doesn’t know as personal', () => {
    expect(agyLogin(settings('google', JSON.stringify({ security: { auth: { selectedType: 'oauth-personal' } } })))).toBe('personal');
    expect(agyLogin(path.join(dir, 'none.json'))).toBe('personal');
    expect(agyLogin(settings('bad', '{ not json'))).toBe('personal');
    expect(agyLogin(settings('other', JSON.stringify({ security: { auth: { selectedType: 'something-new' } } })))).toBe('personal');
  });

  it('says so through its extension', () => {
    expect(antigravityExtension({ login: personal }).personalOnly?.()).toBe(AGY_PERSONAL);
    expect(antigravityExtension({ login: () => 'api' }).personalOnly?.()).toBeUndefined();
  });
});

describe('a run on a personal sign-in', () => {
  it('answers what you sent yourself', async () => {
    const agy = new ScriptedAgy();
    expect(await backend(agy).run(input('hello', { byYourHand: true }))).toBe('echo: hello');
  });

  it('never starts for what Beluga, a Sentinel or another agent sent, and says why', async () => {
    for (const extra of [{}, { viaAgent: true }, { sentinelRun: true }] as Array<Partial<AgentRunInput>>) {
      const agy = new ScriptedAgy();
      await expect(backend(agy).run(input('hello', extra))).rejects.toThrow(AGY_PERSONAL);
      expect(agy.sent('session/prompt')).toHaveLength(0);
    }
  });

  it('sends no turn of its own after a command it left in the background: the run ends with its turn', async () => {
    const agy = new ScriptedAgy();
    const answer = await backend(agy).run(input('background tests', { byYourHand: true }));
    expect(answer).toMatch(/background/);
    const prompts = agy.sent('session/prompt');
    expect(prompts).toHaveLength(1);
    expect(JSON.stringify(prompts)).not.toContain('The command you left running in the background has ended');
  });

  it('makes no side call on it, without even starting it', async () => {
    const agy = new ScriptedAgy();
    await expect(agyComplete({ prompt: 'ask hello', system: 'Name this worktree.', cwd: dir }, { connect: agy.connect, drop: async () => true, login: personal })).rejects.toBeInstanceOf(CompletionError);
    expect(agy.sent('initialize')).toHaveLength(0);
  });
});
