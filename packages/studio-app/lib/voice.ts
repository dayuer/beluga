import { useCallback, useRef, useState } from 'react';
import { NativeModules, PermissionsAndroid, Platform } from 'react-native';
import type { Lang } from './strings';
import { tVoice } from './strings/voice';

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
 * Check microphone (and iOS speech recognition) permissions across Android and iOS.
 */
export async function requestMicPermission(
  lang: Lang,
  os: string = Platform.OS,
): Promise<PermissionCheck> {
  if (os === 'android') {
    try {
      const res = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      );
      if (res !== PermissionsAndroid.RESULTS.GRANTED) {
        return { granted: false, message: tVoice(lang, 'voice.micDenied') };
      }
      return { granted: true };
    } catch {
      return { granted: false, message: tVoice(lang, 'voice.micDenied') };
    }
  }

  if (os === 'ios') {
    const audioSession = NativeModules?.AudioSession as
      | { requestRecordPermission?: () => Promise<boolean> }
      | undefined;
    const speechMod = NativeModules?.SpeechRecognition as
      | { requestAuthorization?: () => Promise<string> }
      | undefined;

    if (audioSession?.requestRecordPermission) {
      const micOk = await audioSession.requestRecordPermission().catch(() => false);
      if (!micOk) return { granted: false, message: tVoice(lang, 'voice.micDenied') };
    }
    if (speechMod?.requestAuthorization) {
      const auth = await speechMod.requestAuthorization().catch(() => 'denied');
      if (auth !== 'authorized' && auth !== 'granted') {
        return { granted: false, message: tVoice(lang, 'voice.speechDeniedIos') };
      }
    }
    if (!audioSession?.requestRecordPermission && !speechMod?.requestAuthorization) {
      return { granted: false, message: tVoice(lang, 'voice.unavailable') };
    }
    return { granted: true };
  }

  return { granted: false, message: tVoice(lang, 'voice.unavailable') };
}

const defaultRecognizer: VoiceRecognizer = {
  requestPermission: (lang, os) => requestMicPermission(lang, os),
  async start() {
    throw new Error('voice-module-not-installed');
  },
  async stop() {
    return '';
  },
  async cancel() {},
};

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
  readonly lang: Lang;
  readonly onTranscript: (text: string) => void;
  readonly recognizer?: VoiceRecognizer;
  readonly onPhaseChange?: (phase: VoicePhase) => void;
  readonly onHintChange?: (hint: string | null) => void;
}) {
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
      const perm = await recognizer.requestPermission(lang);
      if (cancelled) return;
      if (!perm.granted) {
        setPhase('idle');
        setHint(perm.message ?? tVoice(lang, 'voice.micDenied'));
        return;
      }
      try {
        setPhase('listening');
        await recognizer.start(() => {});
      } catch {
        setPhase('idle');
        setHint(tVoice(lang, 'voice.unavailable'));
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
        setHint(tVoice(lang, 'voice.unavailable'));
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

  if (!ctrlRef.current) {
    ctrlRef.current = createVoiceController({
      lang,
      onTranscript,
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
