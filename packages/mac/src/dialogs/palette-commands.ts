import { type AppState, channelOf } from '@beluga/core/store.js';
import { canRunOn } from '@beluga/core/trust.js';
import { type WorkspaceAction, findWorkspace, workspaceButtons } from '@beluga/ui/workspace-models.js';
import type { IconName } from '../components/Icon.js';
import type { Actions } from '../lib/actions.js';
import type { UiStore } from '../lib/beluga.js';
import type { SocketClient } from '@beluga/ipc/socket-client.js';
import { openSettings } from '../lib/native-routes.js';
import { openSheet } from '../lib/sheets.js';
import { openStripe } from '../lib/earnings.js';
import { openSupport } from '../lib/support.js';
import { SHOW_WELCOME } from '../onboarding/onboarding-model.js';
import { previewRequestPopup } from '../gateway/request-native.js';
import { revealLabel } from '../lib/os-words.js';
import { t } from '../i18n/index.js';

export interface PaletteCommand {
  readonly id: string;
  readonly label: string;
  readonly hint?: string;
  readonly icon: IconName;
  readonly run: () => void;
  readonly keywords?: string[];
}

interface Ctx {
  readonly client: SocketClient;
  readonly ui: UiStore;
  readonly actions: Actions;
  readonly state: AppState;
}

/** One command: a name you'd look for, what it does, and the /command it stands for (so typing that finds it too). */
const cmd = (slash: string, id: string, label: string, icon: IconName, run: () => void, hint?: string): PaletteCommand => ({ id: `cmd:${id}`, label, icon, run, keywords: [`/${slash}`, slash], ...(hint ? { hint } : {}) });

/** What you can do in the workspace on screen that its toolbar buttons (the palette's "Here") don't already list. */
function workspaceCommands({ ui, actions, state }: Ctx): PaletteCommand[] {
  const ws = state.view.kind === 'workspace' ? findWorkspace(state.projects, state.view.id) : undefined;
  if (!ws || ws.archived) return [];
  const here = new Set(workspaceButtons(state, ws).filter((b) => !b.disabled).map((b) => b.action));
  const act = (action: WorkspaceAction) => () => actions.run({ type: 'ws', id: ws.id, action });
  const project = state.projects.find((p) => p.id === ws.projectId);
  const worktree = ws.kind === 'worktree';
  const list: Array<[WorkspaceAction, PaletteCommand, boolean]> = [
    ['pr', cmd('pr', 'pr', state.prs[ws.id] ? t('dialogs.cmd.pr') : t('dialogs.cmd.createPr'), 'pr', act('pr'), t('dialogs.cmd.prHint')), worktree],
    ['fork', cmd('fork', 'fork', t('dialogs.cmd.fork'), 'branch', act('fork'), t('dialogs.cmd.forkHint')), ws.kind !== 'chat'],
    ['handoff', cmd('handoff', 'handoff', t('dialogs.cmd.handoff'), 'hand', act('handoff'), t('dialogs.cmd.handoffHint')), worktree],
    ['commit', cmd('commit', 'commit', t('dialogs.cmd.commit'), 'commit', act('commit')), worktree && Boolean(ws.status?.changed)],
    ['merge', cmd('merge', 'merge', t('dialogs.cmd.merge'), 'merge', act('merge')), worktree],
    ['compact', cmd('compact', 'compact', t('dialogs.cmd.compact'), 'wand', act('compact'), t('dialogs.cmd.compactHint')), true],
    ['run', cmd('run', 'run', t('dialogs.cmd.run'), 'play', act('run')), Boolean(project?.scripts?.run)],
    ['setup', cmd('setup', 'setup', t('dialogs.cmd.setup'), 'refresh', act('setup')), Boolean(project?.scripts?.setup)],
    ['finder', cmd('finder', 'finder', revealLabel(), 'folder', act('finder')), true],
    ['archive', cmd('archive', 'archive', t('dialogs.cmd.archive'), 'archive', act('archive')), ws.kind !== 'main'],
    ['delete', cmd('delete', 'delete', t('dialogs.cmd.delete'), 'alert', act('delete')), ws.kind !== 'main'],
  ];
  return [
    ...list.filter(([action, , ok]) => ok && !here.has(action)).map(([, c]) => c),
    ...(project?.root ? [cmd('project', 'scripts', t('dialogs.cmd.projectSettings'), 'terminal', () => ui.openMenu({ kind: 'scripts', projectId: project.id }), t('dialogs.cmd.projectSettingsHint'))] : []),
  ];
}

/**
 * The /commands as things to do: a name you'd look for, no `<arg>` syntax. The ones that need
 * more (a name, a command, a note for Claude) open their sheet; nothing is typed for you.
 */
export function paletteCommands(ctx: Ctx): PaletteCommand[] {
  const { client, ui, state } = ctx;
  const api = client.api;
  const channel = channelOf(state.view);
  const talking = state.view.kind === 'room' || state.view.kind === 'assistant' || state.view.kind === 'workspace';
  const following = state.peers.find((p) => p.peerId === state.follow);
  const canRun = state.peers.some((p) => canRunOn(state.granted[p.peerId]?.level));
  return [
    ...workspaceCommands(ctx),
    ...(talking
      ? [
          cmd('clear', 'clear', state.view.kind === 'room' ? t('dialogs.cmd.clearRoom') : t('dialogs.cmd.clearThis'), 'x', () => ui.openMenu({ kind: 'clear', channel, host: state.isHost })),
          cmd('plan', 'plan', state.planMode[channel] ? t('dialogs.cmd.planOff') : t('dialogs.cmd.planOn'), 'claude', () => ctx.actions.run({ type: 'plan_toggle', channel }), t('dialogs.cmd.planHint')),
          cmd('visualize', 'visualize', t('dialogs.cmd.visualize'), 'grid', () => void api.session.submit('/visualize', { channel }), t('dialogs.cmd.visualizeHint')),
          cmd('model', 'model', t('dialogs.cmd.model'), 'spark', () => ui.openMenu({ kind: 'model', ...(channel === 'room' ? {} : { channel }) }), t('dialogs.cmd.modelHint')),
        ]
      : []),
    ...(state.board.enabled
      ? [
          { id: 'tasks:new', label: t('dialogs.cmd.newTask'), icon: 'task' as const, hint: t('dialogs.cmd.newTaskHint'), keywords: ['task', 'issue', 'todo', 'ticket'], run: () => openSheet({ kind: 'new_task' }) },
          { id: 'plans:new', label: t('dialogs.cmd.newPlan'), icon: 'flag' as const, hint: t('dialogs.cmd.newPlanHint'), keywords: ['plan', 'milestone', 'roadmap', 'project'], run: () => openSheet({ kind: 'new_plan' }) },
          { id: 'plans:open', label: t('dialogs.cmd.plans'), icon: 'flag' as const, hint: t('dialogs.cmd.plansHint'), keywords: ['plans', 'milestones', 'roadmap'], run: () => ctx.actions.run({ type: 'view', view: { kind: 'plans' } }) },
          { id: 'tasks:open', label: t('dialogs.cmd.tasks'), icon: 'task' as const, hint: t('dialogs.cmd.tasksHint'), keywords: ['tasks', 'board', 'issues', 'backlog', 'kanban'], run: () => ctx.actions.run({ type: 'view', view: { kind: 'tasks' } }) },
          { id: 'issues:open', label: t('dialogs.cmd.issues'), icon: 'issue' as const, hint: t('dialogs.cmd.issuesHint'), keywords: ['issues', 'github', 'bugs', 'triage', 'investigate', 'fix'], run: () => ctx.actions.run({ type: 'view', view: { kind: 'issues' } }) },
          { id: 'pulls:open', label: t('dialogs.cmd.pulls'), icon: 'pr' as const, hint: t('dialogs.cmd.pullsHint'), keywords: ['pull requests', 'prs', 'pulls', 'github', 'review', 'merge'], run: () => ctx.actions.run({ type: 'view', view: { kind: 'pulls' } }) },
          { id: 'actions:open', label: t('dialogs.cmd.actions'), icon: 'pulse' as const, hint: t('dialogs.cmd.actionsHint'), keywords: ['actions', 'github', 'ci', 'workflows', 'runs', 'builds', 'checks', 'pipeline'], run: () => ctx.actions.run({ type: 'view', view: { kind: 'actions' } }) },
        ]
      : []),
    ...(state.sentinel.enabled
      ? [
          { id: 'sentinel:open', label: t('dialogs.cmd.sentinel'), icon: 'sentinel' as const, hint: t('dialogs.cmd.sentinelHint'), keywords: ['sentinel', 'schedule', 'cron', 'watch', 'every morning', 'brief', 'recurring'], run: () => ctx.actions.run({ type: 'view', view: { kind: 'sentinel' } }) },
          { id: 'dashboard:open', label: t('dialogs.cmd.dashboard'), icon: 'gauge' as const, hint: t('dialogs.cmd.dashboardHint'), keywords: ['dashboard', 'numbers', 'metrics', 'kpi', 'stats', 'revenue', 'subscribers', 'tiles'], run: () => ctx.actions.run({ type: 'view', view: { kind: 'dashboard' } }) },
          { id: 'sentinel:chat', label: t('dialogs.cmd.sentinelChat'), icon: 'chat' as const, hint: t('dialogs.cmd.sentinelChatHint'), keywords: ['sentinel', 'chat', 'ask', 'watchers'], run: () => ctx.actions.run({ type: 'view', view: { kind: 'sentinel_chat', ...(ctx.state.sentinel.chats?.active ? { chat: ctx.state.sentinel.chats.active } : {}) } }) },
          { id: 'sentinel:new', label: t('dialogs.cmd.newSentinel'), icon: 'sentinel' as const, hint: t('dialogs.cmd.newSentinelHint'), keywords: ['sentinel', 'schedule', 'cron', 'watch', 'recipe', 'automate'], run: () => openSheet({ kind: 'new_sentinel' }) },
        ]
      : []),
    cmd('template', 'template-new', t('dialogs.cmd.newTemplate'), 'wand', () => openSheet({ kind: 'template' }), t('dialogs.cmd.newTemplateHint')),
    cmd('template', 'templates', t('dialogs.cmd.manageTemplates'), 'wand', () => ui.openMenu({ kind: 'templates', manage: true })),
    ...(canRun ? [cmd('run', 'peer-run', t('dialogs.cmd.peerRun'), 'terminal', () => openSheet({ kind: 'peer_run' }), t('dialogs.cmd.peerRunHint'))] : []),
    ...(following ? [cmd('unfollow', 'unfollow', t('dialogs.cmd.unfollow', { name: following.name }), 'eye', () => void api.session.follow(undefined))] : []),
    ...(state.myShares.length ? [cmd('unshare', 'unshare', t('dialogs.cmd.unshare'), 'share', () => ui.openMenu({ kind: 'share_folder', launchDir: client.launchDir, mine: state.myShares }))] : []),
    cmd('name', 'name', t('dialogs.cmd.name'), 'person', () => openSettings(ui, 'general', 'settings-name'), state.self?.name ? t('dialogs.cmd.nameNow', { name: state.self.name }) : undefined),
    cmd('people', 'people', t('dialogs.cmd.people'), 'people', () => openSettings(ui, 'people'), t('dialogs.cmd.peopleHint')),
    stripeCommand(state),
    { id: 'cmd:support', label: t('dialogs.cmd.support'), icon: 'cup', hint: t('dialogs.cmd.supportHint'), keywords: ['support', 'coffee', 'donate', 'tip', 'sponsor', 'star', 'github'], run: () => openSupport('coffee') },
    cmd('env', 'env', t('dialogs.cmd.env'), 'lock', () => openSettings(ui, 'environment'), t('dialogs.cmd.envHint')),
    cmd('shell', 'shell', t('dialogs.cmd.shell'), 'terminal', () => openSettings(ui, 'terminal'), t('dialogs.cmd.shellHint')),
    {
      id: 'cmd:popup-preview',
      label: t('dialogs.cmd.popup'),
      icon: 'bell',
      hint: t('dialogs.cmd.popupHint'),
      keywords: ['popup', 'pop-up', 'request', 'notification', 'preview', 'test', 'friend'],
      run: previewRequestPopup,
    },
    { id: 'cmd:welcome', label: t('dialogs.cmd.welcome'), icon: 'spark', hint: t('dialogs.cmd.welcomeHint'), keywords: ['onboarding', 'welcome', 'tour', 'intro'], run: () => void document.dispatchEvent(new CustomEvent(SHOW_WELCOME)) },
    ...(state.isHost
      ? [
          cmd('lock', 'lock', state.roomOpen ? t('dialogs.cmd.closeRoom') : t('dialogs.cmd.openRoom'), 'lock', () => void api.session.setRoomOpen(!state.roomOpen)),
          cmd('newlink', 'newlink', t('dialogs.cmd.newLink'), 'link', () =>
            openSheet({ kind: 'confirm', title: t('dialogs.cmd.newLinkTitle'), message: t('dialogs.cmd.newLinkMessage'), confirm: t('dialogs.cmd.newLinkConfirm'), run: () => void api.session.newInviteLink() }),
          ),
        ]
      : [cmd('quit', 'quit', t('dialogs.cmd.quit'), 'x', () => openSheet({ kind: 'confirm', title: t('dialogs.cmd.quitTitle'), message: t('dialogs.cmd.quitMessage'), confirm: t('dialogs.cmd.quitConfirm'), destructive: true, run: () => void api.session.quit() }))]),
  ];
}

/** Connect Stripe (or see the earnings) for the project on screen, or pick one in the sheet. */
function stripeCommand(state: AppState): PaletteCommand {
  const ws = state.view.kind === 'workspace' ? findWorkspace(state.projects, state.view.id) : undefined;
  const project = state.projects.find((p) => p.root && p.id === ws?.projectId);
  const connected = project ? Boolean(state.earnings[project.root]) : false;
  return {
    id: 'cmd:stripe',
    label: project ? (connected ? t('dialogs.cmd.earnings', { name: project.name }) : t('dialogs.cmd.connectStripeTo', { name: project.name })) : t('dialogs.cmd.connectStripe'),
    hint: t('dialogs.cmd.stripeHint'),
    icon: 'coin',
    keywords: ['stripe', 'earnings', 'revenue', 'money', 'sales'],
    run: () => openStripe(project?.id),
  };
}
