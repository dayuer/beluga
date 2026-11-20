import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { ActionDock } from '../components/ActionDock';
import { GoalInput } from '../components/GoalInput';
import { Header } from '../components/Header';
import { PlatformPicker } from '../components/PlatformPicker';
import { PrimaryButton } from '../components/PrimaryButton';
import { ReceiptLine, type ReceiptTone } from '../components/ReceiptLine';
import { Segments, type SegmentItem } from '../components/Segments';
import { SyncBanner } from '../components/SyncBanner';
import { LIMITS, PLATFORMS, type StudioPlatform } from '../../../src/studio/protocol';
import { cache } from '../lib/cache';
import { hub } from '../lib/client';
import { DEMO_REQUEST_SUMMARIES } from '../lib/demo';
import { clearDraft, readDraft, writeDraft } from '../lib/drafts';
import type { ProjectSummary } from '../lib/hub-schema';
import { kv } from '../lib/kv';
import { useOnline } from '../lib/net';
import { detectLang, t, type Lang } from '../lib/strings';
import { refusalKey, useNewRequest, type SubmitState } from '../lib/submit';
import { ago } from '../lib/time';
import { color, radius, space, type } from '../lib/theme';
import { useKeyboardInset } from '../lib/viewport';

type NewMode = 'new' | 'feedback';

interface FeedbackDraft {
  readonly requestId: string;
  readonly text: string;
  readonly updatedAt: number;
}

const feedbackDraftKey = (pid: string): string => `draft:feedback:${pid}`;

function readFeedbackDraft(pid: string): FeedbackDraft | undefined {
  const raw = kv.get<Partial<FeedbackDraft>>(feedbackDraftKey(pid));
  if (!raw || typeof raw.text !== 'string' || typeof raw.updatedAt !== 'number') return undefined;
  return {
    requestId: typeof raw.requestId === 'string' ? raw.requestId : '',
    text: raw.text.slice(0, LIMITS.text),
    updatedAt: raw.updatedAt,
  };
}

function writeFeedbackDraft(pid: string, draft: FeedbackDraft): void {
  kv.set(feedbackDraftKey(pid), { ...draft, text: draft.text.slice(0, LIMITS.text) });
}

function clearFeedbackDraft(pid: string): void {
  kv.remove(feedbackDraftKey(pid));
}

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
 * P2 提需求（SS-38）：顶部分段「新需求」/「对做好的提意见」，两档各自保留草稿。
 * 发送走 lib/submit.ts 状态机；断网时草稿留在本机，直到中台回执 queued 或 done。
 */
export default function NewRequestScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ project?: string | string[] }>();
  const routePid = Array.isArray(params.project) ? params.project[0] : params.project;
  const cachedProjects = cache.get<ProjectSummary[]>('projects')?.value ?? [];
  const pid = routePid || cachedProjects[0]?.id || DEMO_REQUEST_SUMMARIES[0]?.projectId || 'proj-shop';

  const lang = detectLang();
  const online = useOnline();
  const { width, height } = useWindowDimensions();
  const keyboard = useKeyboardInset();
  const desktop = width >= 900;

  const [mode, setMode] = useState<NewMode>('new');
  const [goal, setGoal] = useState('');
  const [platforms, setPlatforms] = useState<StudioPlatform[]>([]);
  const [restored, setRestored] = useState<string | null>(null);
  const [project, setProject] = useState<ProjectSummary | undefined>(() =>
    cachedProjects.find((p) => p.id === pid),
  );

  const delivered = useMemo(
    () => DEMO_REQUEST_SUMMARIES.filter((r) => r.status === 'done'),
    [],
  );
  const [selectedRequestId, setSelectedRequestId] = useState<string>(() => delivered[0]?.id ?? '');
  const [feedbackText, setFeedbackText] = useState('');

  const lockedRef = useRef(false);

  useEffect(() => {
    if (!pid || project) return;
    let alive = true;
    void hub.projects().then((r) => {
      if (!alive || !r.ok) return;
      cache.set('projects', r.value.projects, Date.now());
      const found = r.value.projects.find((p) => p.id === pid);
      if (found) setProject(found);
    });
    return () => {
      alive = false;
    };
  }, [pid, project]);

  // 恢复两档草稿，切换分段时不互相覆盖
  useEffect(() => {
    const draft = readDraft(pid);
    if (draft) {
      if (!draft.goal.trim() && draft.platforms.length === 0) {
        clearDraft(pid);
      } else {
        setGoal(draft.goal);
        setPlatforms(draft.platforms);
        setRestored(t(lang, 'new.restored', { ago: ago(draft.updatedAt, lang) }));
        const timer = setTimeout(() => setRestored(null), 3000);
        return () => clearTimeout(timer);
      }
    }
    const fb = readFeedbackDraft(pid);
    if (fb) {
      if (!fb.text.trim()) {
        clearFeedbackDraft(pid);
      } else {
        if (fb.requestId) setSelectedRequestId(fb.requestId);
        setFeedbackText(fb.text);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pid]);

  // 300ms 防抖保存新需求草稿
  useEffect(() => {
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

  // 300ms 防抖保存反馈草稿
  useEffect(() => {
    const id = setTimeout(() => {
      if (lockedRef.current) return;
      if (!feedbackText.trim()) {
        clearFeedbackDraft(pid);
        return;
      }
      writeFeedbackDraft(pid, {
        requestId: selectedRequestId,
        text: feedbackText,
        updatedAt: Date.now(),
      });
    }, 300);
    return () => clearTimeout(id);
  }, [pid, selectedRequestId, feedbackText]);

  useEffect(() => {
    const flush = () => {
      if (lockedRef.current) return;
      if (!goal.trim() && platforms.length === 0) clearDraft(pid);
      else writeDraft(pid, { goal, platforms, updatedAt: Date.now() });

      if (!feedbackText.trim()) clearFeedbackDraft(pid);
      else writeFeedbackDraft(pid, { requestId: selectedRequestId, text: feedbackText, updatedAt: Date.now() });
    };
    const sub =
      typeof AppState?.addEventListener === 'function'
        ? AppState.addEventListener('change', (next) => {
            if (next === 'background') flush();
          })
        : null;
    return () => {
      sub?.remove();
    };
  }, [pid, goal, platforms, selectedRequestId, feedbackText]);

  const onDone = useCallback(() => {
    clearFeedbackDraft(pid);
    router.replace(`/project/${encodeURIComponent(pid)}`);
  }, [pid, router]);

  const { state, submit } = useNewRequest(pid, onDone);
  lockedRef.current = state.phase === 'queued' || state.phase === 'done';

  // 收到 queued/done 后清理反馈草稿（新需求草稿由 submit.ts 清理）
  useEffect(() => {
    if (state.phase === 'queued' || state.phase === 'done') {
      clearFeedbackDraft(pid);
    }
  }, [pid, state.phase]);

  const segments: readonly SegmentItem[] = useMemo(
    () => [
      { key: 'new', label: t(lang, 'new.tabNew'), testID: 'seg-new' },
      { key: 'feedback', label: t(lang, 'new.tabFeedback'), testID: 'seg-feedback' },
    ],
    [lang],
  );

  const selectedRequest = delivered.find((r) => r.id === selectedRequestId);
  const visibleHeight = Math.max(240, height - keyboard);
  const compact = keyboard > 0;
  const maxGoal = Math.max(120, Math.round(visibleHeight * 0.4));
  const activeText = mode === 'new' ? goal : feedbackText;
  const count = activeText.length >= 3600 ? t(lang, 'new.left', { n: LIMITS.text - activeText.length }) : null;
  const receipt = useMemo(() => receiptOf(state, lang), [state, lang]);
  const busy = state.phase === 'sending';
  const locked = busy || state.phase === 'queued' || state.phase === 'done';
  const valid =
    mode === 'new'
      ? goal.trim().length > 0 && platforms.length > 0
      : Boolean(selectedRequest) && feedbackText.trim().length > 0;

  const label = busy
    ? t(lang, 'common.sending')
    : state.phase === 'queued'
      ? t(lang, 'common.submitted')
      : state.phase === 'done'
        ? t(lang, 'common.done')
        : state.phase === 'failed' || state.phase === 'refused'
          ? t(lang, 'new.retry')
          : mode === 'new'
            ? t(lang, 'new.start')
            : t(lang, 'new.feedbackSubmit');

  const handleSubmit = () => {
    if (!valid || locked) return;
    if (mode === 'new') {
      void submit(goal.trim(), platforms);
      return;
    }
    if (!selectedRequest) return;
    const rawPlat = selectedRequest.platform;
    const plat: StudioPlatform = (PLATFORMS as readonly string[]).includes(rawPlat)
      ? (rawPlat as StudioPlatform)
      : 'web';
    const payload = `[${selectedRequest.title}] ${feedbackText.trim()}`;
    void submit(payload, [plat]);
  };

  return (
    <View style={styles.root} testID="new-screen">
      <Header title={t(lang, 'new.title')} back />
      <Segments items={segments} value={mode} onChange={(k) => setMode(k as NewMode)} />
      {!online ? <SyncBanner kind="offline" text={t(lang, 'common.offline')} testID="offline-banner" /> : null}

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        <View style={[styles.column, desktop && styles.columnDesktop]}>
          {mode === 'new' ? (
            <>
              <View style={styles.intro}>
                {project ? (
                  <Text style={styles.eyebrow}>
                    {project.name} · {project.studioName}
                  </Text>
                ) : null}
                {!compact ? <Text style={styles.introText}>{t(lang, 'new.intro')}</Text> : null}
                {!compact && !desktop ? <Hint lang={lang} /> : null}
              </View>

              <View style={[styles.composer, desktop && styles.composerDesktop]}>
                <View style={[styles.goalCol, desktop && styles.goalColDesktop]}>
                  <Text style={styles.label}>{t(lang, 'new.goalLabel')}</Text>
                  <GoalInput
                    value={goal}
                    onChangeText={setGoal}
                    onSubmit={handleSubmit}
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
                  {/* SS-40 附件清单 AttachList 插槽 */}
                  <View style={styles.goalMeta}>
                    <Text style={styles.caption} numberOfLines={1}>
                      {restored ?? ''}
                    </Text>
                    <Text style={[styles.caption, count !== null && styles.warn]}>{count ?? ''}</Text>
                  </View>
                </View>

                <View style={[styles.platformCol, desktop && styles.platformColDesktop]}>
                  <Text style={[styles.label, styles.platformLabel]}>{t(lang, 'new.platforms')}</Text>
                  <PlatformPicker value={platforms} onChange={setPlatforms} />
                  {desktop && !compact ? <Hint lang={lang} /> : null}
                </View>
              </View>
            </>
          ) : (
            <View style={styles.feedbackSection} testID="feedback-panel">
              <Text style={styles.label}>{t(lang, 'new.feedbackPick')}</Text>
              {delivered.length === 0 ? (
                <Text style={styles.emptyText}>{t(lang, 'new.feedbackEmpty')}</Text>
              ) : (
                <View style={styles.deliveredList}>
                  {delivered.map((item) => {
                    const selected = item.id === selectedRequestId;
                    return (
                      <Pressable
                        key={item.id}
                        onPress={() => setSelectedRequestId(item.id)}
                        accessibilityRole="radio"
                        accessibilityState={{ selected }}
                        testID={`delivered-${item.id}`}
                        style={({ pressed }) => [
                          styles.deliveredRow,
                          selected && styles.deliveredRowSelected,
                          pressed && styles.pressed,
                        ]}
                      >
                        <View style={styles.deliveredText}>
                          <Text style={styles.deliveredTitle} numberOfLines={1}>
                            {item.title}
                          </Text>
                          <Text style={styles.deliveredSub} numberOfLines={1}>
                            {item.projectName} · {item.statusLine}
                          </Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              )}

              <Text style={[styles.label, styles.feedbackLabel]}>{t(lang, 'new.feedbackLabel')}</Text>
              <GoalInput
                value={feedbackText}
                onChangeText={setFeedbackText}
                onSubmit={handleSubmit}
                maxHeight={maxGoal}
                placeholder={t(lang, 'new.feedbackPlaceholder')}
                accessibilityLabel={t(lang, 'new.feedbackLabel')}
              />
              {/* SS-40 附件清单 AttachList 插槽 */}
              <View style={styles.goalMeta}>
                <View />
                <Text style={[styles.caption, count !== null && styles.warn]}>{count ?? ''}</Text>
              </View>
            </View>
          )}
        </View>
      </ScrollView>

      <ActionDock>
        {receipt ? <ReceiptLine text={receipt.text} tone={receipt.tone} /> : null}
        <PrimaryButton
          label={label}
          onPress={handleSubmit}
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
  eyebrow: { ...type.caption, fontWeight: '600', color: color.text2, letterSpacing: 0.2, marginBottom: space[3] },
  introText: { ...type.body, color: color.text2 },
  hint: {
    marginTop: space[5],
    paddingTop: space[4],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.hairline,
  },
  hintTitle: { ...type.callout, fontWeight: '500', color: color.text2, marginBottom: 6 },
  hintLine: { ...type.callout, color: color.text2, lineHeight: 21 },
  composer: { marginTop: 'auto' },
  composerDesktop: { marginTop: space[6], flexDirection: 'row', gap: space[7], alignItems: 'flex-start' },
  goalCol: { width: '100%' },
  goalColDesktop: { flex: 1 },
  platformCol: { width: '100%' },
  platformColDesktop: { width: 264 },
  label: { ...type.callout, fontWeight: '500', color: color.text2, marginBottom: space[3] },
  platformLabel: { marginTop: space[3] },
  goalMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 18,
    marginTop: space[2],
    gap: space[4],
  },
  caption: { ...type.caption, color: color.text2, flexShrink: 1 },
  warn: { color: color.warn },
  feedbackSection: { flex: 1 },
  feedbackLabel: { marginTop: space[5] },
  emptyText: { ...type.callout, color: color.text3, paddingVertical: space[3] },
  deliveredList: { gap: space[2] },
  deliveredRow: {
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: color.hairline,
    backgroundColor: color.card,
  },
  deliveredRowSelected: {
    borderColor: color.primary,
    backgroundColor: color.sunken,
  },
  pressed: { backgroundColor: color.press },
  deliveredText: { gap: 2 },
  deliveredTitle: { ...type.callout, fontWeight: '600', color: color.text },
  deliveredSub: { ...type.caption, color: color.text2 },
});
