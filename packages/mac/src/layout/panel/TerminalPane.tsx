import { useEffect, useRef } from 'react';
import { githubId, runId, setupId, shellId, terminalLabel } from '@beluga/shared/terminal-keys.js';
import { findWorkspace } from '@beluga/ui/workspace-models.js';
import { ActionsDropdown, type ActionItem } from '../../components/SpecMenu.js';
import { Button, Dot, Empty, IconButton } from '../../components/ui.js';
import { useActions } from '../../lib/actions.js';
import { useApi, useApp, useBeluga, useUi } from '../../lib/beluga.js';
import { closeFocus, moveTerminal, openFocus, usePanelRuntime } from '../../lib/panel.js';
import { setPrefs, usePrefs } from '../../lib/prefs.js';
import { useGlobalShells } from '../../lib/shells.js';
import { chordLabel } from '../../lib/shortcuts-model.js';
import { claimShell, extraShells, pruneShells, releaseShell, useShellOwners } from '../../lib/ws-shells.js';
import { EnvStale, NoShells, ShellTabs, useEnvStale } from '../../views/TerminalView.js';
import { TerminalTab } from '../../views/TerminalTab.js';
import { Xterm } from '../../views/Xterm.js';
import t from '../../views/terminal.module.css';
import s from './panel.module.css';
import { useT } from '../../i18n/index.js';

/** How recently ⌘J must have asked for the keyboard for a terminal that just appeared to take it. */
const FOCUS_WINDOW_MS = 800;

interface Tabbed {
  readonly key: string | undefined;
  readonly tabs: ReadonlyArray<{ key: string; label: string; running: boolean; exit?: number | null; closable: boolean; renamable: boolean }>;
  readonly start: (size: { cols: number; rows: number }) => void;
  readonly restart?: () => void;
  readonly pick: (key: string) => void;
  readonly add: () => void;
  readonly close: (key: string) => void;
}

/** A workspace's terminals: its shell, setup and run while they exist, and shells you added with +. */
function useWorkspaceTerminals(wsId: string): Tabbed {
  const api = useApi();
  const { ui } = useBeluga();
  const terminals = useApp((st) => st.terminals);
  const exits = useApp((st) => st.termExits);
  const names = useApp((st) => st.termNames);
  const projects = useApp((st) => st.projects);
  const picked = useUi((u) => u.termKey);
  const owners = useShellOwners();
  const ws = findWorkspace(projects, wsId);
  useEffect(() => pruneShells(terminals), [terminals]);
  const extra = extraShells(owners, wsId, terminals, picked);
  const own = [shellId(wsId), setupId(wsId), runId(wsId), githubId(wsId)].filter((k) => k in terminals || k === shellId(wsId));
  const keys = [...own, ...extra];
  const key = picked && keys.includes(picked) && (picked in terminals || extra.includes(picked)) ? picked : shellId(wsId);
  const isExtra = (k: string): boolean => extra.includes(k);
  return {
    key,
    tabs: keys.map((k) => ({ key: k, label: terminalLabel(k, names), running: k in terminals && !(k in exits), ...(k in exits ? { exit: exits[k] } : {}), closable: isExtra(k), renamable: k === shellId(wsId) || isExtra(k) })),
    start: (size) => {
      if (key === shellId(wsId)) void api.terminals.shell(wsId, size);
      else if (isExtra(key) && ws) void api.terminals.global(key, ws.path, size);
    },
    ...(key === shellId(wsId) ? { restart: () => void api.terminals.shell(wsId) } : isExtra(key) && ws ? { restart: () => void api.terminals.global(key, ws.path) } : {}),
    pick: (k) => ui.patch({ termKey: k }),
    add: () => ui.patch({ termKey: claimShell(wsId, terminals) }),
    close: (k) => {
      if (k === key) ui.patch({ termKey: shellId(wsId) });
      releaseShell(k);
      void api.terminals.close(k);
    },
  };
}

/** The window's Run and Setup for a workspace, small enough for the terminal's bar. */
function WorkspaceScripts({ wsId }: { wsId: string }) {
  const actions = useActions();
  const tr = useT();
  const project = useApp((st) => st.projects.find((p) => p.workspaces.some((w) => w.id === wsId)));
  const runOn = useApp((st) => runId(wsId) in st.terminals && !(runId(wsId) in st.termExits));
  if (!project?.scripts?.run) return null;
  return runOn ? (
    <IconButton icon="stop" label={tr('layout.terminalPane.stop')} keys={chordLabel('Cmd+R')} onClick={() => actions.run({ type: 'ws', id: wsId, action: 'stop_run' })} />
  ) : (
    <IconButton icon="play" label={tr('layout.terminalPane.run', { command: project.scripts.run.command })} keys={chordLabel('Cmd+R')} onClick={() => actions.run({ type: 'ws', id: wsId, action: 'run' })} />
  );
}

/** The terminal's ⋯: where ⌘J shows it, moving it there now, the full-size view, the project's commands. */
function useMenuItems(where: 'drawer' | 'panel', wsId: string | undefined): ActionItem[] {
  const { client, ui } = useBeluga();
  const actions = useActions();
  const tr = useT();
  const prefs = usePrefs();
  const project = useApp((st) => (wsId ? st.projects.find((p) => p.workspaces.some((w) => w.id === wsId)) : undefined));
  const other = where === 'drawer' ? 'panel' : 'drawer';
  return [
    { label: other === 'panel' ? tr('layout.terminalPane.moveToPanel') : tr('layout.terminalPane.moveToDrawer'), icon: other === 'panel' ? 'panelRight' : 'panelBottom', onSelect: () => moveTerminal(client.store.getState(), other) },
    {
      label: tr('layout.terminalPane.opens', { keys: chordLabel('Cmd+J') }),
      separate: true,
      onSelect: () => undefined,
      submenu: [
        { label: tr('layout.terminalPane.inDrawer'), checked: prefs.termIn === 'drawer', onSelect: () => setPrefs({ termIn: 'drawer' }) },
        { label: tr('layout.terminalPane.inPanel'), checked: prefs.termIn === 'panel', onSelect: () => setPrefs({ termIn: 'panel' }) },
      ],
    },
    wsId
      ? { label: tr('layout.terminalPane.fullSize'), icon: 'expand', separate: true, onSelect: () => openFocus('terminal', wsId) }
      : { label: tr('layout.terminalPane.openView'), icon: 'expand', separate: true, onSelect: () => actions.run({ type: 'view', view: { kind: 'terminal' } }) },
    ...(project?.root ? [{ label: tr('layout.terminalPane.commands'), icon: 'terminal' as const, onSelect: () => ui.openMenu({ kind: 'scripts', projectId: project.id }) }] : []),
    { label: tr('layout.terminalPane.settings'), icon: 'gear', onSelect: () => ui.patch({ settings: 'terminal' }) },
  ];
}

/** Workspace terminals and your own shells, as one shape. */
function useTabbed(wsId: string | undefined): Tabbed {
  const api = useApi();
  const ws = useWorkspaceTerminals(wsId ?? '');
  const shells = useGlobalShells();
  if (wsId) return ws;
  const key = shells.key;
  return {
    key,
    tabs: shells.tabs.map((x) => ({ ...x, closable: true, renamable: true })),
    start: (size) => key && void api.terminals.global(key, shells.dir, size),
    ...(key ? { restart: () => void api.terminals.global(key, shells.dir) } : {}),
    pick: shells.pick,
    add: shells.open,
    close: shells.close,
  };
}

/**
 * A terminal in the right panel or in the drawer under the chat: the workspace's shells (or
 * your own) as tabs, + for another, and the terminal itself filling the rest.
 */
export function TerminalPane({ where, onClose }: { where: 'drawer' | 'panel'; onClose?: () => void }) {
  const tr = useT();
  const view = useApp((st) => st.view);
  const exits = useApp((st) => st.termExits);
  const prefs = usePrefs();
  const wsId = view.kind === 'workspace' ? view.id : undefined;
  // On a project's home the terminal is its main folder's, so it starts in the project you're looking at.
  const mainId = useApp((st) => (view.kind === 'project' ? st.projects.find((p) => p.id === view.id)?.workspaces.find((w) => w.kind === 'main')?.id : undefined));
  const tabbed = useTabbed(wsId ?? mainId);
  const items = useMenuItems(where, wsId);
  const focus = usePanelRuntime((r) => (wsId && r.focus?.wsId === wsId ? r.focus.kind : undefined));
  const askedFocus = usePanelRuntime((r) => r.termFocus);
  const body = useRef<HTMLDivElement>(null);
  // ⌘J puts the keyboard here (Run doesn't: you keep typing to Claude).
  // A terminal that's just appearing is made a frame later (Xterm, KLD-68): keep looking until it's there.
  useEffect(() => {
    let id = 0;
    const tryFocus = (): void => {
      if (Date.now() - askedFocus > FOCUS_WINDOW_MS) return;
      const input = body.current?.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea');
      if (input) input.focus();
      else id = requestAnimationFrame(tryFocus);
    };
    id = requestAnimationFrame(tryFocus);
    return () => cancelAnimationFrame(id);
  }, [askedFocus, tabbed.key]);
  // A terminal shows in one place at a time: the drawer or the full-size view has it.
  const elsewhere = where === 'panel' ? (prefs.drawer ? 'drawer' : focus === 'terminal' ? 'full' : undefined) : focus === 'terminal' ? 'full' : undefined;
  const { key } = tabbed;
  // Restarted with new variables: a fresh terminal on the new program.
  const stale = useEnvStale(key);
  return (
    <section className={s.term} aria-label={tr('layout.terminalPane.label')}>
      <div className={s.termBar}>
        <div className={s.termTabs} role="tablist" aria-label={tr('layout.terminalPane.tabs')}>
          {tabbed.tabs.map((x) => (
            <TerminalTab
              key={x.key}
              termKey={x.key}
              label={x.label}
              on={x.key === key}
              className={s.termTab}
              onClassName={s.termTabOn}
              renamable={x.renamable}
              onPick={() => tabbed.pick(x.key)}
              {...(x.closable ? { onClose: () => tabbed.close(x.key) } : {})}
              before={x.running ? <Dot tone="ok" /> : x.exit !== undefined ? <Dot tone={x.exit === 0 ? 'muted' : 'error'} /> : <Dot tone="muted" />}
              after={x.exit !== undefined && !x.key.startsWith('shell:') ? <span className={t.exit}>{x.exit === 0 ? tr('layout.terminalPane.done') : tr('layout.terminalPane.exit', { code: x.exit ?? '?' })}</span> : null}
            />
          ))}
          <IconButton icon="plus" label={tr('layout.terminalPane.newShell')} className={s.termAdd} onClick={tabbed.add} />
        </div>
        {wsId ? <WorkspaceScripts wsId={wsId} /> : null}
        <ActionsDropdown items={items}>
          <IconButton icon="more" label={tr('layout.terminalPane.options')} />
        </ActionsDropdown>
        {onClose ? <IconButton icon="x" label={tr('layout.terminalPane.closeDrawer')} keys={chordLabel('Cmd+J')} onClick={onClose} /> : null}
      </div>
      <div ref={body} className={s.termBody}>
        {elsewhere ? (
          <Empty
            icon={elsewhere === 'drawer' ? 'panelBottom' : 'expand'}
            title={elsewhere === 'drawer' ? tr('layout.terminalPane.inDrawerTitle') : tr('layout.terminalPane.fullTitle')}
            detail={elsewhere === 'drawer' ? tr('layout.terminalPane.onePlace') : undefined}
            action={
              <Button size="small" onClick={() => (elsewhere === 'drawer' ? setPrefs({ drawer: false }) : closeFocus())}>
                {tr('layout.terminalPane.showHere')}
              </Button>
            }
          />
        ) : key ? (
          <>
            <Xterm key={`${key}:${key in exits ? 'x' : 'live'}${stale ? ':old' : ''}`} termKey={key} start={tabbed.start} focus={false} />
            <EnvStale termKey={key} />
            {key in exits && tabbed.restart ? (
              <div className={t.restart}>
                <Button size="small" onClick={tabbed.restart}>
                  {tr('layout.terminalPane.startAgain')}
                </Button>
              </div>
            ) : null}
          </>
        ) : (
          <NoShells open={tabbed.add} />
        )}
      </div>
    </section>
  );
}
