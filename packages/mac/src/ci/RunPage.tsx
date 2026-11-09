import { useT } from '../i18n/index.js';
import { useEffect, useRef, useState } from 'react';
import type { GhJob, GhRunFull } from '@beluga/core/ci/model.js';
import { durationWords, eventWords, fileName, isLive, jobsSummary, runDuration, runTone, shortSha, sortJobs, spanOf, statusWords } from '@beluga/core/ci/model.js';
import { repoSlug } from '@beluga/core/issues/model.js';
import type { GitHubRepo } from '@beluga/workspaces/github.js';
import { Icon } from '../components/Icon.js';
import { CodeLines } from '../components/markdown/CodeLines.js';
import { ActionsDropdown } from '../components/SpecMenu.js';
import { Button, Empty, EmptyActions, IconButton, Tip, cx } from '../components/ui.js';
import { useActions } from '../lib/actions.js';
import { useApp } from '../lib/beluga.js';
import { runWayBack } from '../tasks/use-tasks.js';
import { useSwipeBack } from '../tasks/use-swipe-back.js';
import { SwipeBackEdge } from '../tasks/SwipeBackEdge.js';
import { agoWords } from '../issues/issues-model.js';
import { RunMark, useRunMenu } from './parts.js';
import { useCiActions, useRun } from './use-ci.js';
import { NowText, Ticking } from './now.js';
import { WorkflowGraph } from './WorkflowGraph.js';
import t from '../tasks/tasks.module.css';
import s from './ci.module.css';
import arr from '../lib/arrive.module.css';
import { useLateArrival } from '../lib/last-seen.js';
import { shortcutKeys } from '../lib/shortcuts.js';

/**
 * One workflow run, to watch: its workflow drawn as a graph with each job coloured by how it's
 * going, then every job and its steps with their times (the failed and running ones open, and a
 * failed job's log a click away), asked for again every few seconds while it runs. Re-run the
 * failed jobs, cancel it, or open it on GitHub.
 */
export function RunPage({ projectId, runId }: { projectId: string; runId: number }) {
  const { data, error, loading, refresh } = useRun(projectId, runId);
  const tr = useT();
  const actions = useActions();
  const late = useLateArrival(`${projectId}#${runId}`, data !== undefined);
  if (!data) {
    if (error) {
      return (
        <Empty
          icon="alert"
          title={tr('ci.run.cantRead')}
          detail={error}
          action={
            <EmptyActions>
              <Button onClick={refresh}>{tr('issues.view.tryAgain')}</Button>
              <Button variant="quiet" onClick={() => actions.run({ type: 'view', view: runWayBack(projectId) })}>
                {tr('issues.page.back')}
              </Button>
            </EmptyActions>
          }
        />
      );
    }
    return <Empty icon="pulse" title={tr('issues.view.asking')} detail={tr('ci.run.forJobs')} />;
  }
  return <Page projectId={projectId} repo={data.repo} run={data.run} loading={loading} refresh={refresh} late={late} />;
}

function Page({ projectId, repo, run, loading, refresh, late }: { projectId: string; repo: GitHubRepo; run: GhRunFull; loading: boolean; refresh: () => void; late: boolean }) {
  const wrap = useRef<HTMLDivElement>(null);
  const tr = useT();
  const actions = useActions();
  const back = (): void => actions.run({ type: 'view', view: runWayBack(projectId) });
  const swipe = useSwipeBack(wrap, back);
  const project = useApp((st) => st.projects.find((p) => p.id === projectId));
  const a = useCiActions();
  const menu = useRunMenu(projectId);
  const live = isLive(run);
  const tone = runTone(run);
  const failed = !live && (tone === 'failed' || tone === 'cancelled');
  // The clock sits in Ticking: only the time text is drawn again each second.
  return (
    <Ticking live={live}>
      <div ref={wrap} className={cx(t.pageWrap, late && arr.arrive)}>
        <SwipeBackEdge progress={swipe} />
        <div className={t.page}>
          <div className={t.pageMain}>
            <nav className={t.crumbs} aria-label={tr('ci.run.where')}>
              <IconButton icon="back" label={tr('issues.page.back')} keys={shortcutKeys('page-back')} className={t.crumbBack} onClick={back} />
              <button type="button" className={t.crumb} onClick={() => a.openList(projectId)}>
                {tr('ci.run.actions')}
              </button>
              <Icon name="chevronRight" size={10} />
              <span className={t.crumbPlain}>{project?.name ?? repoSlug(repo)}</span>
              <span className={t.grow} />
              <span className={t.pageKey}>
                {run.workflow} #{run.number}
                {run.attempt > 1 ? tr('ci.run.attemptN', { n: run.attempt }) : ''}
              </span>
              <IconButton icon="refresh" label={loading ? tr('issues.view.asking') : tr('issues.view.askAgain')} className={cx(loading && s.spinning)} onClick={refresh} />
              <ActionsDropdown items={menu(run, { open: false, then: refresh })}>
                <IconButton icon="more" label={tr('issues.page.more')} />
              </ActionsDropdown>
            </nav>
            <header className={t.pageHead}>
              <h1 className={s.pageTitle}>{run.title}</h1>
              <div className={s.byline}>
                <span className={cx(s.statePill, s[`tone_${tone}`])}>
                  <RunMark tone={tone} size={14} />
                  {statusWords(run)}
                </span>
                <span>
                  <NowText>{(now) => durationWords(runDuration(run, now))}</NowText> · {jobsSummary(run.jobs)}
                </span>
                <span className={t.grow} />
                {failed ? (
                  <Button size="small" icon="refresh" onClick={() => void a.rerun(projectId, run.id, true).then((ok) => ok && refresh())}>
                    {tr('ci.parts.rerunFailed')}
                  </Button>
                ) : null}
                {live ? (
                  <Button size="small" icon="stop" onClick={() => a.cancel(projectId, run.id, run.title, refresh)}>
                    {tr('ci.use.cancelRun')}
                  </Button>
                ) : null}
                <Button size="small" variant="quiet" icon="external" onClick={() => a.openOnGitHub(run.url)}>
                  GitHub
                </Button>
              </div>
            </header>
            {run.file !== undefined && run.path ? (
              <section className={s.runGraph} aria-label={tr('ci.run.theWorkflow')}>
                <WorkflowGraph text={run.file} path={run.path} title={run.workflow} jobs={run.jobs} />
              </section>
            ) : null}
            <section className={s.jobs} aria-label={tr('ci.run.jobs')}>
              {run.jobs.length ? sortJobs(run.jobs).map((job) => <JobCard key={job.id} projectId={projectId} job={job} />) : <p className={s.graphNote}>{live ? tr('ci.run.waitingRunner') : tr('ci.run.noJobs')}</p>}
            </section>
          </div>
          <Properties repo={repo} run={run} />
        </div>
      </div>
    </Ticking>
  );
}

/** A job: how it went and how long, its steps (open while it runs or once it fails), and its log when it failed. */
function JobCard({ projectId, job }: { projectId: string; job: GhJob }) {
  const tone = runTone(job);
  const [open, setOpen] = useState(tone === 'failed' || tone === 'running');
  const a = useCiActions();
  const tr = useT();
  // A job that starts running, or fails, while you watch opens by itself.
  const was = useRef(tone);
  useEffect(() => {
    if (was.current !== tone && (tone === 'failed' || tone === 'running')) setOpen(true);
    was.current = tone;
  }, [tone]);
  return (
    <div className={cx(s.job, open && s.jobOpen)} data-job={job.name}>
      <button type="button" className={s.jobHead} aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={10} className={s.jobChevron} />
        <RunMark tone={tone} size={15} label={statusWords(job)} />
        <span className={s.jobName}>{job.name}</span>
        {job.runner ? <span className={s.jobRunner}>{job.runner}</span> : null}
        <span className={t.grow} />
        <NowText>
          {(now) => {
            const took = spanOf(job, now);
            return took !== undefined ? <span className={cx(s.took, isLive(job) && s.tookLive)}>{durationWords(took)}</span> : <span className={s.took}>{statusWords(job)}</span>;
          }}
        </NowText>
      </button>
      {open ? (
        <div className={s.jobBody}>
          {job.steps.length ? (
            <ol className={s.steps}>
              {job.steps.map((step) => {
                const st = runTone(step);
                return (
                  <li key={step.number} className={cx(s.step, s[`step_${st}`])}>
                    <RunMark tone={st} size={13} label={statusWords(step)} />
                    <span className={s.stepNo}>{step.number}</span>
                    <span className={s.stepName}>{step.name}</span>
                    <span className={s.took}>
                      <NowText>
                        {(now) => {
                          const span = spanOf(step, now);
                          return span !== undefined && st !== 'skipped' ? durationWords(span) : '';
                        }}
                      </NowText>
                    </span>
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className={s.graphNote}>{isLive(job) ? tr('ci.run.waitingRunnerShort') : tr('ci.run.noSteps')}</p>
          )}
          <div className={s.jobFoot}>
            {tone === 'failed' ? <JobLog projectId={projectId} jobId={job.id} /> : null}
            <span className={t.grow} />
            {job.url ? (
              <Button size="small" variant="quiet" icon="external" onClick={() => a.openOnGitHub(job.url)}>
                {tr('ci.run.fullLog')}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** The end of a failed job's log, asked for when you want it. */
function JobLog({ projectId, jobId }: { projectId: string; jobId: number }) {
  const a = useCiActions();
  const tr = useT();
  const [log, setLog] = useState<{ readonly text?: string; readonly error?: string; readonly loading?: boolean }>();
  if (!log) {
    return (
      <Button
        size="small"
        icon="terminal"
        onClick={() => {
          setLog({ loading: true });
          a.log(projectId, jobId).then(
            (text) => setLog({ text }),
            (err: unknown) => setLog({ error: err instanceof Error ? err.message : String(err) }),
          );
        }}
      >
        {tr('ci.run.showFailed')}
      </Button>
    );
  }
  if (log.loading) return <span className={s.graphNote}>{tr('ci.run.readingLog')}</span>;
  if (log.error) return <span className={s.graphNote}>{log.error}</span>;
  return (
    <div className={s.log}>
      <CodeLines text={log.text ?? ''} numbers={false} wrap />
    </div>
  );
}

function Properties({ repo, run }: { repo: GitHubRepo; run: GhRunFull }) {
  const a = useCiActions();
  const tr = useT();
  const commit = `${repo.url}/commit/${run.sha}`;
  return (
    <aside className={t.props} aria-label={tr('issues.page.properties')}>
      <Prop label={tr('ci.run.status')}>
        <span className={t.propStatic}>{statusWords(run)}</span>
      </Prop>
      <Prop label={tr('ci.actions.workflow')}>
        <span className={t.propStatic}>
          {run.workflow}
          {run.path ? <span className={s.propHint}> · {fileName(run.path)}</span> : null}
        </span>
      </Prop>
      <Prop label={tr('ci.run.startedBy')}>
        <span className={t.propStatic}>
          {eventWords(run.event)}
          {run.actor ? ` · ${run.actor}` : ''}
        </span>
      </Prop>
      {run.branch ? (
        <Prop label={tr('ci.run.branch')}>
          <span className={cx(t.propStatic, t.mono, t.ellipsis)}>{run.branch}</span>
        </Prop>
      ) : null}
      {run.prs.length ? (
        <Prop label={tr('ci.run.pr')}>
          <button type="button" className={t.propValue} onClick={() => a.openOnGitHub(`${repo.url}/pull/${run.prs[0]}`)}>
            <span className={t.mono}>#{run.prs[0]}</span>
          </button>
        </Prop>
      ) : null}
      {run.sha ? (
        <Prop label={tr('ci.run.commit')}>
          <Tip label={tr('ci.run.openCommit')}>
            <button type="button" className={t.propValue} onClick={() => a.openOnGitHub(commit)}>
              <span className={t.mono}>{shortSha(run.sha)}</span>
            </button>
          </Tip>
        </Prop>
      ) : null}
      <div className={t.propsRule} />
      <Prop label={tr('ci.run.started')} quiet>
        <span className={t.propStatic}>{agoWords(run.startedAt)}</span>
      </Prop>
      <Prop label={isLive(run) ? tr('ci.run.runningFor') : tr('ci.run.tookLabel')} quiet>
        <span className={t.propStatic}>
          <NowText>{(now) => durationWords(runDuration(run, now))}</NowText>
        </span>
      </Prop>
      {run.attempt > 1 ? (
        <Prop label={tr('ci.run.attempt')} quiet>
          <span className={t.propStatic}>{run.attempt}</span>
        </Prop>
      ) : null}
      <Prop label="GitHub" quiet>
        <button type="button" className={t.propValue} onClick={() => a.openOnGitHub(run.url)}>
          <span className={cx(t.mono, t.ellipsis)}>
            {repoSlug(repo)} #{run.number}
          </span>
        </button>
      </Prop>
    </aside>
  );
}

function Prop({ label, children, quiet }: { label: string; children: React.ReactNode; quiet?: boolean }) {
  return (
    <div className={cx(t.prop, quiet && t.propStaticRow)}>
      <span className={t.propLabel}>{label}</span>
      <div className={t.propControl}>{children}</div>
    </div>
  );
}
