import type { ReactNode } from 'react';
import { labelTitle, labelsFor } from '@beluga/core/board/labels.js';
import { type Assignee, type Issue, type IssueStatus, ISSUE_STATUSES, PRIORITIES, type Priority, boardOf } from '@beluga/core/board/model.js';
import { Avatar } from '../components/ui.js';
import { Icon } from '../components/Icon.js';
import { openSheet } from '../lib/sheets.js';
import { PickMenu } from './PickMenu.js';
import { LabelMark, PriorityIcon, StatusIcon } from './marks.js';
import { assigneeChoices, assigneeKey, statusLabel, priorityLabel } from './tasks-model.js';
import { useBoard, usePeople, useSelf, useTaskActions } from './use-tasks.js';
import { useT } from '../i18n/index.js';

/**
 * Pickers for a task's properties: the same menus from a row, a card and a task's page. The
 * trigger is yours (an icon in a row, a full property on a page).
 */

export function StatusPicker({ issue, children, align }: { issue: Issue; children: ReactNode; align?: 'start' | 'end' }) {
  const { api, act } = useTaskActions();
  const t = useT();
  return (
    <PickMenu<IssueStatus>
      label={t('tasks.prop.status')}
      align={align}
      choices={ISSUE_STATUSES.map((s) => ({ value: s, label: statusLabel(s), mark: <StatusIcon status={s} /> }))}
      chosen={[issue.status]}
      onPick={(status) => void act(() => api.update(issue.id, { status }))}
    >
      {children}
    </PickMenu>
  );
}

export function PriorityPicker({ issue, children, align }: { issue: Issue; children: ReactNode; align?: 'start' | 'end' }) {
  const { api, act } = useTaskActions();
  const t = useT();
  return (
    <PickMenu<Priority>
      label={t('tasks.prop.priority')}
      align={align}
      choices={PRIORITIES.map((p) => ({ value: p, label: priorityLabel(p), mark: <PriorityIcon priority={p} /> }))}
      chosen={[issue.priority]}
      onPick={(priority) => void act(() => api.update(issue.id, { priority }))}
    >
      {children}
    </PickMenu>
  );
}

/** Who a task is for: you, a teammate on its project (BLG-299), or no one. */
export function AssigneePicker({ projectId, value, onChange, children, align }: { projectId: string; value: Assignee | undefined; onChange: (a: Assignee | null) => void; children: ReactNode; align?: 'start' | 'end' }) {
  const self = useSelf();
  const people = usePeople(projectId);
  const choices = assigneeChoices(self, people, value);
  const t = useT();
  return (
    <PickMenu<string>
      label={t('tasks.prop.assignee')}
      align={align}
      search={choices.length > 6}
      placeholder={t('tasks.pick.assignTo')}
      choices={[
        { value: '', label: t('tasks.newTask.noOne'), mark: <Icon name="person" size={13} /> },
        ...choices.map((c) => ({
          value: c.key,
          label: c.label,
          section: c.assignee.id === self.id ? undefined : t('tasks.sync.team'),
          mark: <Avatar name={c.assignee.name} id={c.assignee.id} size={16} />,
        })),
      ]}
      chosen={[assigneeKey(value)]}
      onPick={(key) => onChange(key ? (choices.find((c) => c.key === key)?.assignee ?? null) : null)}
    >
      {children}
    </PickMenu>
  );
}

/**
 * Labels: tick the ones a task has, from the project's set (each with its icon and color). Typing
 * only finds one; a new label is made on purpose, with New Label…. Labels a task has that aren't in
 * the set (from before, from Linear) show under their own heading so they can be taken off.
 */
export function LabelsPicker({ issue, children, align }: { issue: Issue; children: ReactNode; align?: 'start' | 'end' }) {
  const board = useBoard();
  const { api, act } = useTaskActions();
  const set = labelsFor(board, boardOf(issue));
  const others = issue.labels.filter((l) => !set.some((d) => d.name === l));
  const save = (labels: readonly string[]): void => void act(() => api.update(issue.id, { labels: [...labels] }));
  const t = useT();
  return (
    <PickMenu<string>
      label={t('tasks.prop.labels')}
      align={align}
      multiple
      search={set.length + others.length > 8}
      choices={[
        ...set.map((d) => ({ value: d.name, label: labelTitle(d.name), mark: <LabelMark def={d} label={d.name} />, ...(d.hint ? { hint: d.hint } : {}) })),
        ...others.map((l) => ({ value: l, label: labelTitle(l), section: t('tasks.pick.notInSet'), mark: <LabelMark def={undefined} label={l} /> })),
      ]}
      chosen={issue.labels}
      onPick={(l) => save(issue.labels.includes(l) ? issue.labels.filter((x) => x !== l) : [...issue.labels, l])}
      actions={[{ label: t('tasks.pick.newLabel'), icon: 'plus', onSelect: () => openSheet({ kind: 'new_label', projectId: boardOf(issue), issueId: issue.id }) }]}
    >
      {children}
    </PickMenu>
  );
}

/** Pick another task (a parent, a blocker, a related one), by key or words. */
export function TaskPicker({ label, candidates, onPick, children, align }: { label: string; candidates: readonly Issue[]; onPick: (issue: Issue) => void; children: ReactNode; align?: 'start' | 'end' }) {
  const t = useT();
  return (
    <PickMenu<string>
      label={label}
      align={align}
      search
      placeholder={t('tasks.pick.findTask')}
      choices={candidates.map((i) => ({ value: i.id, label: `${i.key} ${i.title}`, mark: <StatusIcon status={i.status} /> }))}
      chosen={[]}
      onPick={(id) => {
        const issue = candidates.find((i) => i.id === id);
        if (issue) onPick(issue);
      }}
    >
      {children}
    </PickMenu>
  );
}
