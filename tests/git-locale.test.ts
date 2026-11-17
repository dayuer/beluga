import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Beluga reads git's English messages ("would be overwritten", "not fully merged"…). On a Mac set
 * to Chinese git answers in Chinese, even with no LANG (it reads the system's languages), so its
 * environment pins the message language: LC_MESSAGES=C and LANGUAGE=C, never LC_ALL, so file
 * names and commit messages come out byte for byte as before. GIT_ENV is read once, when git.ts
 * loads: the Chinese locale goes in before the import.
 */

const ZH = { LANG: 'zh_CN.UTF-8', LC_ALL: 'zh_CN.UTF-8', LC_MESSAGES: 'zh_CN.UTF-8' };
Object.assign(process.env, ZH);
delete process.env.LANGUAGE;
const { git: belugaGit, deleteMergedBranch } = await import('../src/workspaces/git.js');
const { updateDefault } = await import('../src/workspaces/sync.js');

const sh = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=T', ...args], { cwd, stdio: 'pipe' }).toString();
/** Git as the user's own terminal would run it: in Chinese. */
const shZh = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: 'pipe', env: { ...process.env, ...ZH } }).toString();

let repo: string;
let mate: string;

beforeAll(() => {
  const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'klaud-locale-')));
  const origin = path.join(base, 'app.git');
  repo = path.join(base, 'app');
  mate = path.join(base, 'mate');
  mkdirSync(repo);
  execFileSync('git', ['init', '--bare', '-q', '-b', 'main', origin]);
  sh(repo, 'init', '-q', '-b', 'main');
  writeFileSync(path.join(repo, 'notes.txt'), 'one\n');
  writeFileSync(path.join(repo, '中文文件.txt'), '你好\n');
  sh(repo, 'add', '.');
  sh(repo, 'commit', '-q', '-m', '提交：中文信息');
  sh(repo, 'remote', 'add', 'origin', origin);
  sh(repo, 'push', '-q', '-u', 'origin', 'main');
  sh(repo, 'remote', 'set-head', 'origin', 'main');
  execFileSync('git', ['clone', '-q', origin, mate]);
});

describe('git under a Chinese locale', () => {
  it('updateDefault still sees changes in the way as dirty', async () => {
    writeFileSync(path.join(mate, 'notes.txt'), 'from mate\n');
    sh(mate, 'commit', '-q', '-am', 'mate');
    sh(mate, 'push', '-q', 'origin', 'main');
    writeFileSync(path.join(repo, 'notes.txt'), 'mine\n');
    expect(await updateDefault(repo, 'origin/main')).toMatchObject({ kind: 'dirty', files: ['notes.txt'], behind: 1 });
    sh(repo, 'checkout', '-q', '--', 'notes.txt');
  });

  it('git branch -d still says “not fully merged”', async () => {
    sh(repo, 'checkout', '-q', '-b', 'side');
    sh(repo, 'commit', '-q', '--allow-empty', '-m', 'side work');
    sh(repo, 'checkout', '-q', 'main');
    await expect(deleteMergedBranch(repo, 'side', 'main')).rejects.toThrow(/not fully merged/);
  });

  it('Chinese file names and commit messages come out exactly as the user’s own git prints them', async () => {
    writeFileSync(path.join(repo, '中文文件.txt'), '你好\n再见\n');
    for (const args of [['status', '--porcelain'], ['-c', 'core.quotePath=false', 'status', '--porcelain'], ['status', '--porcelain', '-z'], ['log', '-1', '--format=%s'], ['diff', '--stat'], ['diff']]) {
      expect(await belugaGit(repo, args)).toBe(shZh(repo, ...args));
    }
    expect(await belugaGit(repo, ['-c', 'core.quotePath=false', 'status', '--porcelain'])).toContain('中文文件.txt');
    expect((await belugaGit(repo, ['log', '-1', '--format=%s'])).trim()).toBe('提交：中文信息');
    sh(repo, 'checkout', '-q', '--', '中文文件.txt');
  });
});
