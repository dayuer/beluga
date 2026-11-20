import { describe, expect, it, vi } from 'vitest';
import {
  appendSpoken,
  cleanTranscript,
  createVoiceController,
  requestMicPermission,
  type VoiceRecognizer,
} from './voice';

describe('lib/voice', () => {
  it('cleans whisper noise tags and appends spoken text without auto-submitting', () => {
    expect(cleanTranscript('  [BLANK_AUDIO]  增加微信登录 (music) ')).toBe('增加微信登录');
    expect(appendSpoken('', '增加微信登录')).toBe('增加微信登录');
    expect(appendSpoken('登录页', '增加微信登录')).toBe('登录页 增加微信登录');
    expect(appendSpoken('登录页\n', '增加微信登录')).toBe('登录页\n增加微信登录');
    expect(appendSpoken('登录页', '[Silence]')).toBe('登录页');
  });

  it('writes transcript on start -> stop/finish and discards on start -> cancel', async () => {
    const onTranscript = vi.fn();
    const recognizer: VoiceRecognizer = {
      requestPermission: async () => ({ granted: true }),
      start: async () => {},
      stop: async () => '增加购物车筛选',
      cancel: async () => {},
    };

    const ctrl = createVoiceController({ lang: 'zh', onTranscript, recognizer });
    await ctrl.start();
    expect(ctrl.getPhase()).toBe('listening');
    await ctrl.stop();
    expect(ctrl.getPhase()).toBe('idle');
    expect(onTranscript).toHaveBeenCalledWith('增加购物车筛选');

    onTranscript.mockClear();
    await ctrl.start();
    ctrl.cancel();
    expect(ctrl.getPhase()).toBe('idle');
    ctrl.finish('不应该写入');
    expect(onTranscript).not.toHaveBeenCalled();
  });

  it('returns in-place explanations when permission is denied on both iOS and Android', async () => {
    const rn = await import('react-native');
    const origPerm = rn.PermissionsAndroid;
    const origNative = rn.NativeModules;

    // Android denial
    (rn as { PermissionsAndroid: unknown }).PermissionsAndroid = {
      PERMISSIONS: { RECORD_AUDIO: 'RECORD_AUDIO' },
      RESULTS: { GRANTED: 'granted' },
      request: async () => 'denied',
    };
    const androidRes = await requestMicPermission('zh', 'android');
    expect(androidRes.granted).toBe(false);
    expect(androidRes.message).toContain('麦克风');

    // iOS denial
    (rn as { NativeModules: unknown }).NativeModules = {
      AudioSession: { requestRecordPermission: async () => false },
    };
    const iosRes = await requestMicPermission('en', 'ios');
    expect(iosRes.granted).toBe(false);
    expect(iosRes.message).toContain('Microphone');

    (rn as { PermissionsAndroid: unknown }).PermissionsAndroid = origPerm;
    (rn as { NativeModules: unknown }).NativeModules = origNative;
  });
});
