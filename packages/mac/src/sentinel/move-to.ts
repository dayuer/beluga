import { isLive, type Sentinel } from '@beluga/core/sentinel/model.js';
import { MoveAsk } from '@beluga/machines/move-plan.js';
import { moveSentinel } from '@beluga/machines/move-sentinel.js';
import type { ActionItem } from '../components/SpecMenu.js';
import { toast, useApp, useBeluga } from '../lib/beluga.js';
import { useActions } from '../lib/actions.js';
import { openSheet } from '../lib/sheets.js';
import { type MoveTarget, useMoveTargets } from '../machines/move-targets.js';
import { onMachine } from '../machines/pane-model.js';
import { placeMark } from '../machines/MachineMark.js';
import { t } from '../i18n/index.js';

/**
 * Move To ▸ in a sentinel's ••• (BLG-807): your other computers (This Mac from a computer's page),
 * so an always-on one can watch for you. Its steps, runs, kept numbers and tiles go along; it lands
 * paused, its sources checked there, and is on there only if it was on and nothing it uses is
 * missing there (the toast says what waits for you). Pause and Move To while it runs.
 */
export function useSentinelMoveTo(item: Sentinel): ActionItem | undefined {
  const { home } = useBeluga();
  const actions = useActions();
  const where = useMoveTargets();
  const running = useApp((st) => st.sentinel.runs.some((r) => r.sentinelId === item.id && isLive(r.state)));
  if (where.none) return undefined;

  const go = async (target: MoveTarget, pause: boolean): Promise<void> => {
    toast(home, t('sentinel.move.moving', { name: item.name, to: target.place.name }), 'info');
    try {
      const to = await where.clientFor(target);
      const moved = await moveSentinel({
        from: where.fromClient,
        to,
        sentinelId: item.id,
        fromPlace: where.from,
        toPlace: target.place,
        projectThere: (project) => where.projectOn(target, to, project, () => undefined),
        pause,
      });
      const said = moved.notes.length ? moved.notes.join('. ') : moved.on ? t('sentinel.move.movedOn', { to: target.place.name }) : t('sentinel.move.movedPaused', { to: target.place.name });
      toast(home, said, moved.notes.length ? 'warn' : 'success');
      const page = { kind: 'sentinel_page' as const, id: moved.landing.id };
      actions.run({ type: 'view', view: target.machine ? onMachine(target.machine.id, page) : page });
      // What it lacks there is asked for: your variables follow it (Keep My Secrets in Sync, BLG-805), then its sources are tested again.
      const m = target.machine;
      if (moved.landing.missing.length && m && !m.secrets) {
        openSheet({
          kind: 'confirm',
          title: t('sentinel.move.sendVarsTitle', { machine: m.name }),
          message: t('sentinel.move.sendVarsMessage', { name: item.name, missing: moved.landing.missing.join(', '), machine: m.name }),
          confirm: t('sentinel.move.keepInSync'),
          run: () =>
            void (async () => {
              await home.call('machines.secrets', m.id, true);
              await to.call('sentinel.test', moved.landing.id);
              toast(home, t('sentinel.move.varsSent', { machine: m.name, name: item.name }), 'success');
            })().catch((e: unknown) => toast(home, e instanceof Error ? e.message : String(e), 'error')),
        });
      }
    } catch (err) {
      if (err instanceof MoveAsk) {
        openSheet({ kind: 'confirm', title: t('sentinel.move.pauseTitle', { to: target.place.name }), message: t('sentinel.move.pauseMessage'), confirm: t('sentinel.move.pauseAndMove'), run: () => void go(target, true) });
        return;
      }
      toast(home, t('sentinel.move.couldnt', { name: item.name, to: target.place.name, error: err instanceof Error ? err.message : String(err) }), 'error');
    }
  };

  return {
    label: running ? t('sentinel.move.pauseAndMoveTo') : t('sentinel.move.moveTo'),
    hint: running ? t('sentinel.move.runEndsFirst') : t('sentinel.move.goesWithIt'),
    separate: true,
    disabled: !where.targets.length,
    submenu: where.targets.map((x) => ({ label: x.place.name, mark: placeMark(x.machine), onSelect: () => void go(x, running) })),
    onSelect: () => undefined,
  };
}
