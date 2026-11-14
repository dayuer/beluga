import { IconButton } from '../../components/ui.js';
import { useApp } from '../../lib/beluga.js';
import { openSheet } from '../../lib/sheets.js';

/**
 * New Task as an icon in the sidebar's title row (fork; docs/fork.md, "侧边栏"), after Hide Sidebar, as
 * in the Mac-native design: the one main action of the sidebar. It opens the same sheet as Tasks' own
 * button (no project: the sheet asks). Without the board there are no tasks, so no icon. Its name is
 * "New Task…" (it opens a sheet), apart from Tasks' own "New Task" button that the specs click by name.
 */
export function NewTaskButton() {
  const board = useApp((st) => st.board.enabled);
  if (!board) return null;
  return <IconButton size="large" icon="pencil" label="New Task…" data-fork-new-task="" onClick={() => openSheet({ kind: 'new_task' })} />;
}
