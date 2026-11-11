import { StyleSheet, Text, View } from 'react-native';
import type { StudioPlanView } from '../../../src/studio/protocol';
import { currentMilestone } from '../lib/plan-graph';
import type { PagePhase } from '../lib/plan-phase';
import { t, type Lang } from '../lib/strings';
import { color, space, type } from '../lib/theme';
import { ago } from '../lib/time';

interface PlanHeaderProps {
  readonly view: StudioPlanView;
  readonly phase: PagePhase;
  readonly lang: Lang;
  readonly studioOnline: boolean;
  readonly fetchedAt: number;
}

/** The plan's one line, its progress, and who it is waiting on right now (M5 §9, M6 §4.2). */
export function PlanHeader({ view, phase, lang, studioOnline, fetchedAt }: PlanHeaderProps) {
  const status = statusOf(view, phase, lang);
  const offlineLine = studioOnline
    ? null
    : t(lang, 'common.studioOffline', { ago: fetchedAt ? ago(fetchedAt, lang) : t(lang, 'time.justNow') });

  return (
    <View style={styles.root} testID="plan-header">
      <Text style={styles.headline} numberOfLines={2}>
        {view.headline.trim() || t(lang, 'plan.titleFallback')}
      </Text>
      {view.progress.total > 0 ? (
        <View style={styles.progressRow}>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${Math.min(100, (view.progress.done / view.progress.total) * 100)}%` }]} />
          </View>
          <Text style={styles.progressText}>
            {view.progress.done} / {view.progress.total}
          </Text>
        </View>
      ) : null}
      <View style={styles.statusRow} accessibilityLiveRegion="polite">
        <View style={[styles.dot, { backgroundColor: status.color }]} />
        <Text style={styles.status} testID="plan-status" numberOfLines={2}>
          {status.text}
        </Text>
      </View>
      {offlineLine ? (
        <Text style={styles.offline} testID="studio-offline" numberOfLines={1}>
          {offlineLine}
        </Text>
      ) : null}
    </View>
  );
}

function statusOf(view: StudioPlanView, phase: PagePhase, lang: Lang): { text: string; color: string } {
  switch (phase) {
    case 'decide':
      return { text: t(lang, 'plan.waitAnswer', { n: view.decisions.filter((d) => d.open).length }), color: color.warn };
    case 'review': {
      const m = view.milestones.find((x) => x.status === 'review');
      return { text: t(lang, 'plan.waitReview', { m: m?.title ?? '' }), color: color.warn };
    }
    case 'changes':
      return { text: t(lang, 'plan.waitChanges'), color: color.warn };
    case 'confirm':
      return { text: t(lang, 'plan.waitConfirm'), color: color.warn };
    case 'awaiting-start':
      return { text: t(lang, 'plan.waitStudioStart'), color: color.text2 };
    case 'awaiting-changes':
      return { text: t(lang, 'plan.waitStudioChanges'), color: color.text2 };
    case 'drafting-ai':
      return { text: t(lang, view.milestones.length ? 'plan.aiUpdating' : 'plan.aiDrafting'), color: color.ok };
    case 'running': {
      const m = currentMilestone(view);
      return m
        ? {
            text: t(lang, 'plan.aiWorking', { m: m.title, d: m.tasks.filter((x) => x.status === 'done').length, t: m.tasks.length }),
            color: color.ok,
          }
        : { text: t(lang, 'plan.aiWorkingGeneric'), color: color.ok };
    }
    case 'done':
      return { text: t(lang, 'plan.done'), color: color.text3 };
  }
}

const styles = StyleSheet.create({
  root: {
    paddingHorizontal: space[5],
    paddingTop: space[4],
    paddingBottom: space[4],
    gap: space[3],
    backgroundColor: color.bg,
  },
  headline: { ...type.heading, color: color.text },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  track: { flex: 1, height: 4, borderRadius: 2, backgroundColor: color.hairlineStrong, overflow: 'hidden' },
  fill: { height: 4, borderRadius: 2, backgroundColor: color.text },
  progressText: { ...type.caption, color: color.text2 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  dot: { width: 7, height: 7, borderRadius: 999, flexShrink: 0 },
  status: { ...type.callout, color: color.text, flex: 1 },
  offline: { ...type.caption, color: color.text2 },
});
