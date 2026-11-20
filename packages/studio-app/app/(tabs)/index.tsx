import { useFocusEffect, useRouter } from 'expo-router';
import { ChevronRight } from 'lucide-react-native';
import { useCallback, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
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
import { hub } from '../../lib/client';
import { DEMO_REQUEST_SUMMARIES } from '../../lib/demo';
import { useOnline } from '../../lib/net';
import {
  filterRequests,
  groupRequestsByProject,
  isNeedsYou,
  needsYouReason,
  sortRequests,
} from '../../lib/requests';
import { useOnResume } from '../../lib/resume';
import { detectLang, t } from '../../lib/strings';
import { tRequests } from '../../lib/strings/requests';
import { ago } from '../../lib/time';
import { color, radius, space, type } from '../../lib/theme';
import { useTodos } from '../../lib/todo-store';
import type { RequestSummary } from '../../lib/views';

const CACHE_KEY = 'requests:summaries';

function RequestRow({
  item,
  lang,
  onPress,
  last,
}: {
  readonly item: RequestSummary;
  readonly lang: ReturnType<typeof detectLang>;
  readonly onPress: () => void;
  readonly last?: boolean;
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
      {item.unreadCount && item.unreadCount > 0 ? (
        <View style={styles.unreadDot} />
      ) : null}
    </Pressable>
  );
}

/**
 * 「需求」页（SS-36）：跨项目需求列表，使用 `lib/requests.ts` 分组与排序：
 * - 「等你」置顶并写明原因；
 * - 其余按项目分组、组内按更新时间倒序；等待态用灰点（不用红）；
 * - 离线读取缓存并在顶部展示 SyncBanner；右上角「提需求」描边按钮进 /new。
 */
export default function RequestsScreen() {
  const router = useRouter();
  const lang = detectLang();
  const online = useOnline();
  const { width } = useWindowDimensions();
  const desktop = width >= 900;

  const [items, setItems] = useState<readonly RequestSummary[]>(() => {
    const cached = cache.get<RequestSummary[]>(CACHE_KEY);
    return cached?.value ?? DEMO_REQUEST_SUMMARIES;
  });
  const [fetchedAt, setFetchedAt] = useState<number>(
    () => cache.get<RequestSummary[]>(CACHE_KEY)?.fetchedAt ?? Date.now(),
  );
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');

  const { result: todos, refresh: refreshTodos } = useTodos();
  const todoCount = todos?.todos.length ?? 0;

  const load = useCallback(async () => {
    setLoading(true);
    const cached = cache.get<RequestSummary[]>(CACHE_KEY);
    if (cached) {
      setItems(cached.value);
      setFetchedAt(cached.fetchedAt);
    }

    const r = await hub.projects();
    if (r.ok) {
      const next = DEMO_REQUEST_SUMMARIES;
      const at = Date.now();
      cache.set(CACHE_KEY, [...next], at);
      setItems(next);
      setFetchedAt(at);
    }
    setLoading(false);
  }, []);

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

  const filtered = useMemo(() => filterRequests(items, query), [items, query]);
  const sorted = useMemo(() => sortRequests(filtered), [filtered]);
  const needsYouItems = useMemo(() => sorted.filter(isNeedsYou), [sorted]);
  const restItems = useMemo(() => sorted.filter((r) => !isNeedsYou(r)), [sorted]);
  const groups = useMemo(() => groupRequestsByProject(restItems), [restItems]);

  const openRequest = (id: string) => {
    router.push(`/request/${encodeURIComponent(id)}`);
  };

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
      {!online ? (
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

          {loading && items.length === 0 ? (
            <Skeleton count={4} />
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
                      />
                    ))}
                  </View>
                </View>
              ) : null}

              {groups.map((group) => (
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
                    {group.items.map((item, idx) => (
                      <RequestRow
                        key={item.id}
                        item={item}
                        lang={lang}
                        onPress={() => openRequest(item.id)}
                        last={idx === group.items.length - 1}
                      />
                    ))}
                  </View>
                </View>
              ))}
            </>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  scroll: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: space[5], paddingTop: space[4], paddingBottom: space[7] },
  column: { flex: 1, width: '100%' },
  columnDesktop: { maxWidth: 720, alignSelf: 'center', paddingTop: space[4] },
  newBtn: {
    minHeight: 32,
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
});
