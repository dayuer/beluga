import { useEffect, useState } from 'react';
import type { VoiceMacView } from '@beluga/companion/protocol.js';
import { VOICE_LANGUAGES, VOICE_MODELS, voiceKnows, voiceSize } from '@beluga/shared/voice-models.js';
import { Button, Kbd } from '../components/ui.js';
import { useApi } from '../lib/beluga.js';
import { accelLabel, accelOf, DEFAULT_SHORTCUT, microphonesOf, parseAccel, type Microphone } from '../lib/dictation-model.js';
import { voiceModelOf } from '../lib/dictation.js';
import { inApp } from '../lib/boot.js';
import { setPrefs, usePrefs } from '../lib/prefs.js';
import { Group, Row, Select, Switch } from './settings-controls.js';
import s from './settings.module.css';
import { chordLabel, keyPlatform } from '../lib/shortcuts-model.js';
import { microphoneSettings, osName, systemSettingsName, thisComputer, yourComputer } from '../lib/os-words.js';
import { useT } from '../i18n/index.js';

/**
 * Settings › Voice (BLG-146): speaking instead of typing. The microphone it listens to (BLG-766),
 * which model writes it down (the one Beluga suggests for your language, or yours), the language, the talk shortcut (recorded by
 * pressing it), whether it works from any app, whether it's sent at once, and the models on this Mac.
 */
export function VoiceSettings() {
  const api = useApi();
  const prefs = usePrefs();
  const tr = useT();
  const [models, setModels] = useState<VoiceMacView | undefined>();
  const [recording, setRecording] = useState(false);
  const [bad, setBad] = useState<string | undefined>();
  const using = voiceModelOf(prefs);
  const suggested = voiceModelOf({ voiceModel: 'suggested', voiceLanguage: prefs.voiceLanguage });
  const mics = useMicrophones();

  // The models here, and how far one coming is (every 1.5 s while one comes).
  const coming = models?.models.some((m) => m.progress !== undefined) ?? false;
  useEffect(() => {
    let alive = true;
    let t: ReturnType<typeof setTimeout> | undefined;
    const look = (): void =>
      void api.voice.models().then(
        (v) => {
          if (!alive) return;
          setModels(v as VoiceMacView);
          // While one comes, look again in a moment (the pane is open, so you're looking).
          if (coming) t = setTimeout(look, 1500);
        },
        () => undefined,
      );
    look();
    return () => {
      alive = false;
      if (t) clearTimeout(t);
    };
  }, [coming]);

  // The recorder: the next keys pressed (with at least one of ⌘⌃⌥ for a letter, digit or Space) become the shortcut.
  useEffect(() => {
    if (!recording) return;
    const down = (e: KeyboardEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') return setRecording(false);
      const accel = accelOf(e);
      if (!accel) return;
      if (!parseAccel(accel)) return setBad(tr('settings.voice.wouldType', { keys: accelLabel(accel), mods: keyPlatform() === 'mac' ? tr('settings.voice.modsMac') : tr('settings.voice.modsOther') }));
      setBad(undefined);
      setPrefs({ voiceShortcut: accel });
      setRecording(false);
    };
    window.addEventListener('keydown', down, true);
    return () => window.removeEventListener('keydown', down, true);
  }, [recording]);

  const label = (id: 'whisper-turbo' | 'parakeet'): string => (id === 'parakeet' ? tr('settings.voice.parakeet') : tr('settings.voice.whisper'));
  const keys = prefs.voiceShortcut ? accelLabel(prefs.voiceShortcut) : undefined;
  return (
    <>
      <Group title={tr('settings.voice.writing')}>
        <MicrophoneRow mics={mics} />
        <Row
          label={tr('settings.voice.model')}
          detail={
            prefs.voiceModel === 'suggested'
              ? tr('settings.voice.suggestedFor', { lang: prefs.voiceLanguage === 'en' ? tr('settings.voice.english') : tr('settings.voice.yourLanguage'), model: VOICE_MODELS[suggested].label, why: suggested === 'parakeet' ? tr('settings.voice.whyParakeet') : tr('settings.voice.whyWhisper') })
              : using !== prefs.voiceModel
                ? tr('settings.voice.notKnown')
                : using === 'parakeet'
                  ? tr('settings.voice.parakeetDetail')
                  : tr('settings.voice.whisperDetail')
          }
        >
          <Select
            label={tr('settings.voice.model')}
            value={prefs.voiceModel}
            onChange={(v) => setPrefs({ voiceModel: v })}
            options={[
              { value: 'suggested', label: tr('settings.voice.suggested', { model: VOICE_MODELS[suggested].label }) },
              { value: 'whisper-turbo', label: label('whisper-turbo') },
              { value: 'parakeet', label: label('parakeet') },
            ]}
          />
        </Row>
        <Row label={tr('settings.voice.language')} detail={prefs.voiceLanguage === 'auto' ? tr('settings.voice.languageAuto') : tr('settings.voice.languageOne')}>
          <Select label={tr('settings.voice.language')} value={prefs.voiceLanguage} onChange={(v) => setPrefs({ voiceLanguage: v })} options={VOICE_LANGUAGES.map((l) => ({ value: l.code, label: l.label }))} />
        </Row>
        {(models?.models ?? []).map((m) => (
          <Row
            key={m.model}
            label={VOICE_MODELS[m.model].label}
            detail={
              m.ready
                ? tr('settings.voice.onComputer', { computer: thisComputer(), size: voiceSize(m.bytes), inUse: m.model === using ? tr('settings.voice.inUse') : '' })
                : m.progress !== undefined
                  ? tr('settings.voice.getting', { pct: Math.round(m.progress * 100), size: voiceSize(m.bytes) })
                  : (m.error ?? tr('settings.voice.once', { size: voiceSize(m.bytes), withIt: m.model === using ? '' : tr('settings.voice.withIt') }))
            }
          >
            {m.ready ? null : m.progress !== undefined ? null : (
              <Button disabled={!voiceKnows(m.model, prefs.voiceLanguage) && m.model === 'parakeet'} onClick={() => void api.voice.prepare(m.model).then((v) => setModels(v as VoiceMacView), () => undefined)}>
                {tr('settings.voice.getNow')}
              </Button>
            )}
          </Row>
        ))}
      </Group>

      <Group title={tr('settings.voice.talk')}>
        <Row
          label={tr('settings.voice.shortcut')}
          detail={
            bad ??
            (recording ? (
              tr('settings.voice.pressWanted')
            ) : keys ? (
              <>
                {tr('settings.voice.holdA')}<Kbd>{keys}</Kbd>{tr('settings.voice.holdB')}<Kbd>↩</Kbd>{tr('settings.voice.holdC')}<Kbd>esc</Kbd>{tr('settings.voice.holdD')}
              </>
            ) : (
              tr('settings.voice.none')
            ))
          }
        >
          <Button onClick={() => (setBad(undefined), setRecording((r) => !r))}>{recording ? tr('settings.voice.pressKeys') : (keys ?? tr('settings.voice.set'))}</Button>
          {prefs.voiceShortcut && !recording ? (
            <Button variant="quiet" onClick={() => setPrefs({ voiceShortcut: '' })}>
              {tr('settings.voice.clear')}
            </Button>
          ) : null}
          {!prefs.voiceShortcut && !recording ? (
            <Button variant="quiet" onClick={() => setPrefs({ voiceShortcut: DEFAULT_SHORTCUT })}>
              {accelLabel(DEFAULT_SHORTCUT)}
            </Button>
          ) : null}
        </Row>
        {inApp() ? (
          <Row label={tr('settings.voice.anyApp')} detail={tr('settings.voice.anyAppDetail')}>
            <Switch label={tr('settings.voice.anyApp')} on={prefs.voiceAnyApp} onChange={(v) => setPrefs({ voiceAnyApp: v })} />
          </Row>
        ) : null}
        <Row label={tr('settings.voice.sendNow')} detail={prefs.voiceSend ? tr('settings.voice.sendOn') : tr('settings.voice.sendOff', { keys: chordLabel('Cmd+Enter') })}>
          <Switch label={tr('settings.voice.sendNow')} on={prefs.voiceSend} onChange={(v) => setPrefs({ voiceSend: v })} />
        </Row>
      </Group>
      <p className={s.note}>{tr('settings.voice.note', { here: thisComputer(), yours: yourComputer() })}</p>
    </>
  );
}

interface Microphones {
  readonly list: readonly Microphone[];
  /** WebKit names them only once Beluga may use the microphone. */
  readonly named: boolean;
  /** Ask for the microphone once, so they show by name. */
  readonly reveal: () => Promise<void>;
  readonly error?: string;
}

/** The microphones on this computer, following ones plugged in or taken out while Settings is open. */
function useMicrophones(): Microphones {
  const [all, setAll] = useState<readonly MediaDeviceInfo[]>([]);
  const [error, setError] = useState<string | undefined>();
  const tr = useT();
  const load = (): Promise<void> =>
    (navigator.mediaDevices?.enumerateDevices() ?? Promise.resolve([])).then(
      (d) => setAll(d),
      () => setAll([]),
    );
  useEffect(() => {
    void load();
    navigator.mediaDevices?.addEventListener?.('devicechange', load);
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', load);
  }, []);
  const reveal = async (): Promise<void> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      for (const t of stream.getTracks()) t.stop();
      setError(undefined);
    } catch (e) {
      const denied = e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
      setError(denied ? tr('settings.voice.micDenied', { where: microphoneSettings() }) : tr('settings.voice.micCantList'));
    }
    await load();
  };
  const list = microphonesOf(all);
  return { list, named: all.some((d) => d.kind === 'audioinput' && d.label), reveal, ...(error ? { error } : {}) };
}

/** Settings › Voice › Microphone: the one dictation listens to (calls keep their own, beside Mute). */
function MicrophoneRow({ mics }: { readonly mics: Microphones }) {
  const prefs = usePrefs();
  const picked = prefs.voiceMic;
  const tr = useT();
  const gone = Boolean(picked) && mics.named && !mics.list.some((m) => m.id === picked);
  const detail =
    mics.error ??
    (!mics.named
      ? tr('settings.voice.micUnnamed', { os: osName() })
      : gone
        ? tr('settings.voice.micGone', { os: osName() })
        : picked
          ? tr('settings.voice.micPicked')
          : tr('settings.voice.micSystem', { settings: systemSettingsName() }));
  return (
    <Row label={tr('settings.voice.mic')} detail={detail}>
      {mics.named ? (
        <Select
          label={tr('settings.voice.mic')}
          value={gone ? '' : picked}
          onChange={(v) => setPrefs({ voiceMic: v })}
          options={[{ value: '', label: tr('settings.voice.sameAs', { os: osName() }) }, ...mics.list.map((m) => ({ value: m.id, label: m.label }))]}
        />
      ) : (
        <Button onClick={() => void mics.reveal()}>{tr('settings.voice.showMics')}</Button>
      )}
    </Row>
  );
}
