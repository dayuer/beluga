import type { ReactNode } from 'react';
import { findWorkspace, stateOf } from '@beluga/ui/workspace-models.js';
import { formatTokens } from '@beluga/ui/work-models.js';
import { formatBytes } from '@beluga/shared/format.js';
import { contextPct, contextTone, formatTokenCount } from '@beluga/shared/context-usage.js';
import { speedWords } from '@beluga/shared/local-endpoints.js';
import { unreadCount } from '@beluga/core/work-store.js';
import { issuesOfWorkspace } from '@beluga/core/board/model.js';
import { noticeAgo, noticeLook } from '@beluga/ui/notice-models.js';
import { Icon } from '../components/Icon.js';
import { Avatar, Button, Dot, Tip } from '../components/ui.js';
import { useActions } from '../lib/actions.js';
import { useApi, useApp, useBeluga } from '../lib/beluga.js';
import { openExternal } from '../lib/system.js';
import { Switch } from '../dialogs/settings-controls.js';
import { openPerson } from '../dialogs/native/PersonPopover.js';
import r from '../dialogs/native/room.module.css';
import { ConversationDetails } from '../network/ConversationInspector.js';
import { StatusIcon } from '../tasks/marks.js';
import { ClaudeCodeInspector } from '../claude-code/Live.js';
import { teammatesOf } from '@beluga/core/team/model.js';
import { shownState } from '../network/net-model.js';
import { openDm } from '../network/use-net.js';
import { sameDeep, sameFields } from '../lib/stable.js';
import s from './Inspector.module.css';
import { fileManager } from '../lib/os-words.js';
import { ThreadsSection } from '../threads/ThreadsSection.js';
import { Panel } from './inspector-parts.js';
import { useT } from '../i18n/index.js';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={s.field}>
      <span className={s.fieldLabel}>{label}</span>
      <span className={s.fieldValue}>{children}</span>
    </div>
  );
}

/** Everything waiting on you, in one place, wherever you are. */
function NeedsYou() {
  const api = useApi();
  const t = useT();
  const actions = useActions();
  const state = useApp((st) => ({ approvals: st.approvals, questions: st.questions, projects: st.projects, shared: st.shared }), sameFields);
  const { approvals, questions } = state;
  if (!approvals.length && !questions.length) return null;
  const place = (channel: string): string => {
    if (channel === 'room') return t('layout.inspector.theChat');
    const id = channel.slice(3);
    return findWorkspace(state.projects, id)?.name ?? state.shared.find((w) => w.id === id)?.name ?? t('layout.inspector.aWorkspace');
  };
  return (
    <Panel title={t('layout.inspector.needsYou')}>
      {approvals.map((a) => (
        <div key={a.id} className={s.need}>
          <div className={s.needTitle}>
            <Dot tone="warn" />
            {a.title}
          </div>
          <div className={s.needActions}>
            <Button size="small" variant="primary" onClick={() => void api.host.answerApproval('yes', a.id)}>
              {t('layout.inspector.allow')}
            </Button>
            <Button size="small" variant="quiet" onClick={() => void api.host.answerApproval('no', a.id)}>
              {t('layout.inspector.deny')}
            </Button>
          </div>
        </div>
      ))}
      {questions.map((q) => (
        <button
          key={q.qid}
          type="button"
          className={s.needLink}
          onClick={() => {
            const id = q.channel.slice(3);
            const shared = state.shared.find((w) => w.id === id);
            if (q.channel === 'room') actions.run({ type: 'view', view: { kind: 'room' } });
            else if (shared) actions.run({ type: 'open_shared', owner: shared.owner, id, tab: 'chat' });
            else actions.run({ type: 'open_ws', id });
          }}
        >
          <Icon name={q.question.kind === 'plan' ? 'wand' : 'spark'} size={12} />
          {t(q.question.kind === 'plan' ? 'layout.inspector.planIn' : 'layout.inspector.questionIn', { place: place(q.channel) })}
          <Icon name="chevronRight" size={10} />
        </button>
      ))}
    </Panel>
  );
}

/** The board's tasks this worktree is doing or carrying: each opens its page, and the board opens filtered to them. */
function WorkspaceTasks({ id, projectId }: { id: string; projectId: string }) {
  const actions = useActions();
  const tr = useT();
  const board = useApp((st) => st.board);
  if (!board.enabled) return null;
  const tasks = issuesOfWorkspace(board, id);
  const toBoard = (
    <Tip label={tr('layout.inspector.boardTip')}>
      <Button size="small" variant="quiet" icon="task" onClick={() => actions.run({ type: 'view', view: { kind: 'tasks', projectId, worktree: id } })}>
        {tr('layout.inspector.board')}
      </Button>
    </Tip>
  );
  return (
    <Panel title={tasks.length > 1 ? tr('layout.inspector.tasksCount', { count: tasks.length }) : tr('layout.inspector.tasks')} action={toBoard}>
      {tasks.length ? (
        tasks.map((t) => (
          <button key={t.id} type="button" className={s.taskLink} title={`${t.key} ${t.title}`} onClick={() => actions.run({ type: 'view', view: { kind: 'task', id: t.id } })}>
            <StatusIcon status={t.status} size={13} />
            <span className={s.taskKey}>{t.key}</span>
            <span className={s.taskTitle}>{t.title}</span>
          </button>
        ))
      ) : (
        <div className={s.dim}>{tr('layout.inspector.noTask')}</div>
      )}
    </Panel>
  );
}

/** The people you work on this project with (BLG-299): each opens your chat with them. */
function ProjectTeam({ projectId }: { projectId: string }) {
  const { client } = useBeluga();
  const t = useT();
  const enabled = useApp((st) => st.team.enabled);
  const mates = useApp((st) => teammatesOf(st.team, projectId), sameDeep);
  const online = useApp((st) => mates.filter((m) => st.network.friends.some((f) => f.peerId === m.peerId && shownState(f) === 'online')).map((m) => m.peerId), sameDeep);
  if (!enabled && !mates.length) return null;
  return (
    <Panel title={mates.length > 1 ? t('layout.inspector.teamCount', { count: mates.length }) : t('layout.inspector.team')}>
      {mates.length ? (
        mates.map((m) => (
          <Tip key={m.peerId} label={t('layout.inspector.chatWith', { name: m.name })}>
            <button type="button" className={`${s.person} ${r.personRow}`} onClick={() => openDm(client, m.peerId)}>
              <Avatar name={m.name} id={m.peerId} size={18} />
              <span className={s.personName}>{m.name}</span>
              {online.includes(m.peerId) ? (
                <span className={s.dim}>
                  <Dot tone="ok" /> {t('layout.inspector.online')}
                </span>
              ) : null}
              <Icon name="chat" size={12} />
            </button>
          </Tip>
        ))
      ) : (
        <div className={s.dim}>{t('layout.inspector.teamEmpty')}</div>
      )}
    </Panel>
  );
}

function WorkspaceDetails({ id }: { id: string }) {
  const api = useApi();
  const t = useT();
  const actions = useActions();
  const { ui } = useBeluga();
  // What this panel shows, worked out from the shared state: drawn again only when part of it changes.
  const state = useApp(
    (full) => {
      const ws = findWorkspace(full.projects, id);
      return {
        ws,
        st: ws ? stateOf(full, ws, 0) : undefined,
        pr: full.prs[id],
        ctx: full.context[`ws:${id}`],
        setup: full.setup[id],
        members: full.members[id],
        disk: full.disk[id],
        projects: full.projects,
        peers: full.peers,
        friends: full.network.friends,
        contextMeter: full.prefs.contextMeter,
      };
    },
    (a, b) => sameDeep(a, b, 2),
  );
  const { ws, st, pr, ctx, setup } = state;
  if (!ws || !st) return null;
  const members = Object.entries(state.members ?? {});
  const tokens = ws.usage ? ws.usage.input + ws.usage.output + ws.usage.cacheWrite : 0;
  const project = state.projects.find((p) => p.id === ws.projectId);
  return (
    <>
      <ThreadsSection id={id} />
      <Panel title={t('layout.inspector.thisWorkspace')}>
        <Field label={t('layout.inspector.state')}>
          <span className={s[`tone_${st.tone}`]}>{st.label}</span>
        </Field>
        {ws.branch ? <Field label={t('layout.inspector.branch')}>{ws.branch}</Field> : null}
        {ws.base ? <Field label={t('layout.inspector.from')}>{ws.base}</Field> : null}
        {ws.status ? (
          <Field label={t('layout.inspector.changes')}>
            {t('layout.inspector.changesValue', { changed: ws.status.changed, ahead: ws.status.ahead })}
            {ws.status.behind ? t('layout.inspector.behind', { count: ws.status.behind }) : ''}
          </Field>
        ) : null}
        {ctx && state.contextMeter ? (
          <Field label={t('layout.inspector.context')}>
            {/* The same numbers and colours as the meter in the box you type in. */}
            <span className={s.meter} data-tone={contextTone(contextPct(ctx))} title={t('layout.inspector.tokensOf', { used: formatTokenCount(ctx.used), window: formatTokenCount(ctx.window) })}>
              <span style={{ width: `${contextPct(ctx)}%` }} />
            </span>
            {ctx.compacting ? t('layout.inspector.compacting') : t('layout.inspector.contextValue', { pct: contextPct(ctx), used: formatTokenCount(ctx.used), window: formatTokenCount(ctx.window) })}
          </Field>
        ) : null}
        {tokens ? <Field label={t('layout.inspector.agent')}>{`${t('layout.inspector.tokens', { count: formatTokens(tokens) })}${ws.usage?.local ? ` · ${speedWords(ws.usage.local.tps)}` : ws.usage?.cost ? ` · $${ws.usage.cost.toFixed(2)}` : ''}`}</Field> : null}
        {state.disk !== undefined ? <Field label={t('layout.inspector.disk')}>{formatBytes(state.disk)}</Field> : null}
        {setup ? <Field label={t('layout.inspector.setup')}>{setup.status === 'running' ? t('layout.inspector.running') : setup.status === 'done' ? t('layout.inspector.done') : `${t('layout.inspector.failed')}${setup.detail ? ` (${setup.detail})` : ''}`}</Field> : null}
        {ws.handedTo ? <Field label={t('layout.inspector.handedTo')}>{ws.handedTo}</Field> : null}
        {ws.handedFrom ? <Field label={t('layout.inspector.from')}>{ws.handedFrom}</Field> : null}
        <div className={s.buttons}>
          <Button size="small" icon="folder" onClick={() => void api.workspaces.openInFinder(ws.id)}>
            {fileManager()}
          </Button>
          {project?.root ? (
            <Button size="small" icon="terminal" onClick={() => ui.openMenu({ kind: 'scripts', projectId: ws.projectId })}>
              {t('layout.inspector.commands')}
            </Button>
          ) : null}
        </div>
      </Panel>
      {project?.root ? <WorkspaceTasks id={ws.id} projectId={ws.projectId} /> : null}
      {pr ? (
        <Panel title={t('layout.inspector.pr', { number: pr.number })} action={<Button size="small" variant="quiet" icon="refresh" onClick={() => void api.workbench.refreshPrs(ws.id)} />}>
          <div className={s.prTitle}>{pr.title}</div>
          <Field label={t('layout.inspector.checks')}>
            <Dot tone={pr.checks === 'passing' ? 'ok' : pr.checks === 'failing' ? 'error' : pr.checks === 'pending' ? 'warn' : 'muted'} />
            {pr.checks}
          </Field>
          <Field label={t('layout.inspector.state')}>{t(pr.state === 'OPEN' ? (pr.draft ? 'layout.inspector.prDraft' : 'layout.inspector.prOpen') : pr.state === 'MERGED' ? 'layout.inspector.prMerged' : 'layout.inspector.prClosed')}</Field>
          {pr.review ? <Field label={t('layout.inspector.review')}>{t(pr.review === 'APPROVED' ? 'layout.inspector.approved' : pr.review === 'CHANGES_REQUESTED' ? 'layout.inspector.changesRequested' : 'layout.inspector.waitingReview')}</Field> : null}
          <div className={s.buttons}>
            <Button size="small" onClick={() => void openExternal(pr.url)}>
              {t('layout.inspector.openGithub')}
            </Button>
            {pr.checks === 'failing' ? (
              <Button size="small" variant="primary" onClick={() => void api.workbench.fixChecks(ws.id)}>
                {t('layout.inspector.fixChecks')}
              </Button>
            ) : null}
          </div>
        </Panel>
      ) : null}
      <ProjectTeam projectId={ws.projectId} />
      <Panel title={t('layout.inspector.workingHere')} action={<Button size="small" variant="quiet" icon="plus" aria-label={t('layout.inspector.share')} onClick={() => actions.run({ type: 'ws', id: ws.id, action: 'share' })} />}>
        {members.length ? (
          members.map(([peerId, role]) => {
            const name = state.peers.find((p) => p.peerId === peerId)?.name ?? state.friends.find((f) => f.peerId === peerId)?.name ?? t('layout.sharedProjects.someone');
            return (
              <button key={peerId} type="button" className={`${s.person} ${r.personRow}`} onClick={(e) => openPerson(ui, state.peers.findIndex((p) => p.peerId === peerId), e.currentTarget)}>
                <Avatar name={name} id={peerId} size={18} />
                <span className={s.personName}>{name}</span>
                <span className={s.dim}>{role === 'contribute' ? t('layout.inspector.worksHere') : t('layout.inspector.follows')}</span>
              </button>
            );
          })
        ) : (
          <div className={s.dim}>{t('layout.inspector.onlyYou')}</div>
        )}
      </Panel>
    </>
  );
}

function Room() {
  const api = useApi();
  const t = useT();
  const { ui } = useBeluga();
  const state = useApp((st) => ({ hosting: st.hosting, invite: st.invite, room: st.room, status: st.status, peers: st.peers, selfId: st.selfId, isHost: st.isHost, roomOpen: st.roomOpen }), sameFields);
  const hosting = state.hosting;
  const invite = (): void => void document.dispatchEvent(new CustomEvent('beluga:invite-room'));
  const inviteState = hosting?.phase === 'ready' || state.invite ? t('layout.inspector.readyToShare') : hosting?.phase === 'local' ? t('layout.inspector.localOnly') : hosting?.phase === 'failed' ? (hosting.detail ?? t('layout.inspector.remoteFailed')) : hosting ? t('layout.inspector.opening') : t('layout.inspector.notOpen');
  return (
    <Panel
      title={t('layout.inspector.room')}
      action={
        <Button size="small" variant="quiet" icon="link" onClick={invite}>
          {t('layout.sidebar.invite')}
        </Button>
      }
    >
      <Field label={t('layout.inspector.name')}>{state.room}</Field>
      <Field label={t('layout.inspector.status')}>
        <Dot tone={state.status === 'connected' ? 'ok' : state.status === 'connecting' ? 'warn' : 'error'} />
        {state.status === 'connected' ? t('layout.inspector.connected') : state.status === 'connecting' ? t('layout.inspector.connecting') : t('layout.inspector.offline')}
      </Field>
      <Field label={t('layout.inspector.people')}>
        <span className={r.avatars}>
          {state.peers.map((p, index) => (
            <Tip key={p.peerId} label={p.peerId === state.selfId ? t('layout.inspector.you', { name: p.name }) : p.name}>
              <button type="button" className={r.avatarButton} aria-label={p.name} onClick={(e) => openPerson(ui, index, e.currentTarget)}>
                <Avatar name={p.name} id={p.peerId} size={20} />
              </button>
            </Tip>
          ))}
        </span>
      </Field>
      {state.isHost ? (
        <Field label={t('layout.sidebar.invite')}>
          <Tip label={t('layout.inspector.inviteTip')}>
            <button type="button" className={r.link} onClick={invite}>
              {inviteState}
              <Icon name="chevronRight" size={9} />
            </button>
          </Tip>
        </Field>
      ) : null}
      {state.isHost ? (
        <Field label={t('layout.inspector.newPeople')}>
          <Switch label={t('layout.inspector.newPeopleJoin')} on={state.roomOpen} onChange={(v) => void api.session.setRoomOpen(v)} />
          {state.roomOpen ? t('layout.inspector.canJoin') : t('layout.inspector.closed')}
        </Field>
      ) : null}
    </Panel>
  );
}

/** The newest unread notification; the rest are under the bell in the toolbar. */
function Inbox() {
  const { ui } = useBeluga();
  const t = useT();
  const unread = useApp((st) => unreadCount(st));
  const latest = useApp((st) => st.inbox.find((n) => !n.read));
  if (!unread || !latest) return null;
  const { tone } = noticeLook(latest);
  const show = (): void => ui.patch({ notices: true });
  return (
    <Panel
      title={t('layout.inspector.notifications')}
      action={
        <Button size="small" variant="quiet" onClick={show}>
          {t('layout.inspector.showAll')}
        </Button>
      }
    >
      <button type="button" className={s.notice} onClick={show}>
        <Dot tone={tone === 'claude' ? 'claude' : tone === 'muted' ? 'info' : tone} />
        <span className={s.noticeText}>
          <span className={s.noticeTitle}>{latest.title}</span>
          <span className={s.dim}>{unread > 1 ? t('layout.inspector.andMore', { count: unread - 1 }) : (latest.body || t('layout.inspector.new'))}</span>
        </span>
        <span className={s.dim}>{noticeAgo(latest.ts)}</span>
      </button>
    </Panel>
  );
}

export function Inspector() {
  const t = useT();
  const view = useApp((st) => st.view);
  return (
    <aside className={s.inspector} aria-label={t('layout.inspector.label')}>
      <div className={s.titlebar} data-tauri-drag-region />
      <div className={s.scroll}>
        <NeedsYou />
        <ClaudeCodeInspector />
        {view.kind === 'workspace' ? (
          <WorkspaceDetails id={view.id} />
        ) : view.kind === 'conversation' ? (
          <ConversationDetails id={view.id} />
        ) : (
          <>
            {view.kind === 'project' ? <ProjectTeam projectId={view.id} /> : null}
            <Room />
          </>
        )}
        <Inbox />
      </div>
    </aside>
  );
}
