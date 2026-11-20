import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronDown, ChevronRight } from 'lucide-react-native';
import { useCallback, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  useWindowDimensions,
  View,
} from 'react-native';
import { EmptyState } from '../../components/EmptyState';
import { Header } from '../../components/Header';
import { Skeleton } from '../../components/Skeleton';
import { StatusDot } from '../../components/StatusDot';
import { SyncBanner } from '../../components/SyncBanner';
import { TabBar } from '../../components/TabBar';
import { TextButton } from '../../components/TextButton';
import { cache } from '../../lib/cache';
import { hub, isDemoMode } from '../../lib/client';
import { DEMO_SCREENS } from '../../lib/demo';
import { useOnline } from '../../lib/net';
import {
  filterRequests,
  groupRequestsByProject,
  isNeedsYou,
  needsYouReason,
  sortRequests,
} from '../../lib/requests';
import {
  loadRequestsFromHub,
  REQUESTS_CACHE_KEY,
} from '../../lib/requests-source';
import { useOnResume } from '../../lib/resume';
import { session } from '../../lib/session';
import { detectLang, t } from '../../lib/strings';
import { tRequests } from '../../lib/strings/requests';
import { ago } from '../../lib/time';
import { color, radius, space, type } from '../../lib/theme';
import { useTodos } from '../../lib/todo-store';
import type { RequestSummary } from '../../lib/views';

type DemoStateKey = keyof typeof DEMO_SCREENS.requestsList;

function RequestRow({
  item,
  lang,
  onPress,
  last,
  styles,
}: {
  readonly item: RequestSummary;
  readonly lang: ReturnType<typeof detectLang>;
  readonly onPress: () => void;
  readonly last?: boolean;
  readonly styles: ReturnType<typeof createStyles>;
}) {
  const reason = needsYouReason(item);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      testID={`request-row-${item.id}`}
      style={({ pressed }) => [styles.row, !last && styles.rowBorder, pressed && styles.pressed]}
    >
      <View style={styles.dotCol}>
        <StatusDot status={item.status} testID={`request-dot-${item.id}`} />
      </View>
      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {item.title}
          </Text>
          <Text style={styles.rowTime}>{ago(item.updatedAt, lang)}</Text>
        </View>
        <Text
          style={[styles.rowSub, reason ? styles.reasonText : null]}
          numberOfLines={1}
        >
          {reason ?? item.statusLine}
        </Text>
      </View>
      {item.unreadCount && item.unreadCount > 0 ? <View style={styles.unreadDot} /> : null}
    </Pressable>
  );
}

/**
 * 「需求」页（SS-36 / SS-193）：
 * - 仅在 `isDemoMode()` 时读 `DEMO_SCREENS.requestsList`（支持 normal / empty / loading / offline / runnerOffline）；
 * - 非 DEMO 时从 `hub.projects()` + `hub.plans(pid)` 拉取真实数据，无缓存时显示 Skeleton，
 *   无缓存失败时显示可重试 EmptyState，401 清空会话，离线显示缓存 + SyncBanner，每组末尾折叠已完成项。
 */
export default function RequestsScreen() {
  useColorScheme();
  const styles = createStyles();
  const router = useRouter();
  const params = useLocalSearchParams<{ state?: string | string[] }>();
  const rawDemoState = Array.isArray(params.state) ? params.state[0] : params.state;
  const demoMode = isDemoMode();
  const demoKey: DemoStateKey =
    rawDemoState && rawDemoState in DEMO_SCREENS.requestsList
      ? (rawDemoState as DemoStateKey)
      : 'normal';

  const lang = detectLang();
  const online = useOnline();
  const { width } = useWindowDimensions();
  const desktop = width >= 900;

  const [items, setItems] = useState<readonly RequestSummary[] | null>(() => {
    if (demoMode) return DEMO_SCREENS.requestsList[demoKey].data;
    return cache.get<RequestSummary[]>(REQUESTS_CACHE_KEY)?.value ?? null;
  });
  const [fetchedAt, setFetchedAt] = useState<number>(() =>
    demoMode ? Date.now() : (cache.get<RequestSummary[]>(REQUESTS_CACHE_KEY)?.fetchedAt ?? 0),
  );
  const [loading, setLoading] = useState<boolean>(() => {
    if (demoMode) return Boolean('loading' in DEMO_SCREENS.requestsList[demoKey] && DEMO_SCREENS.requestsList[demoKey].loading);
    return cache.get<RequestSummary[]>(REQUESTS_CACHE_KEY) === undefined;
  });
  const [loadError, setLoadError] = useState<'offline' | 'error' | null>(null);
  const [query, setQuery] = useState('');
  const [expandedDone, setExpandedDone] = useState<ReadonlySet<string>>(() => new Set());

  const { result: todos, refresh: refreshTodos } = useTodos();
  const todoCount = todos?.todos.length ?? 0;

  const load = useCallback(async () => {
    if (demoMode) {
      const fixture = DEMO_SCREENS.requestsList[demoKey];
      setItems(fixture.data);
      setLoading(Boolean('loading' in fixture && fixture.loading));
      setLoadError('offline' in fixture && fixture.offline ? 'offline' : null);
      setFetchedAt(Date.now());
      return;
    }

    const cached = cache.get<RequestSummary[]>(REQUESTS_CACHE_KEY);
    if (cached) {
      setItems(cached.value);
      setFetchedAt(cached.fetchedAt);
      setLoading(false);
    } else {
      setLoading(true);
    }

    const outcome = await loadRequestsFromHub({
      hub,
      cache,
      onSignedOut: () => session.clear(),
      lang,
    });

    if (outcome.kind === 'signed-out') {
      setLoading(false);
      return;
    }
    if (outcome.kind === 'ok') {
      setItems(outcome.items);
      setFetchedAt(outcome.fetchedAt);
      setLoadError(null);
      setLoading(false);
      return;
    }

    setItems(outcome.items);
    setFetchedAt(outcome.fetchedAt);
    setLoadError(outcome.kind);
    setLoading(false);
  }, [demoKey, demoMode, lang]);

  useFocusEffect(
    useCallback(() => {
      void load();
      void refreshTodos();
    }, [load, refreshTodos]),
  );

  useOnResume(() => {
    void load();
    void refreshTodos();
  });

  const listItems = useMemo(() => items ?? [], [items]);
  const filtered = useMemo(() => filterRequests(listItems, query), [listItems, query]);
  const sorted = useMemo(() => sortRequests(filtered), [filtered]);
  const needsYouItems = useMemo(() => sorted.filter(isNeedsYou), [sorted]);
  const restItems = useMemo(() => sorted.filter((r) => !isNeedsYou(r)), [sorted]);
  const groups = useMemo(() => groupRequestsByProject(restItems), [restItems]);

  const toggleDoneGroup = (projectId: string) => {
    setExpandedDone((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  };

  const openRequest = (id: string) => {
    router.push(`/request/${encodeURIComponent(id)}`);
  };

  const showOfflineBanner =
    (!online || loadError === 'offline' || (demoMode && demoKey === 'offline')) &&
    items !== null;

  return (
    <View style={styles.root} testID="requests-screen">
      <Header
        title={tRequests(lang, 'requests.title')}
        right={
          <Pressable
            onPress={() => router.push('/new')}
            accessibilityRole="button"
            testID="new-request-button"
            style={({ pressed }) => [styles.newBtn, pressed && styles.pressed]}
          >
            <Text style={styles.newBtnText}>{tRequests(lang, 'requests.newBtn')}</Text>
          </Pressable>
        }
      />
      {desktop ? <TabBar todoCount={todoCount} /> : null}
      {showOfflineBanner ? (
        <SyncBanner
          kind="offline"
          text={t(lang, 'common.offlineYou', {
            ago: fetchedAt ? ago(fetchedAt, lang) : t(lang, 'time.justNow'),
          })}
          testID="offline-banner"
        />
      ) : null}

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.column, desktop && styles.columnDesktop]}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={tRequests(lang, 'requests.searchPlaceholder')}
            placeholderTextColor={color.text3}
            accessibilityLabel={tRequests(lang, 'requests.searchPlaceholder')}
            testID="requests-search"
            style={styles.search}
          />

          {loading && items === null ? (
            <View testID="requests-skeleton">
              <Skeleton count={4} />
            </View>
          ) : demoMode && demoKey === 'loading' ? (
            <View testID="requests-skeleton">
              <Skeleton count={4} />
            </View>
          ) : loadError && items === null ? (
            <EmptyState
              title={t(lang, loadError === 'offline' ? 'common.offline' : 'common.error')}
              action={
                <TextButton
                  label={t(lang, 'common.retry')}
                  onPress={() => void load()}
                  testID="requests-retry"
                />
              }
              testID="requests-error"
            />
          ) : filtered.length === 0 ? (
            <EmptyState
              title={
                query.trim()
                  ? tRequests(lang, 'requests.searchEmpty')
                  : tRequests(lang, 'requests.empty')
              }
              body={query.trim() ? undefined : tRequests(lang, 'requests.emptyBody')}
              action={
                !query.trim() ? (
                  <TextButton
                    label={tRequests(lang, 'requests.newBtn')}
                    onPress={() => router.push('/new')}
                    testID="requests-empty-new"
                  />
                ) : undefined
              }
              testID="requests-empty"
            />
          ) : (
            <>
              {needsYouItems.length > 0 ? (
                <View style={styles.section} testID="requests-needs-you-section">
                  <Text style={styles.sectionTitle}>
                    {tRequests(lang, 'requests.needsYouSection')}
                  </Text>
                  <View style={styles.groupCard}>
                    {needsYouItems.map((item, idx) => (
                      <RequestRow
                        key={item.id}
                        item={item}
                        lang={lang}
                        onPress={() => openRequest(item.id)}
                        last={idx === needsYouItems.length - 1}
                        styles={styles}
                      />
                    ))}
                  </View>
                </View>
              ) : null}

              {groups.map((group) => {
                const active = group.items.filter((i) => i.status !== 'done');
                const done = group.items.filter((i) => i.status === 'done');
                const isDoneExpanded = expandedDone.has(group.projectId);

                return (
                  <View
                    key={group.projectId}
                    style={styles.section}
                    testID={`requests-group-${group.projectId}`}
                  >
                    <Pressable
                      onPress={() =>
                        router.push(`/project/${encodeURIComponent(group.projectId)}`)
                      }
                      accessibilityRole="button"
                      style={styles.groupHeader}
                    >
                      <Text style={styles.sectionTitle}>{group.projectName}</Text>
                      <View style={styles.groupHeaderRight}>
                        <Text style={styles.groupCount}>
                          {tRequests(lang, 'requests.groupCount', { n: group.items.length })}
                        </Text>
                        <ChevronRight size={14} color={color.text3} />
                      </View>
                    </Pressable>
                    <View style={styles.groupCard}>
                      {active.map((item, idx) => (
                        <RequestRow
                          key={item.id}
                          item={item}
                          lang={lang}
                          onPress={() => openRequest(item.id)}
                          last={idx === active.length - 1 && done.length === 0}
                          styles={styles}
                        />
                      ))}
                      {done.length > 0 ? (
                        <>
                          <Pressable
                            onPress={() => toggleDoneGroup(group.projectId)}
                            accessibilityRole="button"
                            testID={`requests-done-toggle-${group.projectId}`}
                            style={({ pressed }) => [
                              styles.doneToggle,
                              isDoneExpanded && styles.rowBorder,
                              pressed && styles.pressed,
                            ]}
                          >
                            <Text style={styles.doneToggleText}>
                              {tRequests(lang, 'requests.completedToggle', { n: done.length })}
                            </Text>
                            {isDoneExpanded ? (
                              <ChevronDown size={14} color={color.text3} />
                            ) : (
                              <ChevronRight size={14} color={color.text3} />
                            )}
                          </Pressable>
                          {isDoneExpanded
                            ? done.map((item, idx) => (
                                <RequestRow
                                  key={item.id}
                                  item={item}
                                  lang={lang}
                                  onPress={() => openRequest(item.id)}
                                  last={idx === done.length - 1}
                                  styles={styles}
                                />
                              ))
                            : null}
                        </>
                      ) : null}
                    </View>
                  </View>
                );
              })}
            </>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const createStyles = () => StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  scroll: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: space[5], paddingTop: space[4], paddingBottom: space[7] },
  column: { flex: 1, width: '100%' },
  columnDesktop: { maxWidth: 720, alignSelf: 'center', paddingTop: space[4] },
  newBtn: {
    minHeight: 44,
    paddingHorizontal: space[3],
    borderRadius: radius.s,
    borderWidth: 1,
    borderColor: color.hairlineStrong,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.card,
  },
  newBtnText: { ...type.caption, fontWeight: '600', color: color.text },
  search: {
    minHeight: 44,
    backgroundColor: color.card,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: color.hairline,
    paddingHorizontal: space[4],
    fontSize: 16,
    color: color.text,
    marginBottom: space[5],
  },
  section: { marginBottom: space[5] },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space[2],
    paddingHorizontal: space[1],
  },
  groupHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  groupCount: { ...type.caption, color: color.text3 },
  sectionTitle: {
    ...type.caption,
    fontWeight: '600',
    color: color.text3,
    marginBottom: space[2],
    paddingHorizontal: space[1],
  },
  groupCard: {
    backgroundColor: color.card,
    borderRadius: radius.l,
    borderWidth: 1,
    borderColor: color.hairline,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    gap: space[3],
  },
  rowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.hairline,
  },
  pressed: { backgroundColor: color.press },
  dotCol: { paddingTop: 2 },
  rowBody: { flex: 1, gap: 2 },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[2] },
  rowTitle: { ...type.callout, fontWeight: '600', color: color.text, flex: 1 },
  rowTime: { ...type.caption, color: color.text3 },
  rowSub: { ...type.caption, color: color.text2 },
  reasonText: { color: color.text, fontWeight: '500' },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: color.needsYouDot,
  },
  doneToggle: {
    minHeight: 44,
    paddingHorizontal: space[4],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: color.sunken,
  },
  doneToggleText: { ...type.caption, fontWeight: '500', color: color.text3 },
});
