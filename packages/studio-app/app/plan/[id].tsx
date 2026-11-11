import { useLocalSearchParams, useRouter } from 'expo-router';
import { Minus, Plus } from 'lucide-react-native';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ActivityList } from '../../components/ActivityList';
import { EmptyState } from '../../components/EmptyState';
import { Header } from '../../components/Header';
import { PlanHeader } from '../../components/PlanHeader';
import { Segments, type SegmentItem } from '../../components/Segments';
import { Skeleton } from '../../components/Skeleton';
import { SyncBanner } from '../../components/SyncBanner';
import { TextButton } from '../../components/TextButton';
import { PlanMap } from '../../components/plan/PlanMap';
import { PlanOutline } from '../../components/plan/PlanOutline';
import { MilestoneSheet } from '../../components/plan/MilestoneSheet';
import { kv } from '../../lib/kv';
import { currentMilestone, mapItems, outlineOf } from '../../lib/plan-graph';
import { pagePhase } from '../../lib/plan-phase';
import { usePlanView } from '../../lib/plan-store';
import { detectLang, t } from '../../lib/strings';
import { color, radius, space, type } from '../../lib/theme';
import { ago } from '../../lib/time';

const ZOOMS = [0.8, 1, 1.25] as const;
type TabKey = 'map' | 'outline' | 'activity';

const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

/**
 * The customer's plan page (M6 §4): headline and progress, the map / outline / activity tabs,
 * the milestone detail sheet, and — added by BLG-92/93/96 — the chat entry, the one primary action
 * and the draft diff. Data is the hub view, kept current by the shared live socket.
 */
export default function PlanScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string | string[]; project?: string | string[] }>();
  const ref = first(params.id);
  const queryPid = first(params.project);
  const [remembered] = useState(() => (ref ? kv.get<string>(`plan-project:${ref}`) : undefined));
  const pid = queryPid ?? remembered;
  const lang = detectLang();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const desktop = width >= 900;
  const store = usePlanView(pid, ref);
  const view = store.view;
  const phase = view ? pagePhase(view) : undefined;
  const [tab, setTab] = useState<TabKey>('map');
  const [picked, setPicked] = useState<string | undefined>();
  const [menu, setMenu] = useState(false);
  const [openMilestones, setOpenMilestones] = useState<readonly string[]>([]);
  const [zoomIndex, setZoomIndex] = useState(() => {
    const saved = kv.get<number>('plan-zoom');
    const found = ZOOMS.indexOf(saved as (typeof ZOOMS)[number]);
    return found >= 0 ? found : 1;
  });
  const defaulted = useRef(false);

  useEffect(() => {
    if (pid && ref) kv.set(`plan-project:${ref}`, pid);
  }, [pid, ref]);

  // Open where the work is on the first view; after that the customer owns the outline.
  useEffect(() => {
    if (!view || defaulted.current) return;
    defaulted.current = true;
    const current = currentMilestone(view);
    setOpenMilestones(current ? [current.ref] : []);
  }, [view]);

  const items = useMemo(() => (view ? mapItems(view, lang) : []), [view, lang]);
  const outline = useMemo(() => (view ? outlineOf(view, lang) : []), [view, lang]);
  const tabs: readonly SegmentItem[] = [
    { key: 'map', label: t(lang, 'plan.tabMap'), testID: 'tab-map' },
    { key: 'outline', label: t(lang, 'plan.tabOutline'), testID: 'tab-outline' },
    { key: 'activity', label: t(lang, 'plan.tabActivity'), testID: 'tab-activity' },
  ];
  const pickedMilestone = view && picked ? view.milestones.find((m) => m.ref === picked) : undefined;
  const zoom = ZOOMS[zoomIndex] ?? 1;
  const offlineAgo = store.fetchedAt ? ago(store.fetchedAt, lang) : t(lang, 'time.justNow');
  const offline = !store.online || store.error?.kind === 'offline';

  const changeZoom = (next: number): void => {
    if (next < 0 || next >= ZOOMS.length) return;
    setZoomIndex(next);
    kv.set('plan-zoom', ZOOMS[next]);
  };

  const more = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t(lang, 'plan.more')}
      testID="more"
      onPress={() => setMenu(true)}
      style={({ pressed }) => [styles.more, pressed && styles.pressed]}
    >
      <Text style={styles.moreInk}>•••</Text>
    </Pressable>
  );

  if (!pid || !ref) {
    return (
      <View style={styles.root} testID="plan-screen">
        <Header title={t(lang, 'plan.titleFallback')} back />
        <EmptyState
          title={t(lang, 'plan.linkIncomplete')}
          action={<TextButton label={t(lang, 'plan.backToProject')} onPress={() => router.replace('/')} testID="plan-back" />}
          testID="plan-link-incomplete"
        />
      </View>
    );
  }

  return (
    <View style={styles.root} testID="plan-screen">
      <Header title={view?.title ?? t(lang, 'plan.titleFallback')} back right={more} />
      {offline && view ? <SyncBanner kind="offline" text={t(lang, 'common.offlineYou', { ago: offlineAgo })} testID="offline-banner" /> : null}

      <View style={[styles.main, desktop && styles.mainDesktop]}>
        {view && phase ? (
          <>
            <PlanHeader view={view} phase={phase} lang={lang} studioOnline={store.studioOnline} fetchedAt={store.fetchedAt} />
            {store.error && store.error.kind !== 'offline' ? (
              <View style={styles.refreshRow}>
                <Text style={styles.refreshText}>{store.error.kind === 'schema' ? t(lang, 'plan.needsRefresh') : t(lang, 'common.error')}</Text>
                <TextButton label={t(lang, 'common.retry')} onPress={() => void store.refresh()} testID="plan-refresh" />
              </View>
            ) : null}
            <Segments items={tabs} value={tab} onChange={(key) => setTab(key as TabKey)} />
            <ScrollView style={styles.scroll} contentContainerStyle={{ paddingBottom: insets.bottom + space[6] }} testID={`tab-panel-${tab}`}>
              {tab === 'map' ? (
                <View style={styles.mapSection}>
                  <View style={styles.zoomRow}>
                    <ZoomButton label={t(lang, 'plan.zoomOut')} testID="zoom-out" disabled={zoomIndex === 0} onPress={() => changeZoom(zoomIndex - 1)}>
                      <Minus size={18} color={color.text2} />
                    </ZoomButton>
                    <ZoomButton label={t(lang, 'plan.zoomIn')} testID="zoom-in" disabled={zoomIndex === ZOOMS.length - 1} onPress={() => changeZoom(zoomIndex + 1)}>
                      <Plus size={18} color={color.text2} />
                    </ZoomButton>
                  </View>
                  <PlanMap items={items} onPick={setPicked} scale={zoom} />
                  {items.length === 0 ? <Text style={styles.noMilestones}>{t(lang, 'plan.noMilestones')}</Text> : null}
                </View>
              ) : tab === 'outline' ? (
                <View style={styles.outline}>
                  {outline.length === 0 ? <Text style={styles.noMilestones}>{t(lang, 'plan.noMilestones')}</Text> : null}
                  <PlanOutline
                    milestones={outline}
                    open={openMilestones}
                    onToggle={(id) => setOpenMilestones((was) => (was.includes(id) ? was.filter((x) => x !== id) : [...was, id]))}
                  />
                </View>
              ) : (
                <ActivityList activity={view.activity} lang={lang} />
              )}
            </ScrollView>
          </>
        ) : store.loading ? (
          <View style={styles.loading}>
            <Skeleton count={3} variant="card" />
          </View>
        ) : store.gone ? (
          <EmptyState
            title={t(lang, 'plan.empty')}
            action={<TextButton label={t(lang, 'plan.backToProject')} onPress={() => router.replace(`/project/${encodeURIComponent(pid)}`)} testID="plan-back" />}
            testID="plan-gone"
          />
        ) : (
          <EmptyState
            title={store.error?.kind === 'offline' ? t(lang, 'common.offline') : t(lang, 'common.error')}
            action={<TextButton label={t(lang, 'common.retry')} onPress={() => void store.refresh()} testID="plan-retry" />}
            testID="plan-error"
          />
        )}
      </View>

      {pickedMilestone ? <MilestoneSheet milestone={pickedMilestone} lang={lang} onClose={() => setPicked(undefined)} bottomInset={8} /> : null}

      {menu ? (
        <View style={StyleSheet.absoluteFill} testID="plan-menu-layer">
          <Pressable style={StyleSheet.absoluteFill} accessibilityLabel={t(lang, 'plan.close')} onPress={() => setMenu(false)} />
          <View style={[styles.menu, { top: (desktop ? 56 : insets.top + 44) + 6 }]}>
            <Pressable
              accessibilityRole="button"
              testID="menu-refresh"
              onPress={() => {
                setMenu(false);
                void store.refresh();
              }}
              style={({ pressed }) => [styles.menuItem, pressed && styles.pressed]}
            >
              <Text style={styles.menuText}>{t(lang, 'common.refresh')}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" testID="menu-close" onPress={() => setMenu(false)} style={({ pressed }) => [styles.menuItem, pressed && styles.pressed]}>
              <Text style={styles.menuText}>{t(lang, 'plan.close')}</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

function ZoomButton({ label, testID, disabled, onPress, children }: { readonly label: string; readonly testID: string; readonly disabled: boolean; readonly onPress: () => void; readonly children: ReactNode }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [styles.zoom, disabled && styles.zoomOff, pressed && !disabled && styles.pressed]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  main: { flex: 1, width: '100%' },
  mainDesktop: { maxWidth: 720, alignSelf: 'center' },
  scroll: { flex: 1 },
  mapSection: { paddingTop: space[3] },
  zoomRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: space[2], paddingHorizontal: space[5], paddingBottom: space[2] },
  zoom: { width: 44, height: 44, borderRadius: radius.m, alignItems: 'center', justifyContent: 'center', backgroundColor: color.card, borderWidth: 1, borderColor: color.hairline },
  zoomOff: { opacity: 0.4 },
  outline: { paddingHorizontal: space[5], paddingTop: space[5] },
  noMilestones: { ...type.callout, color: color.text2, textAlign: 'center', paddingHorizontal: space[6], paddingVertical: space[6] },
  loading: { padding: space[5] },
  refreshRow: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingHorizontal: space[5], paddingBottom: space[3] },
  refreshText: { ...type.caption, color: color.text2, flex: 1 },
  more: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  moreInk: { ...type.heading, color: color.text2, letterSpacing: 1 },
  pressed: { backgroundColor: color.press },
  menu: { position: 'absolute', right: space[4], minWidth: 180, backgroundColor: color.card, borderRadius: radius.l, borderWidth: 1, borderColor: color.hairline, overflow: 'hidden' },
  menuItem: { minHeight: 44, paddingHorizontal: space[5], alignItems: 'flex-start', justifyContent: 'center' },
  menuText: { ...type.callout, color: color.text },
});
