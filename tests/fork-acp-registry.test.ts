import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AcpAgents } from '../src/agent/runtime/acp/agents.js';
import { AcpRegistry, OWN_RUNTIME_AGENTS, installKind, parseRegistry, registryPlatform, registryRuntimeId, searchRegistry } from '../src/agent/runtime/acp/registry.js';

/** A Registry like the real one (cdn.agentclientprotocol.com/registry/v1/latest/registry.json), in its shapes. */
const registry = (archive: { url: string; sha256?: string }, platform: string) => ({
  version: '1.0.0',
  agents: [
    { id: 'cursor', name: 'Cursor', version: '2026.11.22', description: 'Cursor’s coding agent', distribution: { binary: { [platform]: { archive: archive.url, cmd: './dist-package/cursor-agent', args: ['acp'], ...(archive.sha256 ? { sha256: archive.sha256 } : {}) } } } },
    { id: 'gemini', name: 'Gemini CLI', version: '0.70.0', description: 'Google’s agent', distribution: { npx: { package: '@google/gemini-cli@0.70.0', args: ['--acp'] } } },
    { id: 'fast-agent', name: 'fast-agent', version: '0.10.65', distribution: { uvx: { package: 'fast-agent-acp==0.10.65', args: ['-x'], env: { FAST_AGENT_MODEL: 'codexplan' } } } },
    { id: 'muse-code', name: 'Muse Code', version: '1.4.24', distribution: { binary: { [platform]: { archive: 'https://downloads.test/muse?file=muse-mac', cmd: './muse', args: ['acp'], env: { MUSE_EXPERIMENTAL_ACP: 'on' } } } } },
    { id: 'elsewhere', name: 'Elsewhere', version: '1.0.0', distribution: { binary: { 'plan9-mips': { archive: 'https://x.test/a.tar.gz', cmd: './a' } } } },
    { id: 'claude-acp', name: 'Claude Agent', version: '0.1.0', distribution: { npx: { package: '@agentclientprotocol/claude-agent-acp@0.1.0' } } },
    { id: 'BAD ID', name: 'broken', version: '1', distribution: {} },
    { id: 'future', name: 'Future', version: '2.0.0', distribution: { binary: { [platform]: { archive: 'http://insecure.test/a.tar.gz', cmd: './a' } } }, newField: { anything: true } },
  ],
});

describe('the ACP Registry, read', () => {
  const platform = 'darwin-aarch64';
  const agents = parseRegistry(registry({ url: 'https://downloads.test/cursor.tar.gz' }, platform));

  it('keeps the agents that parse and leaves out the rest (a newer Registry’s fields don’t break it)', () => {
    expect(agents.map((a) => a.id)).toEqual(['cursor', 'gemini', 'fast-agent', 'muse-code', 'elsewhere', 'claude-acp', 'future']);
  });

  it('names this computer as the Registry does', () => {
    expect(registryPlatform('darwin', 'arm64')).toBe('darwin-aarch64');
    expect(registryPlatform('linux', 'x64')).toBe('linux-x86_64');
    expect(registryPlatform('win32', 'x64')).toBe('windows-x86_64');
    expect(registryPlatform('aix', 'ppc64')).toBeUndefined();
  });

  it('installs a binary for this platform first, else npx, else uvx', () => {
    const by = (id: string) => agents.find((a) => a.id === id)!;
    expect(installKind(by('cursor'), platform)).toBe('binary');
    expect(installKind(by('gemini'), platform)).toBe('npx');
    expect(installKind(by('fast-agent'), platform)).toBe('uvx');
    expect(installKind(by('elsewhere'), platform)).toBeUndefined();
  });

  it('searches by every word, runnable ones first, without the agents Beluga runs itself', () => {
    expect(searchRegistry(agents, 'google', new Map(), 50, platform).map((h) => h.id)).toEqual(['gemini']);
    const all = searchRegistry(agents, '', new Map([['gemini', '0.70.0']]), 50, platform);
    expect(all.map((h) => h.id)).not.toContain('claude-acp');
    expect(all.at(-1)!.id).toBe('elsewhere');
    expect(all.find((h) => h.id === 'gemini')).toMatchObject({ installed: '0.70.0', kind: 'npx', runtime: 'gemini' });
    expect(OWN_RUNTIME_AGENTS['github-copilot-cli']).toBe('copilot');
  });

  it('keeps a built-in agent’s id for its Registry entry', () => {
    expect(registryRuntimeId('cursor')).toBe('cursor');
    expect(registryRuntimeId('qwen-code')).toBe('qwen');
    expect(registryRuntimeId('stakpak')).toBe('acp-stakpak');
  });
});

describe('installing from the ACP Registry', () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'beluga-acp-reg-'));
  const tools = path.join(home, 'tools');
  const platform = registryPlatform() ?? 'darwin-aarch64';
  let archive: Buffer;
  let sha: string;
  const agents = new AcpAgents({ file: path.join(home, 'acp-agents.json'), installed: () => false });

  beforeAll(() => {
    // A Cursor-like archive: its command in a folder, as cursor's agent-cli-package.tar.gz has it.
    const src = path.join(home, 'src');
    mkdirSync(path.join(src, 'dist-package'), { recursive: true });
    writeFileSync(path.join(src, 'dist-package', 'cursor-agent'), '#!/usr/bin/env node\n');
    execFileSync('tar', ['-czf', path.join(home, 'a.tar.gz'), '-C', src, 'dist-package']);
    archive = readFileSync(path.join(home, 'a.tar.gz'));
    sha = createHash('sha256').update(archive).digest('hex');
  });
  afterAll(() => rmSync(home, { recursive: true, force: true }));

  const fakeFetch = (reg: object, files: Record<string, Buffer>): typeof fetch =>
    (async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith('registry.json')) return new Response(JSON.stringify(reg), { status: 200 });
      const body = files[url];
      return body ? new Response(new Uint8Array(body), { status: 200 }) : new Response('no', { status: 404 });
    }) as typeof fetch;

  it('downloads a binary, checks its SHA-256, unpacks it into its own folder and adds the agent', async () => {
    const reg = new AcpRegistry(agents, { fetch: fakeFetch(registry({ url: 'https://downloads.test/cursor.tar.gz', sha256: sha }, platform), { 'https://downloads.test/cursor.tar.gz': archive }), toolsDir: tools, platform, url: 'https://reg.test/registry.json' });
    const done = await reg.install('cursor');
    expect(done).toEqual({ ok: true, runtime: 'cursor', version: '2026.11.22' });
    const added = agents.added().find((a) => a.id === 'cursor')!;
    expect(added).toMatchObject({ source: 'registry', registryId: 'cursor', version: '2026.11.22', args: ['acp'] });
    expect(realpathSync(added.command)).toBe(realpathSync(path.join(tools, 'cursor', '2026.11.22', 'dist-package', 'cursor-agent')));
    if (process.platform !== 'win32') expect(statSync(added.command).mode & 0o111).not.toBe(0);
    expect(await reg.search('cursor')).toMatchObject([{ id: 'cursor', installed: '2026.11.22' }]);
  });

  it('refuses a download whose checksum doesn’t match, and adds nothing', async () => {
    const other = new AcpAgents({ file: path.join(home, 'other.json'), installed: () => false });
    const reg = new AcpRegistry(other, { fetch: fakeFetch(registry({ url: 'https://downloads.test/cursor2.tar.gz', sha256: '0'.repeat(64) }, platform), { 'https://downloads.test/cursor2.tar.gz': archive }), toolsDir: path.join(home, 'tools2'), platform, url: 'https://reg.test/registry.json' });
    const done = await reg.install('cursor');
    expect(done).toMatchObject({ ok: false, error: expect.stringContaining('checksum') });
    expect(other.added()).toEqual([]);
    expect(existsSync(path.join(home, 'tools2', 'cursor', '2026.11.22'))).toBe(false);
  });

  it('refuses a download not over HTTPS, and agents Beluga runs itself', async () => {
    const reg = new AcpRegistry(agents, { fetch: fakeFetch(registry({ url: 'https://downloads.test/c.tar.gz' }, platform), {}), toolsDir: tools, platform, url: 'https://reg.test/registry.json' });
    expect(await reg.install('future')).toMatchObject({ ok: false, error: expect.stringContaining('HTTPS') });
    expect(await reg.install('claude-acp')).toMatchObject({ ok: false, error: expect.stringContaining('own runtime') });
    expect(await reg.install('elsewhere')).toMatchObject({ ok: false, error: expect.stringContaining('doesn’t run on this computer') });
    expect(await reg.install('nope')).toMatchObject({ ok: false });
  });

  it('takes a bare executable as the command itself', async () => {
    const bin = Buffer.from('#!/usr/bin/env node\n');
    const reg = new AcpRegistry(agents, { fetch: fakeFetch(registry({ url: 'https://downloads.test/c.tar.gz' }, platform), { 'https://downloads.test/muse?file=muse-mac': bin }), toolsDir: tools, platform, url: 'https://reg.test/registry.json' });
    expect(await reg.install('muse-code')).toMatchObject({ ok: true, runtime: 'muse' });
    const muse = agents.added().find((a) => a.id === 'muse')!;
    expect(muse.env).toEqual({ MUSE_EXPERIMENTAL_ACP: 'on' });
    expect(readFileSync(muse.command, 'utf8')).toBe(bin.toString());
  });

  it('runs a package at its exact version through npx or uvx', async () => {
    const reg = new AcpRegistry(agents, { fetch: fakeFetch(registry({ url: 'https://downloads.test/c.tar.gz' }, platform), {}), toolsDir: tools, platform, url: 'https://reg.test/registry.json' });
    expect(await reg.install('gemini')).toMatchObject({ ok: true, runtime: 'gemini' });
    expect(agents.added().find((a) => a.id === 'gemini')).toMatchObject({ command: 'npx', args: ['-y', '@google/gemini-cli@0.70.0', '--acp'] });
    expect(await reg.install('fast-agent')).toMatchObject({ ok: true, runtime: 'acp-fast-agent' });
    expect(agents.added().find((a) => a.id === 'acp-fast-agent')).toMatchObject({ command: 'uvx', args: ['fast-agent-acp==0.10.65', '-x'], env: { FAST_AGENT_MODEL: 'codexplan' } });
  });

  it('uninstalls one: its entry and the files Beluga downloaded', async () => {
    const reg = new AcpRegistry(agents, { fetch: fakeFetch(registry({ url: 'https://downloads.test/c.tar.gz' }, platform), {}), toolsDir: tools, platform, url: 'https://reg.test/registry.json' });
    expect(await reg.uninstall('cursor')).toBe(true);
    expect(existsSync(path.join(tools, 'cursor'))).toBe(false);
    expect(agents.added().some((a) => a.id === 'cursor')).toBe(false);
    expect(await reg.uninstall('cursor')).toBe(false);
  });
});

describe('your ACP agents', () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'beluga-acp-agents-'));
  afterAll(() => rmSync(home, { recursive: true, force: true }));
  let now = 0;
  const here = new Set(['grok']);
  const agents = new AcpAgents({ file: path.join(home, 'acp-agents.json'), installed: (s) => here.has(s.id), now: () => now });

  it('offers the built-in ones whose CLI is here, and the ones you added', () => {
    expect(agents.list().map((a) => a.id)).toEqual(['grok']);
    expect(agents.addLocal({ label: 'DeepSeek Harness', command: 'dsh', args: ['--profile', 'acp'] })).toEqual({ ok: true, id: 'acp-deepseek-harness' });
    expect(agents.list().map((a) => a.id)).toEqual(['acp-deepseek-harness', 'grok']);
    expect(agents.get('acp-deepseek-harness')).toMatchObject({ source: 'local', command: 'dsh', args: ['--profile', 'acp'] });
  });

  it('refuses an id another runtime owns, and a bad command', () => {
    expect(agents.add({ id: 'claude', label: 'Fake', command: 'x', args: [], source: 'local' })).toMatchObject({ ok: false });
    expect(agents.addLocal({ label: 'Bad', command: 'x\ny' })).toMatchObject({ ok: false });
    expect(agents.addLocal({ label: ' ', command: 'x' })).toMatchObject({ ok: false });
  });

  it('turns a built-in one off and back on; removes one you added', () => {
    expect(agents.remove('grok')).toBe(true);
    expect(agents.list().map((a) => a.id)).toEqual(['acp-deepseek-harness']);
    agents.restore('grok');
    expect(agents.list().map((a) => a.id)).toContain('grok');
    expect(agents.remove('acp-deepseek-harness')).toBe(true);
    expect(agents.remove('acp-nothing')).toBe(false);
  });

  it('finds a CLI just installed after a while, or at once when told', () => {
    agents.list();
    here.add('cursor');
    expect(agents.list().map((a) => a.id)).not.toContain('cursor');
    now += 31_000;
    expect(agents.list().map((a) => a.id)).toContain('cursor');
    here.add('kiro');
    agents.refresh();
    expect(agents.list().map((a) => a.id)).toContain('kiro');
  });

  it('reads a broken file as empty, and writes it for you alone', () => {
    writeFileSync(path.join(home, 'acp-agents.json'), '{nope');
    agents.refresh();
    expect(agents.added()).toEqual([]);
    agents.addLocal({ label: 'Mine', command: 'mine' });
    if (process.platform !== 'win32') expect(statSync(path.join(home, 'acp-agents.json')).mode & 0o777).toBe(0o600);
  });
});
