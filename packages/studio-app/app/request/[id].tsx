import { useLocalSearchParams } from 'expo-router';
import { Layers, Send } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CardStream } from '../../components/CardStream';
import { Drawer, type DrawerTab } from '../../components/Drawer';
import { ChangesTab } from '../../components/drawer/ChangesTab';
import { OutputsTab } from '../../components/drawer/OutputsTab';
import { PlanTab } from '../../components/drawer/PlanTab';
import { PreviewTab } from '../../components/drawer/PreviewTab';
import { EmptyState } from '../../components/EmptyState';
import { Header } from '../../components/Header';
import { ReasonSheet } from '../../components/ReasonSheet';
import { Skeleton } from '../../components/Skeleton';
import { StatusDot } from '../../components/StatusDot';
import { SyncBanner } from '../../components/SyncBanner';
import { UndoBar } from '../../components/UndoBar';
import { cache } from '../../lib/cache';
import { hub, isDemoMode } from '../../lib/client';
import { useDesignUpload } from '../../lib/design-upload';
import {
  DEMO_CARDS,
  DEMO_REQUEST_SUMMARIES,
  DEMO_REQUEST_VIEW,
  DEMO_SCREENS,
  type ScreenStateKind,
} from '../../lib/demo/screens';
import { isOnline } from '../../lib/net';
import { applyLocal, localFor, type LocalPlanState } from '../../lib/plan-phase';
import { usePlanView } from '../../lib/plan-store';
import { requestViewFromPlan } from '../../lib/request-view';
import { REQUESTS_CACHE_KEY } from '../../lib/requests-source';
import { pendingKey, useSend } from '../../lib/send';
import { session } from '../../lib/session';
import { randomOpId } from '../../lib/submit';
import { undoStore } from '../../lib/undo';
import { detectLang, t } from '../../lib/strings';
import { tDrawer } from '../../lib/strings/drawer';
import { tUnderstanding } from '../../lib/strings/understanding';
import { tRequests } from '../../lib/strings/requests';
import { color, radius, space, stroke, type } from '../../lib/theme';
import { useKeyboardInset } from '../../lib/viewport';
import type { RequestMessage, RequestSummary, RequestView, StudioCard } from '../../lib/views';

function firstParam(raw: string | string[] | undefined): string {
  const val = Array.isArray(raw) ? raw[0] : raw;
  return typeof val === 'string' ? val.trim() : '';
}

const DEMO_CARDS_BY_ID: Record<string, readonly StudioCard[]> = {
  'req-login': DEMO_REQUEST_VIEW.cards,
  'req-export': [DEMO_CARDS.delivery!, DEMO_CARDS.code!],
  'req-pay': [DEMO_CARDS.steps!, DEMO_CARDS.design!],
  'req-push': [DEMO_CARDS.waitOffline!, DEMO_CARDS.steps!],
  'req-cert': [DEMO_CARDS.release!, DEMO_CARDS.code!],
  'req-home': [DEMO_CARDS.code!, DEMO_CARDS.delivery!],
  'req-quota': [DEMO_CARDS.waitQuota!, DEMO_CARDS.steps!],
  'req-human': [DEMO_CARDS.waitHuman!, DEMO_CARDS.steps!],
  'req-upload': [DEMO_CARDS.designUploading!, DEMO_CARDS.steps!],
  'req-code-failed': [DEMO_CARDS.codeFailed!, DEMO_CARDS.code!],
};

/** 按路由 id 取对应的演示需求详情；未知 id 返回 null（触发空态）。 */
export function resolveRequestView(id: string): RequestView | null {
  if (!id) return null;
  const summary = DEMO_REQUEST_SUMMARIES.find((item) => item.id === id);
  if (!summary) return null;
  return {
    ...DEMO_REQUEST_VIEW,
    summary,
    cards: [...(DEMO_CARDS_BY_ID[id] ?? DEMO_REQUEST_VIEW.cards)],
  };
}

/**
 * 本轮对话里还没被中台收下的消息：按 opId 存，中台 turn 带上同一个 opId 时移除。
 * 每条消息有自己的 opId（一个 `useSend` 发完一条就进入 done，不能连发）。
 */
interface OutboxMessage {
  readonly opId: string;
  readonly text: string;
  readonly at: number;
  readonly state: 'sending' | 'failed';
  /** 被拒（opId 在中台已终结）：重试要换一个新 opId。 */
  readonly refused?: boolean;
}

/**
 * P4 需求详情页（SS-52 / SS-184 / SS-185 / SS-223）：
 * - DEMO：按 id 取演示数据，保持原有四态与本地发消息；
 * - 非 DEMO：项目从 `?project=` 或缓存的需求列表来，`usePlanView` 拉真实计划并订阅 live；
 *   保单里没有签名的动作（chat.send / decision.answer / draft.discard / milestone.sendBack）
 *   在这里发；需要签名的卡由 card-stream-signed 接（SS-87）；
 * - 按 `?card=` 参数滚动定位与短暂高亮；对话与卡片共用同一个纵向 ScrollView。
 */
export default function RequestDetailScreen() {
  const demoMode = isDemoMode();
  const params = useLocalSearchParams<{
    id?: string | string[];
    card?: string | string[];
    state?: string | string[];
    project?: string | string[];
  }>();
  const id = firstParam(params.id);
  const targetCardId = firstParam(params.card);
  const stateParam = firstParam(params.state) as ScreenStateKind | '';
  const projectParam = firstParam(params.project);

  const lang = detectLang();
  const insets = useSafeAreaInsets();
  const keyboardInset = useKeyboardInset();
  const { width } = useWindowDimensions();
  const desktop = width >= 900;
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const cardOffsetsRef = useRef<Record<string, number>>({});

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [draft, setDraft] = useState('');
  // 输入框的同步副本：双击发送时第二下看到空文本，不会发出第二个动作。
  const draftRef = useRef('');
  const [extraMessages, setExtraMessages] = useState<RequestMessage[]>([]);
  const [outbox, setOutbox] = useState<OutboxMessage[]>([]);
  const [highlightedCardId, setHighlightedCardId] = useState<string | null>(null);
  const [local, setLocal] = useState<LocalPlanState | undefined>();
  const [reasonFor, setReasonFor] = useState<{ milestoneRef: string; draftRev: number } | null>(null);

  // 路由只带 planRef；项目从 `?project=` 或缓存的需求列表拿。DEMO 不订阅。
  const cachedRequest = useMemo<RequestSummary | undefined>(() => {
    if (demoMode) return undefined;
    const list = cache.get<RequestSummary[]>(REQUESTS_CACHE_KEY)?.value ?? [];
    return list.find((item) => item.id === id);
  }, [demoMode, id]);
  const projectId = demoMode ? '' : projectParam || cachedRequest?.projectId || '';

  const store = usePlanView(
    demoMode ? undefined : projectId || undefined,
    demoMode ? undefined : id || undefined,
  );

  const view = useMemo(
    () => (store.view ? applyLocal(store.view, localFor(store.rev, local)) : undefined),
    [store.view, store.rev, local],
  );

  // 设计稿包先上传、需求后发；卡片一直显示到包传完（传完之后是「已收下」）。
  const designUpload = useDesignUpload();
  const design = useMemo(() => {
    if (demoMode || !designUpload.info || designUpload.info.projectId !== projectId) return undefined;
    return {
      name: designUpload.info.name,
      fileCount: designUpload.info.fileCount,
      imageCount: designUpload.info.imageCount,
      specCount: designUpload.info.specCount,
      progress: designUpload.info.progress,
      done: designUpload.info.status === 'done',
    };
  }, [demoMode, designUpload.info, projectId]);

  const online = demoMode ? stateParam !== 'offline' && isOnline() : store.online;
  const loading = demoMode ? stateParam === 'loading' : store.loading && !store.view;
  const offline = demoMode
    ? stateParam === 'offline' || !isOnline()
    : !store.online || !store.studioOnline;

  const request = useMemo<RequestView | null>(() => {
    if (demoMode) {
      if (stateParam === 'empty') return null;
      if (stateParam === 'runnerOffline') return DEMO_SCREENS.P4.runnerOffline.data;
      return resolveRequestView(id);
    }
    if (!view) return null;
    return requestViewFromPlan(view, {
      projectId,
      projectName: cachedRequest?.projectName,
      platform: cachedRequest?.platform,
      lang,
      studioOnline: store.studioOnline,
      updatedAt: store.fetchedAt,
      ...(design ? { design } : {}),
    });
  }, [demoMode, id, stateParam, view, projectId, cachedRequest, lang, store.studioOnline, store.fetchedAt, design]);

  const hasTargetCard = Boolean(targetCardId && request?.cards.some((c) => c.id === targetCardId));

  useEffect(() => {
    if (!hasTargetCard) {
      setHighlightedCardId(null);
      return;
    }
    setHighlightedCardId(targetCardId);
    const y = cardOffsetsRef.current[targetCardId];
    if (typeof y === 'number') {
      scrollRef.current?.scrollTo({ y, animated: true });
    }
    const timer = setTimeout(() => setHighlightedCardId(null), 2000);
    return () => clearTimeout(timer);
  }, [hasTargetCard, targetCardId]);

  const handleCardLayout = (cardId: string, y: number) => {
    cardOffsetsRef.current[cardId] = y;
    if (hasTargetCard && cardId === targetCardId) {
      scrollRef.current?.scrollTo({ y, animated: true });
    }
  };

  // --- 发动作（非 DEMO）--------------------------------------------------------
  const decisionSend = useSend(projectId, pendingKey('decision', projectId, id));
  const discardSend = useSend(projectId, pendingKey('discard', projectId, id));
  const startSend = useSend(projectId, pendingKey('gate-start', projectId, id));
  const changesSend = useSend(projectId, pendingKey('gate-changes', projectId, id));
  const acceptSend = useSend(projectId, pendingKey('accept', projectId, id));
  const releaseSend = useSend(projectId, pendingKey('release', projectId, id));
  const chatBusy = outbox.some((item) => item.state === 'sending');
  const chatFailed = outbox.some((item) => item.state === 'failed');

  // 中台收下了消息（turn 带上同一个 opId）：移除本地气泡。
  useEffect(() => {
    const accepted = new Set((store.view?.turns ?? []).flatMap((turn) => (turn.opId ? [turn.opId] : [])));
    if (accepted.size === 0) return;
    setOutbox((prev) => prev.filter((item) => !accepted.has(item.opId)));
  }, [store.view]);

  const messages = useMemo(() => {
    const base = [...(request?.messages ?? []), ...extraMessages];
    if (demoMode) return base;
    return [
      ...base,
      ...outbox.map<RequestMessage>((item) => ({
        id: `local-${item.opId}`,
        role: 'customer',
        text: item.text,
        createdAt: item.at,
      })),
    ];
  }, [request?.messages, extraMessages, demoMode, outbox]);

  const setOutboxItem = (opId: string, patch: Partial<OutboxMessage>): void => {
    setOutbox((prev) => prev.map((item) => (item.opId === opId ? { ...item, ...patch } : item)));
  };

  const deliverChat = async (opId: string, text: string): Promise<void> => {
    const action = { t: 'action' as const, opId, kind: 'chat.send' as const, planRef: id, payload: { text } };
    let answer = await hub.send(projectId, action);
    // 断网恢复后第一个请求常撞上断网前的旧连接（立刻 “network connection was lost”）。
    // 中台按 opId 幂等，原地再发一次不会多出动作。
    if (!answer.ok && answer.error.kind === 'offline') {
      answer = await hub.send(projectId, action);
    }
    if (answer.ok) {
      if (answer.value.state === 'refused') {
        // opId 在中台已终结：保留气泡，重试时换新 opId。
        setOutboxItem(opId, { state: 'failed', refused: true });
        return;
      }
      // queued / done / expired：等中台的 turn 带上同一个 opId，再拿掉本地气泡。
      return;
    }
    if (answer.error.kind === 'signed-out') {
      session.clear();
      return;
    }
    setOutboxItem(opId, { state: 'failed' });
  };

  const sendText = (text: string): void => {
    const opId = randomOpId();
    setOutbox((prev) => [...prev, { opId, text, at: Date.now(), state: 'sending' }]);
    void deliverChat(opId, text);
  };

  /** 失败的气泡：同一个 opId 再发一次；被拒的换新 opId（中台的 opId 是终态）。 */
  const retryChat = (): void => {
    for (const item of outbox) {
      if (item.state !== 'failed') continue;
      if (item.refused) {
        const next = randomOpId();
        setOutbox((prev) =>
          prev.map((x) => (x.opId === item.opId ? { opId: next, text: item.text, at: item.at, state: 'sending' } : x)),
        );
        void deliverChat(next, item.text);
      } else {
        setOutboxItem(item.opId, { state: 'sending' });
        void deliverChat(item.opId, item.text);
      }
    }
  };

  const sendMessage = (): void => {
    const text = draftRef.current.trim();
    if (!text) return;
    // 同一 tick 清空同步副本：双击的第二下看到空文本，不会重发。
    draftRef.current = '';
    setDraft('');
    if (demoMode) {
      setExtraMessages((prev) => [
        ...prev,
        { id: `local-${Date.now()}`, role: 'customer', text, createdAt: Date.now() },
      ]);
      return;
    }
    if (!projectId) {
      draftRef.current = text;
      setDraft(text);
      return;
    }
    sendText(text);
  };

  /** 问题回答：先给 10 秒撤销窗口（与旧计划页一致），到点才发 decision.answer。 */
  const scheduleDecisionAnswer = (cardId: string, picks: string[], free: string): void => {
    undoStore.show({
      text: t(lang, 'decision.undo'),
      ms: 10_000,
      fire: () => {
        void decisionSend.send(
          (opId) => ({
            t: 'action',
            opId,
            kind: 'decision.answer',
            planRef: id,
            payload: {
              decisionId: cardId,
              ...(picks.length > 0 ? { picks } : {}),
              ...(free ? { text: free } : {}),
            },
          }),
          {
            onQueued: () =>
              setLocal((prev) => ({ ...prev, rev: store.rev, answered: [...(prev?.answered ?? []), cardId] })),
            onDone: () =>
              setLocal((prev) => ({ ...prev, rev: store.rev, answered: [...(prev?.answered ?? []), cardId] })),
          },
        );
      },
    });
  };

  const changeDraft = (value: string): void => {
    draftRef.current = value;
    setDraft(value);
  };

  const answerQuestions = (cardId: string, answers: readonly { questionId: string; picks: readonly string[]; customText?: string }[]) => {
    if (demoMode) return;
    const picks = [...new Set(answers.flatMap((answer) => answer.picks))];
    const free = answers
      .map((answer) => answer.customText?.trim())
      .filter((text): text is string => Boolean(text))
      .join('\n');
    if (picks.length === 0 && !free) return false;
    scheduleDecisionAnswer(cardId, picks, free);
  };

  const confirmUnderstanding = (cardId: string) => {
    if (demoMode) return;
    sendText(tUnderstanding(lang, 'understanding.confirmed'));
    void cardId;
  };

  const rejectUnderstanding = (cardId: string, reason: string) => {
    if (demoMode) return;
    sendText(reason);
    void cardId;
  };

  const discardDraft = (): void => {
    if (demoMode || !view?.draftDiff) return;
    const draftRev = view.draftDiff.draftRev;
    void discardSend.send(
      (opId) => ({ t: 'action', opId, kind: 'draft.discard', planRef: id, payload: { draftRev } }),
      { onQueued: () => setLocal((prev) => ({ ...prev, rev: store.rev, discarded: true })) },
    );
  };

  // --- 需要签名的动作（SS-87）：签名在 prepareActionForSend 里补，没设备密钥时按钮自己置灰 ---
  const startPlan = (): void => {
    if (demoMode || !view || !projectId) return;
    const draftRev = view.draftRev;
    void startSend.send((opId) => ({
      t: 'action',
      opId,
      kind: 'gate.answer',
      planRef: id,
      rev: store.rev,
      payload: { gate: 'start', approved: true, draftRev },
    }));
  };

  const approveChanges = (): void => {
    if (demoMode || !view || !projectId) return;
    const draftRev = view.draftRev;
    void changesSend.send((opId) => ({
      t: 'action',
      opId,
      kind: 'gate.answer',
      planRef: id,
      rev: store.rev,
      payload: { gate: 'changes', approved: true, draftRev },
    }));
  };

  const acceptDelivery = (milestoneRef: string): void => {
    if (demoMode || !view || !projectId) return;
    const draftRev = view.draftRev;
    void acceptSend.send((opId) => ({
      t: 'action',
      opId,
      kind: 'delivery.accept',
      planRef: id,
      rev: store.rev,
      payload: { milestoneRef, draftRev },
    }));
  };

  const releaseApprove = (): void => {
    if (demoMode || !view || !projectId) return;
    const draftRev = view.draftRev;
    void releaseSend.send((opId) => ({
      t: 'action',
      opId,
      kind: 'release.approve',
      planRef: id,
      rev: store.rev,
      payload: { draftRev },
    }));
  };

  const drawerTabs: readonly DrawerTab[] = useMemo(() => {
    const results = request?.results ?? DEMO_REQUEST_VIEW.results;
    return [
      {
        key: 'outputs',
        label: tDrawer(lang, 'drawer.tab.outputs'),
        render: () => <OutputsTab artifacts={results.artifacts} attachments={results.attachments} lang={lang} />,
      },
      {
        key: 'changes',
        label: tDrawer(lang, 'drawer.tab.changes'),
        render: () => (
          <ChangesTab changes={results.changes} milestones={results.plan.milestones} lang={lang} />
        ),
      },
      {
        key: 'plan',
        label: tDrawer(lang, 'drawer.tab.plan'),
        render: () => <PlanTab plan={results.plan} lang={lang} />,
      },
      {
        key: 'preview',
        label: tDrawer(lang, 'drawer.tab.preview'),
        render: () => {
          const buildItem = results.artifacts.find((a) => a.kind === 'build');
          return <PreviewTab previewUrl={results.previewUrl} installUrl={buildItem?.url} lang={lang} />;
        },
      },
    ];
  }, [lang, request?.results]);

  const openDrawerButton = request ? (
    <Pressable
      onPress={() => setDrawerOpen(true)}
      accessibilityRole="button"
      accessibilityLabel={tDrawer(lang, 'request.openResults')}
      testID="open-results-drawer"
      style={({ pressed }) => [styles.headerBtn, pressed && styles.pressed]}
    >
      <Layers size={20} color={color.text} strokeWidth={stroke} />
    </Pressable>
  ) : undefined;

  const bannerText = !online
    ? tDrawer(lang, 'request.offlineBanner')
    : tRequests(lang, 'requests.waitingRunnerOffline');

  return (
    <View style={[styles.screen, { backgroundColor: color.bg }]} testID="request-detail-screen">
      <Header
        title={request?.summary.title ?? t(lang, 'plan.titleFallback')}
        back
        right={openDrawerButton}
        rightPanel={desktop ? 360 : undefined}
      />

      {offline ? <SyncBanner kind="offline" text={bannerText} testID="offline-banner" /> : null}

      {loading ? (
        <View style={styles.loadingWrap} testID="request-loading">
          <Skeleton count={3} />
        </View>
      ) : !request ? (
        <EmptyState
          title={tDrawer(lang, 'request.emptyTitle')}
          body={tDrawer(lang, 'request.emptyBody')}
          testID="request-empty"
        />
      ) : (
        <>
          <ScrollView
            ref={scrollRef}
            style={styles.main}
            contentContainerStyle={[styles.mainContent, { paddingBottom: space[6] }]}
            keyboardShouldPersistTaps="handled"
            testID="request-detail-scroll"
          >
            <View style={[styles.statusBar, { backgroundColor: color.card, borderColor: color.hairline }]}>
              <StatusDot status={request.summary.status} />
              <Text
                style={[styles.statusLine, { color: color.text2 }]}
                numberOfLines={2}
                testID="request-status"
              >
                {request.summary.statusLine}
              </Text>
              <Pressable
                onPress={() => setDrawerOpen(true)}
                accessibilityRole="button"
                testID="request-results-pill"
                style={({ pressed }) => [
                  styles.resultsPill,
                  { backgroundColor: color.sunken },
                  pressed && styles.pressed,
                ]}
              >
                <Text style={[styles.resultsPillText, { color: color.text }]}>
                  {tDrawer(lang, 'request.openResults')}
                </Text>
              </Pressable>
            </View>

            <CardStream
              cards={request.cards}
              lang={lang}
              highlightedCardId={highlightedCardId}
              onCardLayout={handleCardLayout}
              onAnswerQuestions={answerQuestions}
              onConfirmUnderstanding={confirmUnderstanding}
              onRejectUnderstanding={rejectUnderstanding}
              onStartPlan={startPlan}
              onApproveChanges={approveChanges}
              onDeclineChanges={discardDraft}
              onAcceptDelivery={acceptDelivery}
              onNotYet={(cardId) =>
                setReasonFor({ milestoneRef: cardId, draftRev: view?.draftRev ?? 0 })
              }
              onRelease={releaseApprove}
              onOpenPreview={() => setDrawerOpen(true)}
              onOpenPlan={() => setDrawerOpen(true)}
            />

            {!demoMode && view?.draftDiff ? (
              <View style={styles.cardActions} testID="request-draft-actions">
                <Pressable
                  onPress={discardDraft}
                  accessibilityRole="button"
                  testID="request-discard-draft"
                  style={({ pressed }) => [styles.ghostBtn, pressed && styles.pressed]}
                >
                  <Text style={[styles.ghostBtnText, { color: color.text2 }]}>{t(lang, 'plan.discard')}</Text>
                </Pressable>
              </View>
            ) : null}

            <View style={styles.messagesSection} testID="request-messages">
              <Text style={[styles.sectionTitle, { color: color.text3 }]}>
                {tDrawer(lang, 'request.chatSection')}
              </Text>
              {messages.map((msg) => {
                const isCustomer = msg.role === 'customer';
                return (
                  <View
                    key={msg.id}
                    style={[
                      styles.bubble,
                      isCustomer
                        ? [styles.bubbleCustomer, { backgroundColor: color.primary }]
                        : [styles.bubbleAi, { backgroundColor: color.card, borderColor: color.hairline }],
                    ]}
                  >
                    <Text style={[styles.bubbleText, { color: isCustomer ? color.onPrimary : color.text }]}>
                      {msg.text}
                    </Text>
                  </View>
                );
              })}
              {!demoMode && view?.typing ? (
                <View style={styles.typingRow} testID="request-chat-typing">
                  <View style={styles.typingDot} />
                  <Text style={[styles.chatStatus, { color: color.text2 }]}>{t(lang, 'chat.aiWriting')}</Text>
                </View>
              ) : null}
            </View>
          </ScrollView>

          {/* 发送状态与重试放在输入框上方（不随列表滚动），失败的句子看得见也点得到 */}
          {!demoMode && (chatBusy || chatFailed) ? (
            <View style={styles.chatBar} testID="request-chat-bar">
              {chatBusy ? (
                <Text style={[styles.chatStatus, { color: color.text3 }]} testID="request-chat-status">
                  {t(lang, 'common.sending')}
                </Text>
              ) : null}
              {chatFailed ? (
                <Pressable
                  onPress={retryChat}
                  accessibilityRole="button"
                  testID="request-chat-retry"
                  style={({ pressed }) => [styles.retryBar, pressed && styles.pressed]}
                >
                  <Text style={[styles.retryBarText, { color: color.error }]}>{t(lang, 'chat.failed')}</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          {!drawerOpen ? (
            <View pointerEvents="box-none" style={keyboardInset > 0 ? { marginBottom: keyboardInset } : undefined}>
              <UndoBar />
            </View>
          ) : null}

          <View
            style={[
              styles.composer,
              {
                backgroundColor: color.bar,
                borderTopColor: color.hairline,
                paddingBottom: (keyboardInset > 0 ? keyboardInset : insets.bottom) + space[2],
              },
            ]}
            testID="request-composer"
          >
            <TextInput
              value={draft}
              onChangeText={changeDraft}
              placeholder={t(lang, 'chat.saySomething')}
              placeholderTextColor={color.text3}
              style={[styles.input, { color: color.text, backgroundColor: color.sunken, borderColor: color.hairline }]}
              testID="request-chat-input"
              accessibilityLabel={t(lang, 'chat.saySomething')}
            />
            <Pressable
              onPress={sendMessage}
              disabled={!draft.trim()}
              accessibilityRole="button"
              accessibilityLabel={t(lang, 'chat.send')}
              testID="request-chat-send"
              style={({ pressed }) => [
                styles.sendBtn,
                { backgroundColor: draft.trim() ? color.primary : color.disabledFill },
                pressed && draft.trim() ? styles.pressed : null,
              ]}
            >
              <Send
                size={18}
                color={draft.trim() ? color.onPrimary : color.text3}
                strokeWidth={stroke}
              />
            </Pressable>
          </View>

          <Drawer
            open={drawerOpen}
            onClose={() => setDrawerOpen(false)}
            title={tDrawer(lang, 'drawer.title')}
            lang={lang}
            tabs={drawerTabs}
            testID="request-results-drawer"
          />

          {!demoMode ? (
            <ReasonSheet
              open={reasonFor !== null}
              onClose={() => setReasonFor(null)}
              title={t(lang, 'reason.title')}
              lang={lang}
              pid={projectId}
              planRef={id}
              milestoneRef={reasonFor?.milestoneRef ?? ''}
              draftRev={reasonFor?.draftRev ?? 0}
              onSent={() => {
                setReasonFor(null);
                setLocal((prev) => ({
                  ...prev,
                  rev: store.rev,
                  sentBackMilestoneRef: reasonFor?.milestoneRef,
                }));
              }}
              testID="request-reason-sheet"
            />
          ) : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  loadingWrap: { padding: space[4] },
  main: { flex: 1 },
  mainContent: { padding: space[4], gap: space[4] },
  headerBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.65 },
  statusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    padding: space[3],
    borderRadius: radius.m,
    borderWidth: StyleSheet.hairlineWidth,
  },
  statusLine: { ...type.caption, flex: 1 },
  resultsPill: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: space[3],
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
  resultsPillText: { ...type.caption, fontWeight: '600' },
  cardActions: { flexDirection: 'row', justifyContent: 'flex-end' },
  ghostBtn: { minHeight: 44, paddingHorizontal: space[3], justifyContent: 'center', borderRadius: radius.pill },
  ghostBtnText: { ...type.caption, fontWeight: '600' },
  messagesSection: { gap: space[2] },
  sectionTitle: { ...type.caption, fontWeight: '600' },
  chatStatus: { ...type.caption, alignSelf: 'flex-end' },
  chatBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: space[3],
    paddingHorizontal: space[4],
    paddingVertical: space[1],
    backgroundColor: color.bar,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.hairline,
  },
  retryBar: { minHeight: 44, paddingHorizontal: space[3], justifyContent: 'center', borderRadius: radius.pill },
  retryBarText: { ...type.caption, fontWeight: '600' },
  typingRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  typingDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: color.ok },
  bubble: {
    maxWidth: '85%',
    paddingVertical: space[2],
    paddingHorizontal: space[3],
    borderRadius: radius.m,
  },
  bubbleCustomer: { alignSelf: 'flex-end' },
  bubbleAi: { alignSelf: 'flex-start', borderWidth: StyleSheet.hairlineWidth },
  bubbleText: { ...type.callout },
  composer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    paddingHorizontal: space[4],
    paddingTop: space[2],
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    minHeight: 44,
    fontSize: 16,
    lineHeight: 22,
    borderWidth: 1,
    borderRadius: radius.m,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.m,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
