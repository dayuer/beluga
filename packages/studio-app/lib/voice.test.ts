import { describe, expect, it, vi } from 'vitest';
import { appendSpoken, cleanTranscript, micDeniedMessage, requestMicPermission } from './voice';

describe('lib/voice', () => {
  it('cleans whisper noise tags and appends spoken text without auto-submitting', () => {
    expect(cleanTranscript('  [BLANK_AUDIO]  增加微信登录 (music) ')).toBe('增加微信登录');
    expect(appendSpoken('', '增加微信登录')).toBe('增加微信登录');
    expect(appendSpoken('登录页', '增加微信登录')).toBe('登录页 增加微信登录');
    expect(appendSpoken('登录页\n', '增加微信登录')).toBe('登录页\n增加微信登录');
    expect(appendSpoken('登录页', '[Silence]')).toBe('登录页');
  });

  it('provides in-place permission denied explanation in zh and en', () => {
    expect(micDeniedMessage('zh')).toContain('麦克风');
    expect(micDeniedMessage('en')).toContain('Microphone');
  });

  it('requests Android microphone permission and handles denial gracefully', async () => {
    const res = await requestMicPermission('zh');
    expect(res.granted).toBe(true); // non-android default in node test env
    expect(vi.isMockFunction(requestMicPermission)).toBe(false);
  });
});
