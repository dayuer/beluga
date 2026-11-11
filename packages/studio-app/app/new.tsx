import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { ActionDock } from '../components/ActionDock';
import { GoalInput } from '../components/GoalInput';
import { Header } from '../components/Header';
import { PlatformPicker } from '../components/PlatformPicker';
import { PrimaryButton } from '../components/PrimaryButton';
import { ReceiptLine, type ReceiptTone } from '../components/ReceiptLine';
import { SyncBanner } from '../components/SyncBanner';
import { LIMITS, type StudioPlatform } from '../../../src/studio/protocol';
import { cache } from '../lib/cache';
import { clearDraft, readDraft, writeDraft } from '../lib/drafts';
import type { ProjectSummary } from '../lib/hub-schema';
import { useOnline } from '../lib/net';
import { detectLang, t, type Lang } from '../lib/strings';
import { refusalKey, useNewRequest, type SubmitState } from '../lib/submit';
import { ago } from '../lib/time';
import { color, space, type } from '../lib/theme';
import { useKeyboardInset } from '../lib/viewport';

function receiptOf(state: SubmitState, lang: Lang): { text: string; tone: ReceiptTone } | null {
  switch (state.phase) {
    case 'idle':
      return null;
    case 'sending':
      return { text: t(lang, 'common.sending'), tone: 'info' };
    case 'queued':
      return { text: t(lang, 'new.queued'), tone: 'warn' };
    case 'done':
      return { text: t(lang, 'new.done'), tone: 'ok' };
    case 'refused':
      return { text: state.code ? t(lang, refusalKey(state.code)) : t(lang, 'common.error'), tone: 'error' };
    case 'failed':
      return {
        text:
          state.failure === 'expired'
            ? t(lang, 'refusal.expired')
            : state.failure === 'offline'
              ? t(lang, 'new.failed')
              : t(lang, 'refusal.http'),
        tone: 'error',
      };
  }
}

function Hint({ lang }: { lang: Lang }) {
  return (
    <View style={styles.hint}>
      <Text style={styles.hintTitle}>{t(lang, 'new.hintTitle')}</Text>
      <Text style={styles.hintLine}>· {t(lang, 'new.hint1')}</Text>
      <Text style={styles.hintLine}>· {t(lang, 'new.hint2')}</Text>
      <Text style={styles.hintLine}>· {t(lang, 'new.hint3')}</Text>
    </View>
  );
}

/**
 * New request (M5 design §4): the goal, platforms, and one Start planning button in the thumb
 * zone. The draft is written 300ms after typing and on leave; it is deleted only when the hub
 * answers queued/done. Double taps and retries reuse the same opId (lib/submit.ts), so the hub's
 * idempotency yields one queue entry.
 */
export default function NewRequestScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ project?: string | string[] }>();
  const pid = Array.isArray(params.project) ? params.project[0] : params.project;
  const lang = detectLang();
  const online = useOnline();
  const { width, height } = useWindowDimensions();
  const keyboard = useKeyboardInset();
  const desktop = width >= 900;

  const [goal, setGoal] = useState('');
  const [platforms, setPlatforms] = useState<StudioPlatform[]>([]);
  const [restored, setRestored] = useState<string | null>(null);
  const lockedRef = useRef(false);

  useEffect(() => {
    if (!pid) router.replace('/');
  }, [pid, router]);

  useEffect(() => {
    if (!pid) return;
    const draft = readDraft(pid);
    if (!draft) return;
    if (!draft.goal.trim() && draft.platforms.length === 0) {
      clearDraft(pid);
      return;
    }
    setGoal(draft.goal);
    setPlatforms(draft.platforms);
    setRestored(t(lang, 'new.restored', { ago: ago(draft.updatedAt, lang) }));
    const id = setTimeout(() => setRestored(null), 3000);
    return () => clearTimeout(id);
    // One restore per project; the language does not change while the screen is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pid]);

  // 300ms debounce; blur, pagehide and hidden visibility flush immediately below.
  useEffect(() => {
    if (!pid) return;
    const id = setTimeout(() => {
      if (lockedRef.current) return;
      if (!goal.trim() && platforms.length === 0) {
        clearDraft(pid);
        return;
      }
      writeDraft(pid, { goal, platforms, updatedAt: Date.now() });
    }, 300);
    return () => clearTimeout(id);
  }, [pid, goal, platforms]);

  useEffect(() => {
    if (!pid) return;
    const flush = () => {
      if (lockedRef.current) return;
      if (!goal.trim() && platforms.length === 0) {
        clearDraft(pid);
        return;
      }
      writeDraft(pid, { goal, platforms, updatedAt: Date.now() });
    };
    const hidden = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, [pid, goal, platforms]);

  const onDone = useCallback(() => {
    if (pid) router.replace(`/project/${encodeURIComponent(pid)}`);
  }, [pid, router]);

  const { state, submit } = useNewRequest(pid ?? '', onDone);
  // Once the hub has the request (queued/done), leaving must not resurrect the draft.
  lockedRef.current = state.phase === 'queued' || state.phase === 'done';

  const visibleHeight = Math.max(240, height - keyboard);
  const maxGoal = Math.max(120, Math.round(visibleHeight * 0.4));
  const count = goal.length >= 3600 ? t(lang, 'new.left', { n: LIMITS.text - goal.length }) : null;
  const project = pid ? cache.get<ProjectSummary[]>('projects')?.value.find((p) => p.id === pid) : undefined;
  const receipt = useMemo(() => receiptOf(state, lang), [state, lang]);
  const busy = state.phase === 'sending';
  const locked = busy || state.phase === 'queued' || state.phase === 'done';
  const valid = goal.trim().length > 0 && platforms.length > 0;
  const label = busy
    ? t(lang, 'common.sending')
    : state.phase === 'queued'
      ? t(lang, 'common.submitted')
      : state.phase === 'done'
        ? t(lang, 'common.done')
        : state.phase === 'failed' || state.phase === 'refused'
          ? t(lang, 'new.retry')
          : t(lang, 'new.start');

  if (!pid) return <View style={styles.root} />;

  return (
    <View style={styles.root} testID="new-screen">
      <Header title={t(lang, 'new.title')} back />
      {!online ? <SyncBanner kind="offline" text={t(lang, 'common.offline')} testID="offline-banner" /> : null}

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
        <View style={[styles.column, desktop && styles.columnDesktop]}>
          <View style={styles.intro}>
            {project ? <Text style={styles.eyebrow}>{project.name} · {project.studioName}</Text> : null}
            <Text style={styles.introText}>{t(lang, 'new.intro')}</Text>
            {!desktop ? <Hint lang={lang} /> : null}
          </View>

          <View style={[styles.composer, desktop && styles.composerDesktop]}>
            <View style={[styles.goalCol, desktop && styles.goalColDesktop]}>
              <Text style={styles.label}>{t(lang, 'new.goalLabel')}</Text>
              <GoalInput
                value={goal}
                onChangeText={setGoal}
                onBlur={() => {
                  if (lockedRef.current) return;
                  if (!goal.trim() && platforms.length === 0) {
                    clearDraft(pid);
                    return;
                  }
                  writeDraft(pid, { goal, platforms, updatedAt: Date.now() });
                }}
                maxHeight={maxGoal}
                placeholder={t(lang, 'new.goalPlaceholder')}
                accessibilityLabel={t(lang, 'new.goalLabel')}
              />
              <View style={styles.goalMeta}>
                <Text style={styles.caption} numberOfLines={1}>{restored ?? ''}</Text>
                <Text style={[styles.caption, count !== null && styles.warn]}>{count ?? ''}</Text>
              </View>
            </View>

            <View style={[styles.platformCol, desktop && styles.platformColDesktop]}>
              <Text style={styles.label}>{t(lang, 'new.platforms')}</Text>
              <PlatformPicker value={platforms} onChange={setPlatforms} />
              {desktop ? <Hint lang={lang} /> : null}
            </View>
          </View>
        </View>
      </ScrollView>

      <ActionDock>
        {receipt ? <ReceiptLine text={receipt.text} tone={receipt.tone} /> : null}
        <PrimaryButton
          label={label}
          onPress={() => {
            if (valid && !locked) void submit(goal.trim(), platforms);
          }}
          disabled={!valid || locked}
          loading={busy}
          testID="primary"
        />
      </ActionDock>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1, paddingHorizontal: space[5], paddingTop: space[5], paddingBottom: space[6] },
  column: { flex: 1, width: '100%' },
  columnDesktop: { maxWidth: 720, alignSelf: 'center', paddingTop: space[4] },
  intro: { marginBottom: space[5] },
  eyebrow: { ...type.eyebrow, color: color.text3, marginBottom: space[3] },
  introText: { ...type.body, color: color.text2 },
  hint: { marginTop: space[5], paddingTop: space[4], borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.hairline },
  hintTitle: { ...type.callout, fontWeight: '500', color: color.text2, marginBottom: 6 },
  hintLine: { ...type.callout, color: color.text3, lineHeight: 21 },
  composer: { marginTop: 'auto' },
  composerDesktop: { marginTop: space[6], flexDirection: 'row', gap: space[7], alignItems: 'flex-start' },
  goalCol: { width: '100%' },
  goalColDesktop: { flex: 1 },
  platformCol: { width: '100%' },
  platformColDesktop: { width: 264 },
  label: { ...type.callout, fontWeight: '500', color: color.text2, marginBottom: space[3] },
  goalMeta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 18, marginTop: space[2], gap: space[4] },
  caption: { ...type.caption, color: color.text3, flexShrink: 1 },
  warn: { color: color.warn },
});
