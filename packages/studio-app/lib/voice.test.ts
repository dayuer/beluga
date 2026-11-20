import { describe, expect, it, vi } from 'vitest';
import {
  appendSpoken,
  cleanTranscript,
  createVoiceController,
  type VoiceRecognizer,
} from './voice';
import { createVoiceRecognizer } from './voice-recognizer';

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
});

describe('lib/voice-recognizer（假的录音流和 whisper）', () => {
  it('start → stop：录下的 PCM 交给 whisper，返回它的文字', async () => {
    let emit: (samples: Float32Array) => void = () => {};
    const stopRecording = vi.fn();
    const transcribe = vi.fn(async () => '增加购物车筛选');
    const recognizer = createVoiceRecognizer({
      requestPermission: async () => true,
      startRecording: async (push) => {
        emit = push;
      },
      stopRecording,
      transcribe,
    });

    const perm = await recognizer.requestPermission('zh', 'ios');
    expect(perm.granted).toBe(true);

    await recognizer.start(() => {});
    emit(new Float32Array([0, 0.5, -0.5]));
    const text = await recognizer.stop();

    expect(text).toBe('增加购物车筛选');
    expect(stopRecording).toHaveBeenCalledTimes(1);
    expect(transcribe).toHaveBeenCalledTimes(1);
    const [pcm, lang] = transcribe.mock.calls[0] as unknown as [Uint8Array, string];
    expect(lang).toBe('zh');
    // 3 个采样 × 2 字节的小端 16-bit PCM
    expect(pcm.length).toBe(6);
    expect(pcm[0]).toBe(0);
  });

  it('cancel：停掉录音，之后拿不到文字，也不调用 whisper', async () => {
    let emit: (samples: Float32Array) => void = () => {};
    const stopRecording = vi.fn();
    const transcribe = vi.fn(async () => '不应该出现');
    const recognizer = createVoiceRecognizer({
      requestPermission: async () => true,
      startRecording: async (push) => {
        emit = push;
      },
      stopRecording,
      transcribe,
    });

    await recognizer.requestPermission('zh', 'android');
    await recognizer.start(() => {});
    emit(new Float32Array([0.1, 0.2]));
    await recognizer.cancel();

    expect(stopRecording).toHaveBeenCalledTimes(1);
    expect(await recognizer.stop()).toBe('');
    expect(transcribe).not.toHaveBeenCalled();
  });

  it('iOS 与 Android 拒绝麦克风权限时都给出 micDenied', async () => {
    for (const platform of ['ios', 'android']) {
      const recognizer = createVoiceRecognizer({ requestPermission: async () => false });
      const zh = await recognizer.requestPermission('zh', platform);
      expect(zh.granted, platform).toBe(false);
      expect(zh.message).toContain('麦克风');

      const en = await recognizer.requestPermission('en', platform);
      expect(en.granted, platform).toBe(false);
      expect(en.message).toContain('Microphone');
    }
  });

  it('要权限本身出错也按未授权处理', async () => {
    const recognizer = createVoiceRecognizer({
      requestPermission: async () => {
        throw new Error('no native module');
      },
    });
    const res = await recognizer.requestPermission('zh', 'ios');
    expect(res.granted).toBe(false);
    expect(res.message).toContain('麦克风');
  });
});
