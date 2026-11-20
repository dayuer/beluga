import { useFocusEffect } from 'expo-router';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { EmptyState } from '../../components/EmptyState';
import { Header } from '../../components/Header';
import { Skeleton } from '../../components/Skeleton';
import { SyncBanner } from '../../components/SyncBanner';
import { TabBar } from '../../components/TabBar';
import { TextButton } from '../../components/TextButton';
import { TodoCard, WaitingTodoCard } from '../../components/TodoCard';
import { useScheme } from '../../lib/appearance';
import { cache } from '../../lib/cache';
import { hub, isDemoMode } from '../../lib/client';
import { DEMO_REQUEST_SUMMARIES } from '../../lib/demo';
import { useOnline } from '../../lib/net';
import { loadRequestsFromHub, REQUESTS_CACHE_KEY } from '../../lib/requests-source';
import { useOnResume } from '../../lib/resume';
import { session } from '../../lib/session';
import { detectLang, t } from '../../lib/strings';
import { color, space, type } from '../../lib/theme';
import { ago } from '../../lib/time';
import { partitionTodos } from '../../lib/todo';
import { useTodos } from '../../lib/todo-store';
import type { RequestSummary } from '../../lib/views';

/**
 * P8 待办（SS-53 / SS-194）：
 * - 非 DEMO 时绝不注入 DEMO_REQUEST_SUMMARIES，等待列表从真实需求数据派生；
 * - !online 时无论是否有 result 都在顶部显示 SyncBanner；
 * - 无待办且无等待时显示 todo-empty。
 */
export default function TodoScreen() {
  useScheme();
  const styles = createStyles();
  const router = useRouter();
  const lang = detectLang();
  const online = useOnline();
  const demoMode = isDemoMode();
  const { width } = useWindowDimensions();
  const desktop = width >= 900;
  const { result, loading, error, refresh } = useTodos();
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [realRequests, setRealRequests] = useState<readonly RequestSummary[]>(() =>
    demoMode
      ? DEMO_REQUEST_SUMMARIES
      : (cache.get<RequestSummary[]>(REQUESTS_CACHE_KEY)?.value ?? []),
  );

  const refreshAll = useCallback(async () => {
    await refresh();
    if (demoMode) {
      setRealRequests(DEMO_REQUEST_SUMMARIES);
      return;
    }
    const outcome = await loadRequestsFromHub({
      hub,
      cache,
      onSignedOut: () => session.clear(),
      lang,
    });
    if (outcome.kind === 'ok' || ((outcome.kind === 'offline' || outcome.kind === 'error') && outcome.items)) {
      setRealRequests(outcome.items ?? []);
    }
  }, [demoMode, lang, refresh]);

  useFocusEffect(
    useCallback(() => {
      void refreshAll();
    }, [refreshAll]),
  );

  useOnResume(() => {
    void refreshAll();
  });

  const visibleTodos = useMemo(
    () => (result?.todos ?? []).filter((todo) => !hidden.has(todo.key)),
    [result?.todos, hidden],
  );

  const { needsYou, waiting } = useMemo(
    () =>
      partitionTodos({
        todos: visibleTodos,
        requests: realRequests,
        lang,
      }),
    [visibleTodos, realRequests, lang],
  );

  const openRequest = useCallback(
    (requestId: string, cardId: string) => {
      router.push(
        `/request/${encodeURIComponent(requestId)}?card=${encodeURIComponent(cardId)}`,
      );
    },
    [router],
  );

  const offline = !online;
  const fetchedAt = result?.fetchedAt ?? 0;
  const emptyAll = needsYou.length === 0 && waiting.length === 0;

  return (
    <View style={styles.root} testID="todo-screen">
      <Header
        title={t(lang, 'todo.title')}
        onRefresh={() => void refreshAll()}
        refreshing={loading}
      />
      {desktop ? <TabBar todoCount={needsYou.length} /> : null}
      {offline ? (
        <SyncBanner
          kind="offline"
          text={
            result
              ? t(lang, 'common.offlineYou', {
                  ago: fetchedAt ? ago(fetchedAt, lang) : t(lang, 'time.justNow'),
                })
              : t(lang, 'common.offline')
          }
          testID="offline-banner"
        />
      ) : null}
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <View style={[styles.column, desktop && styles.columnDesktop]}>
          {loading && !result ? (
            <Skeleton count={3} />
          ) : error && !result ? (
            <EmptyState
              title={t(lang, 'common.error')}
              action={
                <TextButton
                  label={t(lang, 'common.retry')}
                  onPress={() => void refreshAll()}
                  testID="todo-retry"
                />
              }
              testID="todo-error"
            />
          ) : emptyAll ? (
            <EmptyState
              title={t(lang, 'todo.empty')}
              body={t(lang, 'todo.emptyBody')}
              testID="todo-empty"
            />
          ) : (
            <>
              {needsYou.length > 0 ? (
                <View style={styles.group} testID="todo-needs-you-group">
                  <Text style={styles.groupTitle}>{t(lang, 'todo.needsYouGroup')}</Text>
                  {needsYou.map((todo) => (
                    <TodoCard
                      key={todo.key}
                      todo={todo}
                      lang={lang}
                      onHidden={(key) => setHidden((was) => new Set(was).add(key))}
                      onOpenRequest={openRequest}
                      onOpenPlan={(pid, planRef, open) =>
                        router.push(
                          `/plan/${encodeURIComponent(planRef)}?project=${encodeURIComponent(pid)}${open ? `&open=${open}` : ''}`,
                        )
                      }
                      onRefresh={() => void refreshAll()}
                    />
                  ))}
                </View>
              ) : null}

              {waiting.length > 0 ? (
                <View style={styles.group} testID="todo-waiting-group">
                  <Text style={styles.groupTitle}>{t(lang, 'todo.waitingGroup')}</Text>
                  {waiting.map((item) => (
                    <WaitingTodoCard
                      key={item.id}
                      item={item}
                      onOpenRequest={openRequest}
                    />
                  ))}
                </View>
              ) : null}
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
  content: { flexGrow: 1, paddingHorizontal: space[5], paddingTop: space[5], paddingBottom: space[7] },
  column: { flex: 1, width: '100%' },
  columnDesktop: { maxWidth: 720, alignSelf: 'center', paddingTop: space[4] },
  group: { marginBottom: space[4] },
  groupTitle: { ...type.caption, fontWeight: '600', color: color.text3, marginBottom: space[3] },
});
