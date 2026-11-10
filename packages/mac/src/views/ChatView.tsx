import { channelOf } from '@beluga/core/store.js';
import { planForHome } from '@beluga/core/plans/model.js';
import { Attention } from '../chat/Attention.js';
import { ChatLog } from '../chat/ChatLog.js';
import { Composer } from '../chat/Composer.js';
import { Button, Empty, EmptyActions } from '../components/ui.js';
import { useActions } from '../lib/actions.js';
import { useApp } from '../lib/beluga.js';
import s from './views.module.css';
import { OtherWorktreeBanner, WorktreeInfoPage } from './WorktreeInfo.js';
import { AgentWorktreePage } from '../claude-code/AgentMonitor.js';
import { isAgentWorktree } from '../claude-code/subagents-model.js';
import { LiveStrip } from '../claude-code/Live.js';
import { SharedStrip } from '../layout/PeopleHere.js';
import { EnvStrip } from './project/EnvAsks.js';
import { TaskStrip } from '../tasks/TaskStrip.js';
import { DrivenStrip } from '../chat/DrivenStrip.js';
import { PrStrip } from '../chat/PrStrip.js';
import { PlanStrip } from '../plans/PlanStrip.js';
import { useWorktreeFlag } from './worktree-info-state.js';
import { AskBanner } from '../chat/AskBanner.js';
import { TriageLine } from '../chat/TriageLine.js';
import { ConnectionStatus } from './room/ConnectionStatus.js';
import { AssistantTabs } from '../chat/AssistantTabs.js';
import { DrivingBanner } from '../agent-term/DrivingBanner.js';
import { computerWord, yourComputer } from '../lib/os-words.js';
import { type Key, useT } from '../i18n/index.js';

/** A conversation and the box to add to it: the room's group chat, a workspace, a shared workspace, a draft. */
/** One-click ways to begin, under an empty conversation. */
function Starters() {
  const actions = useActions();
  const tr = useT();
  const view = useApp((st) => st.view);
  const project = useApp((st) => st.projects.find((p) => p.root && (view.kind !== 'workspace' || p.workspaces.some((w) => w.id === view.id))));
  if (view.kind === 'room') {
    return (
      <EmptyActions>
        {project ? (
          <Button variant="primary" icon="branch" onClick={() => actions.run({ type: 'new_worktree', projectId: project.id })}>
            {tr('views.home.newWorktree')}
          </Button>
        ) : (
          <Button variant="primary" icon="plus" onClick={() => actions.run({ type: 'add_project' })}>
            {tr('views.overview.addProjects')}
          </Button>
        )}
        <Button icon="chat" onClick={() => actions.run({ type: 'new_chat', projectId: 'chats' })}>
          {tr('views.overview.newChat')}
        </Button>
        {project ? (
          <Button variant="quiet" icon="plus" onClick={() => actions.run({ type: 'add_project' })}>
            {tr('views.overview.addProjects')}
          </Button>
        ) : null}
      </EmptyActions>
    );
  }
  if (view.kind !== 'workspace') return null;
  // A first task, sent with one click (in a main folder: a first question).
  const ask = project?.workspaces.find((w) => w.id === view.id)?.askOnly;
  return (
    <EmptyActions>
      {(ask ? ASK_STARTERS : STARTERS).map((t) => (
        <Button key={t.label} icon={t.icon} onClick={() => actions.submit(tr(t.prompt))}>
          {tr(t.label)}
        </Button>
      ))}
    </EmptyActions>
  );
}

/** First things to ask Your Mac. */
function AssistantStarters() {
  const actions = useActions();
  const tr = useT();
  return (
    <EmptyActions>
      {ASSISTANT_STARTERS.map((t) => (
        <Button key={t.label} icon={t.icon} onClick={() => actions.submit(tr(t.prompt))}>
          {tr(t.label)}
        </Button>
      ))}
    </EmptyActions>
  );
}

// Labels and prompts are dictionary keys: a starter is sent in the language shown, so the agent answers in it.
const starter = <I extends string>(id: string, icon: I) => ({ label: `views.chat.starter.${id}` as Key, prompt: `views.chat.starter.${id}Prompt` as Key, icon });

const ASSISTANT_STARTERS = [starter('screenshot', 'image'), starter('cpu', 'gauge'), starter('running', 'pulse')] as const;

const STARTERS = [starter('explain', 'eye'), starter('bug', 'search'), starter('tests', 'check')] as const;

/** First questions for a chat in a main folder, where Claude only reads. */
const ASK_STARTERS = [starter('explain', 'eye'), starter('lately', 'clock'), starter('risks', 'search')] as const;

export function ChatView() {
  const view = useApp((st) => st.view);
  const t = useT();
  const channel = channelOf(view);
  const ws = useApp((st) => (view.kind === 'workspace' ? st.projects.flatMap((p) => p.workspaces).find((w) => w.id === view.id) : undefined));
  const projectName = useApp((st) => st.projects.find((p) => p.root && (view.kind === 'draft' ? p.id === view.projectId : p.workspaces.some((w) => w.id === ws?.id)))?.name);
  const empty =
    view.kind === 'draft' ? (
      projectName ? (
        <Empty icon="eye" title={t('views.chat.askAbout', { name: projectName })} detail={t('views.chat.draftAskDetail')} />
      ) : (
        <Empty icon="chat" title={t('views.chat.newChat')} detail={t('views.chat.newChatDetail')} />
      )
    ) : ws?.askOnly ? (
      <Empty icon="eye" title={t('views.chat.askAbout', { name: projectName ?? t('views.chat.thisProject') })} detail={t('views.chat.askDetail')} action={<Starters />} />
    ) : view.kind === 'draft_worktree' ? (
      <Empty icon="branch" title={t('views.chat.newWorktree')} detail={t('views.chat.newWorktreeDetail')} />
    ) : view.kind === 'assistant' ? (
      <Empty icon="laptop" title={t('views.chat.askComputer', { computer: yourComputer() })} detail={t('views.chat.assistantDetail', { computer: computerWord() })} action={<AssistantStarters />} />
    ) : view.kind === 'room' ? (
      <Empty icon="claude" title={t('views.chat.sayHi')} detail={t('views.chat.sayHiDetail')} action={<Starters />} />
    ) : (
      <Empty icon="chat" title={t('views.chat.tell')} detail={t('views.chat.tellDetail')} action={<Starters />} />
    );
  // A worktree made outside Beluga: its info page until there's a conversation (or you start one).
  const other = ws?.kind === 'worktree' && ws.external && !ws.archived ? ws : undefined;
  const hasItems = useApp((st) => st.log.some((l) => l.channel === channel));
  // A plan's own conversation plans: it never moves to a worktree.
  const planHome = useApp((st) => Boolean(planForHome(st.plans, channel)));
  // The agent's own terminal drives this conversation (BLG-534): the chat follows along until you take over.
  const driving = useApp((st) => (view.kind === 'workspace' ? Boolean(st.agentTerms[view.id]) : false));
  const started = useWorktreeFlag('started', other?.id ?? '');
  const about = useWorktreeFlag('about', other?.id ?? '');
  // A sub-agent's own worktree is the agent, followed live (never a place to start a conversation).
  if (other && isAgentWorktree(other) && !hasItems) return <AgentWorktreePage ws={other} />;
  if (other && (about || (!hasItems && !started))) return <WorktreeInfoPage ws={other} />;
  // Files from Finder dropped anywhere on it go in the message box (use-attachments.tsx).
  const chat = (
    <div className={s.chat} data-drop-zone>
      {other ? <OtherWorktreeBanner ws={other} /> : null}
      {view.kind === 'room' ? <ConnectionStatus /> : null}
      {view.kind === 'assistant' ? <AssistantTabs /> : null}
      {view.kind === 'workspace' ? <PlanStrip workspaceId={view.id} /> : null}
      {view.kind === 'workspace' ? <TaskStrip workspaceId={view.id} /> : null}
      {view.kind === 'workspace' ? <DrivenStrip workspaceId={view.id} /> : null}
      {view.kind === 'workspace' ? <PrStrip workspaceId={view.id} /> : null}
      {view.kind === 'workspace' ? <SharedStrip wsId={view.id} /> : null}
      {view.kind === 'workspace' ? <EnvStrip workspaceId={view.id} /> : null}
      {/* Its own terminal driving it: the banner below says so (not a Claude Code session beside it). */}
      {view.kind === 'workspace' && !driving ? <LiveStrip workspaceId={view.id} /> : null}
      <ChatLog key={channel} channel={channel === 'draft' ? '__draft__' : channel} empty={empty} />
      {ws?.askOnly && !ws.archived && !planHome ? <AskBanner wsId={ws.id} /> : null}
      <Attention />
      {channel === 'draft' ? null : <TriageLine channel={channel} />}
      {driving && view.kind === 'workspace' ? <DrivingBanner wsId={view.id} /> : <Composer />}
    </div>
  );
  // The terminal is in the right panel or the drawer under the center (layout/panel), not beside the chat.
  return chat;
}
