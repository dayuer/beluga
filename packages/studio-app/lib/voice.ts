import { useCallback, useRef, useState } from 'react';
import type { Lang } from './strings';
import { tVoice } from './strings/voice';
import { createVoiceRecognizer } from './voice-recognizer';

const NOISE = /\[[^\]]*\]|\([^)]*\)|\*[^*]*\*|[♪♫]+/g;

export function cleanTranscript(raw: string): string {
  return raw.replace(NOISE, ' ').replace(/\s+/g, ' ').trim();
}

export function appendSpoken(field: string, spoken: string): string {
  const words = cleanTranscript(spoken);
  if (!words) return field;
  if (!field.trim()) return words;
  const sep = /\n\s*$/.test(field) ? '' : /\s$/.test(field) ? '' : ' ';
  return field + sep + words;
}

export interface PermissionCheck {
  readonly granted: boolean;
  readonly message?: string;
}

export interface VoiceRecognizer {
  requestPermission(lang: Lang, platform?: string): Promise<PermissionCheck>;
  start(onPartial: (text: string) => void): Promise<void>;
  stop(): Promise<string>;
  cancel(): Promise<void>;
}

/**
 * 默认识别器：真的录音、本机 Whisper 识别、真的弹麦克风授权（lib/voice-recognizer.ts）。
 * 测试和组件可以传入自己的 recognizer 替换掉它。
 */
const defaultRecognizer: VoiceRecognizer = createVoiceRecognizer();

export type VoicePhase = 'idle' | 'listening' | 'recognizing';

export interface VoiceState {
  readonly phase: VoicePhase;
  readonly hint: string | null;
  start(): Promise<void>;
  stop(): Promise<void>;
  cancel(): void;
  finish(transcript: string): void;
}

export function createVoiceController({
  lang,
  onTranscript,
  recognizer = defaultRecognizer,
  onPhaseChange,
  onHintChange,
}: {
  /** 语言；可以传一个 getter，用户切语言后下一次录音就用新的（不用重建 controller）。 */
  readonly lang: Lang | (() => Lang);
  readonly onTranscript: (text: string) => void;
  readonly recognizer?: VoiceRecognizer;
  readonly onPhaseChange?: (phase: VoicePhase) => void;
  readonly onHintChange?: (hint: string | null) => void;
}) {
  const langNow = (): Lang => (typeof lang === 'function' ? lang() : lang);
  let phase: VoicePhase = 'idle';
  let cancelled = false;

  const setPhase = (next: VoicePhase) => {
    phase = next;
    onPhaseChange?.(next);
  };

  const setHint = (next: string | null) => {
    onHintChange?.(next);
  };

  return {
    getPhase: () => phase,
    async start() {
      setHint(null);
      cancelled = false;
      const perm = await recognizer.requestPermission(langNow());
      if (cancelled) return;
      if (!perm.granted) {
        setPhase('idle');
        setHint(perm.message ?? tVoice(langNow(), 'voice.micDenied'));
        return;
      }
      try {
        setPhase('listening');
        await recognizer.start(() => {});
      } catch {
        setPhase('idle');
        setHint(tVoice(langNow(), 'voice.unavailable'));
      }
    },
    async stop() {
      if (phase !== 'listening' || cancelled) return;
      setPhase('recognizing');
      try {
        const raw = await recognizer.stop();
        if (cancelled) return;
        setPhase('idle');
        const cleaned = cleanTranscript(raw);
        if (cleaned) onTranscript(cleaned);
      } catch {
        setPhase('idle');
        setHint(tVoice(langNow(), 'voice.unavailable'));
      }
    },
    cancel() {
      cancelled = true;
      setPhase('idle');
      setHint(null);
      void recognizer.cancel();
    },
    finish(transcript: string) {
      if (cancelled) return;
      setPhase('idle');
      const cleaned = cleanTranscript(transcript);
      if (cleaned) onTranscript(cleaned);
    },
  };
}

export function useVoiceDictation({
  lang,
  onTranscript,
  recognizer = defaultRecognizer,
}: {
  readonly lang: Lang;
  readonly onTranscript: (text: string) => void;
  readonly recognizer?: VoiceRecognizer;
}): VoiceState {
  const [phase, setPhase] = useState<VoicePhase>('idle');
  const [hint, setHint] = useState<string | null>(null);
  const ctrlRef = useRef<ReturnType<typeof createVoiceController> | null>(null);
  // controller 只建一次；语言和「写到哪」每次渲染都更新，切到别的档后语音就写进那一档。
  const langRef = useRef(lang);
  langRef.current = lang;
  const transcriptRef = useRef(onTranscript);
  transcriptRef.current = onTranscript;

  if (!ctrlRef.current) {
    ctrlRef.current = createVoiceController({
      lang: () => langRef.current,
      onTranscript: (text) => transcriptRef.current(text),
      recognizer,
      onPhaseChange: setPhase,
      onHintChange: setHint,
    });
  }

  const start = useCallback(() => ctrlRef.current!.start(), []);
  const stop = useCallback(() => ctrlRef.current!.stop(), []);
  const cancel = useCallback(() => ctrlRef.current!.cancel(), []);
  const finish = useCallback((transcript: string) => ctrlRef.current!.finish(transcript), []);

  return { phase, hint, start, stop, cancel, finish };
}
