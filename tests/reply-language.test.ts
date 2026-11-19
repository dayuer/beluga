import { describe, expect, it } from 'vitest';
import { runInstructions } from '../src/agent/run-instructions.js';
import type { AgentRunInput } from '../src/agent/types.js';
import { prefsFrom } from '../src/core/store.js';
import { PrefsPatch } from '../src/ipc/api.js';
import { LOCAL_SETTINGS, SYNCED_SETTINGS } from '../src/machines/sync.js';
import { buildReplyLanguageAppend } from '../src/shared/reply-language.js';
import { Settings } from '../src/shared/settings-schema.js';

const input = (extra: Partial<AgentRunInput> = {}) => ({ prompt: 'hi', requesterName: 'kay', viaAgent: false, context: [], ...extra }) as unknown as AgentRunInput;

describe('reply language', () => {
  it('tells the agent to answer in Chinese, and to keep what git and programs read in English', () => {
    const words = buildReplyLanguageAppend('zh-CN');
    expect(words).toContain('Simplified Chinese');
    expect(words).toContain('every turn');
    expect(words).toContain('commit messages');
    expect(words).toContain('thinking may stay in English');
  });

  it('adds nothing for English or when unset', () => {
    expect(buildReplyLanguageAppend('en')).toBe('');
    expect(buildReplyLanguageAppend(undefined)).toBe('');
  });

  it('is in a run’s instructions only when the run carries it', () => {
    expect(runInstructions(input({ replyLanguage: 'zh-CN' }), 'kay')).toContain('Simplified Chinese');
    expect(runInstructions(input(), 'kay')).not.toContain('Simplified Chinese');
  });

  it('is kept in settings, read back into prefs, and cleared with null', () => {
    expect(Settings.parse({ replyLanguage: 'zh-CN' }).replyLanguage).toBe('zh-CN');
    expect(Settings.parse({ replyLanguage: 'klingon' }).replyLanguage).toBeUndefined();
    expect(prefsFrom({ replyLanguage: 'zh-CN' }).replyLanguage).toBe('zh-CN');
    expect(PrefsPatch.parse({ replyLanguage: null }).replyLanguage).toBeNull();
  });

  it('belongs to this computer and never syncs', () => {
    expect(LOCAL_SETTINGS).toContain('replyLanguage');
    expect(SYNCED_SETTINGS).not.toContain('replyLanguage');
  });
});
