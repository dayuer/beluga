import { continueOn } from '@beluga/machines/move.js';
import { MoveAsk } from '@beluga/machines/move-plan.js';
import type { Workspace } from '@beluga/workspaces/types.js';
import type { ActionItem } from '../components/SpecMenu.js';
import { toast, useBeluga } from '../lib/beluga.js';
import { useActions } from '../lib/actions.js';
import { openSheet } from '../lib/sheets.js';
import { type MoveTarget, useMoveTargets } from './move-targets.js';
import { onMachine } from './pane-model.js';
import { noteStarted } from './started.js';
import { placeMark } from './MachineMark.js';
import { t } from '../i18n/index.js';

/**
 * Continue On ▸ in a worktree's ••• (BLG-808): your other computers (This Mac from a computer's
 * page). Its branch and its conversation go there, its .env is asked about as for any new
 * worktree, and the old one is archived once the new one is there. Changes not committed are asked
 * about (Commit Them and Continue), never dropped; while its agent works, it waits for the turn.
 */
export function useContinueOn(ws: Workspace | undefined): ActionItem | undefined {
  const { home } = useBeluga();
  const actions = useActions();
  const where = useMoveTargets();
  if (!ws || where.none || ws.kind !== 'worktree' || !ws.branch || ws.archived) return undefined;
  const name = ws.name;

  const go = async (target: MoveTarget, opts: { readonly commit?: boolean; readonly wait?: boolean }): Promise<void> => {
    toast(home, t('machines.continueOn.continuing', { name, place: target.place.name }), 'info');
    try {
      const to = await where.clientFor(target);
      const made = await continueOn({
        from: where.fromClient,
        to,
        workspaceId: ws.id,
        fromPlace: where.from,
        toPlace: target.place,
        projectThere: (project) => where.projectOn(target, to, project, () => undefined),
        ...opts,
      });
      if (target.machine) noteStarted(target.machine.id, `ws:${made}`);
      toast(home, t('machines.continueOn.done', { name, place: target.place.name }), 'success');
      const page = { kind: 'workspace' as const, id: made, tab: 'chat' as const };
      actions.run({ type: 'view', view: target.machine ? onMachine(target.machine.id, page) : page });
    } catch (err) {
      if (err instanceof MoveAsk) {
        openSheet(
          err.kind === 'dirty'
            ? { kind: 'confirm', title: t('machines.continueOn.dirtyTitle', { place: target.place.name }), message: t('machines.continueOn.dirtyMessage', { name, items: err.items.join(', '), branch: ws.branch ?? '' }), confirm: t('machines.continueOn.dirtyConfirm'), run: () => void go(target, { ...opts, commit: true }) }
            : { kind: 'confirm', title: t('machines.continueOn.busyTitle', { place: target.place.name }), message: t('machines.continueOn.busyMessage'), confirm: t('machines.continueOn.busyConfirm'), run: () => void go(target, { ...opts, wait: true }) },
        );
        return;
      }
      toast(home, t('machines.continueOn.failed', { name, place: target.place.name, error: err instanceof Error ? err.message : String(err) }), 'error');
    }
  };

  return {
    label: t('machines.continueOn.label'),
    hint: t('machines.continueOn.hint'),
    separate: true,
    disabled: !where.targets.length,
    submenu: where.targets.map((t) => ({ label: t.place.name, mark: placeMark(t.machine), onSelect: () => void go(t, {}) })),
    onSelect: () => undefined,
  };
}
