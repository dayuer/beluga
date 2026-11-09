import { baseName } from '@beluga/shared/os-path.js';
import { Suspense, lazy, memo, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { type ChartKind, type Column, type Row, type View, type ViewType, describeSource, parseView } from '@beluga/shared/view-spec.js';
import { ActionsContext, ActionsDropdown, type ActionItem } from '../SpecMenu.js';
import { CodeLines } from '../markdown/CodeLines.js';
import { useCopied } from '../markdown/CodeBlock.js';
import { Icon, type IconName } from '../Icon.js';
import { IconButton, Tip, cx } from '../ui.js';
import { copyRich, copyText } from '../../lib/copy.js';
import { saveTextAs } from '../../lib/save-text.js';
import { toast, useBeluga } from '../../lib/beluga.js';
import { useActions } from '../../lib/actions.js';
import { useClock } from '../../lib/window-active.js';
import { type ViewData, useViewData, useVisible } from './use-view-data.js';
import { ago, isNumeric, toHtmlTable, toMarkdownTable } from './format.js';
import { EXPORT_KINDS, type ExportKind, exportFileName, exportRows } from './export.js';
import { DataTable } from './Table.js';
import { StatTiles } from './Stats.js';
import { CodeView } from './Code.js';
import { ColorsView } from './Colors.js';
import { ControlsBar } from './Controls.js';
import { GanttView } from './Gantt.js';
import { HeatmapView } from './Heatmap.js';
import { CalendarView } from './Calendar.js';
import { tableRows, tableView } from './md-table.js';
import { t as tNow, useT } from '../../i18n/index.js';
import v from './views.module.css';

/**
 * A ```beluga-view block (or ```beluga-table, ```beluga-chart…) wherever Markdown is drawn: a
 * card with the element in it. Tables page, sort and search; a table turns into a chart and back;
 * a source (your own Claude's) is fetched for more and refreshed, live. While Claude is still
 * writing the block it says so; a block that's wrong says what's wrong and shows its JSON.
 */

const Chart = lazy(() => import('./Chart.js'));

const ICON: Record<ViewType, IconName> = { table: 'table', chart: 'chartLine', stats: 'gauge', code: 'command', colors: 'palette', gantt: 'gantt', heatmap: 'heat', calendar: 'calendar' };
const NOUN = (type: ViewType): string => tNow(`common.viewBlock.noun.${type}` as const);
/** Views drawn from all their rows at once (not a page of them). */
const WHOLE: ReadonlySet<ViewType> = new Set(['chart', 'gantt', 'heatmap', 'calendar']);

export const ViewBlock = memo(function ViewBlock({ code, type, live = false, local = false }: { code: string; type?: ViewType | 'any'; live?: boolean; local?: boolean }) {
  const parsed = useMemo(() => parseView(code, type === 'any' ? undefined : type), [code, type]);
  const t = useT();
  if (!parsed.ok) {
    if (parsed.incomplete && live) {
      return (
        <figure className={v.card} data-state="drawing" aria-label={t('common.viewBlock.view')}>
          <div className={v.drawing}>
            <Icon name={type && type !== 'any' ? ICON[type] : 'grid'} size={14} />
            {t('common.viewBlock.showing', { what: type && type !== 'any' ? NOUN(type) : t('common.viewBlock.data') })}
          </div>
        </figure>
      );
    }
    return (
      <figure className={v.cardError} data-state="error">
        <figcaption>{t('common.viewBlock.cantShow', { error: parsed.error })}</figcaption>
        <CodeLines text={code} lang="json" />
      </figure>
    );
  }
  return <ViewCard view={parsed.view} code={code} warnings={parsed.warnings} local={local} />;
});

/** What a table can be shown as. */
type Shape = 'table' | ChartKind;

function chartable(view: View, data: ViewData): boolean {
  return data.columns.some(isNumeric) && data.columns.length >= 2 && view.type !== 'stats';
}

function ViewCard({ view, code, warnings, local, bare = false }: { view: View; code: string; warnings: readonly string[]; local: boolean; bare?: boolean }) {
  const { client } = useBeluga();
  const t = useT();
  const [ref, visible] = useVisible<HTMLElement>();
  const [shape, setShape] = useState<Shape>(view.type === 'chart' ? view.chart : 'table');
  const [full, setFull] = useState(false);
  const [shown, setShown] = useShownValues();
  const asChart = view.type === 'chart' || (view.type === 'table' && shape !== 'table');
  const data = useViewData(view, { local, visible, ...(asChart || WHOLE.has(view.type) ? { limit: Math.max(view.pageSize, 500) } : {}), ...(view.type === 'code' ? { text: true } : {}) });
  const copySpec = (): void => void copyText(JSON.stringify(JSON.parse(code), null, 2)).then(() => toast(client, t('common.viewBlock.copiedJson'), 'success'));
  const rowsCopied = (n: number): string => t('common.viewBlock.copiedRows', { n });
  // A table copies as a table: HTML for Sheets, Numbers, Docs and Notion; Markdown for everything else.
  const [copied, copy] = useCopied();
  const tableCopy = view.type === 'table' && data.rows.length > 0;
  const copyTable = (): void =>
    copy(() => {
      const rows = data.allRows();
      const columns = data.columns.filter((c) => !c.hidden);
      return copyRich(toHtmlTable(rows, columns), toMarkdownTable(rows, columns)).then(() => toast(client, rowsCopied(rows.length), 'success'));
    });
  const exportable = data.rows.length > 0 && view.type !== 'code' && view.type !== 'colors';
  const items: ActionItem[] = [
    ...(view.type !== 'code' && view.type !== 'colors' ? [{ label: t('common.viewBlock.fullWindow'), icon: 'expand' as const, onSelect: () => setFull(true) }] : []),
    ...(tableCopy ? [{ label: t('common.viewBlock.copyTable'), icon: 'copy' as const, onSelect: copyTable }] : []),
    ...(exportable ? exportItems(view, data, (text, ok) => toast(client, text, ok ? 'success' : 'error'), shown, setShown) : []),
    { label: exportable ? t('common.viewBlock.copySpec') : t('common.viewBlock.copyJson'), icon: 'copy', separate: exportable, onSelect: copySpec },
    ...(data.mode === 'live' ? [{ label: t('common.viewBlock.refresh'), icon: 'refresh' as const, onSelect: data.refresh }] : []),
  ];
  const body = (inFull: boolean) => <Body view={view} data={data} shape={asChart ? (view.type === 'chart' && shape === 'table' ? view.chart : shape) : 'table'} full={inFull} />;
  const canSwitch = (view.type === 'table' || view.type === 'chart') && chartable(view, data);
  // Opened from the welcome (the tour's table): over it, not hidden behind it.
  const overWelcome = full && document.querySelector('[data-welcome]') ? '' : undefined;
  return (
    <>
      <ActionsContext items={items}>
        <figure ref={ref} className={cx(v.card, bare && v.bare)} data-type={view.type} data-state="ready" aria-label={view.title ? `${label(view.type)}: ${view.title}` : label(view.type)}>
          <Head view={view} data={data} warnings={warnings} shape={shape} setShape={canSwitch ? setShape : undefined} copy={tableCopy ? { copied, onCopy: copyTable } : undefined} more={exportable ? items : undefined} onExpand={!bare && items[0]?.label === t('common.viewBlock.fullWindow') ? () => setFull(true) : undefined} bare={bare} />
          <ControlsBar view={view} data={data} />
          {data.needsApproval ? <Approve command={data.needsApproval} onRun={data.approve} /> : null}
          {data.error ? (
            <div className={v.problem} role="alert">
              <Icon name="alert" size={13} />
              <span>{t('common.viewBlock.couldntLoad', { error: data.error })}</span>
              {data.mode === 'live' ? (
                <button type="button" className={v.linkButton} onClick={data.refresh}>
                  {t('common.viewBlock.tryAgain')}
                </button>
              ) : null}
            </div>
          ) : null}
          {body(false)}
          <Foot view={view} data={data} />
        </figure>
      </ActionsContext>
      {full ? (
        <Dialog.Root open onOpenChange={(open) => (open ? undefined : setFull(false))}>
          <Dialog.Portal>
            <Dialog.Overlay className={v.fullOverlay} data-over-welcome={overWelcome} />
            <Dialog.Content className={v.full} data-over-welcome={overWelcome} aria-describedby={undefined} onOpenAutoFocus={(e) => e.preventDefault()}>
              <Head view={view} data={data} warnings={warnings} shape={shape} setShape={canSwitch ? setShape : undefined} copy={tableCopy ? { copied, onCopy: copyTable } : undefined} more={exportable ? items.filter((it) => it.label !== t('common.viewBlock.fullWindow')) : undefined} inFull onClose={() => setFull(false)} />
              <ControlsBar view={view} data={data} />
              <div className={v.fullBody}>{body(true)}</div>
              <Foot view={view} data={data} />
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      ) : null}
    </>
  );
}

/** Whether Copy as and Save as take the values as the table shows them ("$48,210") or raw (48210). Remembered. */
const SHOWN_KEY = 'beluga.tableExport.shown';
function useShownValues(): [boolean, (on: boolean) => void] {
  const [shown, setShown] = useState(() => {
    try {
      return localStorage.getItem(SHOWN_KEY) === '1';
    } catch {
      return false;
    }
  });
  const set = (on: boolean): void => {
    setShown(on);
    try {
      localStorage.setItem(SHOWN_KEY, on ? '1' : '0');
    } catch {
      // Private storage off: it holds for this card only.
    }
  };
  return [shown, set];
}

/** Copy as ▸ and Save as ▸: the rows (sorted, searched, filtered) in the columns you see. */
function exportItems(view: View, data: ViewData, say: (text: string, ok: boolean) => void, shown: boolean, setShown: (on: boolean) => void): ActionItem[] {
  const take = (k: ExportKind): { text: string; n: number } => {
    const rows = data.allRows();
    const columns = data.columns.filter((c) => !c.hidden);
    return { text: exportRows(k.format, rows, columns, { shown: shown || !k.raw, name: view.title ?? 'rows' }), n: rows.length };
  };
  const rowsWord = (n: number): string => tNow('common.viewBlock.nRows', { n });
  const copyAs = (k: ExportKind): void => {
    const { text, n } = take(k);
    copyText(text).then(
      () => say(tNow('common.viewBlock.copiedAs', { rows: rowsWord(n), as: k.label }), true),
      (err: unknown) => say(tNow('common.viewBlock.couldntCopy', { error: err instanceof Error ? err.message : String(err) }), false),
    );
  };
  const saveAs = (k: ExportKind): void => {
    const { text, n } = take(k);
    saveTextAs(exportFileName(view.title, k.ext), text).then(
      (to) => to && say(tNow('common.viewBlock.savedTo', { rows: rowsWord(n), file: baseName(to) }), true),
      (err: unknown) => say(tNow('common.viewBlock.couldntSave', { error: err instanceof Error ? err.message : String(err) }), false),
    );
  };
  const valuesItem: ActionItem = { label: tNow('common.viewBlock.valuesShown'), hint: shown ? tNow('common.viewBlock.valuesShownHint') : tNow('common.viewBlock.valuesRawHint'), checked: shown, separate: true, onSelect: () => setShown(!shown) };
  return [
    { label: tNow('common.viewBlock.copyAs'), icon: 'copy', submenu: [...EXPORT_KINDS.map((k) => ({ label: k.label, onSelect: () => copyAs(k) })), valuesItem], onSelect: () => undefined },
    { label: tNow('common.viewBlock.saveAs'), icon: 'download', submenu: [...EXPORT_KINDS.map((k) => ({ label: `${k.label}…`, onSelect: () => saveAs(k) })), valuesItem], onSelect: () => undefined },
  ];
}

const label = (type: ViewType): string => tNow(`common.viewBlock.label.${type}` as const);

function Body({ view, data, shape, full }: { view: View; data: ViewData; shape: Shape; full: boolean }) {
  switch (view.type) {
    case 'stats':
      return <StatTiles view={view} data={data} />;
    case 'code':
      return <CodeView view={view} data={data} />;
    case 'colors':
      return <ColorsView view={view} />;
    case 'gantt':
      return <GanttView view={view} data={data} full={full} />;
    case 'heatmap':
      return <HeatmapView view={view} data={data} />;
    case 'calendar':
      return <CalendarView view={view} data={data} />;
    default:
      if (shape === 'table') return <DataTable view={view} data={data} full={full} />;
      return (
        <Suspense fallback={<div className={v.chartWait} style={{ height: view.height ?? 260 }} />}>
          <Chart view={view} data={data} kind={shape} full={full} />
        </Suspense>
      );
  }
}

type Shown = 'table' | 'line' | 'area' | 'bar';
const SHAPES: ReadonlyArray<{ shape: Shown; icon: IconName }> = [
  { shape: 'table', icon: 'table' },
  { shape: 'line', icon: 'chartLine' },
  { shape: 'area', icon: 'chartArea' },
  { shape: 'bar', icon: 'chartBar' },
];
const shapeLabel = (shape: Shown): string => tNow(`common.viewBlock.shape.${shape}` as const);

function Head({ view, data, warnings, shape, setShape, copy, more, onExpand, inFull, onClose, bare = false }: { view: View; data: ViewData; warnings: readonly string[]; shape: Shape; setShape?: ((s: Shape) => void) | undefined; copy?: { copied: boolean; onCopy: () => void } | undefined; more?: readonly ActionItem[] | undefined; onExpand?: (() => void) | undefined; inFull?: boolean; onClose?: () => void; bare?: boolean }) {
  const actions = useActions();
  const t = useT();
  const now = useClock(data.at !== undefined, 15_000);
  const live = data.mode === 'live' && Boolean(data.source?.refresh);
  const TitleTag = inFull ? Dialog.Title : 'span';
  return (
    <figcaption className={cx(v.head, bare && v.headBare)}>
      <span className={v.chip} aria-hidden="true">
        <Icon name={ICON[view.type]} size={13} />
      </span>
      <span className={v.titles}>
        <TitleTag className={v.title}>{view.title ?? label(view.type)}</TitleTag>
        {view.summary ? <span className={v.summary}>{view.summary}</span> : null}
      </span>
      <span className={v.tools}>
        {warnings.length ? (
          <Tip label={warnings.join('\n')}>
            <span className={v.note}>{t('common.viewBlock.leftOut', { n: warnings.length })}</span>
          </Tip>
        ) : null}
        {data.mode === 'live' && (data.at || data.loading || live) ? (
          <Tip label={data.at ? t('common.viewBlock.fetched', { at: new Date(data.at).toLocaleString() }) : t('common.viewBlock.live')}>
            <span className={cx(v.status, live && v.statusLive, data.loading && v.statusBusy)}>
              <span className={v.dot} />
              {data.loading ? t('common.viewBlock.loading') : live ? t('common.viewBlock.live') : data.at ? ago(data.at, now) : t('common.viewBlock.live')}
            </span>
          </Tip>
        ) : data.mode === 'snapshot' && data.at ? (
          <Tip label={t('common.viewBlock.snapshotTip')}>
            <span className={v.status}>{ago(data.at, now)}</span>
          </Tip>
        ) : null}
        {setShape ? (
          <span className={v.segment} role="radiogroup" aria-label={t('common.viewBlock.showAs')}>
            {SHAPES.map((s) => (
              <Tip key={s.shape} label={shapeLabel(s.shape)}>
                <button type="button" role="radio" aria-checked={shape === s.shape} aria-label={shapeLabel(s.shape)} className={cx(v.segmentItem, shape === s.shape && v.segmentOn)} onClick={() => setShape(s.shape)}>
                  <Icon name={s.icon} size={12} />
                </button>
              </Tip>
            ))}
          </span>
        ) : null}
        {view.actions.map((a) => (
          <button
            key={a.label}
            type="button"
            className={cx(v.action, a.source && data.switched && data.source === a.source && v.actionOn)}
            onClick={() => {
              if (a.source) data.useSource(data.source === a.source ? undefined : a.source);
              else if (a.href) actions.openLink(/^https?:/i.test(a.href) ? { kind: 'url', url: a.href } : { kind: 'local', path: a.href, dir: a.href.endsWith('/') });
              else if (a.copy !== undefined) void copyText(a.copy);
            }}
          >
            {a.href ? <Icon name="external" size={11} /> : a.copy !== undefined ? <Icon name="copy" size={11} /> : null}
            {a.label}
          </button>
        ))}
        {copy ? <IconButton icon={copy.copied ? 'check' : 'copy'} label={copy.copied ? t('common.ui.copied') : t('common.viewBlock.copyTable')} className={cx(v.iconTool, copy.copied && v.iconDone)} onClick={copy.onCopy} /> : null}
        {data.mode === 'live' ? <IconButton icon="refresh" label={t('common.viewBlock.refresh')} className={cx(v.iconTool, data.loading && v.spinning)} onClick={data.refresh} /> : null}
        {onExpand ? <IconButton icon="expand" label={t('common.viewBlock.fullWindow')} className={v.iconTool} onClick={onExpand} /> : null}
        {more ? (
          <ActionsDropdown items={more}>
            <IconButton icon="more" label={t('common.viewBlock.copyOrSave')} className={v.iconTool} />
          </ActionsDropdown>
        ) : null}
        {onClose ? (
          <Dialog.Close asChild>
            <IconButton icon="x" label={t('common.ui.close')} keys="esc" className={v.iconTool} />
          </Dialog.Close>
        ) : null}
      </span>
    </figcaption>
  );
}

/** A command Claude wrote by hand (not through its tool) runs once you press Load; after that, by itself. */
function Approve({ command, onRun }: { command: string; onRun: () => void }) {
  const t = useT();
  return (
    <div className={v.approve}>
      <button type="button" className={v.primary} onClick={onRun}>
        <Icon name="play" size={11} />
        {t('common.viewBlock.load')}
      </button>
      <Tip label={command}>
        <code className={v.approveCode}>{command}</code>
      </Tip>
    </div>
  );
}

function Foot({ view, data }: { view: View; data: ViewData }) {
  if (!data.source || view.type === 'colors') return null;
  const kind = data.source.kind;
  const t = useT();
  return (
    <div className={v.foot}>
      <Icon name={kind === 'http' ? 'globe' : kind === 'folder' ? 'folder' : kind === 'file' ? 'file' : kind === 'command' ? 'terminal' : 'grid'} size={11} />
      <span className={v.sourceText} title={describeSource(data.source)}>
        {kind === 'sqlite' ? 'SQLite' : kind === 'postgres' ? 'Postgres' : kind === 'http' ? t('common.viewBlock.source.web') : kind === 'command' ? t('common.viewBlock.source.command') : kind === 'folder' ? t('common.viewBlock.source.folder') : t('common.viewBlock.source.file')} · {describeSource(data.source)}
      </span>
      {data.mode === 'snapshot' ? <span className={v.footNote}>{t('common.viewBlock.liveOnOwner')}</span> : data.source.refresh ? <span className={v.footNote}>{t('common.viewBlock.every', { n: data.source.refresh })}</span> : null}
    </div>
  );
}

/**
 * A plain Markdown table in an answer (md-table.ts), drawn as a table view: it sorts by its
 * headings, searches when it's long, turns into a chart when it has numbers. Its tools show on hover.
 */
export function MarkdownTable({ node, fallback }: { node: unknown; fallback: React.ReactNode }) {
  const view = useMemo(() => {
    const t = tableRows(node as Parameters<typeof tableRows>[0]);
    return t ? tableView(t) : undefined;
  }, [node]);
  const code = useMemo(() => (view ? JSON.stringify({ type: 'table', data: view.rows }) : ''), [view]);
  return view ? <ViewCard view={view} code={code} warnings={[]} local={false} bare /> : <PlainTable>{fallback}</PlainTable>;
}

/** A table that stays as written (it has links): Copy on hover takes it as drawn, links and all. */
function PlainTable({ children }: { children: React.ReactNode }) {
  const { client } = useBeluga();
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  const [copied, copy] = useCopied();
  const onCopy = (): void =>
    copy(() => {
      const table = box.current?.querySelector('table');
      if (!table) return Promise.resolve();
      const lines = [...table.rows].map((tr) => [...tr.cells].map((td) => td.innerText.trim()));
      const columns: Column[] = (lines[0] ?? []).map((label, i) => ({ key: String(i), label, type: 'text' }));
      const rows: Row[] = lines.slice(1).map((cells) => Object.fromEntries(cells.map((c, i) => [String(i), c])));
      return copyRich(table.outerHTML, toMarkdownTable(rows, columns)).then(() => toast(client, t('common.viewBlock.copiedRows', { n: rows.length }), 'success'));
    });
  return (
    <div ref={box} className={v.plainTable}>
      <span className={v.plainTools}>
        <IconButton icon={copied ? 'check' : 'copy'} label={copied ? t('common.ui.copied') : t('common.viewBlock.copyTable')} className={cx(v.iconTool, copied && v.iconDone)} onClick={onCopy} />
      </span>
      {children}
    </div>
  );
}
