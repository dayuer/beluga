import { useCallback, useRef, useState } from 'react';
import { PermissionsAndroid, Platform } from 'react-native';
import type { Lang } from './strings';

const NOISE = /\[[^\]]*\]|\([^)]*\)|\*[^*]*\*|[♪♫]+/g;

/** 清理语音识别结果中的非语音标记（如 [BLANK_AUDIO]、(music)）。 */
export function cleanTranscript(raw: string): string {
  return raw.replace(NOISE, ' ').replace(/\s+/g, ' ').trim();
}

/** 把识别出的文字追加到输入框现有内容后（不自动发送）。 */
export function appendSpoken(field: string, spoken: string): string {
  const words = cleanTranscript(spoken);
  if (!words) return field;
  if (!field.trim()) return words;
  const sep = /\n\s*$/.test(field) ? '' : /\s$/.test(field) ? '' : ' ';
  return field + sep + words;
}

export function micDeniedMessage(lang: Lang): string {
  return lang === 'en'
    ? 'Microphone permission is off. Enable it in Settings › Synon Studio › Microphone, or use keyboard dictation.'
    : '未开启麦克风权限。请在系统「设置 › Synon Studio › 麦克风」中允许访问，或使用系统键盘听写。';
}

export async function requestMicPermission(
  lang: Lang,
): Promise<{ granted: boolean; message?: string }> {
  if (Platform.OS === 'android') {
    try {
      const res = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      );
      if (res !== PermissionsAndroid.RESULTS.GRANTED) {
        return { granted: false, message: micDeniedMessage(lang) };
      }
      return { granted: true };
    } catch {
      return { granted: false, message: micDeniedMessage(lang) };
    }
  }
  return { granted: true };
}

export type VoicePhase = 'idle' | 'listening' | 'recognizing';

export interface VoiceState {
  readonly phase: VoicePhase;
  readonly hint: string | null;
  start(): Promise<void>;
  cancel(): void;
  finish(transcript: string): void;
}

/**
 * 语音输入控制器（SS-41）：
 * - 拒绝麦克风权限时原地说明如何开启；
 * - 识别中可随时 `cancel()` 取消；
 * - 识别结果通过 `onTranscript` 写入输入框供用户修改，绝不自动发送。
 */
export function useVoiceDictation({
  lang,
  onTranscript,
  requestPermission = requestMicPermission,
}: {
  readonly lang: Lang;
  readonly onTranscript: (text: string) => void;
  readonly requestPermission?: (lang: Lang) => Promise<{ granted: boolean; message?: string }>;
}): VoiceState {
  const [phase, setPhase] = useState<VoicePhase>('idle');
  const [hint, setHint] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  const start = useCallback(async () => {
    setHint(null);
    cancelledRef.current = false;
    const perm = await requestPermission(lang);
    if (cancelledRef.current) return;
    if (!perm.granted) {
      setPhase('idle');
      setHint(perm.message ?? micDeniedMessage(lang));
      return;
    }
    setPhase('listening');
  }, [lang, requestPermission]);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    setPhase('idle');
    setHint(null);
  }, []);

  const finish = useCallback(
    (transcript: string) => {
      if (cancelledRef.current) return;
      setPhase('idle');
      const cleaned = cleanTranscript(transcript);
      if (cleaned) onTranscript(cleaned);
    },
    [onTranscript],
  );

  return { phase, hint, start, cancel, finish };
}
