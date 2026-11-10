import { Command } from 'cmdk';
import * as Dialog from '@radix-ui/react-dialog';
import { findWorkspace, workspaceButtons } from '@beluga/ui/workspace-models.js';
import { macTabs } from '../lib/go.js';
import { groupChatOpen } from '../lib/group-chat.js';
import { worktreeOrigin } from '@beluga/workspaces/origin.js';
import { Icon, type IconName } from '../components/Icon.js';
import { useActions } from '../lib/actions.js';
import { asksBeforeWork } from '../lib/work-confirm.js';
import { useApp, useBeluga, useUi } from '../lib/beluga.js';
import { pickTheme, setPrefs, usePrefs, zoom } from '../lib/prefs.js';
import { THEMES } from '../lib/themes.js';
import { themeName } from '../lib/prefs-words.js';
import { localButton } from '../lib/engine-words.js';
import { shortcutKeys } from '../lib/shortcuts.js';
import { showPanelTab, tabsOf, togglePanel, toggleTerminal } from '../lib/panel.js';
import { PANEL_LABELS, panelFits } from '../lib/panel-model.js';
import { paletteCommands } from './palette-commands.js';
import { newChatProject } from '../lib/project-home.js';
import { networkPaletteItems } from '../network/net-palette.js';
import s from './palette.module.css';
import { useT, tl } from '../i18n/index.js';

interface Item {
  readonly id: string;
  readonly label: string;
  readonly hint?: string;
  readonly keys?: string;
  readonly icon: IconName;
  readonly run: () => void;
  readonly keywords?: string[];
}

/** A shortcut's keys for an item, when it has some (yours: Settings › Keyboard). */
const keysOf = (id: string): { keys?: string } => {
  const keys = shortcutKeys(id);
  return keys ? { keys } : {};
};

const VIEW_ICONS: Record<string, IconName> = { files: 'folder', overview: 'grid', search: 'search', usage: 'gauge', terminal: 'terminal', tasks: 'task' };

/**
 * Everything you can do, one keystroke away: go anywhere, act on what's open, start something
 * new, any /command, people, and this window's settings. Type to filter.
 */
export function Palette() {
  const t = useT();
  const { ui, client } = useBeluga();
  const actions = useActions();
  const open = useUi((u) => u.palette);
  const state = useApp((st) => st);
  const prefs = usePrefs();
  if (!open) return null;
  const close = (): void => ui.patch({ palette: false });
  const go = (fn: () => void) => () => {
    close();
    fn();
  };

  const nav: Item[] = macTabs(state).map((tab) => ({ id: `view:${tab.kind}`, label: tab.label, hint: tab.hint.split(' · ')[0], ...keysOf(`go-${tab.kind}`), icon: VIEW_ICONS[tab.kind] ?? 'grid', run: () => actions.run({ type: 'view', view: { kind: tab.kind } }) }));
  const places: Item[] = [
    // Each project's home (its main folder: Update main, its worktrees and chats).
    ...state.projects.filter((p) => p.root).map((p) => ({ id: `project:${p.id}`, label: p.name, hint: t('dialogs.palette.projectHome'), icon: 'folder' as IconName, run: () => actions.run({ type: 'view', view: { kind: 'project', id: p.id } }) })),
    ...state.projects.flatMap((p) =>
      p.workspaces
        // A project's main checkout is no conversation (BLG-70): the project itself is listed instead.
        .filter((w) => !w.archived && w.kind !== 'main' && worktreeOrigin(w) !== 'agent')
        .map((w) => ({ id: `ws:${w.id}`, label: p.root ? `${p.name} › ${w.name}` : w.name, hint: w.branch ?? (w.kind === 'chat' ? t('dialogs.palette.chat') : ''), icon: (w.kind === 'chat' ? 'chat' : 'branch') as IconName, run: () => actions.run({ type: 'open_ws', id: w.id }) })),
    ),
    ...state.shared.map((w) => ({ id: `shared:${w.id}`, label: w.name, hint: t('dialogs.palette.sharedBy', { name: state.peers.find((p) => p.peerId === w.owner)?.name ?? t('dialogs.palette.someone') }), icon: 'share' as IconName, run: () => actions.run({ type: 'open_shared', owner: w.owner, id: w.id, tab: 'chat' }) })),
  ];
  const ws = state.view.kind === 'workspace' ? findWorkspace(state.projects, state.view.id) : undefined;
  const here: Item[] = ws
    ? [
        // The right panel's tabs (the center stays on the conversation).
        ...tabsOf(state).map((tab) => ({ id: `panel:${tab}`, label: t('dialogs.palette.show', { tab: tl('PANEL_LABELS', tab, 'text', PANEL_LABELS[tab]) }), hint: t('dialogs.palette.inPanel'), ...keysOf(`panel-${tab}`), icon: (tab === 'changes' ? 'diff' : tab === 'files' ? 'folder' : tab === 'terminal' ? 'terminal' : tab === 'history' ? 'clock' : tab === 'scratch' ? 'pulse' : tab === 'background' ? 'play' : tab === 'phone' ? 'phone' : 'inspector') as IconName, run: () => void showPanelTab(state, tab) })),
        ...workspaceButtons(state, ws)
          .filter((b) => !b.disabled)
          .map((b) => localButton(b))
          .map((b) => ({ id: `ws-action:${b.action}`, label: asksBeforeWork(b.action) ? `${b.label}…` : b.label, hint: b.hint, icon: (b.action === 'merge' ? 'merge' : b.action === 'pr' ? 'pr' : b.action === 'run' ? 'play' : b.action === 'archive' ? 'archive' : b.action === 'share' ? 'share' : b.action === 'handoff' ? 'hand' : b.action === 'review_claude' ? 'review' : b.action === 'commit' ? 'commit' : 'claude') as IconName, run: () => actions.run({ type: 'ws', id: ws.id, action: b.action }) })),
      ]
    : [];
  const chatHere = newChatProject(state);
  const create: Item[] = [
    { id: 'new-chat', label: t('dialogs.palette.newChat'), hint: chatHere === 'chats' ? t('dialogs.palette.newChatAnything') : t('dialogs.palette.inProject', { name: state.projects.find((p) => p.id === chatHere)?.name ?? t('dialogs.palette.thisProject') }), ...keysOf('new-chat'), icon: 'chat', run: () => actions.run({ type: 'new_chat', projectId: chatHere }) },
    ...state.projects.filter((p) => p.root).flatMap((p) => [
      { id: `new-wt:${p.id}`, label: t('dialogs.palette.newWorktreeIn', { name: p.name }), hint: t('dialogs.palette.fromOrigin'), icon: 'branch' as IconName, run: () => actions.run({ type: 'new_worktree', projectId: p.id }) },
      { id: `new-chat:${p.id}`, label: t('dialogs.palette.newChatIn', { name: p.name }), hint: t('dialogs.palette.newChatInHint'), icon: 'chat' as IconName, run: () => actions.run({ type: 'new_chat', projectId: p.id }) },
    ]),
    { id: 'add-project', label: t('dialogs.palette.addProject'), icon: 'plus', run: () => actions.run({ type: 'add_project' }) },
    { id: 'new-project', label: t('dialogs.palette.newProject'), hint: t('dialogs.palette.newProjectHint'), icon: 'folder', keywords: ['create project', 'start project', 'git init'], run: () => ui.patch({ addProject: 'new' }) },
    { id: 'clone-project', label: t('dialogs.palette.cloneProject'), hint: t('dialogs.palette.cloneProjectHint'), icon: 'download', keywords: ['git clone', 'git url', 'github', 'repository'], run: () => ui.patch({ addProject: 'clone' }) },
    { id: 'share-folder', label: t('dialogs.palette.shareFolder'), icon: 'share', run: () => ui.openMenu({ kind: 'share_folder', launchDir: state.home, mine: state.myShares }) },
    // One entry for inviting and adding a friend (BLG-203): /invite does the same.
    { id: 'invite', label: t('dialogs.palette.addFriend'), hint: t('dialogs.palette.addFriendHint'), icon: 'people', keywords: ['invite', 'invite someone', 'friend', 'code', 'link'], run: () => document.dispatchEvent(new CustomEvent('beluga:invite')) },
    { id: 'templates', label: t('dialogs.palette.template'), icon: 'wand', run: () => ui.openMenu({ kind: 'templates' }) },
  ];
  const people: Item[] = [
    ...(groupChatOpen(state) ? [{ id: 'view:room', label: t('more.sync.groupChat'), hint: t('more.sync.groupChatHint'), icon: 'chat' as IconName, run: () => actions.run({ type: 'view', view: { kind: 'room' } }) }] : []),
    ...state.peers
      .map((p, index) => ({ p, index }))
      .filter(({ p }) => p.peerId !== state.selfId)
      .map(({ p, index }) => ({ id: `person:${p.peerId}`, label: p.name, hint: t('dialogs.palette.personHint'), icon: 'person' as IconName, run: () => ui.openMenu({ kind: 'person', index }) })),
  ];
  // Friends and groups (the Beluga network), and adding a friend or a group.
  const net = networkPaletteItems(state, client);
  // The /commands as things to do (no `<arg>` syntax); the ones that need more open their sheet.
  const commands: Item[] = paletteCommands({ client, ui, actions, state });
  const window: Item[] = [
    { id: 'settings', label: t('dialogs.palette.settings'), ...keysOf('settings'), icon: 'gear', run: () => ui.patch({ settings: 'general' }) },
    { id: 'shortcuts', label: t('dialogs.palette.shortcuts'), hint: t('dialogs.palette.shortcutsHint'), keywords: ['keys', 'shortcuts', 'remap', 'hotkeys', 'keyboard'], ...keysOf('help-keys'), icon: 'command', run: () => ui.patch({ settings: 'keyboard' }) },
    { id: 'inbox', label: t('dialogs.palette.notifications'), hint: t('dialogs.palette.notificationsHint'), ...keysOf('inbox'), icon: 'bell', run: () => ui.patch({ notices: true }) },
    { id: 'appearance', label: prefs.appearance === 'dark' ? t('dialogs.palette.appearanceLight') : prefs.appearance === 'light' ? t('dialogs.palette.appearanceSystem') : t('dialogs.palette.appearanceDark'), icon: 'eye', run: () => setPrefs({ appearance: prefs.appearance === 'dark' ? 'light' : prefs.appearance === 'light' ? 'system' : 'dark' }) },
    ...THEMES.map((th) => ({ id: `theme:${th.id}`, label: t('dialogs.palette.theme', { name: themeName(th) }), hint: th.base === 'dark' ? t('dialogs.palette.darkTheme') : t('dialogs.palette.lightTheme'), keywords: ['theme', 'colours', 'colors', 'appearance'], icon: 'eye' as IconName, run: () => pickTheme(th.id) })),
    { id: 'sidebar', label: prefs.sidebar ? t('dialogs.palette.hideSidebar') : t('dialogs.palette.showSidebar'), ...keysOf('toggle-sidebar'), icon: 'sidebar', run: () => setPrefs({ sidebar: !prefs.sidebar }) },
    ...(panelFits(state.view)
      ? [{ id: 'inspector', label: prefs.inspector ? t('dialogs.palette.hidePanel') : t('dialogs.palette.showPanel'), hint: t('dialogs.palette.panelHint'), ...keysOf('toggle-inspector'), icon: 'panelRight' as IconName, run: () => togglePanel(state.view) }]
      : state.view.kind === 'plan'
        ? [{ id: 'inspector', label: t('dialogs.palette.planChat'), ...keysOf('toggle-inspector'), icon: 'claude' as IconName, run: () => togglePanel(state.view) }]
        : []),
    { id: 'terminal-toggle', label: t('dialogs.palette.terminal'), hint: prefs.termIn === 'drawer' ? t('dialogs.palette.underChat') : t('dialogs.palette.inPanel'), ...keysOf('toggle-dock'), icon: 'terminal', run: () => void toggleTerminal(client.store.getState()) },
    { id: 'bigger', label: t('dialogs.palette.bigger'), ...keysOf('zoom-in'), icon: 'plus', run: () => zoom('in') },
    { id: 'smaller', label: t('dialogs.palette.smaller'), ...keysOf('zoom-out'), icon: 'x', run: () => zoom('out') },
    { id: 'copy-answer', label: t('dialogs.palette.copyAnswer'), ...keysOf('conv-copy'), icon: 'copy', run: () => void client.api.session.copyLastAnswer() },
    { id: 'stop', label: t('dialogs.palette.stop'), icon: 'stop', run: () => void client.api.session.stopAgent() },
  ];
  const groups: Array<[string, Item[]]> = [
    [t('dialogs.palette.here'), here],
    [t('dialogs.palette.goTo'), nav],
    [t('dialogs.palette.workspaces'), places],
    [t('dialogs.palette.new'), [...create, ...net.create]],
    [t('dialogs.palette.friends'), net.friends],
    [t('dialogs.palette.inRoom'), people],
    [t('dialogs.palette.window'), window],
    [t('dialogs.palette.commands'), commands],
  ];
  return (
    <Dialog.Root open onOpenChange={(v) => (v ? undefined : close())}>
      <Dialog.Portal>
        <Dialog.Overlay className={s.overlay} />
        <Dialog.Content className={s.palette} aria-describedby={undefined}>
          <Dialog.Title className="visually-hidden">{t('dialogs.palette.everything')}</Dialog.Title>
          <Command label={t('dialogs.palette.everything')} loop>
            <div className={s.inputRow}>
              <Icon name="search" size={15} />
              <Command.Input className={s.input} placeholder={t('dialogs.palette.placeholder')} autoFocus />
            </div>
            <Command.List className={s.list}>
              <Command.Empty className={s.empty}>{t('dialogs.palette.nothing')}</Command.Empty>
              {groups.map(([heading, items]) =>
                items.length ? (
                  <Command.Group key={heading} heading={heading} className={s.group}>
                    {items.map((it) => (
                      <Command.Item key={it.id} value={`${it.label} ${it.hint ?? ''} ${it.id}`} keywords={it.keywords} className={s.item} onSelect={go(it.run)}>
                        <Icon name={it.icon} size={14} className={s.itemIcon} />
                        <span className={s.label}>{it.label}</span>
                        {it.hint ? <span className={s.hint}>{it.hint}</span> : null}
                        {it.keys ? <kbd className={s.keys}>{it.keys}</kbd> : null}
                      </Command.Item>
                    ))}
                  </Command.Group>
                ) : null,
              )}
            </Command.List>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
