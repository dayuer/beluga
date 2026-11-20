import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { MapItem, OutlineMilestone, PlanTone } from '../../../ui-plan';
import { detectLang, t, type Lang } from '../../lib/strings';
import { color, space, type } from '../../lib/theme';
import type { RequestStep, ResultDrawerView, StepStatus } from '../../lib/views';
import { ActivityList } from '../ActivityList';
import { PlanMap } from '../plan/PlanMap';
import { PlanOutline } from '../plan/PlanOutline';
import { Segments } from '../Segments';

export type PlanSubTab = 'map' | 'outline' | 'activity';

export interface PlanTabProps {
  readonly plan: ResultDrawerView['plan'];
  readonly lang?: Lang;
  readonly initialSubTab?: PlanSubTab;
  readonly testID?: string;
}

const STEP_TONE: Record<StepStatus, PlanTone> = {
  done: 'mint',
  active: 'sky',
  waiting: 'butter',
  todo: 'plain',
};

const STEP_LABEL_KEY: Record<
  StepStatus,
  'steps.status.done' | 'steps.status.active' | 'steps.status.waiting' | 'steps.status.todo'
> = {
  done: 'steps.status.done',
  active: 'steps.status.active',
  waiting: 'steps.status.waiting',
  todo: 'steps.status.todo',
};

function toMapItems(milestones: readonly RequestStep[], lang: Lang): MapItem[] {
  return milestones.map((m, i) => ({
    id: m.id,
    title: m.title,
    index: i + 1,
    tone: STEP_TONE[m.status],
    statusLabel: t(lang, STEP_LABEL_KEY[m.status]),
    done: m.status === 'done' ? 1 : 0,
    total: 1,
    emphasized: m.status === 'active',
    passed: m.status === 'done',
  }));
}

function toOutlineMilestones(milestones: readonly RequestStep[], lang: Lang): OutlineMilestone[] {
  return milestones.map((m, i) => ({
    id: m.id,
    title: m.title,
    index: i + 1,
    tone: STEP_TONE[m.status],
    statusLabel: t(lang, STEP_LABEL_KEY[m.status]),
    goal: m.summary ?? '',
    criteria: [],
    done: m.status === 'done' ? 1 : 0,
    total: 1,
    tasks: [],
  }));
}

/**
 * 抽屉页签：计划（SS-48）：用 Segments 分「图 / 大纲 / 动态」三档，
 * 复用 PlanMap（plan-graph 体系）、PlanOutline 与 ActivityList。
 */
export function PlanTab({ plan, lang: langProp, initialSubTab = 'map', testID = 'drawer-plan-tab' }: PlanTabProps) {
  const lang = langProp ?? detectLang();
  const [subTab, setSubTab] = useState<PlanSubTab>(initialSubTab);
  const [openIds, setOpenIds] = useState<string[]>(() =>
    plan.milestones.filter((m) => m.status === 'active').map((m) => m.id),
  );

  const items = useMemo(() => toMapItems(plan.milestones, lang), [plan.milestones, lang]);
  const outline = useMemo(() => toOutlineMilestones(plan.milestones, lang), [plan.milestones, lang]);

  const toggleOutline = (id: string) => {
    setOpenIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  };

  const segments = [
    { key: 'map', label: t(lang, 'plan.tabMap'), testID: 'plan-subtab-map' },
    { key: 'outline', label: t(lang, 'plan.tabOutline'), testID: 'plan-subtab-outline' },
    { key: 'activity', label: t(lang, 'plan.tabActivity'), testID: 'plan-subtab-activity' },
  ];

  return (
    <View style={styles.root} testID={testID}>
      <Segments items={segments} value={subTab} onChange={(k) => setSubTab(k as PlanSubTab)} />

      <View style={styles.content}>
        {subTab === 'map' ? (
          items.length > 0 ? (
            <PlanMap items={items} onPick={(id) => {
              setOpenIds((cur) => (cur.includes(id) ? cur : [...cur, id]));
              setSubTab('outline');
            }} />
          ) : (
            <Text style={[styles.empty, { color: color.text3 }]}>{t(lang, 'plan.noMilestones')}</Text>
          )
        ) : subTab === 'outline' ? (
          outline.length > 0 ? (
            <PlanOutline milestones={outline} open={openIds} onToggle={toggleOutline} />
          ) : (
            <Text style={[styles.empty, { color: color.text3 }]}>{t(lang, 'plan.noMilestones')}</Text>
          )
        ) : (
          <ActivityList activity={plan.activity} lang={lang} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space[3] },
  content: { minHeight: 160 },
  empty: { ...type.callout, paddingVertical: space[5], textAlign: 'center' },
});
