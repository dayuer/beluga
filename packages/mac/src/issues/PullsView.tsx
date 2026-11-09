import { useMemo, useState } from 'react';
import { repoSlug } from '@beluga/core/issues/model.js';
import { Icon } from '../components/Icon.js';
import { ProjectIcon } from '../components/ProjectIcon.js';
import { Button, Empty, EmptyActions, IconButton, Tip, cx } from '../components/ui.js';
import { useActions } from '../lib/actions.js';
import { useApi, useApp } from '../lib/beluga.js';
import { PickMenu } from '../tasks/PickMenu.js';
import { ago } from '../tasks/tasks-model.js';
import { useTasksPrefs } from '../tasks/use-tasks.js';
import { ConnectGitHub } from '../views/project/GitHubRow.js';
import { PullRow, usePulls } from '../views/project/PullRow.js';
import { issuesProject } from './issues-model.js';
import t from '../tasks/tasks.module.css';
import s from './issues.module.css';
import arr from '../lib/arrive.module.css';
import { useLateArrival } from '../lib/last-seen.js';
import { NoProjects } from '../work/NoProjects.js';
import { useT } from '../i18n/index.js';

/**
 * Pull Requests: one project's open pull requests on GitHub at a time (anyone's, the switcher
 * changes the project), the most recently active first. Each is the row Project Home shows: one
 * on a worktree's branch opens that worktree, any other checks out in a new one or opens on GitHub.
 */
export function PullsView() {
  const view = useApp((st) => st.view);
  const tr = useT();
  const allProjects = useApp((st) => st.projects);
  const projects = useMemo(() => allProjects.filter((p) => p.root && !p.error), [allProjects]);
  const tasksPrefs = useTasksPrefs();
  const actions = useActions();
  const api = useApi();
  const projectId = issuesProject(projects, view.kind === 'pulls' ? view.projectId : undefined, tasksPrefs.project);
  const here = projects.find((p) => p.id === projectId);
  const [connect, setConnect] = useState(false);
  const { list, loading, error, refresh } = usePulls(projectId ?? '');
  // Nothing kept from last time: the list settles in once GitHub answers.
  const late = useLateArrival(projectId ?? '', list !== undefined);

  if (!projects.length || !here || !projectId) return <NoProjects icon="pr" detail={tr('issues.pulls.noProjects')} />;

  const repo = list && list.kind !== 'none' ? list.repo : undefined;
  const onGitHub = (url: string): void => actions.openLink({ kind: 'url', url });
  const openList = (id: string): void => actions.run({ type: 'view', view: { kind: 'pulls', projectId: id } });
  return (
    <div className={t.view}>
      <div className={t.bar}>
        <div className={t.barGroup}>
          <PickMenu<string>
            label={tr('issues.view.project')}
            choices={projects.map((p) => ({ value: p.id, label: p.name, mark: <ProjectIcon id={p.id} name={p.name} size={16} /> }))}
            chosen={[here.id]}
            onPick={openList}
          >
            <button type="button" className={t.projectSwitch} aria-label={tr('issues.view.projectIs', { name: here.name })}>
              <ProjectIcon id={here.id} name={here.name} size={18} />
              <span className={t.projectName}>{here.name}</span>
              <Icon name="chevronDown" size={11} />
            </button>
          </PickMenu>
        </div>
        <div className={cx(t.barGroup, t.barActions)}>
          <IconButton icon="refresh" label={loading ? tr('issues.view.asking') : tr('issues.view.askAgain')} className={cx(loading && s.spinning)} onClick={refresh} disabled={!repo} />
          {repo ? (
            <Tip label={`${repo.url}/pulls`}>
              <Button size="small" icon="external" onClick={() => onGitHub(`${repo.url}/pulls`)}>
                GitHub
              </Button>
            </Tip>
          ) : null}
        </div>
      </div>
      <div className={t.body}>
        {error && !list ? (
          <Empty icon="alert" title={tr('issues.pulls.cantRead')} detail={error} action={<Button onClick={refresh}>{tr('issues.view.tryAgain')}</Button>} />
        ) : !list ? (
          <Empty icon="pr" title={tr('issues.view.asking')} detail={tr('issues.pulls.forPulls', { name: here.name })} />
        ) : list.kind === 'none' ? (
          <Empty icon="pr" title={tr('issues.view.notOnGitHub')} detail={tr('issues.pulls.notOnGitHubDetail')} />
        ) : list.kind === 'no_gh' ? (
          <Empty
            icon="pr"
            title={tr('issues.view.connect')}
            detail={tr('issues.pulls.connectDetail', { repo: repoSlug(list.repo) })}
            action={
              <EmptyActions>
                <Button variant="primary" onClick={() => setConnect(true)}>
                  {tr('issues.view.connectButton')}
                </Button>
              </EmptyActions>
            }
          />
        ) : list.kind === 'error' ? (
          <Empty icon="alert" title={tr('issues.pulls.cantRead')} detail={list.message} action={<Button onClick={refresh}>{tr('issues.view.tryAgain')}</Button>} />
        ) : !list.pulls.length ? (
          <Empty icon="pr" title={tr('issues.pulls.noOpen')} detail={tr('issues.pulls.nothingWaiting', { repo: repoSlug(list.repo) })} />
        ) : (
          <div className={cx(s.list, late && arr.arrive)} role="list" aria-label={tr('issues.pulls.listLabel', { name: here.name })}>
            {list.pulls.map((pull) => (
              <PullRow key={pull.number} projectId={projectId} pull={pull} />
            ))}
          </div>
        )}
      </div>
      {list?.kind === 'github' && list.pulls.length ? (
        <div className={t.foot}>
          {tr('issues.pulls.foot', { count: list.pulls.length, repo: repoSlug(list.repo), when: ago(list.fetchedAt) })}
          {list.total > list.pulls.length ? (
            <>
              {tr('issues.pulls.footActive')}
              <button type="button" className={t.footLink} onClick={() => onGitHub(`${list.repo.url}/pulls`)}>
                {tr('issues.pulls.moreOnGitHub', { n: list.total - list.pulls.length })}
              </button>
            </>
          ) : null}
        </div>
      ) : null}
      {connect ? (
        <ConnectGitHub
          onClose={() => setConnect(false)}
          onCheck={async () => {
            const now = await api.issues.pulls(projectId, { force: true }).catch(() => undefined);
            refresh();
            return now?.kind === 'github';
          }}
        />
      ) : null}
    </div>
  );
}
