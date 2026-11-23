import { type ChildProcess, spawn } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { RunProcess } from '../../types.js';
import { endProcess, keepLines, niceForWorktree } from '../claude/claude-process.js';
import { codexCommand, pathVar } from '../codex/app-server.js';
import { CodexRpc } from '../codex/rpc.js';
import type { InitializeResponse } from '../opencode/acp.js';
import { acpHandshake } from '../opencode/connection.js';
import { type FolderReader, nodeGlobalBinDirs } from '../version-managers.js';
import { THIS_COMPUTER } from '../../../shared/assistant.js';
import type { AcpAgentSpec } from './spec.js';

/** One ACP agent's process for one run (or one side call): its JSON-RPC, its process, what it said it can do. */
export interface AcpConnection {
  readonly rpc: CodexRpc;
  readonly proc: RunProcess;
  readonly init: InitializeResponse & { readonly agentCapabilities?: { readonly mcpCapabilities?: { readonly http?: boolean; readonly sse?: boolean } } };
  /** Its last stderr lines, for a failure's details. */
  readonly stderr: () => readonly string[];
}

export interface AcpConnectOptions {
  readonly cwd: string;
  /** Its whole environment (the run's env over Beluga's). */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** The executable; unset: findAcpCommand(spec). */
  readonly bin?: string;
  /** Flags after the spec's own (none today: a model is picked through the session). */
  readonly args?: readonly string[];
}

/** How a run reaches an ACP agent: spawn it (tests hand a scripted one instead). */
export type AcpConnect = (opts: AcpConnectOptions) => Promise<AcpConnection>;

const STDERR_KEEP = 40;

const executable = (file: string): boolean => {
  try {
    accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

/** `~/x` as a folder under `home`. */
const homeDir = (dir: string, home: string, p: typeof path.posix): string => (dir === '~' ? home : dir.startsWith('~/') ? p.join(home, dir.slice(2)) : dir);

/**
 * Where an ACP agent's executable is: its variable (BELUGA_CURSOR_PATH) when set; a full path as
 * it is; else the name on PATH, then its installer's folders, Homebrew's and npm's global ones
 * (nvm, fnm, Volta, a prefix of your own: the Mac app's PATH may not have them, #568). On Windows,
 * `<name>.exe`, then npm's `<name>.cmd`. Undefined: not installed.
 */
export function findAcpCommand(spec: Pick<AcpAgentSpec, 'command' | 'pathVar' | 'searchDirs'>, env: Readonly<Record<string, string | undefined>> = process.env, platform: NodeJS.Platform = process.platform, runs: (file: string) => boolean = executable, home: string = os.homedir(), fs?: FolderReader): string | undefined {
  const set = spec.pathVar ? env[spec.pathVar] : undefined;
  if (set) return runs(set) ? set : undefined;
  const p = platform === 'win32' ? path.win32 : path.posix;
  if (p.isAbsolute(spec.command) || spec.command.includes(p.sep)) {
    const file = p.resolve(home, spec.command);
    return runs(file) ? file : undefined;
  }
  const dirs = pathVar(env).split(platform === 'win32' ? ';' : ':').filter(Boolean);
  const own = (spec.searchDirs ?? []).map((d) => homeDir(d, home, p));
  if (platform === 'win32') {
    const all = [...dirs, ...own];
    return [...all.map((dir) => p.join(dir, `${spec.command}.exe`)), ...all.map((dir) => p.join(dir, `${spec.command}.cmd`))].find(runs);
  }
  const extra = [...own, '/opt/homebrew/bin', '/usr/local/bin', p.join(home, '.local/bin'), p.join(home, '.bun/bin'), ...nodeGlobalBinDirs(env, home, platform, fs)];
  return [...dirs, ...extra.filter((d) => !dirs.includes(d))].map((dir) => p.join(dir, spec.command)).find(runs);
}

/** The words for an agent that isn't on this computer: how to install it, when Beluga knows. */
export const acpMissingWords = (spec: Pick<AcpAgentSpec, 'label' | 'install'>): string => `${spec.label} isn’t installed on ${THIS_COMPUTER}.${spec.install ? ` ${spec.install}, then try again.` : ''}`;

/**
 * Spawn an ACP agent (its command, its ACP arguments, its variables over the run's) and shake
 * hands. Beluga offers it no file or terminal access of its own: it uses its own tools, each one
 * it asks about judged by Beluga.
 */
export function spawnAcp(spec: AcpAgentSpec): AcpConnect {
  return async ({ cwd, env, bin, args = [] }) => {
    const all = { ...(env ?? process.env) };
    const command = bin ?? findAcpCommand(spec, all);
    if (!command) throw new Error(acpMissingWords(spec));
    const how = codexCommand(command, [...spec.args, ...args]);
    const child = spawn(how.command, [...how.args], { cwd, env: { ...all, ...spec.env }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: how.shell });
    const lines: string[] = [];
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => keepLines(lines, chunk, STDERR_KEEP));
    const spawned = await new Promise<Error | undefined>((resolve) => {
      child.once('spawn', () => resolve(undefined));
      child.once('error', resolve);
    });
    if (spawned || child.pid === undefined) throw new Error(`Couldn’t start ${spec.label} (${spawned?.message ?? 'no process'}).`);
    niceForWorktree(child.pid, env);
    const running = (c: ChildProcess): boolean => c.exitCode === null && c.signalCode === null;
    const exited = running(child) ? new Promise<void>((resolve) => child.once('exit', () => resolve())) : Promise.resolve();
    const proc: RunProcess = { pid: child.pid, alive: () => running(child), kill: () => endProcess(child), exited };
    const rpc = new CodexRpc(child.stdout, child.stdin, { name: spec.label, jsonrpc: true });
    try {
      const init = await acpHandshake(rpc);
      return { rpc, proc, init, stderr: () => lines };
    } catch (err) {
      await proc.kill();
      throw new Error(`${spec.label} didn’t start: ${err instanceof Error ? err.message : String(err)}${lines.length ? ` (${lines.at(-1)})` : ''}`);
    }
  };
}
