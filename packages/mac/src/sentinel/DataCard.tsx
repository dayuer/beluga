import { useEffect, useState } from 'react';
import type { Sentinel } from '@beluga/core/sentinel/model.js';
import { sizeWords } from '@beluga/core/sentinel/columns.js';
import { Icon } from '../components/Icon.js';
import { ActionsDropdown } from '../components/SpecMenu.js';
import { IconButton } from '../components/ui.js';
import { useApp } from '../lib/beluga.js';
import { openSheet } from '../lib/sheets.js';
import { ago } from '../tasks/tasks-model.js';
import { useSentinelActions } from './use-sentinel.js';
import t from '../tasks/tasks.module.css';
import s from './sentinel.module.css';
import d from './data.module.css';
import { revealLabel } from '../lib/os-words.js';
import { useT } from '../i18n/index.js';

type Data = Awaited<ReturnType<ReturnType<typeof useSentinelActions>['api']['dataList']>>;

/** Runs shown at first (the rest a click away). */
const FIRST_RUNS = 6;
const KIND_WORDS = new Set(['number', 'rows', 'series', 'output']);

/**
 * Kept data (BLG-392): everything a sentinel keeps, to look at and take out. Each metric with how
 * much of it is kept (a number's every run, a table's rows run by run, a kept output's last ones)
 * opens its whole history, with Export (CSV or JSON, to Downloads) and Show in Finder; each run that
 * kept files lists them (its report, each step's output, the documents its tables hold), and one
 * opens in Beluga's viewer. Below the History, when it keeps anything.
 */
export function DataCard({ item }: { item: Sentinel }) {
  const a = useSentinelActions();
  const tr = useT();
  const [data, setData] = useState<Data>();
  const [all, setAll] = useState(false);
  // Read again when a run ends (it may have kept more).
  const last = useApp((st) => st.sentinel.runs.filter((r) => r.sentinelId === item.id).reduce((n, r) => Math.max(n, r.endedAt ?? 0), 0));
  useEffect(() => {
    let alive = true;
    a.api.dataList(item.id).then(
      (got) => alive && setData(got),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [a, item.id, last]);
  if (!data || (!data.metrics.length && !data.runs.length)) return null;
  const runs = all ? data.runs : data.runs.slice(0, FIRST_RUNS);
  return (
    <section className={s.card} aria-label={tr('sentinel.data.kept')} data-testid="sentinel-data">
      <header className={s.cardHead}>
        <h3 className={s.cardTitle}>{tr('sentinel.data.kept')}</h3>
        <span className={t.grow} />
        <span className={s.hint}>{tr('sentinel.data.keepsDays', { n: data.keepsDays })}</span>
        {data.metrics.length ? <IconButton icon="folder" label={revealLabel('its numbers')} onClick={() => void a.act(() => a.api.dataReveal(item.id))} /> : null}
      </header>
      {data.metrics.length ? (
        <div className={d.list} role="list" aria-label={tr('sentinel.data.whatItKeeps')}>
          {data.metrics.map((m) => (
            <button key={m.name} type="button" role="listitem" className={d.row} data-metric={m.name} onClick={() => openSheet({ kind: 'sentinel_data', sentinelId: item.id, metric: m.name })}>
              <Icon name={m.kind === 'rows' ? 'table' : m.kind === 'output' ? 'file' : m.kind === 'series' ? 'chartBar' : 'chartLine'} size={13} className={d.icon} />
              <span className={d.name}>{m.label}</span>
              <span className={d.what}>{KIND_WORDS.has(m.kind) ? tr(`sentinel.data.kind.${m.kind as 'number' | 'rows' | 'series' | 'output'}`) : m.kind}</span>
              <span className={d.count}>
                {m.kind === 'rows' ? tr('sentinel.data.rowsOverRuns', { rows: (m.rows ?? 0).toLocaleString(), n: m.lines, runs: m.lines.toLocaleString() }) : tr('sentinel.data.runs', { n: m.lines, runs: m.lines.toLocaleString() })}
                {m.first ? tr('sentinel.data.since', { ago: ago(m.first) }) : ''}
              </span>
              <Icon name="chevronRight" size={12} className={d.more} />
            </button>
          ))}
        </div>
      ) : null}
      {data.runs.length ? (
        <>
          <h4 className={d.sub}>{tr('sentinel.data.files')}</h4>
          <div className={d.list} role="list" aria-label={tr('sentinel.data.files')}>
            {runs.map((r) => (
              <div key={r.runId} role="listitem" className={d.runRow} data-run={r.runId}>
                <button type="button" className={d.runWhen} onClick={() => a.openRun(r.runId)} title={tr('sentinel.data.openRun')}>
                  {ago(r.at)}
                </button>
                <span className={d.files}>
                  {r.files.map((f) => (
                    <button key={f.name} type="button" className={d.file} title={`${f.label} · ${sizeWords(f.size)}`} onClick={() => openSheet({ kind: 'sentinel_document', source: 'run', sentinelId: item.id, metric: r.runId, column: '', name: f.name })}>
                      <Icon name={f.kind === 'report' ? 'book' : f.kind === 'step' ? 'terminal' : 'file'} size={11} />
                      <span>{f.label}</span>
                    </button>
                  ))}
                </span>
                <ActionsDropdown
                  items={[
                    { label: tr('sentinel.data.saveFiles'), icon: 'download', onSelect: () => void a.act(() => a.api.dataExport(item.id, { runId: r.runId }), tr('sentinel.data.saved')) },
                    { label: revealLabel(), icon: 'folder', onSelect: () => void a.act(() => a.api.dataReveal(item.id, r.runId)) },
                  ]}
                >
                  <IconButton icon="more" label={tr('sentinel.data.moreForRun')} />
                </ActionsDropdown>
              </div>
            ))}
          </div>
          {data.runs.length > FIRST_RUNS ? (
            <button type="button" className={d.showAll} onClick={() => setAll(!all)}>
              {all ? tr('sentinel.data.fewerRuns') : tr('sentinel.data.allRuns', { n: data.runs.length })}
            </button>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
