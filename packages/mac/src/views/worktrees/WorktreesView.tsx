import { useEffect, useMemo, useState } from 'react';
import { formatBytes } from '@beluga/shared/format.js';
import { Icon } from '../../components/Icon.js';
import { type ActionItem, ActionsDropdown } from '../../components/SpecMenu.js';
import { Button, Empty, IconButton, Segmented } from '../../components/ui.js';
import { useActions } from '../../lib/actions.js';
import { toast, useApi, useApp, useBeluga } from '../../lib/beluga.js';
import { openSheet } from '../../lib/sheets.js';
import { outsideOf } from '../../layout/outside-model.js';
import type { ThreadChildren } from '@beluga/shared/threads.js';
import { batchCalls } from '../../lib/thread-family.js';
import { type Batch, BatchAlert } from './BatchAlerts.js';
import { ArchivedItem, WorktreeItem } from './WorktreeItem.js';
import { forgetRebuildable, useRebuildable } from './use-rebuildable.js';
import { FILTERS, type WorktreeFilter, type WorktreeRow, archivedRows, filterRows, totals, worktreeRows } from './worktrees-model.js';
import s from './worktrees.module.css';
import { t as tNow, useT } from '../../i18n/index.js';

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** What the build-files column holds, in words (its header's tooltip). */
const BUILD_FILES = (): string => tNow('views.wt.buildFiles');

/**
 * Every worktree in your projects, made by Beluga, by Claude Code's sub-agents or outside Beluga,
 * and every one you archived: who made it, what's in it that isn't in main, what it takes on
 * disk and how much of that is build files. Tick the ones you're done with, then archive them
 * (everything of yours is kept), delete them for good or remove their build files (they stay);
 * under Archived, restore them or delete them for good. Everything you do with worktrees is here.
 */
export function WorktreesView({ projectId }: { projectId?: string | undefined }) {
  const api = useApi();
  const { client } = useBeluga();
  const actions = useActions();
  const t = useT();
  const projects = useApp((st) => st.projects);
  const disk = useApp((st) => st.disk);
  const prs = useApp((st) => st.prs);
  const claudeCode = useApp((st) => st.claudeCode);
  const archiving = useApp((st) => st.archiving);
  const live = useMemo(() => worktreeRows({ projects, disk, prs, claudeCode, archiving }), [projects, disk, prs, claudeCode, archiving]);
  const put = useMemo(() => archivedRows({ projects, disk, prs, claudeCode, archiving }), [projects, disk, prs, claudeCode, archiving]);
  const rows = useMemo(() => [...live, ...put], [live, put]);
  const [filter, setFilter] = useState<WorktreeFilter>('all');
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const [batch, setBatch] = useState<{ kind: Batch; rows: readonly WorktreeRow[] } | undefined>();
  const [running, setRunning] = useState(false);
  const plans = useRebuildable(
    api,
    live.map((r) => ({ id: r.ws.id, size: r.size })),
  );
  const rebuildable = useMemo(() => Object.fromEntries([...plans].map(([id, p]) => [id, p.dropBytes])), [plans]);
  const project = projects.find((p) => p.id === projectId);
  const archivedView = filter === 'archived';
  const shown = filterRows(rows, filter, projectId);
  const sum = totals(filterRows(live, archivedView ? 'all' : filter, projectId), rebuildable);
  const picked = shown.filter((r) => ticked.has(r.ws.id));
  const pickedSum = totals(picked, rebuildable);

  // Sizes as they are now.
  useEffect(() => void api.workbench.measureDisk().catch(() => undefined), [api]);
  // Gone (archived, restored, removed) or out of view: no longer ticked.
  useEffect(() => setTicked((t) => new Set([...t].filter((id) => shown.some((r) => r.ws.id === id)))), [rows, filter, projectId]);

  const tick = (id: string, on: boolean): void => setTicked((t) => (on ? new Set([...t, id]) : new Set([...t].filter((x) => x !== id))));
  const allShown = shown.length > 0 && shown.every((r) => ticked.has(r.ws.id));
  const tickAll = (on: boolean): void => setTicked(on ? new Set([...ticked, ...shown.filter((r) => !r.archiving).map((r) => r.ws.id)]) : new Set([...ticked].filter((id) => !shown.some((r) => r.ws.id === id))));

  /**
   * Archiving and deleting: all asked at once, so every row leaves its list now (Beluga does the
   * disk work one at a time behind them). Freeing space and restoring: one at a time. What failed
   * says why and the rest go on.
   */
  const run = async (kind: Batch | 'restore', list: readonly WorktreeRow[], children?: ThreadChildren): Promise<void> => {
    setBatch(undefined);
    setRunning(true);
    try {
      if (kind === 'archive' || kind === 'delete') {
        const calls = batchCalls(client.store.getState(), list.map((r) => r.ws.id), children);
        const one = (id: string) => (kind === 'archive' ? (children ? api.workspaces.archive(id, false, { children }) : api.workspaces.archive(id)) : children ? api.workspaces.remove(id, { children }) : api.workspaces.remove(id));
        await Promise.all(list.filter((r) => calls.includes(r.ws.id)).map((r) => one(r.ws.id).catch((err: unknown) => toast(client, `${r.ws.name}: ${errorText(err)}`, 'error'))));
        return;
      }
      for (const r of list) {
        try {
          if (kind === 'free') await api.workspaces.freeSpace(r.ws.id);
          else await api.workspaces.restore(r.ws.id);
        } catch (err) {
          toast(client, `${r.ws.name}: ${errorText(err)}`, 'error');
        }
      }
    } finally {
      forgetRebuildable(list.map((r) => r.ws.id));
      setTicked(new Set());
      setRunning(false);
      void api.workbench.measureDisk().catch(() => undefined);
    }
  };
  const act = {
    archive: (list: readonly WorktreeRow[]) => setBatch({ kind: 'archive', rows: list }),
    free: (list: readonly WorktreeRow[]) => setBatch({ kind: 'free', rows: list }),
    // Restoring loses nothing: no question first.
    restore: (list: readonly WorktreeRow[]) => void run('restore', list.filter((r) => r.archived?.restorable)),
    remove: (list: readonly WorktreeRow[]) => setBatch({ kind: 'delete', rows: list }),
  };
  const projectItems: ActionItem[] = [
    { label: t('views.overview.allProjects'), checked: !projectId, onSelect: () => actions.run({ type: 'view', view: { kind: 'worktrees' } }) },
    ...projects.filter((p) => p.root && p.workspaces.some((w) => w.kind === 'worktree')).map((p, i) => ({ label: p.name, checked: p.id === projectId, ...(i === 0 ? { separate: true } : {}), onSelect: () => actions.run({ type: 'view', view: { kind: 'worktrees', projectId: p.id } }) })),
  ];
  // Worktrees made outside Beluga that can go without losing anything: the Clean Up sheet, per project.
  const outsideIn = projects.filter((p) => p.root && (!projectId || p.id === projectId) && outsideOf(p).length);
  const moreItems: ActionItem[] = [
    ...(outsideIn.length === 1
      ? [{ label: t('views.wt.cleanUpOutside'), hint: t('views.wt.cleanUpHint'), onSelect: () => openSheet({ kind: 'clean_up_worktrees', projectId: outsideIn[0]!.id }) }]
      : outsideIn.length
        ? [{ label: t('views.wt.cleanUpOutsideMenu'), onSelect: () => undefined, submenu: outsideIn.map((p) => ({ label: `${p.name}…`, onSelect: () => openSheet({ kind: 'clean_up_worktrees', projectId: p.id }) })) }]
        : []),
  ];

  if (!rows.length) return <Empty icon="branch" title={t('views.wt.none')} detail={t('views.wt.noneDetail')} />;
  return (
    <div className={s.page}>
      <header className={s.head}>
        <div className={s.title}>
          <h1>{t('views.home.worktrees')}</h1>
          <p className={s.summary} aria-live="polite">
            {archivedView ? (
              t('views.wt.archivedSummary', { n: shown.length })
            ) : (
              <>
                {t('views.wt.navCount', { n: sum.count })} · {formatBytes(sum.bytes)}
                {sum.rebuildable ? t('views.wt.isBuildFiles', { size: formatBytes(sum.rebuildable) }) : ''}
                {sum.measured < sum.count ? <span className={s.pending}>{t('views.wt.lookingAt', { n: sum.count - sum.measured })}</span> : null}
              </>
            )}
          </p>
        </div>
        <div className={s.tools}>
          <Segmented label={t('views.earnings.show')} value={filter} onChange={setFilter} options={FILTERS.map((f) => ({ value: f.id, label: `${f.label} ${filterRows(rows, f.id, projectId).length}`, hint: f.hint }))} />
          <ActionsDropdown items={projectItems}>
            <Button size="small" variant="plain">
              {project?.name ?? t('views.overview.allProjects')} <Icon name="chevronDown" size={10} />
            </Button>
          </ActionsDropdown>
          {moreItems.length ? (
            <ActionsDropdown items={moreItems} align="end">
              <IconButton icon="more" label={t('views.wt.more')} />
            </ActionsDropdown>
          ) : null}
        </div>
      </header>
      <div role="grid" aria-label={archivedView ? t('views.wt.archivedAria') : t('views.home.worktrees')} aria-multiselectable className={s.grid}>
        <div role="row" className={archivedView ? `${s.headRow} ${s.archivedRow}` : s.headRow}>
          <span role="columnheader" className={s.tick}>
            <input type="checkbox" aria-label={t('views.wt.selectAll')} checked={allShown} onChange={(e) => tickAll(e.target.checked)} />
          </span>
          <span role="columnheader">{t('views.wt.colWorktree')}</span>
          <span role="columnheader">{t('views.wt.colMadeBy')}</span>
          {archivedView ? (
            <>
              <span role="columnheader" className={s.num}>
                {t('views.overview.filterArchived')}
              </span>
              <span role="columnheader" title={t('views.wt.colComesBackTip')}>
                {t('views.wt.colComesBack')}
              </span>
              <span role="columnheader" />
            </>
          ) : (
            <>
              <span role="columnheader" title={t('views.wt.colNotInMainTip')}>
                {t('views.wt.colNotInMain')}
              </span>
              <span role="columnheader" className={s.num}>
                {t('views.overview.sortSize')}
              </span>
              <span role="columnheader" className={s.num} title={BUILD_FILES()}>
                {t('views.wt.colBuildFiles')}
              </span>
              <span role="columnheader" />
            </>
          )}
        </div>
        {shown.length ? (
          shown.map((r) => (r.archived ? <ArchivedItem key={r.ws.id} row={r} ticked={ticked.has(r.ws.id)} onTick={(on) => tick(r.ws.id, on)} act={act} busy={running} /> : <WorktreeItem key={r.ws.id} row={r} plan={plans.get(r.ws.id)} ticked={ticked.has(r.ws.id)} onTick={(on) => tick(r.ws.id, on)} act={act} />))
        ) : (
          <p className={s.none}>{t('views.wt.nothingHere', { hint: FILTERS.find((f) => f.id === filter)?.hint.toLowerCase() ?? '' })}</p>
        )}
      </div>
      {picked.length ? (
        <footer className={s.bar} role="toolbar" aria-label={t('views.wt.selectedAria')}>
          {archivedView ? (
            <>
              <span className={s.barText}>{t('views.wt.selected', { n: picked.length })}</span>
              <Button size="small" variant="quiet" onClick={() => setTicked(new Set())} disabled={running}>
                {t('views.wt.deselect')}
              </Button>
              <Button size="small" onClick={() => act.remove(picked)} disabled={running}>
                {t('views.wt.delete')}
              </Button>
              <Button size="small" variant="primary" icon="refresh" onClick={() => act.restore(picked)} disabled={running || !picked.some((r) => r.archived?.restorable)}>
                {running ? t('views.wt.working') : t('views.overview.restore')}
              </Button>
            </>
          ) : (
            <>
              <span className={s.barText}>
                {t('views.wt.selected', { n: picked.length })} · {formatBytes(pickedSum.bytes)}
                {pickedSum.rebuildable ? t('views.wt.isBuildFiles', { size: formatBytes(pickedSum.rebuildable) }) : ''}
              </span>
              <Button size="small" variant="quiet" onClick={() => setTicked(new Set())} disabled={running}>
                {t('views.wt.deselect')}
              </Button>
              <Button size="small" onClick={() => act.free(picked)} disabled={running || !pickedSum.rebuildable} title={BUILD_FILES()}>
                {t('views.wt.removeBuildFiles')}
              </Button>
              <Button size="small" onClick={() => act.remove(picked)} disabled={running || picked.some((r) => r.archiving)} title={t('views.wt.deleteTip')}>
                {t('views.wt.delete')}
              </Button>
              <Button size="small" variant="primary" icon="archive" onClick={() => act.archive(picked)} disabled={running}>
                {running ? t('views.wt.working') : t('views.wt.archive')}
              </Button>
            </>
          )}
        </footer>
      ) : null}
      {batch ? <BatchAlert batch={batch.kind} rows={batch.rows} rebuildable={totals(batch.rows, rebuildable).rebuildable} onConfirm={(children) => void run(batch.kind, batch.rows, children)} onCancel={() => setBatch(undefined)} /> : null}
    </div>
  );
}
