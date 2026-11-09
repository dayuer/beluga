import { Alert } from '../../components/Alert.js';
import { worktreeOrigin } from '@beluga/workspaces/origin.js';
import { useApi, useApp } from '../../lib/beluga.js';
import { rich } from './pick.js';
import { useT } from '../../i18n/index.js';

/**
 * Delete Project…: it leaves Beluga, and so do the worktrees Beluga made for it (archived first,
 * so nothing of yours is lost). The project's own folder is never touched: not deleted, not
 * moved to the Trash. It leaves the sidebar at once; the archiving goes on in the background.
 */
export function DeleteProjectAlert({ projectId, close }: { projectId: string; close: () => void }) {
  const t = useT();
  const api = useApi();
  const project = useApp((st) => st.projects.find((p) => p.id === projectId && p.root));
  if (!project) return null;
  const worktrees = project.workspaces.filter((w) => w.kind === 'worktree' && !w.archived && worktreeOrigin(w) === 'beluga').length;
  const remove = (): void => {
    close();
    void api.workspaces.removeProject(project.id);
  };
  return (
    <Alert
      icon="alert"
      tone="danger"
      title={t('dialogs.deleteProject.title', { name: project.name })}
      message={
        <>
          <p>
            {t('dialogs.deleteProject.leaves')}
            {worktrees ? t('dialogs.deleteProject.worktrees', { n: worktrees, count: t('dialogs.n.worktree', { n: worktrees }) }) : null}
          </p>
          <p>
            {rich(t('dialogs.deleteProject.untouched'), { root: <code>{project.root}</code> })}
          </p>
        </>
      }
      confirm={{ label: t('dialogs.deleteProject.confirm'), destructive: true, onClick: remove }}
      onCancel={close}
    />
  );
}
