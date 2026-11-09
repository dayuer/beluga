import { useMemo } from 'react';
import { type Issue, STATUS_INFO, findIssue } from '@beluga/core/board/model.js';
import { readTaskKeys } from '@beluga/shared/task-refs.js';
import { Icon } from '../components/Icon.js';
import { Tip } from '../components/ui.js';
import { useApp } from '../lib/beluga.js';
import { TonePill } from '../plans/marks.js';
import { PriorityIcon, StatusIcon } from './marks.js';
import { useTaskActions } from './use-tasks.js';
import { useActions } from '../lib/actions.js';
import { planTitle } from '@beluga/core/plans/model.js';
import r from './task-ref.module.css';
import { statusLabel, priorityLabel } from './tasks-model.js';
import { t as tNow, useT } from '../i18n/index.js';

/**
 * Tasks Claude shows in an answer (src/shared/task-refs.ts): `task:BLG-12` as a chip in the
 * sentence, a `beluga-tasks` block as a list of cards. Each reads its task from the live board,
 * so a status that changes changes here too; a click opens the task. A key the board doesn't
 * have (deleted, or someone else's board) is a quiet "not found", never a broken card.
 */

const useIssue = (key: string): Issue | undefined => useApp((s) => findIssue(s.board, key));

const tipOf = (issue: Issue): string => tNow('tasks.ref.tip', { key: issue.key, status: statusLabel(issue.status), priority: priorityLabel(issue.priority) });

function Missing({ taskKey, block, label }: { taskKey: string; block?: boolean; label?: 'worktree' | 'plan' }) {
  const tr = useT();
  return (
    <Tip label={label ? tr(label === 'worktree' ? 'tasks.ref.noWorktree' : 'tasks.ref.noPlan', { key: taskKey }) : tr('tasks.ref.noTask', { key: taskKey })}>
      <span className={block ? r.missingRow : r.missing}>
        <span className={r.key}>{taskKey}</span>
        <span>{tr('tasks.ref.notFound')}</span>
      </span>
    </Tip>
  );
}

/** One task inside a sentence: a pill with its status ring, key and title (cut short), and an arrow to open it. */
export function TaskChip({ taskKey }: { taskKey: string }) {
  const issue = useIssue(taskKey);
  const { open } = useTaskActions();
  if (!issue) return <Missing taskKey={taskKey} />;
  return (
    <Tip label={tipOf(issue)}>
      <button type="button" className={r.chip} onClick={() => open(issue)} aria-label={`${issue.key}: ${issue.title}, ${statusLabel(issue.status)}`}>
        <StatusIcon status={issue.status} size={12} />
        <span className={r.key}>{issue.key}</span>
        <span className={r.chipTitle}>{issue.title}</span>
        <Icon name="arrowRight" size={10} className={r.chipGo} />
      </button>
    </Tip>
  );
}

/**
 * A bare key in the words ("BLG-72", not `task:BLG-72`): Claude wrote what it's about next to it,
 * so only the status ring and the key, with the title on hover. A key that's gone stays text.
 */
export function TaskKeyChip({ taskKey }: { taskKey: string }) {
  const issue = useIssue(taskKey);
  const { open } = useTaskActions();
  const tr = useT();
  if (!issue) return <>{taskKey}</>;
  return (
    <Tip label={tr('tasks.ref.keyTip', { title: issue.title, status: statusLabel(issue.status) })}>
      <button type="button" className={`${r.chip} ${r.keyChip}`} onClick={() => open(issue)} aria-label={`${issue.key}: ${issue.title}, ${statusLabel(issue.status)}`}>
        <StatusIcon status={issue.status} size={11} />
        <span className={r.key}>{issue.key}</span>
      </button>
    </Tip>
  );
}

/** A `beluga-tasks` block: one card per key, stacked. */
export function TaskCards({ code }: { code: string }) {
  const keys = useMemo(() => readTaskKeys(code), [code]);
  const tr = useT();
  if (!keys.length) return null;
  return (
    <div className={r.cards} role="list" aria-label={keys.length === 1 ? tr('plans.details.task') : tr('plans.canvas.nTasks', { n: keys.length })}>
      {keys.map((k) => (
        <TaskCardRow key={k} taskKey={k} />
      ))}
    </div>
  );
}

function TaskCardRow({ taskKey }: { taskKey: string }) {
  const issue = useIssue(taskKey);
  const { open } = useTaskActions();
  if (!issue) {
    return (
      <div role="listitem">
        <Missing taskKey={taskKey} block />
      </div>
    );
  }
  const status = STATUS_INFO[issue.status];
  return (
    <div role="listitem">
      <button type="button" className={r.card} onClick={() => open(issue)}>
        <StatusIcon status={issue.status} size={14} />
        <span className={r.key}>{issue.key}</span>
        <span className={r.cardTitle}>{issue.title}</span>
        <span className={r.cardEnd}>
          <TonePill tone={status.tone} live={issue.status === 'in_progress'}>
            {statusLabel(issue.status)}
          </TonePill>
          <PriorityIcon priority={issue.priority} size={14} labelled />
        </span>
      </button>
    </div>
  );
}

/** A worktree Claude started (Your Mac: `worktree:<id>`): a pill with its name; a click opens its conversation. */
export function WorktreeChip({ id }: { id: string }) {
  // Picks the store's own objects: a pick built fresh each time ({ w, project }) never settles, and React gives up (#185).
  const project = useApp((s) => s.projects.find((p) => p.workspaces.some((w) => w.id === id)));
  const w = project?.workspaces.find((x) => x.id === id);
  const actions = useActions();
  const tr = useT();
  if (!project || !w) return <Missing taskKey={id} label="worktree" />;
  return (
    <Tip label={tr('tasks.ref.worktreeTip', { project: project.name, name: w.name, archived: w.archived ? tr('tasks.ref.archived') : '' })}>
      <button type="button" className={r.chip} onClick={() => actions.run({ type: 'open_ws', id })} aria-label={tr('tasks.ref.worktreeAria', { name: w.name, project: project.name })}>
        <Icon name="branch" size={12} />
        <span className={r.key}>{project.name}</span>
        <span className={r.chipTitle}>{w.name}</span>
        <Icon name="arrowRight" size={10} className={r.chipGo} />
      </button>
    </Tip>
  );
}

/** A plan Claude started (Your Mac: `plan:<id>`): a pill with its name; a click opens its page. */
export function PlanChip({ id }: { id: string }) {
  const plan = useApp((s) => s.plans.plans.find((p) => p.id === id));
  const actions = useActions();
  const tr = useT();
  if (!plan) return <Missing taskKey={id} label="plan" />;
  return (
    <Tip label={tr('tasks.ref.planTip', { title: planTitle(plan) })}>
      <button type="button" className={r.chip} onClick={() => actions.run({ type: 'view', view: { kind: 'plan', id } })} aria-label={tr('tasks.ref.planAria', { title: planTitle(plan) })}>
        <Icon name="graph" size={12} />
        <span className={r.key}>{tr('plans.details.plan')}</span>
        <span className={r.chipTitle}>{planTitle(plan)}</span>
        <Icon name="arrowRight" size={10} className={r.chipGo} />
      </button>
    </Tip>
  );
}
