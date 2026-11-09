import { useEffect, useState } from 'react';
import { activityOf } from '@beluga/ui/workspace-models.js';
import type { StashUpdateOutcome, UpdateOutcome } from '@beluga/workspaces/sync.js';
import type { Project } from '@beluga/workspaces/types.js';
import { Alert } from '../../components/Alert.js';
import { Icon } from '../../components/Icon.js';
import { Button, Dot, Tip, cx } from '../../components/ui.js';
import { useActions } from '../../lib/actions.js';
import { toast, useApi, useApp, useBeluga } from '../../lib/beluga.js';
import { useMyAgentName } from '../../lib/agent-words.js';
import { type MainLine, agoText } from './home-model.js';
import s from './main-sync.module.css';
import { t as tNow, useT } from '../../i18n/index.js';

/**
 * Under the project's name: Update main (fetch and fast-forward), Fetch and when it last did, the
 * main folder being on another branch (Switch to main), and Claude updating main. What can't
 * simply fast-forward asks: set your changes aside, move them to a worktree, or let Claude do it
 * (in a worktree of its own; in the main folder only for what's stuck in its files). A fork also
 * gets Sync Fork when the original has new commits (BLG-726): GitHub brings them into the fork,
 * then main updates here.
 */

type Dialog =
  | { readonly kind: 'dirty'; readonly files: readonly string[]; readonly behind: number }
  /** `inMain`: stuck in the main folder's own files, so Claude works there (else in a worktree). */
  | { readonly kind: 'claude'; readonly title: string; readonly message: string; readonly inMain?: boolean }
  | { readonly kind: 'conflicts'; readonly files: readonly string[]; readonly message: string }
  | { readonly kind: 'switch'; readonly dirty: number }
  /** Sync fork stopped: the fork and the original change the same lines. */
  | { readonly kind: 'fork'; readonly message: string };

/** A fetch that failed, as the dialog that offers Claude (git's own words go along). */
const fetchDialog = (message: string, detail?: string): Dialog => ({ kind: 'claude', title: tNow('views.sync.couldntFetch'), message: detail && !message.includes(detail) ? tNow('views.sync.gitSaid', { message, detail }) : message });

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** Re-render every so often (for "fetched 3 min ago"). */
function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** A conversation where Claude is updating main right now (its workspace id, and whether it's in a worktree). */
function useClaudeUpdating(project: Project): { id: string; worktree: boolean } | undefined {
  const ws = useApp((st) => project.workspaces.find((w) => w.purpose === 'sync_main' && !w.archived && activityOf(st.log, `ws:${w.id}`).running));
  return ws ? { id: ws.id, worktree: ws.kind === 'worktree' } : undefined;
}

export function MainSyncBar({ project, line }: { project: Project; line: MainLine }) {
  const agent = useMyAgentName();
  const t = useT();
  const api = useApi();
  const { client } = useBeluga();
  const actions = useActions();
  const sync = project.sync;
  const [busy, setBusy] = useState<'update' | 'switch' | 'claude' | 'fork'>();
  const [dialog, setDialog] = useState<Dialog>();
  const now = useNow(30_000);
  const claude = useClaudeUpdating(project);
  const branch = line.branch ?? 'main';

  // Opening the home fetches when the last fetch is a few minutes old (quietly).
  useEffect(() => {
    void api.git.fetchIfStale(project.id).catch(() => undefined);
  }, [project.id]);

  if (!sync) return null;
  const upstream = sync.upstream ?? `origin/${branch}`;

  const run = async <T,>(what: 'update' | 'switch' | 'claude' | 'fork', job: () => Promise<T>): Promise<T | undefined> => {
    setBusy(what);
    try {
      return await job();
    } catch (err) {
      toast(client, errorText(err), 'error');
      return undefined;
    } finally {
      setBusy(undefined);
    }
  };

  /** What an update came back with that needs you (the rest the core already said in a toast). */
  const decide = (out: UpdateOutcome | StashUpdateOutcome): void => {
    if ('restored' in out && !out.restored) {
      setDialog({ kind: 'conflicts', files: out.conflicts ?? [], message: t('views.sync.restoreConflict', { branch, stash: out.stash?.message ?? 'beluga' }) });
      return;
    }
    switch (out.kind) {
      case 'dirty':
        setDialog({ kind: 'dirty', files: out.files, behind: out.behind });
        return;
      case 'diverged':
        setDialog({ kind: 'claude', title: t('views.sync.divergedTitle', { branch: out.branch, upstream: out.upstream }), message: t('views.sync.divergedMessage', { branch: out.branch, upstream: out.upstream, ahead: out.ahead, behind: out.behind }) });
        return;
      case 'busy':
        setDialog({ kind: 'claude', inMain: true, title: t('views.sync.busyTitle', { operation: out.operation }), message: t('views.sync.busyMessage', { operation: out.operation, branch }) });
        return;
      case 'failed':
        setDialog({ kind: 'claude', title: t('views.sync.couldntUpdate', { branch }), message: out.message });
        return;
      case 'fetch_failed':
        setDialog(fetchDialog(out.message, out.detail));
        return;
      default:
    }
  };

  const update = (): void => void run('update', () => api.git.updateMain(project.id)).then((out) => out && decide(out));
  const syncFork = (): void =>
    void run('fork', () => api.git.syncFork(project.id)).then((out) => {
      if (out?.kind === 'synced') decide(out.update);
      else if (out?.kind === 'conflict') setDialog({ kind: 'fork', message: out.message });
    });
  const forkWithClaude = (): void => {
    const said = dialog?.kind === 'fork' ? dialog.message : undefined;
    setDialog(undefined);
    void run('claude', () => api.git.syncForkWithClaude(project.id, said));
  };
  const fetchNow = (): void => void api.git.fetch(project.id).catch((err: unknown) => toast(client, errorText(err), 'error'));
  /** What the dialog said goes along, so Claude starts from git's own words. */
  const askClaude = (): void => {
    const said = dialog && 'message' in dialog ? `${dialog.kind === 'claude' ? `${dialog.title}: ` : ''}${dialog.message}`.slice(0, 2000) : undefined;
    setDialog(undefined);
    void run('claude', () => api.git.askClaude(project.id, said));
  };
  const stashAndUpdate = (): void => {
    setDialog(undefined);
    void run('update', () => api.git.stashAndUpdate(project.id)).then((out) => out && decide(out));
  };
  const moveAndUpdate = (): void => {
    setDialog(undefined);
    void run('update', () => api.git.moveAndUpdate(project.id)).then((out) => out && decide(out.outcome));
  };
  const switchTo = (mode: 'clean' | 'stash' | 'move'): void => {
    setDialog(undefined);
    void run('switch', () => api.git.switchToDefault(project.id, mode)).then((out) => {
      if (!out) return;
      if (out.kind === 'dirty') setDialog({ kind: 'switch', dirty: out.files?.length || sync.dirty || 1 });
      else if (out.kind === 'conflicts') setDialog({ kind: 'conflicts', files: out.files ?? [], message: out.message ?? '' });
      else if (out.kind === 'failed') toast(client, out.message ?? t('views.sync.couldntSwitch', { branch }), 'error');
    });
  };

  const diverged = sync.ahead > 0 && sync.behind > 0;
  const showUpdate = Boolean(sync.upstream) && (line.canUpdate || diverged || Boolean(sync.operation));
  const fork = project.fork;
  const original = fork ? `${fork.owner}/${fork.repo}` : '';
  // Only when there's something to bring in (unknown counts too: GitHub didn't say).
  const showFork = Boolean(fork) && (fork?.behind ?? 1) > 0;
  const fetchedLabel = sync.fetching ? t('views.sync.fetching') : sync.fetchedAt ? t('views.sync.fetched', { ago: agoText(sync.fetchedAt, now) }) : t('views.sync.neverFetched');

  return (
    <div className={s.wrap}>
      {line.elsewhere ? (
        <div className={s.callout} role="note" aria-label={t('views.sync.mainBranchAria')}>
          <Icon name="branch" size={13} className={s.calloutIcon} />
          <span className={s.calloutText}>
            <strong>{t('views.sync.elsewhere', { line: line.elsewhere })}</strong> {t('views.sync.aboutBranch', { branch })}{sync.dirty ? t('views.sync.folderHas', { n: sync.dirty }) : ''}{t('views.sync.period')}
          </span>
          <Tip label={sync.dirty ? t('views.sync.chooseFirst') : t('views.sync.checkOutTip', { branch })}>
            <Button size="small" disabled={busy === 'switch'} onClick={() => (sync.dirty ? setDialog({ kind: 'switch', dirty: sync.dirty }) : switchTo('clean'))}>
              {busy === 'switch' ? t('views.sync.switching') : t('views.sync.switchTo', { branch })}
            </Button>
          </Tip>
        </div>
      ) : null}
      {claude ? (
        <div className={cx(s.callout, s.calloutClaude)} role="status" aria-label={t('views.sync.agentUpdatingAria')}>
          <Dot tone="claude" live />
          <span className={s.calloutText}>
            <strong>{t('views.sync.agentUpdating', { branch })}</strong> {claude.worktree ? t('views.sync.agentInWorktree') : t('views.sync.agentInMain')} {t('views.sync.nothingPushed')}
          </span>
          <Button size="small" onClick={() => actions.run({ type: 'open_ws', id: claude.id, tab: 'chat' })}>
            {t('views.sync.open')}
          </Button>
        </div>
      ) : null}
      <div className={s.bar}>
        {showUpdate ? (
          <Tip label={diverged ? t('views.sync.bothMoved') : t(sync.onDefault ? 'views.sync.updateTip' : 'views.sync.updateTipElsewhere', { upstream, branch })}>
            <Button size="small" variant="primary" icon="download" disabled={busy === 'update' || Boolean(claude)} onClick={update}>
              {busy === 'update' ? t('views.sync.updating') : t('views.sync.update', { branch })}
            </Button>
          </Tip>
        ) : null}
        {showFork && fork ? (
          <Tip label={t('views.sync.forkTip', { original, forkBranch: fork.forkBranch, branch })}>
            <Button size="small" variant={showUpdate ? undefined : 'primary'} icon="merge" disabled={busy === 'fork' || Boolean(claude)} onClick={syncFork}>
              {busy === 'fork' ? t('views.sync.syncing') : t('views.sync.syncFork')}
            </Button>
          </Tip>
        ) : null}
        {sync.upstream ? (
          <Tip label={t('views.sync.fetchTip', { remote: sync.remote ?? 'origin' })}>
            <Button size="small" variant="quiet" icon="refresh" className={cx(sync.fetching && s.spinning)} disabled={sync.fetching} onClick={fetchNow}>
              {t('views.sync.fetch')}
            </Button>
          </Tip>
        ) : null}
        {showFork && fork?.behind ? (
          <span className={s.status} aria-label={t('views.sync.newCommitsOn', { n: fork.behind, original })}>
            {t('views.sync.newOn', { n: fork.behind, original })}
          </span>
        ) : null}
        {sync.fetchError ? (
          <Tip label={t('views.sync.fetchErrorTip', { message: sync.fetchError.message })}>
            <button type="button" className={cx(s.status, s.statusWarn, s.statusButton)} onClick={() => setDialog(fetchDialog(sync.fetchError!.message))}>
              <Icon name="alert" size={12} />
              {sync.fetchError.reason === 'auth' ? t('views.sync.signIn') : sync.fetchError.reason === 'offline' ? t('views.sync.offline') : t('views.sync.couldntFetch')}
            </button>
          </Tip>
        ) : sync.upstream ? (
          <span className={s.status} title={sync.fetchedAt ? new Date(sync.fetchedAt).toLocaleString() : undefined}>
            {fetchedLabel}
          </span>
        ) : null}
      </div>
      {dialog?.kind === 'dirty' ? (
        <Alert
          title={t('views.sync.dirtyTitle')}
          icon="alert"
          message={t('views.sync.dirtyMessage', { upstream, n: dialog.behind })}
          table={{ caption: t('views.sync.changedInMain'), columns: [t('views.sync.file')], rows: dialog.files.slice(0, 8).map((f) => [<code key={f}>{f}</code>]) }}
          confirm={{ label: t('views.sync.stashAndUpdate'), onClick: stashAndUpdate }}
          alternative={{ label: t('views.sync.moveToWorktree'), onClick: moveAndUpdate }}
          onCancel={() => setDialog(undefined)}
        />
      ) : null}
      {dialog?.kind === 'claude' ? (
        <Alert
          title={dialog.title}
          icon="claude"
          tone="info"
          message={
            <>
              {dialog.message}
              <span className={s.alertNote}>
                {dialog.inMain
                  ? t('views.sync.claudeInMain')
                  : t('views.sync.claudeInWorktree')}
              </span>
            </>
          }
          confirm={{ label: t('views.sync.letHandle', { agent }), onClick: askClaude }}
          onCancel={() => setDialog(undefined)}
        />
      ) : null}
      {dialog?.kind === 'conflicts' ? (
        <Alert
          title={t('views.sync.conflictTitle')}
          icon="alert"
          message={dialog.message}
          {...(dialog.files.length ? { table: { caption: t('views.sync.conflictsIn'), columns: [t('views.sync.file')], rows: dialog.files.slice(0, 8).map((f) => [<code key={f}>{f}</code>]) } } : {})}
          confirm={{ label: t('views.sync.letHandle', { agent }), onClick: askClaude }}
          cancel={t('views.sync.illHandle')}
          onCancel={() => setDialog(undefined)}
        />
      ) : null}
      {dialog?.kind === 'fork' ? (
        <Alert
          title={t('views.sync.forkConflict', { original })}
          icon="claude"
          tone="info"
          message={
            <>
              {dialog.message}
              <span className={s.alertNote}>{t('views.sync.forkNote', { original, forkBranch: fork?.forkBranch ?? branch })}</span>
            </>
          }
          confirm={{ label: t('views.sync.letHandle', { agent }), onClick: forkWithClaude }}
          onCancel={() => setDialog(undefined)}
        />
      ) : null}
      {dialog?.kind === 'switch' ? (
        <Alert
          title={t('views.sync.switchTitle', { branch })}
          icon="branch"
          message={t('views.sync.switchMessage', { n: dialog.dirty, current: sync.current ?? t('views.home.detachedHead'), work: sync.current ?? t('views.sync.thatWork'), branch })}
          confirm={{ label: t('views.sync.moveToWorktree'), onClick: () => switchTo('move') }}
          alternative={{ label: t('views.sync.bringAlong'), onClick: () => switchTo('stash') }}
          onCancel={() => setDialog(undefined)}
        />
      ) : null}
    </div>
  );
}
