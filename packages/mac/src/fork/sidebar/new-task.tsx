import { Icon } from '../../components/Icon.js';
import { useApp } from '../../lib/beluga.js';
import { openSheet } from '../../lib/sheets.js';
import s from './new-task.module.css';

/**
 * New Task under the sidebar's top entries (fork; docs/fork.md, "侧边栏"): the one main action of
 * the sidebar, as in the reviewed design. It opens the same sheet as Tasks' own button (no project:
 * the sheet asks). Without the board there are no tasks, so no button. Its name is "New Task…"
 * (it opens a sheet), apart from Tasks' own "New Task" button that the specs click by name.
 */
export function NewTaskButton() {
  const board = useApp((st) => st.board.enabled);
  if (!board) return null;
  return (
    <button type="button" className={s.newTask} data-fork-new-task="" aria-label="New Task…" onClick={() => openSheet({ kind: 'new_task' })}>
      <Icon name="plus" size={13} />
      New Task
    </button>
  );
}
