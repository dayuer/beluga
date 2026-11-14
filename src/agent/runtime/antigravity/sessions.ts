import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { samePath } from '../claude/claude-sessions.js';
import { type AgyConnect, spawnAgy } from './connection.js';

/** An Antigravity conversation id (a UUID): only those name its files. */
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Where `agy acp` keeps its conversations: ~/.gemini/antigravity-cli. */
export function agyDataDir(home: string = os.homedir()): string {
  return path.join(home, '.gemini', 'antigravity-cli');
}

/** A conversation's own folder of notes (its plan, its task list): written there without being yours. */
export function agyBrainDir(sessionId: string, dir: string = agyDataDir()): string {
  return path.join(dir, 'brain', sessionId);
}

/**
 * Forget Antigravity's own record of a conversation (a deleted chat's, BLG-571; a side call's,
 * which was never yours to keep): its conversation file, its annotations and its notes folder.
 * The CLI has no command to delete one, so the files go; nothing else of Antigravity's is touched,
 * and one that's already gone is fine.
 */
export async function dropAgySession(sessionId: string, dir: string = agyDataDir()): Promise<boolean> {
  if (!SESSION_ID.test(sessionId)) return false;
  const files = [path.join(dir, 'conversations', `${sessionId}.db`), path.join(dir, 'conversations', `${sessionId}.pb`), path.join(dir, 'annotations', `${sessionId}.pbtxt`), agyBrainDir(sessionId, dir)];
  const gone = await Promise.all(files.map((f) => fs.rm(f, { recursive: true, force: true }).then(() => true, () => false)));
  return gone.some(Boolean);
}

/** Every Antigravity conversation that ran in a folder being deleted for good (as `session/list` says), each dropped. */
export async function dropAgyFolder(folder: string, deps: { readonly connect?: AgyConnect; readonly dir?: string } = {}): Promise<number> {
  const conn = await (deps.connect ?? spawnAgy)({ cwd: os.tmpdir() }).catch(() => undefined);
  if (!conn) return 0;
  try {
    const listed = await conn.rpc.request<{ sessions?: Array<{ sessionId?: string; cwd?: string }> }>('session/list', {}, 30_000).catch(() => ({ sessions: [] }));
    let dropped = 0;
    for (const s of listed.sessions ?? []) if (s.sessionId && s.cwd && samePath(s.cwd, folder) && (await dropAgySession(s.sessionId, deps.dir))) dropped++;
    return dropped;
  } finally {
    await conn.proc.kill();
  }
}
