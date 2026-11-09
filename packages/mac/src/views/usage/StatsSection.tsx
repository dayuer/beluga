import { useMemo } from 'react';
import type { AppState } from '@beluga/core/store.js';
import { EMPTY_STATS, type StatRange, dailySeries } from '@beluga/shared/stats.js';
import { Icon } from '../../components/Icon.js';
import { Segmented, cx } from '../../components/ui.js';
import { Calendar } from './Calendar.js';
import { Highlights, Hours } from './HoursCard.js';
import { Card, Chapter } from './parts.js';
import { Share } from './ShareCard.js';
import { type GroupBy, type Metric, type MetricDef, METRICS, asideOf, calendar, change, groupRows, metricOf, rangeTotals } from './stats-model.js';
import { TrendChart, type TrendMode } from './TrendChart.js';
import { trendOf } from './trend-model.js';
import { type GotStats, usePicked } from './use-stats.js';
import s from './stats.module.css';
import { type Key, useT } from '../../i18n/index.js';

// Dictionary keys: each is looked up where it's shown, in the language shown.
const RANGES: ReadonlyArray<{ value: StatRange; label: Key; hint: Key }> = [
  { value: 'week', label: 'views.statsSec.week', hint: 'views.statsSec.weekHint' },
  { value: 'month', label: 'views.statsSec.month', hint: 'views.statsSec.monthHint' },
  { value: 'year', label: 'views.statsSec.year', hint: 'views.statsSec.yearHint' },
  { value: 'all', label: 'views.statsSec.all', hint: 'views.statsSec.allHint' },
];
const GROUPS: ReadonlyArray<{ value: GroupBy; label: Key; icon: 'folder' | 'bot' }> = [
  { value: 'project', label: 'views.statsSec.projects', icon: 'folder' },
  { value: 'agent', label: 'views.statsSec.agents', icon: 'bot' },
];
const MODES: ReadonlyArray<{ value: TrendMode; label: Key; hint: Key }> = [
  { value: 'stacked', label: 'views.statsSec.stacked', hint: 'views.statsSec.stackedHint' },
  { value: 'share', label: 'views.statsSec.share', hint: 'views.statsSec.shareHint' },
];
const BEFORE: Record<StatRange, Key> = { week: 'views.statsSec.beforeWeek', month: 'views.statsSec.beforeMonth', year: 'views.statsSec.beforeYear', all: 'views.statsSec.beforeAll' };
const STEP: Record<StatRange, Key> = { week: 'views.statsSec.aDay', month: 'views.statsSec.aDay', year: 'views.statsSec.aWeek', all: 'views.statsSec.aMonth' };

/** One number on the strip: pressing it shows it in the calendar and the ranking. */
function StatCell({
  m,
  totals,
  before,
  on,
  onPick,
  range,
  noGitHub,
}: {
  noGitHub: boolean;
  m: MetricDef;
  totals: ReturnType<typeof rangeTotals>['now'];
  before?: ReturnType<typeof rangeTotals>['now'];
  on: boolean;
  onPick: () => void;
  range: StatRange;
}) {
  const t = useT();
  const value = m.value(totals);
  const delta = before ? change(value, m.value(before)) : undefined;
  return (
    <button type="button" role="tab" aria-selected={on} className={cx(s.cell, on && s.cellOn)} style={{ '--m': m.color } as React.CSSProperties} onClick={onPick}>
      <span className={s.cellLabel}>
        <Icon name={m.icon} size={13} />
        {m.label}
      </span>
      <span className={s.cellValue}>{m.format(value)}</span>
      <span className={s.cellAside}>
        <span className={s.cellAsideText}>{asideOf(m, totals, noGitHub)}</span>
        {delta ? (
          <span className={cx(s.delta, delta.up ? s.deltaUp : s.deltaDown)} title={t('views.statsSec.against', { before: t(BEFORE[range]) })}>
            {delta.text}
          </span>
        ) : null}
      </span>
    </button>
  );
}

/**
 * Your stats: what you and your agents did, as a strip of numbers for the range you pick (each
 * pressable: it's what the charts show), that number over time by project or agent, the last year
 * as a calendar, each one's share, when you work, and a few highlights. The daemon counts
 * (core/stats/); this only draws what it sent.
 */
export function StatsSection({ state, got }: { state: AppState; got: GotStats }) {
  const { stats, at: now, failed } = got;
  const t = useT();
  const opts = <V extends string>(list: ReadonlyArray<{ value: V; label: Key; hint?: Key; icon?: 'folder' | 'bot' }>) => list.map((o) => ({ ...o, label: t(o.label), ...(o.hint ? { hint: t(o.hint) } : {}) }));
  // Projects change with every git status: the charts only care about their roots, names and order.
  const projectsKey = state.projects.map((p) => `${p.id}\t${p.root}\t${p.name}`).join('\n');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const projects = useMemo(() => state.projects, [projectsKey]);
  const [range, setRange] = usePicked<StatRange>('beluga.stats.range', 'month', ['week', 'month', 'year', 'all']);
  const [by, setBy] = usePicked<GroupBy>('beluga.stats.by', 'project', ['project', 'agent']);
  const [mode, setMode] = usePicked<TrendMode>('beluga.stats.mode', 'stacked', ['stacked', 'share']);
  const [metric, setMetric] = usePicked<Metric>(
    'beluga.stats.metric',
    'agentMs',
    METRICS.map((m) => m.id),
  );
  const m = metricOf(metric);
  const data = stats ?? EMPTY_STATS;
  const totals = useMemo(() => rangeTotals(data, range, now), [data, range, now]);
  const trend = useMemo(() => trendOf(data, projects, by, m, range, now), [data, projects, by, m, range, now]);
  const weeks = useMemo(() => {
    const series = dailySeries(data, m.daily, now, 371);
    const removed = m.id === 'lines' ? dailySeries(data, 'linesRemoved', now, 371) : undefined;
    return calendar(removed ? series.map((d, i) => ({ key: d.key, value: d.value + removed[i]!.value })) : series, now);
  }, [data, m, now]);
  const rows = useMemo(() => groupRows(data, projects, by, m, range, now), [data, projects, by, m, range, now]);
  const since = data.since ? new Date(data.since).toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' }) : undefined;
  const byWord = by === 'agent' ? t('views.statsSec.agentWord') : t('views.statsSec.projectWord');
  // Pull requests come from GitHub: without its CLI, say so instead of an empty chart.
  const why = m.github && data.noGitHub ? t('views.statsSec.needGh') : undefined;
  return (
    <section className={s.section} aria-label={t('views.statsSec.aria')}>
      <Chapter
        title={t('views.statsSec.title')}
        sub={failed ? t('views.statsSec.failed') : data.backfilling ? t('views.statsSec.backfilling') : since ? t('views.statsSec.since', { since }) : t('views.statsSec.fromToday')}
        aside={
          <>
            <Segmented label={t('views.statsSec.groupBy')} value={by} options={opts(GROUPS)} onChange={setBy} />
            <Segmented label={t('views.earnings.range')} value={range} options={opts(RANGES)} onChange={setRange} />
          </>
        }
      >
        <div className={s.stripFit}>
          <div className={s.strip} role="tablist" aria-label={t('views.statsSec.whatToShow')}>
            {METRICS.map((x) => (
              <StatCell key={x.id} m={x} totals={totals.now} {...(totals.before ? { before: totals.before } : {})} on={x.id === metric} onPick={() => setMetric(x.id)} range={range} noGitHub={Boolean(data.noGitHub)} />
            ))}
          </div>
        </div>
        <Card
          label={t('views.trend.overTime', { metric: m.label })}
          title={
            <span className={s.cardTitle}>
              <Icon name="chartArea" size={14} /> {t('views.statsSec.byAtATime', { metric: m.label, by: byWord, step: t(STEP[range]) })}
            </span>
          }
          aside={<Segmented label={t('views.statsSec.chart')} value={mode} options={opts(MODES)} onChange={setMode} />}
        >
          <TrendChart key={by} trend={trend} m={m} mode={mode} animate={`${range}|${metric}|${mode}`} {...(why ? { why } : {})} />
        </Card>
      </Chapter>
      <Chapter title={t('views.statsSec.rhythm')} sub={t('views.statsSec.rhythmSub', { metric: m.label.toLowerCase() })}>
        <Highlights stats={data} now={now} rows={rows} by={by} />
        <Card
          title={
            <span className={s.cardTitle}>
              <Icon name="calendar" size={14} /> {t('views.statsSec.everyDay', { metric: m.label })}
            </span>
          }
        >
          <Calendar weeks={weeks} m={m} {...(why ? { why } : {})} />
        </Card>
        <div className={s.pairFit}>
          <div className={cx(s.pair, s.pairEven)}>
            <Card title={t('views.statsSec.shareBy', { by: byWord })}>
              <Share rows={rows} m={m} by={by} {...(why ? { why } : {})} />
            </Card>
            <Card title={t('views.statsSec.when')}>
              <Hours hours={data.hours} />
            </Card>
          </div>
        </div>
      </Chapter>
    </section>
  );
}
