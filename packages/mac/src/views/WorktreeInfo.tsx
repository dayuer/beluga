import { baseName } from '@beluga/shared/os-path.js';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import type { AgentOrigin } from '@beluga/core/claude-code/model.js';
import type { WorktreeInfo } from '@beluga/core/other-worktrees.js';
import { formatBytes } from '@beluga/shared/format.js';
import { type WorktreeSource, sourceFromPath } from '@beluga/workspaces/origin.js';
import type { Workspace } from '@beluga/workspaces/types.js';
import { Alert } from '../components/Alert.js';
import { Icon, type IconName } from '../components/Icon.js';
import { Button, Tip } from '../components/ui.js';
import { useActions } from '../lib/actions.js';
import { toast, useApi, useApp, useBeluga } from '../lib/beluga.js';
import { setWorktreeFlag, useWorktreeInfo } from './worktree-info-state.js';
import s from './worktree-info.module.css';
import { LivePanel } from '../claude-code/Live.js';
import { openFolderLabel } from '../lib/os-words.js';
import { t as tNow, useT } from '../i18n/index.js';

/**
 * What a worktree made outside Beluga is (another app's, Claude Code's, a script's): where it
 * is, its branch and state, the Claude Code conversations that ran in it, and what you can do
 * with it. Shown instead of an empty chat, and from "About This Worktree" over one with a
 * conversation. Another app is never named: the worktree's name and location say enough.
 */

/** Claude's mark for one Claude made; a branch for the rest. */
const iconOf = (source: WorktreeSource): IconName => (source === 'claude' ? 'claude' : 'branch');

const day = (ms: number): string => new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
const when = (ms: number): string => new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

function ago(ms: number): string {
  const d = Math.floor((Date.now() - ms) / 86_400_000);
  if (d <= 0) return tNow('views.info.today');
  if (d === 1) return tNow('views.ago.yesterday');
  if (d < 45) return tNow('views.info.daysAgo', { n: d });
  const m = Math.round(d / 30);
  return m < 18 ? tNow('views.info.monthsAgo', { n: m }) : tNow('views.info.yearsAgo', { n: Math.round(d / 365) });
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={s.field}>
      <dt>{label}</dt>
      <dd className="selectable">{children}</dd>
    </div>
  );
}

/**
 * Asks before removing a worktree made outside Beluga; with uncommitted changes the button says what's lost.
 * Confirming closes it at once: the removal carries on in the background and says how it went in a toast.
 */
export function RemoveWorktreeAlert({ ws, info, onDone, onCancel }: { ws: Workspace; info?: WorktreeInfo; onDone: (removed: boolean) => void; onCancel: () => void }) {
  const api = useApi();
  const { client } = useBeluga();
  const t = useT();
  const changed = info?.changed ?? ws.status?.changed ?? 0;
  const branch = info?.branch ?? ws.branch;
  // Another app made it and may still use it.
  const anotherApp = (info?.origin.source ?? sourceFromPath(ws.path)) === 'conductor';
  const go = (): void => {
    void api.workspaces.removeOther(ws.id, changed > 0).catch((err: unknown) => toast(client, t('views.info.removeFailed', { name: ws.name, error: err instanceof Error ? err.message : String(err) }), 'error'));
    onDone(true);
  };
  return (
    <Alert
      icon="archive"
      tone={changed > 0 ? 'danger' : 'caution'}
      title={t('views.info.removeTitle', { name: ws.name })}
      message={
        <>
          <p>
            {t('views.info.deletesFolder')}{' '}
            {branch ? (
              <>
                {t('views.info.theBranch')}<strong>{branch}</strong>{t('views.info.branchStays')}
              </>
            ) : (
              t('views.info.noBranch')
            )}
          </p>
          {changed > 0 ? (
            <p>
              <strong>{t('views.info.hasChanges', { n: changed })}</strong> {t('views.info.theyllBeLost')}
            </p>
          ) : null}
          {anotherApp ? <p>{t('views.info.anotherApp')}</p> : null}
        </>
      }
      confirm={{ label: changed > 0 ? t('views.info.removeAnyway') : t('views.info.remove'), destructive: true, onClick: go }}
      onCancel={onCancel}
    />
  );
}

function Conversations({ ws, info }: { ws: Workspace; info: WorktreeInfo }) {
  const api = useApi();
  const t = useT();
  const talked = useApp((st) => st.log.some((l) => l.channel === `ws:${ws.id}` && !/^(t-\d+|import-)/.test(l.id)));
  if (!info.conversations.length) {
    return (
      <p className={s.quiet}>
        {t('views.info.noConvo')}
        {info.creator?.cwd ? t('views.info.madeItRanIn', { cwd: info.creator.cwd }) : ''}
      </p>
    );
  }
  return (
    <ul className={s.convos} aria-label={t('views.info.convos')}>
      {info.conversations.map((c) => (
        <li key={c.sessionId} className={s.convo}>
          <Icon name="chat" size={14} className={s.convoIcon} />
          <span className={s.convoText}>
            <span className={s.convoTitle}>{c.title}</span>
            <span className={s.convoWhen}>{t('views.info.lastActive', { when: when(c.lastModified) })}</span>
          </span>
          <Button
            size="small"
            disabled={talked || Boolean(ws.sessionId)}
            onClick={() => {
              setWorktreeFlag('about', ws.id, false);
              void api.workspaces.showConversation(ws.id, c.sessionId);
            }}
          >
            {t('views.info.show')}
          </Button>
        </li>
      ))}
    </ul>
  );
}

/** Size on disk: measured on request (it walks every worktree's folder). */
function useSize(id: string): number | undefined {
  const api = useApi();
  const size = useApp((st) => st.disk[id]);
  const asked = useRef(false);
  useEffect(() => {
    if (size !== undefined || asked.current) return;
    asked.current = true;
    void api.workbench.measureDisk().catch(() => undefined);
  }, [api, size]);
  return size;
}

/**
 * `agent`: a sub-agent's own worktree whose agent Claude Code no longer has (no conversation to
 * start in it); `origin`, who started it, when Claude Code's files still say.
 */
export function WorktreeInfoPage({ ws, agent, origin }: { ws: Workspace; agent?: boolean; origin?: AgentOrigin }) {
  const actions = useActions();
  const api = useApi();
  const { client } = useBeluga();
  const t = useT();
  const statusKey = `${ws.status?.changed ?? '-'}:${ws.status?.ahead ?? '-'}:${ws.status?.behind ?? '-'}:${ws.branch ?? ''}`;
  const { info, loading, error } = useWorktreeInfo(ws.id, statusKey);
  const hasChat = useApp((st) => st.log.some((l) => l.channel === `ws:${ws.id}`));
  const size = useSize(ws.id);
  const [removing, setRemoving] = useState(false);
  const source = info?.origin.source ?? sourceFromPath(ws.path);
  const start = (): void => {
    setWorktreeFlag('started', ws.id, true);
    setWorktreeFlag('about', ws.id, false);
    setTimeout(() => document.dispatchEvent(new CustomEvent('beluga:focus-composer')), 30);
  };
  return (
    <div className={s.page} data-testid="worktree-info">
      <div className={s.inner}>
        <header className={s.head}>
          <span className={s.badge} aria-hidden="true">
            <Icon name={agent ? 'bot' : iconOf(source)} size={22} />
          </span>
          <div className={s.headText}>
            <h1 className={s.title}>{origin?.description ?? ws.name}</h1>
            <p className={s.origin}>{origin ? `${t('views.info.startedBy', { name: origin.sessionTitle ?? t('views.wt.aSession') })}${origin.sessionCwd ? t('views.info.inDir', { dir: baseName(origin.sessionCwd) }) : ''}` : (info?.origin.label ?? t('views.wt.madeOutside'))}</p>
          </div>
          {hasChat ? (
            <Button size="small" variant="quiet" icon="back" onClick={() => setWorktreeFlag('about', ws.id, false)}>
              {t('views.info.back')}
            </Button>
          ) : null}
        </header>
        <p className={s.lead}>{agent ? t('views.info.agentLead') : (info?.origin.detail ?? t('views.info.madeOutsideDetail'))}</p>
        <LivePanel workspaceId={ws.id} />
        {info?.stale ? (
          <p className={s.stale}>
            <Icon name="check" size={13} /> {t('views.info.safe', { why: info.staleText?.toLowerCase() ?? '' })}
          </p>
        ) : null}
        {info?.missing ? (
          <p className={s.warn}>
            <Icon name="alert" size={13} /> {t('views.info.folderGone')}
          </p>
        ) : null}

        <div className={s.actions}>
          {!info?.missing && !agent ? (
            <Button variant="primary" icon="chat" onClick={start}>
              {t('views.info.startHere')}
            </Button>
          ) : null}
          {!info?.missing ? (
            <Button icon="folder" onClick={() => void api.workspaces.openInFinder(ws.id)}>
              {openFolderLabel()}
            </Button>
          ) : null}
          {!info?.missing ? (
            <Button icon="terminal" onClick={() => actions.run({ type: 'open_ws', id: ws.id, tab: 'terminal' })}>
              {t('views.info.openTerminal')}
            </Button>
          ) : null}
          <span className={s.flex} />
          <Button variant="danger" icon="archive" onClick={() => setRemoving(true)}>
            {t('views.info.removeWorktree')}
          </Button>
        </div>

        <section className={s.card} aria-label={t('views.info.about')}>
          <dl className={s.fields}>
            <Field label={t('views.history.branchLabel')}>{info ? (info.branch ?? t('views.info.detached')) : (ws.branch ?? '…')}</Field>
            <Field label={t('views.home.basedOn')}>{info?.base ?? ws.base ?? '…'}</Field>
            <Field label={t('views.info.made')}>{info?.createdAt ? `${day(info.createdAt)} (${ago(info.createdAt)})` : loading ? '…' : t('views.info.unknown')}</Field>
            <Field label={t('views.info.lastCommit')}>
              {info?.lastCommit ? (
                <>
                  {ago(info.lastCommit.at)} · <span className={s.subject}>{info.lastCommit.subject}</span>
                </>
              ) : loading ? (
                '…'
              ) : (
                t('views.wt.noneSize')
              )}
            </Field>
            <Field label={t('views.info.compared')}>{info ? `${t('views.info.aheadBehind', { ahead: info.ahead, behind: info.behind })}${info.merged ? t('views.info.allMerged') : ''}` : '…'}</Field>
            <Field label={t('views.info.uncommitted')}>{info ? (info.changed ? t('views.diff.files', { n: info.changed }) : t('views.info.nothing')) : '…'}</Field>
            <Field label={t('views.info.sizeOnDisk')}>{size !== undefined ? formatBytes(size) : t('views.info.measuring')}</Field>
            {info?.conductor?.prTitle ? <Field label={t('views.info.pr')}>{info.conductor.prTitle}</Field> : null}
            {info?.creator ? (
              <Field label={t('views.wt.colMadeBy')}>
                {t('views.info.claudeIn', { title: info.creator.title ?? info.creator.sessionId.slice(0, 8) })}{info.creator.at ? `, ${day(info.creator.at)}` : ''}
                {info.creator.cwd ? t('views.info.ranIn', { cwd: info.creator.cwd }) : ''}
              </Field>
            ) : null}
            <Field label={t('views.info.folder')}>
              <Tip label={t('views.info.copyPath')}>
                <button type="button" className={s.path} onClick={() => void navigator.clipboard?.writeText(ws.path).then(() => toast(client, t('views.diff.copiedPath'), 'success'))}>
                  {ws.path}
                </button>
              </Tip>
            </Field>
          </dl>
        </section>

        <section className={s.section}>
          <h2 className={s.h2}>{info?.conversations.length ? t('views.info.convosN', { n: info.conversations.length }) : t('views.info.convos')}</h2>
          {info ? <Conversations ws={ws} info={info} /> : error ? <p className={s.quiet}>{t('views.info.couldntLook', { error })}</p> : <p className={s.quiet}>{t('views.info.looking')}</p>}
        </section>
      </div>
      {removing ? (
        <RemoveWorktreeAlert
          ws={ws}
          {...(info ? { info } : {})}
          onCancel={() => setRemoving(false)}
          onDone={(removed) => {
            setRemoving(false);
            if (removed) actions.run({ type: 'close_tab', id: ws.id });
          }}
        />
      ) : null}
    </div>
  );
}

/** Above a conversation shown from a worktree made outside Beluga: what it is, and its info page. */
export function OtherWorktreeBanner({ ws }: { ws: Workspace }) {
  const t = useT();
  return (
    <div className={s.banner}>
      <Icon name={iconOf(sourceFromPath(ws.path))} size={13} />
      <span className={s.bannerText}>{t('views.info.banner')}</span>
      <Button size="small" variant="quiet" onClick={() => setWorktreeFlag('about', ws.id, true)}>
        {t('views.info.aboutButton')}
      </Button>
    </div>
  );
}
