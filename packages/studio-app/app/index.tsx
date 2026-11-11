import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { EmptyState } from '../components/EmptyState';
import { Header } from '../components/Header';
import { ProjectCard } from '../components/ProjectCard';
import { Skeleton } from '../components/Skeleton';
import { SyncBanner } from '../components/SyncBanner';
import { TextButton } from '../components/TextButton';
import { cache } from '../lib/cache';
import { cardFor, type ProjectCardData } from '../lib/cards';
import { hub } from '../lib/client';
import type { PlansRes, ProjectSummary } from '../lib/hub-schema';
import { useOnline } from '../lib/net';
import { session } from '../lib/session';
import { detectLang, t } from '../lib/strings';
import { ago } from '../lib/time';
import { color, space } from '../lib/theme';

type LoadError = 'offline' | 'error' | null;

/**
 * The projects list (M5 design §2): one card per project, the latest plan's line, a dot when the
 * customer is needed, and the studio's offline line. Data is the hub's cached answers; a card's
 * "last synced" comes from the cached `fetchedAt` / `studio.lastSyncAt`, never a local timer.
 */
export default function ProjectsScreen() {
  const router = useRouter();
  const lang = detectLang();
  const online = useOnline();
  const { width } = useWindowDimensions();
  const desktop = width >= 900;

  const [projects, setProjects] = useState<ProjectSummary[] | null>(() => cache.get<ProjectSummary[]>('projects')?.value ?? null);
  const [plans, setPlans] = useState<Map<string, PlansRes | undefined>>(() => {
    const cached = cache.get<ProjectSummary[]>('projects');
    return new Map((cached?.value ?? []).map((project) => [project.id, cache.get<PlansRes>(`plans:${project.id}`)?.value]));
  });
  const [fetchedAt, setFetchedAt] = useState(() => cache.get<ProjectSummary[]>('projects')?.fetchedAt ?? 0);
  const [loading, setLoading] = useState(() => cache.get<ProjectSummary[]>('projects') === undefined);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<LoadError>(null);
  const [stale, setStale] = useState(0);

  const load = useCallback(async () => {
    setRefreshing(true);
    const cached = cache.get<ProjectSummary[]>('projects');
    if (cached) {
      setProjects(cached.value);
      setFetchedAt(cached.fetchedAt);
      setLoading(false);
    }

    const result = await hub.projects();
    if (!result.ok) {
      setRefreshing(false);
      if (result.error.kind === 'signed-out') {
        session.clear();
        return;
      }
      if (cached) {
        if (result.error.kind === 'offline') setError('offline');
        else setStale((n) => n + 1);
      } else {
        setError(result.error.kind === 'offline' ? 'offline' : 'error');
        setLoading(false);
      }
      return;
    }

    setError(null);
    const at = Date.now();
    cache.set('projects', result.value.projects, at);
    setProjects(result.value.projects);
    setFetchedAt(at);
    setLoading(false);

    // One request per project, all at once. A project whose plans fail keeps its cached answer;
    // the page stays usable.
    const entries = await Promise.all(
      result.value.projects.map(async (project) => {
        const cachedPlans = cache.get<PlansRes>(`plans:${project.id}`);
        const r = await hub.plans(project.id);
        if (r.ok) {
          cache.set(`plans:${project.id}`, r.value, Date.now());
          return [project.id, r.value] as const;
        }
        if (r.error.kind === 'signed-out') session.clear();
        return [project.id, cachedPlans?.value] as const;
      }),
    );
    setPlans(new Map(entries));
    setRefreshing(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // "刷新失败" is a 3-second line, not a state the customer has to dismiss.
  useEffect(() => {
    if (!stale) return;
    const id = setTimeout(() => setStale(0), 3000);
    return () => clearTimeout(id);
  }, [stale]);

  const cards: ProjectCardData[] = (projects ?? []).map((project) => {
    const answer = plans.get(project.id);
    return cardFor(project, answer?.plans, answer?.studio, refreshing && answer === undefined);
  });

  const offline = !online || error === 'offline';
  const offlineAgo = fetchedAt ? ago(fetchedAt, lang) : t(lang, 'time.justNow');

  return (
    <View style={styles.root} testID="projects-screen">
      <Header title={t(lang, 'projects.title')} onRefresh={() => void load()} refreshing={refreshing} />

      {offline ? (
        <SyncBanner kind="offline" text={t(lang, 'common.offlineYou', { ago: offlineAgo })} testID="offline-banner" />
      ) : stale > 0 ? (
        <SyncBanner kind="offline" text={t(lang, 'projects.refreshFailed')} testID="refresh-failed" />
      ) : null}

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <View style={[styles.column, desktop && styles.columnDesktop]}>
          {loading ? (
            <Skeleton count={desktop ? 4 : 3} />
          ) : error && !projects ? (
            <EmptyState
              title={error === 'offline' ? t(lang, 'common.offline') : t(lang, 'projects.loadFailed')}
              action={<TextButton label={t(lang, 'common.retry')} onPress={() => void load()} testID="retry" />}
              testID="projects-error"
            />
          ) : cards.length === 0 ? (
            <EmptyState
              title={t(lang, 'projects.emptyTitle')}
              body={t(lang, 'projects.emptyBody')}
              action={<TextButton label={t(lang, 'common.refresh')} onPress={() => void load()} testID="refresh-empty" />}
              testID="projects-empty"
            />
          ) : (
            <View style={[styles.grid, desktop && styles.gridDesktop]}>
              {cards.map((card) => (
                <View key={card.id} style={[styles.cardWrap, desktop && styles.cardWrapDesktop]}>
                  <ProjectCard project={card} onPress={() => router.push(`/project/${encodeURIComponent(card.id)}`)} fill={desktop} />
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: space[5], paddingTop: space[5], paddingBottom: space[7] },
  column: { width: '100%' },
  columnDesktop: { maxWidth: 720, alignSelf: 'center', paddingTop: space[4] },
  grid: { width: '100%' },
  gridDesktop: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  cardWrap: { width: '100%', marginBottom: space[4] },
  cardWrapDesktop: { width: '48.9%', marginBottom: space[5], display: 'flex' },
});
