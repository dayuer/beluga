import { worktreeOrigin } from '@beluga/workspaces/origin.js';
import { Alert } from '../../components/Alert.js';
import { useApp } from '../../lib/beluga.js';
import type { NativeMenuProps } from './index.js';
import { usePick } from './pick.js';
import { useT } from '../../i18n/index.js';
import s from './menus.module.css';

/** Tidy up the worktrees Claude Code sub-agents left in a project: which ones, and what's kept. */
export function AgentsAlert({ menu, close }: NativeMenuProps<'agents'>) {
  const t = useT();
  const pick = usePick(menu);
  const project = useApp((st) => st.projects.find((p) => p.id === menu.projectId));
  if (!project) return null;
  const agents = project.workspaces.filter((w) => !w.archived && worktreeOrigin(w) === 'agent');
  const clean = agents.filter((w) => w.status?.changed === 0).length;
  const table = {
    columns: [t('dialogs.agents.colWorktree'), t('dialogs.agents.colBranch'), t('dialogs.agents.colChanges')],
    rows: agents.map((w) => [
      w.name,
      <code key="b">{w.branch ?? '–'}</code>,
      w.status?.changed ? <span className={s.warn}>{t('dialogs.n.file', { n: w.status.changed })}</span> : <span className={s.muted}>{t('dialogs.agents.none')}</span>,
    ]),
  };
  if (!clean) {
    return (
      <Alert
        icon="branch"
        tone="info"
        title={t('dialogs.agents.leftTitle', { count: t('dialogs.n.worktree', { n: agents.length }), project: project.name })}
        message={t('dialogs.agents.leftMessage')}
        table={table}
        cancel={false}
        confirm={{ label: t('dialogs.agents.ok'), onClick: close }}
        onCancel={close}
      />
    );
  }
  return (
    <Alert
      icon="branch"
      tone="caution"
      title={t('dialogs.agents.removeTitle', { count: t('dialogs.n.finishedWorktree', { n: clean }) })}
      message={t('dialogs.agents.removeMessage', { n: clean, project: project.name })}
      table={table}
      confirm={{ label: t('dialogs.agents.remove', { count: t('dialogs.n.Worktree', { n: clean }) }), onClick: () => pick('agents-clean') }}
      onCancel={close}
    />
  );
}
