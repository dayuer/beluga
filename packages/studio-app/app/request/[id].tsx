import { useLocalSearchParams } from 'expo-router';
import { Layers } from 'lucide-react-native';
import { useMemo, useState, type ComponentProps } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CardStream } from '../../components/CardStream';
import { Drawer, type DrawerTab } from '../../components/Drawer';
import { ChangesTab } from '../../components/drawer/ChangesTab';
import { OutputsTab } from '../../components/drawer/OutputsTab';
import { PlanTab } from '../../components/drawer/PlanTab';
import { PreviewTab } from '../../components/drawer/PreviewTab';
import { Header } from '../../components/Header';
import { PlanChat } from '../../components/PlanChat';
import { StatusDot } from '../../components/StatusDot';
import { DEMO_REQUEST_SUMMARIES, DEMO_REQUEST_VIEW } from '../../lib/demo/screens';
import { detectLang, t } from '../../lib/strings';
import { color, radius, space, stroke, type } from '../../lib/theme';
import type { RequestMessage } from '../../lib/views';

function messagesToTurns(messages: readonly RequestMessage[]): ComponentProps<typeof PlanChat>['turns'] {
  return messages.map((m) => ({
    id: m.id,
    who: m.role,
    text: m.text,
    at: m.createdAt,
  }));
}

/**
 * P4 需求详情页（SS-52）：顶部状态 + 卡片流（CardStream）+ 对话（PlanChat）+ P12 结果抽屉（传入四个页签）。
 */
export default function RequestDetailScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const lang = detectLang();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const desktop = width >= 900;
  const [drawerOpen, setDrawerOpen] = useState(false);

  const request = useMemo(() => {
    const matched = id ? DEMO_REQUEST_SUMMARIES.find((item) => item.id === id) : undefined;
    return matched ? { ...DEMO_REQUEST_VIEW, summary: matched } : DEMO_REQUEST_VIEW;
  }, [id]);

  const turns = useMemo(() => messagesToTurns(request.messages), [request.messages]);

  const drawerTabs: readonly DrawerTab[] = useMemo(
    () => [
      {
        key: 'plan',
        label: t(lang, 'drawer.tab.plan'),
        render: () => <PlanTab plan={request.results.plan} lang={lang} />,
      },
      {
        key: 'outputs',
        label: t(lang, 'drawer.tab.outputs'),
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
        label: t(lang, 'drawer.tab.changes'),
        render: () => (
          <ChangesTab
            changes={request.results.changes}
            milestones={request.results.plan.milestones}
            lang={lang}
          />
        ),
      },
      {
        key: 'preview',
        label: t(lang, 'drawer.tab.preview'),
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
      accessibilityLabel={t(lang, 'request.openResults')}
      testID="open-results-drawer"
      style={({ pressed }) => [styles.headerBtn, pressed && styles.pressed]}
    >
      <Layers size={20} color={color.text} strokeWidth={stroke} />
    </Pressable>
  );

  return (
    <View style={[styles.screen, { backgroundColor: color.bg }]} testID="request-detail-screen">
      <Header title={request.summary.title} back right={openDrawerButton} rightPanel={desktop ? 360 : undefined} />

      <View style={styles.body}>
        <ScrollView
          style={styles.main}
          contentContainerStyle={[styles.mainContent, { paddingBottom: insets.bottom + space[6] }]}
          keyboardShouldPersistTaps="handled"
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
              <Text style={[styles.resultsPillText, { color: color.text }]}>{t(lang, 'request.openResults')}</Text>
            </Pressable>
          </View>

          <CardStream cards={request.cards} lang={lang} />

          {!desktop ? (
            <View style={[styles.chatBox, { backgroundColor: color.card, borderColor: color.hairline }]}>
              <Text style={[styles.chatTitle, { color: color.text }]}>{t(lang, 'request.chatSection')}</Text>
              <View style={styles.chatInner}>
                <PlanChat
                  pid={request.summary.projectId}
                  planRef={request.summary.id}
                  turns={turns}
                  typing={false}
                  moreTurns={false}
                  lang={lang}
                  docked
                />
              </View>
            </View>
          ) : null}
        </ScrollView>

        {desktop ? (
          <View style={[styles.sideChat, { borderLeftColor: color.hairline, backgroundColor: color.card }]}>
            <PlanChat
              pid={request.summary.projectId}
              planRef={request.summary.id}
              turns={turns}
              typing={false}
              moreTurns={false}
              lang={lang}
              docked
            />
          </View>
        ) : null}
      </View>

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={t(lang, 'drawer.title')}
        tabs={drawerTabs}
        testID="request-results-drawer"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { flex: 1, flexDirection: 'row', minHeight: 0 },
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
    paddingHorizontal: space[3],
    paddingVertical: space[1],
    borderRadius: radius.pill,
  },
  resultsPillText: { ...type.caption, fontWeight: '600' },
  chatBox: {
    borderRadius: radius.l,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  chatTitle: {
    ...type.heading,
    paddingHorizontal: space[4],
    paddingTop: space[3],
    paddingBottom: space[1],
  },
  chatInner: { height: 280 },
  sideChat: { width: 360, borderLeftWidth: StyleSheet.hairlineWidth },
});
