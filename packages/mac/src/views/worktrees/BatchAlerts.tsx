import { formatBytes } from '@beluga/shared/format.js';
import type { ThreadChildren } from '@beluga/shared/threads.js';
import { Alert } from '../../components/Alert.js';
import { useThreadsChoice } from '../../dialogs/native/ThreadsChoice.js';
import type { WorktreeRow } from './worktrees-model.js';
import { useT } from '../../i18n/index.js';

/**
 * Before archiving, removing build files from or deleting several worktrees at once: what
 * happens to them, and what it frees or loses. Archiving keeps everything of yours; removing
 * build files keeps the worktrees and clears only what's made again; deleting (live or archived
 * ones) is for good.
 */

export type Batch = 'archive' | 'free' | 'delete';


export function BatchAlert({ batch, rows, rebuildable, onConfirm, onCancel }: { batch: Batch; rows: readonly WorktreeRow[]; rebuildable: number; onConfirm: (children?: ThreadChildren) => void; onCancel: () => void }) {
  const n = rows.length;
  const t = useT();
  const threads = useThreadsChoice(rows.map((r) => r.ws.id), batch === 'delete' ? 'delete' : 'archive');
  const go = (): void => onConfirm(threads.children);
  const freed = rebuildable ? t('views.batch.about', { size: formatBytes(rebuildable) }) : t('views.batch.theirSpace');
  const outside = rows.filter((r) => r.madeBy.kind === 'outside').length;
  if (batch === 'free') {
    return (
      <Alert
        icon="archive"
        tone="info"
        title={t('views.batch.freeTitle', { n })}
        message={
          <>
            <p>{t('views.batch.freeWhat', { freed })}</p>
            <p>{t('views.batch.freeStays')}</p>
          </>
        }
        confirm={{ label: t('views.batch.freeConfirm'), onClick: () => onConfirm() }}
        onCancel={onCancel}
      />
    );
  }
  if (batch === 'delete' && !rows.some((r) => r.archived)) {
    // Beluga's own go with everything in them; another tool's (or a sub-agent's) only if git lets them, branch kept.
    const own = rows.filter((r) => r.madeBy.kind === 'beluga');
    const files = own.reduce((k, r) => k + (r.left?.files ?? 0), 0);
    const commits = own.filter((r) => r.ws.branch).reduce((k, r) => k + (r.left?.commits ?? 0), 0);
    const branches = own.filter((r) => r.ws.branch).length;
    const theirs = n - own.length;
    return (
      <Alert
        icon="alert"
        tone="danger"
        title={t('views.batch.deleteTitle', { n })}
        message={
          <>
            <p>
              {t('views.batch.foldersGo', { n })}
              {branches ? (commits ? t('views.batch.andBranchesCommits', { n: branches, commits }) : t('views.batch.andBranches', { n: branches })) : ''}
              {t('views.sync.period')}
              {files ? t('views.batch.filesLost', { n: files }) : ''}
            </p>
            {theirs ? <p>{t('views.batch.theirs', { n, theirs })}</p> : null}
            <p>{t('views.batch.cantUndoArchive', { n })}</p>
          </>
        }
        confirm={{ label: t('views.batch.deleteN', { n }), destructive: true, onClick: go }}
        onCancel={onCancel}
      >
        {threads.box}
      </Alert>
    );
  }
  if (batch === 'delete') {
    const branches = rows.filter((r) => r.madeBy.kind === 'beluga' && r.ws.branch).length;
    const saved = rows.filter((r) => r.ws.archive).length;
    return (
      <Alert
        icon="alert"
        tone="danger"
        title={t('views.batch.deleteArchivedTitle', { n })}
        message={
          <>
            <p>
              {saved ? t('views.batch.archives', { n: saved, all: saved === n ? 1 : 0 }) : ''}
              {saved && branches ? t('views.batch.and') : ''}
              {branches ? t('views.batch.archivedBranches', { n: branches }) : ''}
              {saved || branches ? t('views.batch.goWith') : t('views.batch.conversationsGo')} {t('views.batch.otherBranchesKept')}
            </p>
            <p>{t('views.peek.cantUndo')}</p>
          </>
        }
        confirm={{ label: t('views.batch.deleteN', { n }), destructive: true, onClick: go }}
        onCancel={onCancel}
      >
        {threads.box}
      </Alert>
    );
  }
  return (
    <Alert
      icon="archive"
      tone="info"
      title={t('views.batch.archiveTitle', { n })}
      message={
        <>
          <p>{t('views.batch.archiveKept', { freed })}</p>
          <p>{t('views.batch.archiveStay')}</p>
          {outside ? <p>{t('views.batch.archiveOutside', { n: outside })}</p> : null}
        </>
      }
      confirm={{ label: t('views.batch.archiveN', { n }), onClick: go }}
      onCancel={onCancel}
    >
      {threads.box}
    </Alert>
  );
}
