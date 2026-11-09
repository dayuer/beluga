import { useT } from '../i18n/index.js';
import { useEffect, useMemo, useState } from 'react';
import type { GhRun, GhWorkflow } from '@beluga/core/ci/model.js';
import { fileName, isLive, runTone, sortRuns, statusWords } from '@beluga/core/ci/model.js';
import { repoSlug } from '@beluga/core/issues/model.js';
import { Icon } from '../components/Icon.js';
import { ProjectIcon } from '../components/ProjectIcon.js';
import { CodeLines } from '../components/markdown/CodeLines.js';
import { Button, Empty, EmptyActions, IconButton, Segmented, Tip, cx } from '../components/ui.js';
import { useApi, useApp } from '../lib/beluga.js';
import { PickMenu } from '../tasks/PickMenu.js';
import { ago } from '../tasks/tasks-model.js';
import { useTasksPrefs } from '../tasks/use-tasks.js';
import { issuesProject } from '../issues/issues-model.js';
import { ConnectGitHub } from '../views/project/GitHubRow.js';
import { RunMark, RunRow } from './parts.js';
import { useCiActions, useRuns, useWorkflows } from './use-ci.js';
import { NowText, Ticking } from './now.js';
import { WorkflowGraph } from './WorkflowGraph.js';
import t from '../tasks/tasks.module.css';
import s from './ci.module.css';
import arr from '../lib/arrive.module.css';
import { useLateArrival } from '../lib/last-seen.js';
import { NoProjects } from '../work/NoProjects.js';
import { localStatusWords } from '../lib/ci-sentinel-words.js';

type Page = 'runs' | 'workflows';

const PAGES = (tr: ReturnType<typeof useT>): ReadonlyArray<{ readonly value: Page; readonly label: string; readonly hint: string; readonly icon: 'pulse' | 'graph' }> => [
  { value: 'runs', label: tr('ci.actions.runs'), hint: tr('ci.actions.runsHint'), icon: 'pulse' },
  { value: 'workflows', label: tr('ci.actions.workflows'), hint: tr('ci.actions.workflowsHint'), icon: 'graph' },
];

/**
 * Actions: one project's GitHub Actions at a time (the switcher changes it). Runs: the latest,
 * running ones on top, every few seconds while one runs; a workflow narrows them. Workflows: each
 * file drawn as a graph, with how its last run went. A run opens into its page.
 */
export function ActionsView() {
  const view = useApp((st) => st.view);
  const tr = useT();
  const allProjects = useApp((st) => st.projects);
  const projects = useMemo(() => allProjects.filter((p) => p.root && !p.error), [allProjects]);
  const tasksPrefs = useTasksPrefs();
  const { openList, openOnGitHub } = useCiActions();
  const api = useApi();
  const projectId = issuesProject(projects, view.kind === 'actions' ? view.projectId : undefined, tasksPrefs.project);
  const page: Page = view.kind === 'actions' && view.page === 'workflows' ? 'workflows' : 'runs';
  const here = projects.find((p) => p.id === projectId);
  const [workflow, setWorkflow] = useState('');
  const [connect, setConnect] = useState(false);
  useEffect(() => setWorkflow(''), [projectId]);
  const { list, loading, error, refresh } = useRuns(projectId, workflow ? { workflow } : {});
  // Nothing kept from last time: the list settles in once GitHub answers.
  const late = useLateArrival(projectId ?? '', list !== undefined);
  // The workflows: the Workflows page, and the Runs page's filter.
  const flows = useWorkflows(projectId);
  const runs = useMemo(() => (list?.kind === 'github' ? sortRuns(list.runs) : []), [list]);
  const live = runs.some(isLive);

  // The clock sits in Ticking (in both returns, so it's the same one): only the time text is drawn again each second.
  if (!projects.length || !here || !projectId)
    return (
      <Ticking live={live}>
        <NoProjects icon="pulse" detail={tr('ci.actions.noProjects')} />
      </Ticking>
    );

  const repo = list && list.kind !== 'none' ? list.repo : undefined;
  const known = flows.data?.workflows ?? [];
  const named = (path: string): string => known.find((f) => f.path === path)?.name ?? fileName(path);
  return (
    <Ticking live={live}>
      <div className={t.view}>
        <div className={t.bar}>
          <div className={t.barGroup}>
            <PickMenu<string>
              label={tr('issues.view.project')}
              choices={projects.map((p) => ({ value: p.id, label: p.name, mark: <ProjectIcon id={p.id} name={p.name} size={16} /> }))}
              chosen={[here.id]}
              onPick={(id) => openList(id, page === 'workflows' ? 'workflows' : undefined)}
            >
              <button type="button" className={t.projectSwitch} aria-label={tr('issues.view.projectIs', { name: here.name })}>
                <ProjectIcon id={here.id} name={here.name} size={18} />
                <span className={t.projectName}>{here.name}</span>
                <Icon name="chevronDown" size={11} />
              </button>
            </PickMenu>
            <Segmented<Page> label={tr('issues.view.show')} value={page} onChange={(p) => openList(projectId, p === 'workflows' ? 'workflows' : undefined)} options={PAGES(tr)} />
            {page === 'runs' && known.length + (workflow ? 1 : 0) > 1 ? (
              <PickMenu<string>
                label={tr('ci.actions.workflow')}
                choices={[{ value: '', label: tr('ci.actions.allWorkflows') }, ...known.filter((f) => f.id).map((f) => ({ value: f.path, label: f.name, hint: fileName(f.path) }))]}
                chosen={[workflow]}
                onPick={setWorkflow}
              >
                <button type="button" className={s.filter} aria-label={tr('ci.actions.workflow')}>
                  <Icon name="graph" size={12} />
                  {workflow ? named(workflow) : tr('ci.actions.allWorkflows')}
                  <Icon name="chevronDown" size={10} />
                </button>
              </PickMenu>
            ) : null}
          </div>
          <div className={cx(t.barGroup, t.barActions)}>
            {live ? (
              <span className={s.liveTag}>
                <span className={s.liveDot} aria-hidden="true" />
                {tr('ci.actions.live')}
              </span>
            ) : null}
            <IconButton icon="refresh" label={loading || flows.loading ? tr('issues.view.asking') : tr('issues.view.askAgain')} className={cx((loading || flows.loading) && s.spinning)} onClick={() => (refresh(), flows.refresh())} disabled={!repo} />
            {repo ? (
              <Tip label={`${repo.url}/actions`}>
                <Button size="small" icon="external" onClick={() => openOnGitHub(`${repo.url}/actions`)}>
                  GitHub
                </Button>
              </Tip>
            ) : null}
          </div>
        </div>
        <div className={t.body}>
          {error && !list ? (
            <Empty icon="alert" title={tr('ci.actions.cantRead')} detail={error} action={<Button onClick={refresh}>{tr('issues.view.tryAgain')}</Button>} />
          ) : !list ? (
            <Empty icon="pulse" title={tr('issues.view.asking')} detail={tr('ci.actions.forRuns', { name: here.name })} />
          ) : list.kind === 'none' ? (
            <Empty icon="pulse" title={tr('issues.view.notOnGitHub')} detail={tr('ci.actions.notOnGitHubDetail')} />
          ) : list.kind === 'no_gh' ? (
            <Empty
              icon="pulse"
              title={tr('issues.view.connect')}
              detail={tr('ci.actions.connectDetail', { repo: repoSlug(list.repo) })}
              action={
                <EmptyActions>
                  <Button variant="primary" onClick={() => setConnect(true)}>
                    {tr('issues.view.connectButton')}
                  </Button>
                </EmptyActions>
              }
            />
          ) : list.kind === 'error' ? (
            <Empty icon="alert" title={tr('ci.actions.cantRead')} detail={list.message} action={<Button onClick={refresh}>{tr('issues.view.tryAgain')}</Button>} />
          ) : page === 'workflows' ? (
            <Workflows projectId={projectId} flows={flows} runs={runs} />
          ) : !runs.length ? (
            <Empty icon="pulse" title={workflow ? tr('ci.actions.noRunsOf') : tr('ci.actions.noRuns')} detail={workflow ? tr('ci.actions.pickAnother') : tr('ci.actions.nothingRan', { repo: repoSlug(list.repo) })} />
          ) : (
            <div className={cx(s.list, late && arr.arrive)} role="table" aria-label={tr('ci.actions.listLabel', { name: here.name })}>
              {runs.map((run) => (
                <RunRow key={run.id} projectId={projectId} run={run} />
              ))}
            </div>
          )}
        </div>
        {list?.kind === 'github' && runs.length && page === 'runs' ? (
          <div className={t.foot}>
            {runs.filter(isLive).length ? tr('ci.actions.footRunning', { n: runs.filter(isLive).length }) : ''}
            {tr('ci.actions.footRuns', { count: `${runs.length}${list.more ? '+' : ''}`, repo: repoSlug(list.repo) })}<NowText>{(now) => ago(list.fetchedAt, now)}</NowText>
            {live ? tr('ci.actions.watching') : ''}
          </div>
        ) : null}
        {connect ? (
          <ConnectGitHub
            onClose={() => setConnect(false)}
            onCheck={async () => {
              const got = await api.ci.runs(projectId, { force: true }).catch(() => undefined);
              refresh();
              return got?.kind === 'github';
            }}
          />
        ) : null}
      </div>
    </Ticking>
  );
}

/** Each workflow as a card: its name and file, how its last run went, and its graph (or its YAML). */
function Workflows({ projectId, flows, runs }: { projectId: string; flows: ReturnType<typeof useWorkflows>; runs: readonly GhRun[] }) {
  const late = useLateArrival(projectId, flows.data !== undefined);
  const tr = useT();
  if (flows.error && !flows.data) return <Empty icon="alert" title={tr('ci.actions.cantReadFlows')} detail={flows.error} action={<Button onClick={flows.refresh}>{tr('issues.view.tryAgain')}</Button>} />;
  if (!flows.data) return <Empty icon="graph" title={tr('ci.actions.readingFlows')} detail={tr('ci.actions.readingFlowsDetail')} />;
  const list = flows.data.workflows;
  if (!list.length) return <Empty icon="graph" title={tr('ci.actions.noFlows')} detail={tr('ci.actions.noFlowsDetail')} />;
  return (
    <div className={cx(s.flows, late && arr.arrive)}>
      {list.map((f) => (
        <WorkflowCard key={f.path} projectId={projectId} flow={f} last={runs.find((r) => r.path === f.path)} />
      ))}
    </div>
  );
}

function WorkflowCard({ projectId, flow, last }: { projectId: string; flow: GhWorkflow; last?: GhRun }) {
  const { openRun, openOnGitHub } = useCiActions();
  const tr = useT();
  const [yamlShown, setYamlShown] = useState(false);
  const off = flow.state !== 'active' && flow.state !== 'not_pushed';
  return (
    <section className={s.flow} aria-label={flow.name}>
      <header className={s.flowHead}>
        <span className={s.flowName}>{flow.name}</span>
        <span className={s.flowPath}>{flow.path}</span>
        {flow.state === 'not_pushed' ? <span className={s.badge}>{tr('ci.actions.notPushed')}</span> : off ? <span className={s.badge}>{tr('ci.actions.turnedOff')}</span> : null}
        <span className={t.grow} />
        {last ? (
          <Tip label={tr('ci.actions.lastRun', { status: localStatusWords(last), when: ago(last.createdAt) })}>
            <button type="button" className={s.flowLast} onClick={() => openRun(projectId, last.id)}>
              <RunMark tone={runTone(last)} size={14} />
              <span className={s.flowLastTitle}>{last.title}</span>
              <span className={s.when}>{ago(last.createdAt)}</span>
            </button>
          </Tip>
        ) : null}
        <Segmented<'graph' | 'yaml'>
          label={tr('ci.actions.showAs')}
          iconOnly
          value={yamlShown ? 'yaml' : 'graph'}
          onChange={(v) => setYamlShown(v === 'yaml')}
          options={[
            { value: 'graph', label: tr('ci.actions.graph'), icon: 'graph' },
            { value: 'yaml', label: 'YAML', icon: 'file' },
          ]}
        />
        {flow.url ? <IconButton icon="external" label={tr('issues.parts.openOnGitHub')} onClick={() => openOnGitHub(flow.url)} /> : null}
      </header>
      {flow.file === undefined ? (
        <p className={s.graphNote}>{tr('ci.actions.noFile')}</p>
      ) : yamlShown ? (
        <div className={s.yaml}>
          <CodeLines text={flow.file} lang="yaml" />
        </div>
      ) : (
        <WorkflowGraph text={flow.file} path={flow.path} title={flow.name} />
      )}
    </section>
  );
}
