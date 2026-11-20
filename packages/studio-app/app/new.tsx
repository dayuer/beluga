import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { ActionDock } from '../components/ActionDock';
import { AttachList } from '../components/AttachList';
import { DesignCard } from '../components/cards/DesignCard';
import { GoalInput } from '../components/GoalInput';
import { PackageManifest } from '../components/PackageManifest';
import { Header } from '../components/Header';
import { PlatformPicker } from '../components/PlatformPicker';
import { PrimaryButton } from '../components/PrimaryButton';
import { ReceiptLine, type ReceiptTone } from '../components/ReceiptLine';
import { Segments, type SegmentItem } from '../components/Segments';
import { SyncBanner } from '../components/SyncBanner';
import { UndoBar } from '../components/UndoBar';
import { LIMITS, type StudioPlatform } from '../../../src/studio/protocol';
import { useScheme } from '../lib/appearance';
import { cache } from '../lib/cache';
import { hub, isDemoMode } from '../lib/client';
import { DEMO_SCREENS } from '../lib/demo';
import { useDesignUpload } from '../lib/design-upload';
import { pickDesignPackage, type PackageEntry, type PickedPackage } from '../lib/package-pick';
import type { ProjectSummary } from '../lib/hub-schema';
import { pickPhotos, takePhoto, type MediaAttachment } from '../lib/media';
import { useOnline } from '../lib/net';
import {
  clearFeedbackModeDraft,
  clearNewModeDraft,
  restoreBothDrafts,
  writeFeedbackModeDraft,
  writeNewModeDraft,
} from '../lib/new-drafts';
import { loadRequestsFromHub, REQUESTS_CACHE_KEY } from '../lib/requests-source';
import { pendingKey, useSend } from '../lib/send';
import { session } from '../lib/session';
import { detectLang, t, type Lang } from '../lib/strings';
import { packageT } from '../lib/strings/package';
import { refusalKey, useNewRequest, type SubmitState } from '../lib/submit';
import { ago } from '../lib/time';
import { color, radius, space, type } from '../lib/theme';
import { useKeyboardInset } from '../lib/viewport';
import { appendSpoken, useVoiceDictation } from '../lib/voice';
import type { RequestSummary } from '../lib/views';

type NewMode = 'new' | 'feedback';

interface SelectableProject {
  readonly id: string;
  readonly name: string;
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

function Hint({ lang, styles }: { lang: Lang; styles: ReturnType<typeof createStyles> }) {
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
 * P2 提需求（SS-38 / SS-196 / SS-197）：
 * - 顶部分段「新需求」/「对做好的提意见」，两档各自保留文字与附件草稿；
 * - 支持项目切换与「从例子开始」；
 * - 「对做好的提意见」使用协议 `chat.send` 发给对应已交付需求并跳转 `/request/<id>`。
 */
export default function NewRequestScreen() {
  useScheme();
  const styles = createStyles();
  const router = useRouter();
  const params = useLocalSearchParams<{ project?: string | string[] }>();
  const routePid = Array.isArray(params.project) ? params.project[0] : params.project;
  const demoMode = isDemoMode();
  const lang = detectLang();
  const online = useOnline();
  const { width, height } = useWindowDimensions();
  const keyboard = useKeyboardInset();
  const desktop = width >= 900;

  const [projects, setProjects] = useState<readonly SelectableProject[]>(() => {
    if (demoMode) return DEMO_SCREENS.P2.normal.data.projects;
    return cache.get<ProjectSummary[]>('projects')?.value ?? [];
  });
  const [pid, setPid] = useState<string>(
    () => routePid || projects[0]?.id || '',
  );

  const [delivered, setDelivered] = useState<readonly RequestSummary[]>(() => {
    if (demoMode) return DEMO_SCREENS.P2.normal.data.completedRequests;
    const cached = cache.get<RequestSummary[]>(REQUESTS_CACHE_KEY)?.value ?? [];
    return cached.filter((r) => r.status === 'done');
  });

  const examples = useMemo(
    () => (demoMode ? DEMO_SCREENS.P2.normal.data.examples : []),
    [demoMode],
  );

  const [mode, setMode] = useState<NewMode>('new');
  const [goal, setGoal] = useState('');
  const [platforms, setPlatforms] = useState<StudioPlatform[]>([]);
  const [restored, setRestored] = useState<string | null>(null);
  const [selectedRequestId, setSelectedRequestId] = useState<string>(
    () => delivered[0]?.id ?? '',
  );
  const [feedbackText, setFeedbackText] = useState('');
  const [newAttachments, setNewAttachments] = useState<readonly MediaAttachment[]>([]);
  const [feedbackAttachments, setFeedbackAttachments] = useState<readonly MediaAttachment[]>([]);
  const [mediaHint, setMediaHint] = useState<string | null>(null);
  const [designPkg, setDesignPkg] = useState<PickedPackage | null>(null);
  const [manifestOpen, setManifestOpen] = useState(false);
  const [packageHint, setPackageHint] = useState<string | null>(null);
  const design = useDesignUpload();

  const lockedRef = useRef(false);
  const hydratedPidRef = useRef<string | null>(null);

  useEffect(() => {
    if (demoMode) return;
    let alive = true;
    void hub.projects().then((r) => {
      if (!alive || !r.ok) return;
      cache.set('projects', r.value.projects, Date.now());
      setProjects(r.value.projects);
      setPid((cur) => cur || r.value.projects[0]?.id || '');
    });
    void loadRequestsFromHub({
      hub,
      cache,
      onSignedOut: () => session.clear(),
      lang,
    }).then((outcome) => {
      if (!alive) return;
      if (outcome.kind === 'ok' || ((outcome.kind === 'offline' || outcome.kind === 'error') && outcome.items)) {
        const done = (outcome.items ?? []).filter((item) => item.status === 'done');
        setDelivered(done);
        setSelectedRequestId((cur) => cur || done[0]?.id || '');
      }
    });
    return () => {
      alive = false;
    };
  }, [demoMode, lang]);

  // 独立恢复两档草稿（含附件），互不跳过、互不覆盖
  useEffect(() => {
    if (!pid) return;
    hydratedPidRef.current = null;
    const { newDraft, feedbackDraft } = restoreBothDrafts(pid);

    let timer: ReturnType<typeof setTimeout> | undefined;
    if (newDraft) {
      setGoal(newDraft.goal);
      setPlatforms(newDraft.platforms);
      setNewAttachments(newDraft.attachments);
      setRestored(t(lang, 'new.restored', { ago: ago(newDraft.updatedAt, lang) }));
      timer = setTimeout(() => setRestored(null), 3000);
    } else {
      setGoal('');
      setPlatforms([]);
      setNewAttachments([]);
    }

    if (feedbackDraft) {
      if (feedbackDraft.requestId) setSelectedRequestId(feedbackDraft.requestId);
      setFeedbackText(feedbackDraft.text);
      setFeedbackAttachments(feedbackDraft.attachments);
    } else {
      setFeedbackText('');
      setFeedbackAttachments([]);
    }

    hydratedPidRef.current = pid;
    return () => {
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pid]);

  useEffect(() => {
    if (!pid || hydratedPidRef.current !== pid) return;
    const id = setTimeout(() => {
      if (lockedRef.current || hydratedPidRef.current !== pid) return;
      writeNewModeDraft(pid, {
        goal,
        platforms,
        attachments: newAttachments,
        updatedAt: Date.now(),
      });
    }, 300);
    return () => clearTimeout(id);
  }, [pid, goal, platforms, newAttachments]);

  useEffect(() => {
    if (!pid || hydratedPidRef.current !== pid) return;
    const id = setTimeout(() => {
      if (lockedRef.current || hydratedPidRef.current !== pid) return;
      writeFeedbackModeDraft(pid, {
        requestId: selectedRequestId,
        text: feedbackText,
        attachments: feedbackAttachments,
        updatedAt: Date.now(),
      });
    }, 300);
    return () => clearTimeout(id);
  }, [pid, selectedRequestId, feedbackText, feedbackAttachments]);

  useEffect(() => {
    if (!pid) return;
    const flush = () => {
      if (lockedRef.current || hydratedPidRef.current !== pid) return;
      writeNewModeDraft(pid, {
        goal,
        platforms,
        attachments: newAttachments,
        updatedAt: Date.now(),
      });
      writeFeedbackModeDraft(pid, {
        requestId: selectedRequestId,
        text: feedbackText,
        attachments: feedbackAttachments,
        updatedAt: Date.now(),
      });
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
  }, [pid, goal, platforms, newAttachments, selectedRequestId, feedbackText, feedbackAttachments]);

  const onNewDone = useCallback(() => {
    if (pid) clearNewModeDraft(pid);
    router.replace('/');
  }, [pid, router]);

  const { state: newState, submit: submitNew } = useNewRequest(pid, onNewDone);

  const selectedRequest = delivered.find((r) => r.id === selectedRequestId);
  const feedbackSend = useSend(
    selectedRequest?.projectId ?? pid,
    pendingKey('chat', selectedRequest?.projectId ?? pid, selectedRequest?.id ?? 'none'),
  );

  const activePhase = mode === 'new' ? newState.phase : feedbackSend.state.phase;
  lockedRef.current = activePhase === 'queued' || activePhase === 'done';

  useEffect(() => {
    if (pid && (newState.phase === 'queued' || newState.phase === 'done')) {
      clearNewModeDraft(pid);
    }
  }, [pid, newState.phase]);

  useEffect(() => {
    if (pid && (feedbackSend.state.phase === 'queued' || feedbackSend.state.phase === 'done')) {
      clearFeedbackModeDraft(pid);
    }
  }, [pid, feedbackSend.state.phase]);

  const segments: readonly SegmentItem[] = useMemo(
    () => [
      { key: 'new', label: t(lang, 'new.tabNew'), testID: 'seg-new' },
      { key: 'feedback', label: t(lang, 'new.tabFeedback'), testID: 'seg-feedback' },
    ],
    [lang],
  );

  const visibleHeight = Math.max(240, height - keyboard);
  const compact = keyboard > 0;
  const maxGoal = Math.max(120, Math.round(visibleHeight * 0.4));
  const activeText = mode === 'new' ? goal : feedbackText;
  const count =
    activeText.length >= 3600 ? t(lang, 'new.left', { n: LIMITS.text - activeText.length }) : null;

  const activeState: SubmitState = mode === 'new' ? newState : (feedbackSend.state as SubmitState);
  const receipt = useMemo(() => receiptOf(activeState, lang), [activeState, lang]);
  const busy = activeState.phase === 'sending';
  const locked = busy || activeState.phase === 'queued' || activeState.phase === 'done';
  const valid =
    mode === 'new'
      ? Boolean(pid) && goal.trim().length > 0 && platforms.length > 0
      : Boolean(selectedRequest) && feedbackText.trim().length > 0;

  const voice = useVoiceDictation({
    lang,
    onTranscript: (spoken) => {
      if (mode === 'new') setGoal((prev) => appendSpoken(prev, spoken));
      else setFeedbackText((prev) => appendSpoken(prev, spoken));
    },
  });

  const label = busy
    ? t(lang, 'common.sending')
    : activeState.phase === 'queued'
      ? t(lang, 'common.submitted')
      : activeState.phase === 'done'
        ? t(lang, 'common.done')
        : activeState.phase === 'failed' || activeState.phase === 'refused'
          ? t(lang, 'new.retry')
          : mode === 'new'
            ? t(lang, 'new.start')
            : t(lang, 'new.feedbackSubmit');

  const setModeAttachments = (
    updater: (prev: readonly MediaAttachment[]) => readonly MediaAttachment[],
  ) => {
    if (mode === 'new') setNewAttachments(updater);
    else setFeedbackAttachments(updater);
  };

  /** 「设计稿包」：选包 → 清单 → 开始后台分块上传；需求可以先发，上传不挡发送。 */
  const pickPackage = async () => {
    setPackageHint(null);
    try {
      const picked = await pickDesignPackage('zip');
      if (picked.canceled) return;
      setDesignPkg(picked.pkg);
      setManifestOpen(true);
    } catch {
      setPackageHint(packageT(lang, 'package.pickFailed'));
    }
  };

  const confirmPackage = (entries: readonly PackageEntry[]) => {
    setManifestOpen(false);
    if (!designPkg) return;
    const targetProject = mode === 'feedback' ? (selectedRequest?.projectId ?? pid) : pid;
    if (!targetProject) return;
    const current = design.uploader.machine.getState();
    // 同一个包再打开清单后确认：还在传/已经传完的不要重来
    if (current && current.projectId === targetProject && current.name === designPkg.name && current.status !== 'failed') {
      return;
    }
    void design.uploader.start({ projectId: targetProject, name: designPkg.name, entries });
  };

  const designCard = useMemo(
    () =>
      design.info
        ? {
            id: 'design-upload',
            kind: 'design' as const,
            createdAt: 0,
            status: design.info.status === 'done' ? ('done' as const) : ('pending' as const),
            fileCount: design.info.fileCount,
            totalBytes: design.info.totalBytes,
            imageCount: design.info.imageCount,
            specCount: design.info.specCount,
            skipped: [] as { name: string; reason: string }[],
            packageName: design.info.name,
            progress: design.info.progress,
          }
        : null,
    [design.info],
  );

  const designPackageBlock = (
    <View style={styles.packageBlock} testID="design-package-block">
      <View style={styles.chipRow}>
        <Pressable
          onPress={() => void pickPackage()}
          disabled={locked}
          accessibilityRole="button"
          testID="pick-package"
          style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
        >
          <Text style={styles.chipText}>{packageT(lang, 'package.add')}</Text>
        </Pressable>
        {designPkg ? (
          <Pressable
            onPress={() => setManifestOpen(true)}
            accessibilityRole="button"
            testID="view-package-manifest"
            style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
          >
            <Text style={styles.chipText}>{packageT(lang, 'package.viewManifest')}</Text>
          </Pressable>
        ) : null}
      </View>
      {packageHint ? <Text style={styles.caption}>{packageHint}</Text> : null}
      {designCard ? <DesignCard card={designCard} lang={lang} testID="design-upload-card" /> : null}
    </View>
  );

  const addFromCamera = async () => {
    setMediaHint(null);
    const res = await takePhoto(lang);
    if (!res.ok) {
      if (res.reason !== 'cancelled') setMediaHint(res.message);
      return;
    }
    setModeAttachments((prev) => [...prev, ...res.items]);
  };

  const addFromLibrary = async () => {
    setMediaHint(null);
    const res = await pickPhotos(lang);
    if (!res.ok) {
      if (res.reason !== 'cancelled') setMediaHint(res.message);
      return;
    }
    setModeAttachments((prev) => [...prev, ...res.items]);
  };

  const removeAttachment = (id: string) => {
    setModeAttachments((prev) => prev.filter((item) => item.id !== id));
  };

  const restoreAttachment = (item: MediaAttachment, index: number) => {
    setModeAttachments((prev) => {
      if (prev.some((p) => p.id === item.id)) return prev;
      const next = [...prev];
      next.splice(Math.min(index, next.length), 0, item);
      return next;
    });
  };

  const handleSubmit = () => {
    if (!valid || locked) return;
    if (mode === 'new') {
      void submitNew(goal.trim(), platforms);
      return;
    }
    if (!selectedRequest) return;
    const text = feedbackText.trim();
    const targetId = selectedRequest.id;
    void feedbackSend.send(
      (opId) => ({
        t: 'action',
        opId,
        kind: 'chat.send',
        planRef: targetId,
        payload: { text },
      }),
      {
        onDone: () => {
          if (pid) clearFeedbackModeDraft(pid);
          router.replace(`/request/${encodeURIComponent(targetId)}`);
        },
        onQueued: () => {
          if (pid) clearFeedbackModeDraft(pid);
          router.replace(`/request/${encodeURIComponent(targetId)}`);
        },
      },
    );
  };

  return (
    <View style={styles.root} testID="new-screen">
      <Header title={t(lang, 'new.title')} back />
      <Segments items={segments} value={mode} onChange={(k) => setMode(k as NewMode)} />
      {!online ? (
        <SyncBanner kind="offline" text={t(lang, 'common.offline')} testID="offline-banner" />
      ) : null}

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        <View style={[styles.column, desktop && styles.columnDesktop]}>
          {mode === 'new' ? (
            <>
              {projects.length > 0 ? (
                <View style={styles.projectSection} testID="new-project-picker">
                  <Text style={styles.label}>{t(lang, 'new.projectLabel')}</Text>
                  <View style={styles.chipRow}>
                    {projects.map((p) => {
                      const selected = p.id === pid;
                      return (
                        <Pressable
                          key={p.id}
                          onPress={() => setPid(p.id)}
                          accessibilityRole="radio"
                          accessibilityState={{ selected }}
                          testID={`new-project-${p.id}`}
                          style={({ pressed }) => [
                            styles.chip,
                            selected && styles.chipSelected,
                            pressed && styles.pressed,
                          ]}
                        >
                          <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                            {p.name}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ) : null}

              <View style={styles.intro}>
                {!compact ? <Text style={styles.introText}>{t(lang, 'new.intro')}</Text> : null}
                {!compact && !desktop ? <Hint lang={lang} styles={styles} /> : null}
              </View>

              {examples.length > 0 ? (
                <View style={styles.examplesSection} testID="new-examples">
                  <Text style={styles.label}>{t(lang, 'new.examplesLabel')}</Text>
                  <View style={styles.chipRow}>
                    {examples.map((ex, i) => (
                      <Pressable
                        key={ex}
                        onPress={() => setGoal(ex)}
                        accessibilityRole="button"
                        testID={`new-example-${i}`}
                        style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
                      >
                        <Text style={styles.chipText}>{ex}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              ) : null}

              <View style={[styles.composer, desktop && styles.composerDesktop]}>
                <View style={[styles.goalCol, desktop && styles.goalColDesktop]}>
                  <Text style={styles.label}>{t(lang, 'new.goalLabel')}</Text>
                  <GoalInput
                    value={goal}
                    onChangeText={setGoal}
                    onSubmit={handleSubmit}
                    voice={{
                      listening: voice.phase !== 'idle',
                      onStart: () => void voice.start(),
                      onStop: () => void voice.stop(),
                      onCancel: voice.cancel,
                      hint: voice.hint,
                      disabled: locked,
                    }}
                    onBlur={() => {
                      if (!pid || lockedRef.current || hydratedPidRef.current !== pid) return;
                      writeNewModeDraft(pid, {
                        goal,
                        platforms,
                        attachments: newAttachments,
                        updatedAt: Date.now(),
                      });
                    }}
                    maxHeight={maxGoal}
                    lang={lang}
                    placeholder={t(lang, 'new.goalPlaceholder')}
                    accessibilityLabel={t(lang, 'new.goalLabel')}
                  />
                  <AttachList
                    items={newAttachments}
                    onAddCamera={() => void addFromCamera()}
                    onAddLibrary={() => void addFromLibrary()}
                    onRemove={removeAttachment}
                    onRestore={restoreAttachment}
                    permissionHint={mediaHint}
                    lang={lang}
                    disabled={locked}
                  />
                  {designPackageBlock}
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
                  {desktop && !compact ? <Hint lang={lang} styles={styles} /> : null}
                </View>
              </View>
            </>
          ) : (
            <View style={styles.feedbackSection} testID="feedback-panel">
              <Text style={styles.label}>{t(lang, 'new.feedbackPick')}</Text>
              {delivered.length === 0 ? (
                <Text style={styles.emptyText} testID="feedback-empty">
                  {t(lang, 'new.feedbackEmpty')}
                </Text>
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
                voice={{
                  listening: voice.phase !== 'idle',
                  onStart: () => void voice.start(),
                  onStop: () => void voice.stop(),
                  onCancel: voice.cancel,
                  hint: voice.hint,
                  disabled: locked,
                }}
                lang={lang}
                maxHeight={maxGoal}
                placeholder={t(lang, 'new.feedbackPlaceholder')}
                accessibilityLabel={t(lang, 'new.feedbackLabel')}
              />
              <AttachList
                items={feedbackAttachments}
                onAddCamera={() => void addFromCamera()}
                onAddLibrary={() => void addFromLibrary()}
                onRemove={removeAttachment}
                onRestore={restoreAttachment}
                permissionHint={mediaHint}
                lang={lang}
                disabled={locked}
              />
              {designPackageBlock}
              <View style={styles.goalMeta}>
                <View />
                <Text style={[styles.caption, count !== null && styles.warn]}>{count ?? ''}</Text>
              </View>
            </View>
          )}
        </View>
      </ScrollView>

      <PackageManifest
        open={manifestOpen}
        pkg={designPkg}
        onClose={() => setManifestOpen(false)}
        onConfirm={confirmPackage}
      />

      <UndoBar />
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

const createStyles = () => StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1, paddingHorizontal: space[5], paddingTop: space[5], paddingBottom: space[6] },
  column: { flex: 1, width: '100%' },
  columnDesktop: { maxWidth: 720, alignSelf: 'center', paddingTop: space[4] },
  projectSection: { marginBottom: space[4] },
  examplesSection: { marginBottom: space[4] },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  chip: {
    minHeight: 44,
    paddingHorizontal: space[3],
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: color.hairline,
    backgroundColor: color.card,
    justifyContent: 'center',
  },
  chipSelected: { borderColor: color.primary, backgroundColor: color.sunken },
  chipText: { ...type.callout, color: color.text2 },
  chipTextSelected: { color: color.text, fontWeight: '600' },
  intro: { marginBottom: space[5] },
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
  packageBlock: { gap: space[2], marginTop: space[3] },
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
