import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { ActionDock } from '../../components/ActionDock';
import { EmptyState } from '../../components/EmptyState';
import { Header } from '../../components/Header';
import { PlanRow } from '../../components/PlanRow';
import { PrimaryButton } from '../../components/PrimaryButton';
import { Skeleton } from '../../components/Skeleton';
import { SyncBanner } from '../../components/SyncBanner';
import { TextButton } from '../../components/TextButton';
import { cache } from '../../lib/cache';
import { hub } from '../../lib/client';
import type { PlansRes, ProjectSummary, StudioStatus } from '../../lib/hub-schema';
import { useOnline } from '../../lib/net';
import { rowFromView, type PlanRowData } from '../../lib/plan-rows';
import { session } from '../../lib/session';
import { detectLang, t } from '../../lib/strings';
import { ago } from '../../lib/time';
import { color, space, type } from '../../lib/theme';

/**
 * The project page (M5 design §3): the plans, who each is waiting on, and the one action —
 * New request. A live `plan` frame updates a row in place; `plan-gone` removes it. M5 rows are
 * not pressable (the plan page is M6).
 */
export default function ProjectHomeScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const pid = Array.isArray(params.id) ? params.id[0] : params.id;
  const lang = detectLang();
  const online = useOnline();
  const { width } = useWindowDimensions();
  const desktop = width >= 900;

  const [project, setProject] = useState<ProjectSummary | null>(() => cache.get<ProjectSummary[]>('projects')?.value.find((p) => p.id === pid) ?? null);
  const [plans, setPlans] = useState<PlanRowData[] | null>(() => cache.get<PlansRes>(`plans:${pid}`)?.value.plans ?? null);
  const [studio, setStudio] = useState<StudioStatus | undefined>(() => cache.get<PlansRes>(`plans:${pid}`)?.value.studio);
  const [fetchedAt, setFetchedAt] = useState(() => cache.get<PlansRes>(`plans:${pid}`)?.fetchedAt ?? 0);
  const [loading, setLoading] = useState(() => cache.get<PlansRes>(`plans:${pid}`) === undefined);
  const [refreshing, setRefreshing] = useState(false);
  const [requestOffline, setRequestOffline] = useState(false);
  const [error, setError] = useState<'offline' | 'error' | null>(null);
  const [socket, setSocket] = useState<'open' | 'closed'>('open');
  const [reconnected, setReconnected] = useState(false);
  const wasClosed = useRef(false);

  useEffect(() => {
    if (!pid) router.replace('/');
  }, [pid, router]);

  const load = useCallback(async () => {
    if (!pid) return;
    setRefreshing(true);
    const cached = cache.get<PlansRes>(`plans:${pid}`);
    if (cached) {
      setPlans(cached.value.plans);
      setStudio(cached.value.studio);
      setFetchedAt(cached.fetchedAt);
      setLoading(false);
    }

    const [projects, answer] = await Promise.all([hub.projects(), hub.plans(pid)]);
    if (projects.ok) {
      cache.set('projects', projects.value.projects, Date.now());
      const found = projects.value.projects.find((p) => p.id === pid);
      if (found) setProject(found);
    } else if (projects.error.kind === 'signed-out') {
      session.clear();
    }

    if (!answer.ok) {
      setRefreshing(false);
      if (answer.error.kind === 'signed-out') {
        session.clear();
        return;
      }
      if (answer.error.kind === 'offline') setRequestOffline(true);
      if (!cached) {
        setError(answer.error.kind === 'offline' ? 'offline' : 'error');
        setLoading(false);
      }
      return;
    }

    setRequestOffline(false);
    setError(null);
    setPlans(answer.value.plans);
    setStudio(answer.value.studio);
    setFetchedAt(Date.now());
    cache.set(`plans:${pid}`, answer.value, Date.now());
    setLoading(false);
    setRefreshing(false);
  }, [pid]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // Live plans: a frame replaces the row with the same planRef, plan-gone removes it. On a
  // reconnect, refresh the list and say so for two seconds.
  useEffect(() => {
    if (!pid) return;
    const close = hub.watch(pid, {
      frame: (f) => {
        if (f.t === 'plan') {
          const row = rowFromView(f.view);
          setPlans((prev) => {
            const next = (prev ?? []).filter((p) => p.planRef !== row.planRef);
            next.push(row);
            return next.sort((a, b) => b.updatedAt - a.updatedAt);
          });
          setStudio({ online: true, lastSyncAt: Date.now() });
        } else if (f.t === 'plan-gone') {
          setPlans((prev) => (prev ?? []).filter((p) => p.planRef !== f.planRef));
        }
      },
      state: (s) => {
        setSocket(s);
        if (s === 'closed') wasClosed.current = true;
        if (s === 'open' && wasClosed.current) {
          wasClosed.current = false;
          setReconnected(true);
          setTimeout(() => setReconnected(false), 2000);
          void load();
        }
      },
    });
    return close;
  }, [pid, load]);

  // Keep the cache close to what is on screen, so coming back shows the last live list.
  useEffect(() => {
    if (!pid || plans === null || !studio) return;
    cache.set(`plans:${pid}`, { plans, studio }, fetchedAt || Date.now());
  }, [pid, plans, studio, fetchedAt]);

  if (!pid) {
    return (
      <View style={styles.root}>
        <Header title={t(lang, 'projects.title')} back />
      </View>
    );
  }

  const offline = !online || requestOffline;
  const offlineAgo = fetchedAt ? ago(fetchedAt, lang) : t(lang, 'time.justNow');
  const studioLine = studio
    ? studio.online
      ? t(lang, 'common.studioOnline')
      : studio.lastSyncAt != null
        ? t(lang, 'common.studioOffline', { ago: ago(studio.lastSyncAt, lang) })
        : t(lang, 'common.studioOfflineShort')
    : '';

  return (
    <View style={styles.root} testID="project-home">
      <Header title={project?.name ?? t(lang, 'projects.title')} back onRefresh={() => void load()} refreshing={refreshing} />

      {offline ? (
        <SyncBanner kind="offline" text={t(lang, 'common.offlineYou', { ago: offlineAgo })} testID="offline-banner" />
      ) : socket === 'closed' ? (
        <SyncBanner kind="reconnecting" text={t(lang, 'home.reconnecting')} testID="reconnecting-banner" />
      ) : reconnected ? (
        <SyncBanner kind="restored" text={t(lang, 'home.reconnected')} testID="reconnected-banner" />
      ) : null}

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <View style={[styles.column, desktop && styles.columnDesktop]}>
          <View style={styles.head}>
            {project ? <Text style={styles.eyebrow}>{project.studioName}</Text> : null}
            {studioLine ? <Text style={[styles.syncLine, !studio?.online && styles.syncOffline]}>{studioLine}</Text> : null}
          </View>

          {loading ? (
            <Skeleton count={3} variant="row" />
          ) : error && !plans ? (
            <EmptyState
              title={error === 'offline' ? t(lang, 'common.offline') : t(lang, 'common.error')}
              action={<TextButton label={t(lang, 'common.retry')} onPress={() => void load()} testID="retry" />}
              testID="home-error"
            />
          ) : (plans ?? []).length === 0 ? (
            <EmptyState title={t(lang, 'home.empty')} testID="home-empty" />
          ) : (
            (plans ?? []).map((plan) => <PlanRow key={plan.planRef} plan={plan} />)
          )}
        </View>
      </ScrollView>

      <ActionDock>
        <PrimaryButton label={t(lang, 'home.newRequest')} onPress={() => router.push(`/new?project=${encodeURIComponent(pid)}`)} testID="primary" />
      </ActionDock>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: space[5], paddingTop: space[5], paddingBottom: space[7] },
  column: { width: '100%' },
  columnDesktop: { maxWidth: 720, alignSelf: 'center', paddingTop: space[4] },
  head: { marginBottom: space[5] },
  eyebrow: { ...type.eyebrow, color: color.text3 },
  syncLine: { ...type.caption, color: color.text3, marginTop: 6 },
  syncOffline: { color: color.warn },
});
