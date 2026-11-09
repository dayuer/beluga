import { formatBytes } from '@beluga/shared/format.js';
import { ProjectIcon } from '../../components/ProjectIcon.js';
import { IconButton, Tip, cx } from '../../components/ui.js';
import { Card, Shimmer, slotColor } from './parts.js';
import type { ProjectRow } from './usage-model.js';
import s from './usage.module.css';
import { useT } from '../../i18n/index.js';

/** Where a project's rows are in the breakdown below (its legend entry scrolls there). */
export const projectAnchor = (id: string): string => `usage-project-${id}`;


const reveal = (id: string): void => document.getElementById(projectAnchor(id))?.scrollIntoView({ behavior: 'smooth', block: 'start' });

/**
 * The space worktrees take, as one bar split by project (like macOS Storage), with a legend
 * that jumps to each project's rows.
 */
export function StorageCard({ rows, measuring, measured, onMeasure }: { rows: readonly ProjectRow[]; measuring: boolean; measured: boolean; onMeasure: () => void }) {
  const t = useT();
  const parts = rows.filter((r) => r.disk > 0).sort((a, b) => b.disk - a.disk);
  const total = parts.reduce((n, r) => n + r.disk, 0);
  const worktrees = rows.reduce((n, r) => n + r.rows.filter((w) => w.ws.kind === 'worktree').length + (r.agents?.count ?? 0), 0);
  const homes = rows.filter((r) => r.agents || r.rows.some((w) => w.ws.kind === 'worktree')).length;
  const waiting = !measured;
  return (
    <Card
      label={t('views.storage.title')}
      className={s.storage}
      title={t('views.storage.title')}
      aside={<IconButton icon="refresh" label={measuring ? t('views.info.measuring') : t('views.storage.again')} className={cx(measuring && s.spinning)} disabled={measuring} onClick={onMeasure} />}
    >
      <div className={cx(s.hero, waiting && s.heroWaiting)}>
        {waiting ? <Shimmer wide /> : <span className={s.heroValue}>{formatBytes(total)}</span>}
        <span className={s.heroUnit}>{t('views.storage.inWorktrees')}{worktrees ? t('views.storage.folders', { n: worktrees, projects: homes }) : ''}</span>
      </div>
      <div className={cx(s.stack, waiting && s.stackWaiting)} role="group" aria-label={t('views.storage.byProject')}>
        {waiting ? null : parts.length ? (
          parts.map((r) => (
            <Tip key={r.project.id} label={`${r.project.root ? r.project.name : t('views.overview.chats')} · ${formatBytes(r.disk)} (${Math.round((r.disk / total) * 100)}%)`}>
              <button type="button" className={s.segment} style={{ flexGrow: r.disk, background: slotColor(r.slot) }} aria-label={`${r.project.root ? r.project.name : t('views.overview.chats')}: ${formatBytes(r.disk)}`} onClick={() => reveal(r.project.id)} />
            </Tip>
          ))
        ) : (
          <span className={s.stackEmpty} />
        )}
      </div>
      {parts.length && !waiting ? (
        <ul className={s.legend}>
          {parts.map((r) => (
            <li key={r.project.id}>
              <button type="button" className={s.legendItem} onClick={() => reveal(r.project.id)}>
                <span className={s.swatch} style={{ background: slotColor(r.slot) }} />
                {r.project.root ? <ProjectIcon id={r.project.id} name={r.project.name} size={14} /> : null}
                <span className={s.legendName}>{r.project.root ? r.project.name : t('views.overview.chats')}</span>
                <span className={s.legendValue}>{formatBytes(r.disk)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : !waiting ? (
        <p className={s.quiet}>{t('views.storage.none')}</p>
      ) : null}
    </Card>
  );
}
