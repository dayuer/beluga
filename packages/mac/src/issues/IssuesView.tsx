import { useEffect, useMemo, useRef, useState } from 'react';
import type { GhIssueState } from '@beluga/core/issues/model.js';
import { repoSlug } from '@beluga/core/issues/model.js';
import { Icon } from '../components/Icon.js';
import { ProjectIcon } from '../components/ProjectIcon.js';
import { Button, Empty, EmptyActions, IconButton, Segmented, Tip, cx } from '../components/ui.js';
import { useApi, useApp } from '../lib/beluga.js';
import { currentSheet } from '../lib/sheets.js';
import { PickMenu } from '../tasks/PickMenu.js';
import { ago } from '../tasks/tasks-model.js';
import { useTasksPrefs } from '../tasks/use-tasks.js';
import { ConnectGitHub } from '../views/project/GitHubRow.js';
import { issuesProject, searchWords } from './issues-model.js';
import { IssueRow } from './parts.js';
import { setIssuesPrefs, useIssueActions, useIssueList, useIssuesPrefs } from './use-issues.js';
import t from '../tasks/tasks.module.css';
import s from './issues.module.css';
import arr from '../lib/arrive.module.css';
import { useLateArrival } from '../lib/last-seen.js';
import { NoProjects } from '../work/NoProjects.js';
import { primaryKey } from '../lib/shortcuts-model.js';
import { useT } from '../i18n/index.js';

const STATES = (tr: ReturnType<typeof useT>): ReadonlyArray<{ readonly value: GhIssueState; readonly label: string; readonly hint: string }> => [
  { value: 'open', label: tr('issues.view.open'), hint: tr('issues.view.openHint') },
  { value: 'closed', label: tr('issues.view.closed'), hint: tr('issues.view.closedHint') },
];

/**
 * Issues: one project's GitHub issues at a time (the one you're in; the switcher changes it),
 * open or closed, newest activity first; the search box asks GitHub ("login 500", "label:bug").
 * Each shows what Beluga is doing about it. An issue opens into its page, where Claude can
 * investigate it, fix it, or put it on the board; right-click does the same from here.
 */
export function IssuesView() {
  const view = useApp((st) => st.view);
  const tr = useT();
  const allProjects = useApp((st) => st.projects);
  const projects = useMemo(() => allProjects.filter((p) => p.root && !p.error), [allProjects]);
  const tasksPrefs = useTasksPrefs();
  const prefs = useIssuesPrefs();
  const { openList, openOnGitHub } = useIssueActions();
  const api = useApi();
  const projectId = issuesProject(projects, view.kind === 'issues' ? view.projectId : undefined, tasksPrefs.project);
  const here = projects.find((p) => p.id === projectId);
  const [typed, setTyped] = useState('');
  const [search, setSearch] = useState('');
  const [connect, setConnect] = useState(false);
  const find = useRef<HTMLInputElement>(null);
  const { list, loading, error, refresh } = useIssueList(projectId, prefs.state, search);
  // Nothing kept from last time: the list settles in once GitHub answers.
  const late = useLateArrival(projectId ?? '', list !== undefined);

  // GitHub is asked once typing pauses.
  useEffect(() => {
    const words = searchWords(typed);
    if (words === search) return;
    const timer = setTimeout(() => setSearch(words), 450);
    return () => clearTimeout(timer);
  }, [typed, search]);
  // Another project: a fresh search.
  useEffect(() => {
    setTyped('');
    setSearch('');
  }, [projectId]);
  // ⌘F searches.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || currentSheet() || !primaryKey(e) || e.key.toLowerCase() !== 'f') return;
      e.preventDefault();
      find.current?.focus();
      find.current?.select();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  if (!projects.length || !here || !projectId) return <NoProjects icon="issue" detail={tr('issues.view.noProjects')} />;

  const repo = list && list.kind !== 'none' ? list.repo : undefined;
  return (
    <div className={t.view}>
      <div className={t.bar}>
        <div className={t.barGroup}>
          <PickMenu<string>
            label={tr('issues.view.project')}
            choices={projects.map((p) => ({ value: p.id, label: p.name, mark: <ProjectIcon id={p.id} name={p.name} size={16} /> }))}
            chosen={[here.id]}
            onPick={(id) => openList(id)}
          >
            <button type="button" className={t.projectSwitch} aria-label={tr('issues.view.projectIs', { name: here.name })}>
              <ProjectIcon id={here.id} name={here.name} size={18} />
              <span className={t.projectName}>{here.name}</span>
              <Icon name="chevronDown" size={11} />
            </button>
          </PickMenu>
          <Segmented<GhIssueState> label={tr('issues.view.show')} value={prefs.state} onChange={(state) => setIssuesPrefs({ state })} options={STATES(tr)} />
        </div>
        <div className={cx(t.barGroup, t.barActions)}>
          <label className={cx(t.find, s.find)}>
            <Icon name="search" size={12} />
            <input
              ref={find}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={tr('issues.view.search')}
              aria-label={tr('issues.view.searchLabel')}
              onKeyDown={(e) => {
                if (e.key === 'Enter') setSearch(searchWords(typed));
                if (e.key === 'Escape') (setTyped(''), setSearch(''), (e.target as HTMLInputElement).blur());
              }}
            />
            {typed ? (
              <button type="button" className={t.findClear} aria-label={tr('issues.view.clearSearch')} onClick={() => (setTyped(''), setSearch(''))}>
                <Icon name="x" size={10} />
              </button>
            ) : null}
          </label>
          <IconButton icon="refresh" label={loading ? tr('issues.view.asking') : tr('issues.view.askAgain')} className={cx(loading && s.spinning)} onClick={refresh} disabled={!repo} />
          {repo ? (
            <Tip label={`${repo.url}/issues`}>
              <Button size="small" icon="external" onClick={() => openOnGitHub(`${repo.url}/issues`)}>
                GitHub
              </Button>
            </Tip>
          ) : null}
        </div>
      </div>
      <div className={t.body}>
        {error ? (
          <Empty icon="alert" title={tr('issues.view.cantRead')} detail={error} action={<Button onClick={refresh}>{tr('issues.view.tryAgain')}</Button>} />
        ) : !list ? (
          <Empty icon="issue" title={tr('issues.view.asking')} detail={tr('issues.view.forIssues', { name: here.name })} />
        ) : list.kind === 'none' ? (
          <Empty icon="issue" title={tr('issues.view.notOnGitHub')} detail={tr('issues.view.notOnGitHubDetail')} />
        ) : list.kind === 'no_gh' ? (
          <Empty
            icon="issue"
            title={tr('issues.view.connect')}
            detail={tr('issues.view.connectDetail', { repo: repoSlug(list.repo) })}
            action={
              <EmptyActions>
                <Button variant="primary" onClick={() => setConnect(true)}>
                  {tr('issues.view.connectButton')}
                </Button>
              </EmptyActions>
            }
          />
        ) : list.kind === 'error' ? (
          <Empty icon="alert" title={tr('issues.view.cantRead')} detail={list.message} action={<Button onClick={refresh}>{tr('issues.view.tryAgain')}</Button>} />
        ) : !list.issues.length ? (
          <Empty
            icon={prefs.state === 'open' && !search ? 'task' : 'issue'}
            title={search ? tr('issues.view.nothingMatches') : prefs.state === 'open' ? tr('issues.view.noOpen') : tr('issues.view.noClosed')}
            detail={search ? tr('issues.view.tryOther') : prefs.state === 'open' ? tr('issues.view.nothingWaiting', { repo: repoSlug(list.repo) }) : tr('issues.view.nothingClosed', { repo: repoSlug(list.repo) })}
          />
        ) : (
          <div className={cx(s.list, late && arr.arrive)} role="table" aria-label={tr('issues.view.listLabel', { name: here.name, state: prefs.state })}>
            {list.issues.map((issue) => (
              <IssueRow key={issue.number} projectId={projectId} repo={list.repo} issue={issue} />
            ))}
          </div>
        )}
      </div>
      {list?.kind === 'github' && list.issues.length ? (
        <div className={t.foot}>
          {tr('issues.view.foot', { count: `${list.issues.length}${list.more ? '+' : ''}`, state: prefs.state, repo: repoSlug(list.repo), when: ago(list.fetchedAt) })}
          {list.more ? tr('issues.view.footMore') : ''}
        </div>
      ) : null}
      {connect ? (
        <ConnectGitHub
          onClose={() => setConnect(false)}
          onCheck={async () => {
            const now = await api.issues.list(projectId, { state: prefs.state, force: true }).catch(() => undefined);
            refresh();
            return now?.kind === 'github';
          }}
        />
      ) : null}
    </div>
  );
}
