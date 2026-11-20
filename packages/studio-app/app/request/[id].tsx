import { useLocalSearchParams } from 'expo-router';
import { Layers, Send } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CardStream } from '../../components/CardStream';
import { Drawer, type DrawerTab } from '../../components/Drawer';
import { ChangesTab } from '../../components/drawer/ChangesTab';
import { OutputsTab } from '../../components/drawer/OutputsTab';
import { PlanTab } from '../../components/drawer/PlanTab';
import { PreviewTab } from '../../components/drawer/PreviewTab';
import { Header } from '../../components/Header';
import { StatusDot } from '../../components/StatusDot';
import { UndoBar } from '../../components/UndoBar';
import { DEMO_REQUEST_SUMMARIES, DEMO_REQUEST_VIEW } from '../../lib/demo/screens';
import { detectLang, t } from '../../lib/strings';
import { tDrawer } from '../../lib/strings/drawer';
import { color, radius, space, stroke, type } from '../../lib/theme';
import { useKeyboardInset } from '../../lib/viewport';
import type { RequestMessage } from '../../lib/views';

/**
 * P4 需求详情页（SS-52 / SS-184）：
 * - 对话消息与 CardStream 共用同一个纵向 ScrollView（无嵌套纵向滚动），底部固定输入条随键盘上移；
 * - 抽屉页签按 成果、改动、计划、预览 顺序；
 * - 挂载 UndoBar 随键盘上移，抽屉打开时让位不遮挡。
 */
export default function RequestDetailScreen() {
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const rawId = Array.isArray(id) ? id[0] : id;
  const lang = detectLang();
  const insets = useSafeAreaInsets();
  const keyboardInset = useKeyboardInset();
  const { width } = useWindowDimensions();
  const desktop = width >= 900;
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [draft, setDraft] = useState('');

  const request = useMemo(() => {
    const matched = rawId ? DEMO_REQUEST_SUMMARIES.find((item) => item.id === rawId) : undefined;
    return matched ? { ...DEMO_REQUEST_VIEW, summary: matched } : DEMO_REQUEST_VIEW;
  }, [rawId]);

  const [extraMessages, setExtraMessages] = useState<RequestMessage[]>([]);
  const messages = useMemo(() => [...request.messages, ...extraMessages], [request.messages, extraMessages]);

  const sendMessage = () => {
    const text = draft.trim();
    if (!text) return;
    setExtraMessages((prev) => [
      ...prev,
      { id: `local-${Date.now()}`, role: 'customer', text, createdAt: Date.now() },
    ]);
    setDraft('');
  };

  const drawerTabs: readonly DrawerTab[] = useMemo(
    () => [
      {
        key: 'outputs',
        label: tDrawer(lang, 'drawer.tab.outputs'),
        render: () => (
          <OutputsTab
            artifacts={request.results.artifacts}
            attachments={request.results.attachments}
            lang={lang}
          />
        ),
      },
      {
        key: 'changes',
        label: tDrawer(lang, 'drawer.tab.changes'),
        render: () => (
          <ChangesTab
            changes={request.results.changes}
            milestones={request.results.plan.milestones}
            lang={lang}
          />
        ),
      },
      {
        key: 'plan',
        label: tDrawer(lang, 'drawer.tab.plan'),
        render: () => <PlanTab plan={request.results.plan} lang={lang} />,
      },
      {
        key: 'preview',
        label: tDrawer(lang, 'drawer.tab.preview'),
        render: () => {
          const buildItem = request.results.artifacts.find((a) => a.kind === 'build');
          return (
            <PreviewTab
              previewUrl={request.results.previewUrl}
              installUrl={buildItem?.url}
              lang={lang}
            />
          );
        },
      },
    ],
    [lang, request.results],
  );

  const openDrawerButton = (
    <Pressable
      onPress={() => setDrawerOpen(true)}
      accessibilityRole="button"
      accessibilityLabel={tDrawer(lang, 'request.openResults')}
      testID="open-results-drawer"
      style={({ pressed }) => [styles.headerBtn, pressed && styles.pressed]}
    >
      <Layers size={20} color={color.text} strokeWidth={stroke} />
    </Pressable>
  );

  return (
    <View style={[styles.screen, { backgroundColor: color.bg }]} testID="request-detail-screen">
      <Header title={request.summary.title} back right={openDrawerButton} rightPanel={desktop ? 360 : undefined} />

      <ScrollView
        style={styles.main}
        contentContainerStyle={[styles.mainContent, { paddingBottom: space[6] }]}
        keyboardShouldPersistTaps="handled"
        testID="request-detail-scroll"
      >
        <View style={[styles.statusBar, { backgroundColor: color.card, borderColor: color.hairline }]}>
          <StatusDot status={request.summary.status} />
          <Text style={[styles.statusLine, { color: color.text2 }]} numberOfLines={2}>
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
            <Text style={[styles.resultsPillText, { color: color.text }]}>{tDrawer(lang, 'request.openResults')}</Text>
          </Pressable>
        </View>

        <CardStream cards={request.cards} lang={lang} />

        <View style={styles.messagesSection} testID="request-messages">
          <Text style={[styles.sectionTitle, { color: color.text3 }]}>{tDrawer(lang, 'request.chatSection')}</Text>
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
        </View>
      </ScrollView>

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
          onChangeText={setDraft}
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
          <Send size={18} color={draft.trim() ? color.onPrimary : color.text3} strokeWidth={stroke} />
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
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
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
    paddingHorizontal: space[3],
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
  resultsPillText: { ...type.caption, fontWeight: '600' },
  messagesSection: { gap: space[2] },
  sectionTitle: { ...type.caption, fontWeight: '600' },
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
