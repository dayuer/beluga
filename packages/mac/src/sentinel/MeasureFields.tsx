import { useState } from 'react';
import type { Source } from '@beluga/shared/view-spec.js';
import { type Better, type MeasureFrom, type MeasureStep, type MetricSpec, type MetricUnit, ROWS_KEPT } from '@beluga/core/sentinel/model.js';
import { metricName } from '@beluga/core/sentinel/metrics.js';
import { TextInput } from '../components/FormSheet.js';
import { CodeEditor } from '../components/markdown/CodeEditor.js';
import { Select } from '../components/Select.js';
import { Button, IconButton } from '../components/ui.js';
import { useDraft } from './use-draft.js';
import { useT } from '../i18n/index.js';

type Tr = ReturnType<typeof useT>;
import s from './sentinel.module.css';

/**
 * Keep the numbers (docs/sentinel.md §10): what it reads (the step before, a source, or what
 * Claude keeps), and each number it keeps: its label, where it is (a JSON path or a column), its
 * unit, and which way is good. A unit of Rows keeps a table instead.
 */

const fromChoices = (tr: Tr): ReadonlyArray<{ readonly value: MeasureFrom; readonly label: string; readonly description: string }> => [
  { value: 'previous', label: tr('sentinel.measure.from.previous'), description: tr('sentinel.measure.from.previousDetail') },
  { value: 'source', label: tr('sentinel.measure.from.source'), description: tr('sentinel.measure.from.sourceDetail') },
  { value: 'claude', label: tr('sentinel.measure.from.claude'), description: tr('sentinel.measure.from.claudeDetail') },
];

type UnitChoice = MetricUnit | 'rows' | 'series' | 'output';
const unitChoices = (tr: Tr): ReadonlyArray<{ readonly value: UnitChoice; readonly label: string }> => [
  { value: 'count', label: tr('sentinel.measure.unit.count') },
  { value: 'currency:USD', label: tr('sentinel.measure.unit.usd') },
  { value: 'currency:EUR', label: tr('sentinel.measure.unit.eur') },
  { value: 'currency:GBP', label: tr('sentinel.measure.unit.gbp') },
  { value: 'percent', label: tr('sentinel.measure.unit.percent') },
  { value: 'ms', label: tr('sentinel.measure.unit.ms') },
  { value: 'bytes', label: tr('sentinel.measure.unit.bytes') },
  { value: 'plain', label: tr('sentinel.measure.unit.plain') },
  { value: 'rows', label: tr('sentinel.measure.unit.rows') },
  { value: 'series', label: tr('sentinel.measure.unit.series') },
  { value: 'output', label: tr('sentinel.measure.unit.output') },
];
const betterChoices = (tr: Tr): ReadonlyArray<{ readonly value: Better; readonly label: string; readonly description: string }> => [
  { value: 'up', label: tr('sentinel.measure.better.up'), description: tr('sentinel.measure.better.upDetail') },
  { value: 'down', label: tr('sentinel.measure.better.down'), description: tr('sentinel.measure.better.downDetail') },
  { value: 'none', label: tr('sentinel.measure.better.none'), description: tr('sentinel.measure.better.noneDetail') },
];
const sourceKinds = (tr: Tr): ReadonlyArray<{ readonly value: Source['kind']; readonly label: string }> => [
  { value: 'postgres', label: tr('sentinel.measure.source.postgres') },
  { value: 'sqlite', label: tr('sentinel.measure.source.sqlite') },
  { value: 'command', label: tr('sentinel.cards.aCommand') },
  { value: 'http', label: tr('sentinel.measure.source.http') },
  { value: 'file', label: tr('sentinel.measure.source.file') },
];
const KEEP = [20, 50, 100, ROWS_KEPT] as const;

const unitOf = (m: MetricSpec): UnitChoice => (m.kind === 'rows' || m.kind === 'series' || m.kind === 'output' ? m.kind : (m.unit ?? 'count'));

function newSource(kind: Source['kind']): Source {
  switch (kind) {
    case 'postgres':
      return { kind, env: 'DATABASE_URL', query: 'select count(*) as count from customers' };
    case 'sqlite':
      return { kind, path: 'data.db', query: 'select count(*) as count from customers' };
    case 'command':
      return { kind, command: 'echo 42', format: 'auto' };
    case 'http':
      return { kind, url: 'https://api.example.com/stats', method: 'GET', format: 'auto' };
    default:
      return { kind: 'file', path: 'stats.json', format: 'auto' };
  }
}

export function MeasureFields({ step, change }: { step: MeasureStep; change: (patch: Partial<MeasureStep>) => void }) {
  const tr = useT();
  const FROM = fromChoices(tr);
  const from = FROM.find((f) => f.value === step.from);
  const setMetric = (i: number, patch: Partial<MetricSpec>): void => change({ metrics: step.metrics.map((m, n) => (n === i ? clean({ ...m, ...patch }) : m)) });
  const rows = step.metrics.some((m) => m.kind === 'rows');
  return (
    <>
      <div className={s.controlRow}>
        <span className={s.controlLabel}>{tr('sentinel.measure.reads')}</span>
        <Select label={tr('sentinel.measure.whatItReads')} size="small" value={step.from} options={FROM} onChange={(f) => change(f === 'source' ? { from: f, source: step.source ?? newSource('postgres') } : { from: f })} />
      </div>
      {from ? <p className={s.hint}>{tr('sentinel.cards.sentenceEnd', { text: from.description })}</p> : null}
      {step.from === 'source' && step.source ? <SourceFields source={step.source} change={(source) => change({ source })} /> : null}
      <div className={s.field}>
        <span className={s.fieldLabel}>{tr('sentinel.measure.numbersItKeeps')}</span>
        {step.metrics.length ? (
          <div className={s.headers} role="list" aria-label={tr('sentinel.measure.numbersItKeeps')}>
            {step.metrics.map((m, i) => (
              <MetricRow key={`${m.name}-${i}`} m={m} index={i} from={step.from} change={(patch) => setMetric(i, patch)} remove={() => change({ metrics: step.metrics.filter((_, n) => n !== i) })} />
            ))}
          </div>
        ) : (
          <p className={s.hint}>{step.from === 'claude' ? tr('sentinel.measure.emptyClaude') : tr('sentinel.measure.emptyOther')}</p>
        )}
        <div>
          <Button
            size="small"
            icon="plus"
            onClick={() => {
              const taken = new Set(step.metrics.map((m) => m.name));
              let name = 'value';
              for (let n = 2; taken.has(name); n++) name = `value-${n}`;
              change({ metrics: [...step.metrics, { name, label: '', unit: 'count', better: 'up' }] });
            }}
          >
            {tr('sentinel.measure.addNumber')}
          </Button>
        </div>
        <span className={s.help}>{step.from === 'claude' ? tr('sentinel.measure.nameHelp') : tr('sentinel.measure.pickHelp')}</span>
      </div>
      {rows ? (
        <div className={s.controlRow}>
          <span className={s.controlLabel}>{tr('sentinel.measure.rowsKept')}</span>
          <Select label={tr('sentinel.measure.rowsKeptEachRun')} size="small" value={String(step.keep ?? ROWS_KEPT)} options={KEEP.map((k) => ({ value: String(k), label: tr('sentinel.numbers.rows', { n: k }) }))} onChange={(v) => change({ keep: Number(v) })} />
        </div>
      ) : null}
    </>
  );
}

/** A spec without its empty fields (the daemon checks names; labels and paths are optional). */
function clean(m: MetricSpec): MetricSpec {
  return Object.fromEntries(Object.entries(m).filter(([, v]) => v !== undefined && v !== '')) as unknown as MetricSpec;
}

function MetricRow({ m, index, from, change, remove }: { m: MetricSpec; index: number; from: MeasureFrom; change: (patch: Partial<MetricSpec>) => void; remove: () => void }) {
  // Only one just added (still “value”, “value-2”…) is named by its label: another's name is its file, its tiles' link and maybe where it's read.
  const [named, setNamed] = useState(Boolean(m.label) || !/^value(-\d+)?$/.test(m.name));
  const label = useDraft(m.label ?? '', (v) => {
    if (v === (m.label ?? '')) return;
    // A new number takes its name from its label, until it's kept once (the name is its file).
    change({ label: v, ...(!named && v.trim() ? { name: metricName(v) } : {}) });
    if (v.trim()) setNamed(true);
  });
  const pick = useDraft(m.pick ?? '', (v) => v !== (m.pick ?? '') && change({ pick: v }));
  const name = useDraft(m.name, (v) => {
    const next = metricName(v);
    if (next !== m.name) change({ name: next });
  });
  const unit = unitOf(m);
  const tr = useT();
  const UNITS = unitChoices(tr);
  return (
    <div className={s.metricRow} role="listitem" data-metric={m.name}>
      <TextInput value={label.text} onChange={label.change} onBlur={label.flush} placeholder={tr('sentinel.measure.labelPlaceholder')} aria-label={tr('sentinel.measure.numberLabel', { n: index + 1 })} />
      {from === 'claude' ? (
        <TextInput value={name.text} onChange={name.change} onBlur={name.flush} mono placeholder={tr('sentinel.measure.namePlaceholder')} aria-label={tr('sentinel.measure.numberName', { n: index + 1 })} />
      ) : (
        <TextInput value={pick.text} onChange={pick.change} onBlur={pick.flush} mono placeholder={m.name} aria-label={tr('sentinel.measure.numberWhere', { n: index + 1 })} />
      )}
      <Select<UnitChoice>
        label={tr('sentinel.measure.numberUnit', { n: index + 1 })}
        size="small"
        value={unit}
        options={UNITS.some((u) => u.value === unit) ? UNITS : [...UNITS, { value: unit, label: unit }]}
        onChange={(u) => change(u === 'rows' || u === 'output' ? { kind: u, unit: undefined, better: 'none' } : u === 'series' ? { kind: 'series', unit: undefined } : { kind: undefined, unit: u })}
      />
      {m.kind === 'rows' || m.kind === 'output' ? <span /> : <Select<Better> label={tr('sentinel.measure.numberBetter', { n: index + 1 })} size="small" value={m.better ?? 'up'} options={betterChoices(tr)} onChange={(better) => change({ better })} />}
      <IconButton icon="x" label={tr('sentinel.cards.removeHeader', { what: m.label || m.name })} onClick={remove} />
    </div>
  );
}

function SourceFields({ source, change }: { source: Source; change: (s: Source) => void }) {
  const text = source.kind === 'postgres' || source.kind === 'sqlite' ? source.query : source.kind === 'command' ? source.command : source.kind === 'http' ? source.url : source.path;
  const main = useDraft(text, (v) => {
    if (v === text || !v.trim()) return;
    change(source.kind === 'postgres' || source.kind === 'sqlite' ? { ...source, query: v } : source.kind === 'command' ? { ...source, command: v } : source.kind === 'http' ? { ...source, url: v } : { ...source, path: v });
  });
  const tr = useT();
  const SOURCE_KINDS = sourceKinds(tr);
  const second = source.kind === 'postgres' ? (source.env ?? '') : source.kind === 'sqlite' ? source.path : undefined;
  const other = useDraft(second ?? '', (v) => {
    if (second === undefined || v === second || !v.trim()) return;
    change(source.kind === 'postgres' ? { ...source, env: v.trim().replace(/^\$/, '') } : source.kind === 'sqlite' ? { ...source, path: v.trim() } : source);
  });
  return (
    <>
      <div className={s.controlRow}>
        <span className={s.controlLabel}>{tr('sentinel.measure.source')}</span>
        <Select<Source['kind']> label={tr('sentinel.measure.source')} size="small" value={source.kind} options={SOURCE_KINDS.some((k) => k.value === source.kind) ? SOURCE_KINDS : [...SOURCE_KINDS, { value: source.kind, label: source.kind }]} onChange={(k) => k !== source.kind && change(newSource(k))} />
      </div>
      {second !== undefined ? (
        <div className={s.controlRow}>
          <span className={s.controlLabel}>{source.kind === 'postgres' ? tr('sentinel.measure.connectionIn') : tr('sentinel.measure.databaseFile')}</span>
          <TextInput value={other.text} onChange={other.change} onBlur={other.flush} mono placeholder={source.kind === 'postgres' ? 'DATABASE_URL' : 'data.db'} aria-label={source.kind === 'postgres' ? tr('sentinel.measure.connectionVar') : tr('sentinel.measure.theDatabaseFile')} />
        </div>
      ) : null}
      <div className={s.field}>
        <span className={s.fieldLabel}>{source.kind === 'postgres' || source.kind === 'sqlite' ? tr('sentinel.measure.query') : source.kind === 'command' ? tr('sentinel.cards.command') : source.kind === 'http' ? tr('sentinel.event.address') : tr('sentinel.measure.path')}</span>
        {source.kind === 'postgres' || source.kind === 'sqlite' ? (
          <CodeEditor value={main.text} onChange={main.change} onBlur={main.flush} lang="sql" minRows={4} aria-label={tr('sentinel.measure.query')} />
        ) : source.kind === 'command' ? (
          <CodeEditor value={main.text} onChange={main.change} onBlur={main.flush} lang="bash" single aria-label={tr('sentinel.measure.source')} />
        ) : (
          <TextInput value={main.text} onChange={main.change} onBlur={main.flush} mono aria-label={tr('sentinel.measure.source')} />
        )}
        <span className={s.help}>{source.kind === 'postgres' ? tr('sentinel.measure.connectionNote') : ''}{tr('sentinel.measure.runAsYou')}</span>
      </div>
    </>
  );
}
