import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { EmptyState } from '../components/EmptyState';
import { Header } from '../components/Header';
import { Skeleton } from '../components/Skeleton';
import { SyncBanner } from '../components/SyncBanner';
import { TabBar } from '../components/TabBar';
import { TodoCard } from '../components/TodoCard';
import { TextButton } from '../components/TextButton';
import { useOnline } from '../lib/net';
import { detectLang, t } from '../lib/strings';
import { color, space } from '../lib/theme';
import { ago } from '../lib/time';
import { useTodos } from '../lib/todo-store';

/**
 * Everything waiting on the customer, across projects (M6 §6): one card per question, review,
 * changed draft or unconfirmed plan. Acting on a card hides it until the next load.
 */
export default function TodoScreen() {
  const router = useRouter();
  const lang = detectLang();
  const online = useOnline();
  const { width } = useWindowDimensions();
  const desktop = width >= 900;
  const { result, loading, error, refresh } = useTodos();
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const todos = (result?.todos ?? []).filter((todo) => !hidden.has(todo.key));
  const offline = !online;
  const fetchedAt = result?.fetchedAt ?? 0;

  return (
    <View style={styles.root} testID="todo-screen">
      <Header title={t(lang, 'todo.title')} onRefresh={() => void refresh()} refreshing={loading} />
      {desktop ? <TabBar todoCount={todos.length} /> : null}
      {offline && result ? (
        <SyncBanner kind="offline" text={t(lang, 'common.offlineYou', { ago: fetchedAt ? ago(fetchedAt, lang) : t(lang, 'time.justNow') })} testID="offline-banner" />
      ) : null}
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <View style={[styles.column, desktop && styles.columnDesktop]}>
          {loading && !result ? (
            <Skeleton count={3} />
          ) : error && !result ? (
            <EmptyState
              title={t(lang, 'common.error')}
              action={<TextButton label={t(lang, 'common.retry')} onPress={() => void refresh()} testID="todo-retry" />}
              testID="todo-error"
            />
          ) : todos.length === 0 ? (
            <EmptyState title={t(lang, 'todo.empty')} body={t(lang, 'todo.emptyBody')} testID="todo-empty" />
          ) : (
            todos.map((todo) => (
              <TodoCard
                key={todo.key}
                todo={todo}
                lang={lang}
                onHidden={(key) => setHidden((was) => new Set(was).add(key))}
                onOpenPlan={(pid, planRef, open) =>
                  router.push(`/plan/${encodeURIComponent(planRef)}?project=${encodeURIComponent(pid)}${open ? `&open=${open}` : ''}`)
                }
                onRefresh={() => void refresh()}
              />
            ))
          )}
        </View>
      </ScrollView>
      {!desktop ? <TabBar todoCount={todos.length} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  scroll: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: space[5], paddingTop: space[5], paddingBottom: space[7] },
  column: { flex: 1, width: '100%' },
  columnDesktop: { maxWidth: 720, alignSelf: 'center', paddingTop: space[4] },
});
