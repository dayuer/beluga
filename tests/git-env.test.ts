import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { gitEnv } from '../src/workspaces/git.js';

/**
 * Git speaks English to Beluga whatever the Mac's language (BLG-144): src/workspaces/sync.ts reads
 * "would be overwritten" to offer Stash and Update; a 中文 git turned that into "Couldn't update".
 * tests/setup.ts pins LC_ALL=C, which is why the unit tests never saw it.
 */
describe('gitEnv', () => {
  it('pins git’s messages to English and keeps the character set', () => {
    const env = gitEnv({ LANG: 'zh_CN.UTF-8', LC_ALL: 'zh_CN.UTF-8', LANGUAGE: 'zh_CN' });
    expect(env.LC_MESSAGES).toBe('C');
    expect(env.LC_ALL).toBeUndefined();
    expect(env.LC_CTYPE).toBe('zh_CN.UTF-8');
    expect(env.GIT_TERMINAL_PROMPT).toBe('0');
  });

  it('leaves a set LC_CTYPE alone', () => {
    expect(gitEnv({ LC_ALL: 'zh_CN.UTF-8', LC_CTYPE: 'en_US.UTF-8' }).LC_CTYPE).toBe('en_US.UTF-8');
  });

  it('a real git in Chinese still answers in English', () => {
    let message = '';
    try {
      execFileSync('git', ['-C', '/nonexistent-beluga-dir', 'status'], { env: gitEnv({ ...process.env, LANG: 'zh_CN.UTF-8', LC_ALL: 'zh_CN.UTF-8', LANGUAGE: 'zh_CN' }), stdio: 'pipe' });
    } catch (err) {
      message = String((err as { stderr?: Buffer }).stderr ?? '');
    }
    expect(message).toMatch(/^fatal: /);
  });
});
