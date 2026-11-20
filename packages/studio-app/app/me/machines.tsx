import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { EmptyState } from '../../components/EmptyState';
import { Header } from '../../components/Header';
import { ProgressRing } from '../../components/ProgressRing';
import { Skeleton } from '../../components/Skeleton';
import { StatusDot } from '../../components/StatusDot';
import { SyncBanner } from '../../components/SyncBanner';
import { isDemoMode } from '../../lib/client';
import { DEMO_REQUEST_SUMMARIES } from '../../lib/demo';
import { useSettingsView } from '../../lib/settings-source';
import { detectLang, t } from '../../lib/strings';
import { tMe } from '../../lib/strings/me';
import { color, radius, space, type } from '../../lib/theme';

/**
 * 我 › 执行机器（只读，SS-56）：
 * 展示几台、是否在线、能不能接单、正在做哪几条需求、本月用量（ProgressRing）；
 * 离线写「等待」灰色。
 */
export default function MeMachinesScreen() {
  const lang = detectLang();
  const { width } = useWindowDimensions();
  const desktop = width >= 900;

  const { data: settings, loading, offline } = useSettingsView();
  const runners = settings.runners;
  const onlineCount = runners.filter((r) => r.online).length;
  const acceptingCount = runners.filter((r) => r.online && r.accepting).length;
  const activeRequests = isDemoMode()
    ? DEMO_REQUEST_SUMMARIES.filter((r) => r.status === 'working' || r.status === 'needs-you')
    : [];

  return (
    <View style={styles.root} testID="me-machines-screen">
      <Header title={tMe(lang, 'machines.title')} back />
      {offline ? (
        <SyncBanner kind="offline" text={t(lang, 'common.offline')} testID="offline-banner" />
      ) : null}
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <View style={[styles.column, desktop && styles.columnDesktop]}>
          {loading ? (
            <View testID="machines-skeleton">
              <Skeleton count={3} />
            </View>
          ) : runners.length === 0 ? (
            <EmptyState title={tMe(lang, 'machines.empty')} testID="machines-empty" />
          ) : (
            <>
              <Text style={styles.summary} testID="machines-summary">
                {tMe(lang, 'machines.summary', {
                  total: runners.length,
                  online: onlineCount,
                  accepting: acceptingCount,
                })}
              </Text>

              <View style={styles.list}>
                {runners.map((runner) => {
                  const hasQuota =
                    typeof runner.monthlyQuotaUsed === 'number' &&
                    typeof runner.monthlyQuotaLimit === 'number' &&
                    runner.monthlyQuotaLimit > 0;
                  const ratio = hasQuota
                    ? runner.monthlyQuotaUsed! / runner.monthlyQuotaLimit!
                    : 0;
                  const nearFull = ratio >= 0.8;

                  return (
                    <View key={runner.id} style={styles.card} testID={`runner-${runner.id}`}>
                      <View style={styles.cardTop}>
                        <View style={styles.titleBlock}>
                          <View style={styles.nameRow}>
                            <StatusDot status={runner.online ? 'working' : 'waiting'} />
                            <Text style={styles.name}>{runner.name}</Text>
                          </View>
                          <Text
                            style={[
                              styles.statusText,
                              !runner.online && styles.waitingText,
                            ]}
                            testID={`runner-status-${runner.id}`}
                          >
                            {!runner.online
                              ? tMe(lang, 'machines.waiting')
                              : runner.accepting
                                ? tMe(lang, 'machines.online')
                                : tMe(lang, 'machines.onlineBusy')}
                          </Text>
                        </View>

                        {hasQuota ? (
                          <View style={styles.ringBlock} testID={`runner-quota-${runner.id}`}>
                            <ProgressRing
                              done={runner.monthlyQuotaUsed!}
                              total={runner.monthlyQuotaLimit!}
                              tone={nearFull ? 'warn' : 'text'}
                              size={44}
                            />
                            <Text style={[styles.quotaText, nearFull && styles.quotaWarn]}>
                              {tMe(lang, 'machines.quota', {
                                used: runner.monthlyQuotaUsed!,
                                limit: runner.monthlyQuotaLimit!,
                              })}
                            </Text>
                          </View>
                        ) : null}
                      </View>

                      <View style={styles.activeBox}>
                        <Text style={styles.activeLabel}>
                          {tMe(lang, 'machines.activeCount', {
                            n: runner.activeRequestCount,
                          })}
                        </Text>
                        {runner.activeRequestCount > 0
                          ? activeRequests
                              .slice(0, runner.activeRequestCount)
                              .map((req) => (
                                <Text key={req.id} style={styles.activeItem} numberOfLines={1}>
                                  · {req.projectName} · {req.title}
                                </Text>
                              ))
                          : null}
                      </View>
                    </View>
                  );
                })}
              </View>
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
  content: { flexGrow: 1, paddingHorizontal: space[5], paddingTop: space[5], paddingBottom: space[7] },
  column: { flex: 1, width: '100%' },
  columnDesktop: { maxWidth: 720, alignSelf: 'center', paddingTop: space[4] },
  summary: { ...type.caption, fontWeight: '600', color: color.text3, marginBottom: space[3] },
  list: { gap: space[4] },
  card: {
    backgroundColor: color.card,
    borderRadius: radius.l,
    borderWidth: 1,
    borderColor: color.hairline,
    padding: space[4],
    gap: space[3],
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[3],
  },
  titleBlock: { flex: 1, gap: space[1] },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  name: { ...type.heading, color: color.text },
  statusText: { ...type.callout, color: color.text2 },
  waitingText: { color: color.text3 },
  ringBlock: { alignItems: 'center', gap: space[1] },
  quotaText: { ...type.caption, color: color.text3 },
  quotaWarn: { color: color.warn, fontWeight: '600' },
  activeBox: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.hairline,
    paddingTop: space[3],
    gap: 4,
  },
  activeLabel: { ...type.caption, fontWeight: '600', color: color.text2 },
  activeItem: { ...type.caption, color: color.text3 },
});
