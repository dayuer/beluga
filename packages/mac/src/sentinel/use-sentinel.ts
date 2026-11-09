import { useMemo } from 'react';
import { CLAUDE_CHANGED, type RunSummary, type Sentinel, type SentinelDraft, type SentinelPatch, type SentinelState } from '@beluga/core/sentinel/model.js';
import type { Args } from '@beluga/ipc/api.js';
import type { View } from '@beluga/core/store.js';
import type { ActionItem } from '../components/SpecMenu.js';
import { useActions } from '../lib/actions.js';
import { toast, useApi, useApp, useBeluga } from '../lib/beluga.js';
import { copyText } from '../lib/copy.js';
import { openSheet } from '../lib/sheets.js';
import { type ChatPlace, chatPlaceOf, runsFolderOf } from './sentinel-model.js';
import { t } from '../i18n/index.js';
import { openFolderThere } from '../lib/remote-open.js';

/** What Sentinel's screens share: the slice, and acting on sentinels with errors as toasts. */

export const useSentinelState = (): SentinelState => useApp((s) => s.sentinel);

const message = (err: unknown): string => (err instanceof Error ? err.message.replace(/^Error: /, '') : String(err));

export function useSentinelActions() {
  const api = useApi();
  const { client } = useBeluga();
  const actions = useActions();
  return useMemo(() => {
    const act = async <T,>(run: () => Promise<T>, done?: string): Promise<T | undefined> => {
      try {
        const result = await run();
        if (done) toast(client, done, 'success');
        return result;
      } catch (err) {
        toast(client, message(err), 'error');
        return undefined;
      }
    };
    const go = (view: View): void => actions.run({ type: 'view', view });
    const openChat = (place: ChatPlace | undefined): void => {
      if (!place) return;
      if (place.kind === 'workspace') actions.run({ type: 'open_ws', id: place.id, tab: 'chat' });
      else go({ kind: 'assistant', ...(place.chat ? { chat: place.chat } : {}) });
    };
    const self = {
      api: api.sentinel,
      act,
      /** The model's types are readonly; the API's (from zod) aren't: the same shape. */
      create: (draft: SentinelDraft): Promise<Sentinel> => api.sentinel.create(draft as Args<'sentinel.create'>[0]),
      update: (id: string, patch: SentinelPatch): Promise<Sentinel> => api.sentinel.update(id, patch as Args<'sentinel.update'>[1]),
      openList: (projectId?: string): void => go({ kind: 'sentinel', ...(projectId ? { projectId } : {}) }),
      open: (id: string): void => go({ kind: 'sentinel_page', id }),
      openRun: (runId: string): void => go({ kind: 'sentinel_run', runId }),
      openChannel: (channel: string | undefined): void => openChat(chatPlaceOf(channel)),
      runNow: (s: Pick<Sentinel, 'id' | 'name'>): Promise<RunSummary | undefined> => act(() => api.sentinel.run(s.id), t('sentinel.use.running', { name: s.name })),
      setPaused: (s: Pick<Sentinel, 'id' | 'name'>, paused: boolean): Promise<Sentinel | undefined> => act(() => api.sentinel.pause(s.id, paused), paused ? t('sentinel.use.paused', { name: s.name }) : t('sentinel.use.on', { name: s.name })),
      duplicate: async (s: Pick<Sentinel, 'id' | 'name'>): Promise<void> => {
        const copy = await act(() => api.sentinel.duplicate(s.id), t('sentinel.use.copied', { name: s.name }));
        if (copy) go({ kind: 'sentinel_page', id: copy.id });
      },
      remove: (s: Pick<Sentinel, 'id' | 'name'>, after?: () => void): void =>
        openSheet({
          kind: 'confirm',
          title: t('sentinel.use.deleteTitle', { name: s.name }),
          message: t('sentinel.use.deleteMessage'),
          confirm: t('sentinel.use.deleteConfirm'),
          destructive: true,
          run: () => void act(() => api.sentinel.remove(s.id), t('sentinel.use.deleted', { name: s.name })).then(() => after?.()),
        }),
      /** Delete a run's chat, or the whole run (BLG-577), after asking. `after`: where to go once the run is gone. */
      deleteRun: (run: Pick<RunSummary, 'id' | 'headline'>, what: 'chat' | 'run', after?: () => void): void =>
        openSheet({
          kind: 'confirm',
          title: what === 'chat' ? t('sentinel.use.deleteChatTitle') : t('sentinel.use.deleteRunTitle'),
          message: what === 'chat' ? t('sentinel.use.deleteChatMessage') : t('sentinel.use.deleteRunMessage'),
          confirm: what === 'chat' ? t('sentinel.use.deleteChat') : t('sentinel.use.deleteRun'),
          destructive: true,
          run: () => void act(async () => (await api.sentinel.runDelete(run.id, what), true), what === 'chat' ? t('sentinel.use.deletedChat') : t('sentinel.use.deletedRun')).then((done) => done && what === 'run' && after?.()),
        }),
      copyJson: (s: Sentinel): void => void copyText(JSON.stringify(s, null, 2)).then(() => toast(client, t('sentinel.use.copiedJson', { name: s.name }), 'success')),
      // A sentinel on a computer: its runs folder over Remote-SSH, else its path copied; never opened over there (BLG-852).
      openFolder: (path: string): void => void act(() => openFolderThere(client, path)),
    };
    return self;
  }, [api, client, actions]);
}

export type SentinelActions = ReturnType<typeof useSentinelActions>;

/** The runs folder, when the runs say where it is (memory-only runs don't). */
export const useRunsFolder = (): string | undefined => useApp((s) => runsFolderOf(s.sentinel.runs));

/** A sentinel's menu (right-click and ⋯ on its row): Run Now, Pause or Turn On, Open Last Run, Duplicate, Delete…. */
export function sentinelMenu(s: Sentinel, last: RunSummary | undefined, a: SentinelActions): ActionItem[] {
  return [
    { label: t('sentinel.menu.runNow'), icon: 'play', hint: s.paused ? t('sentinel.menu.runNowPaused') : undefined, onSelect: () => void a.runNow(s) },
    s.paused
      ? { label: s.pausedWhy && s.pausedWhy !== CLAUDE_CHANGED ? t('sentinel.menu.resume') : t('sentinel.menu.turnOn'), icon: 'play', hint: s.trigger.kind === 'schedule' ? t('sentinel.menu.turnOnHint') : undefined, onSelect: () => void a.setPaused(s, false) }
      : { label: t('sentinel.menu.pause'), icon: 'pause', hint: t('sentinel.menu.pauseHint'), onSelect: () => void a.setPaused(s, true) },
    { label: t('sentinel.menu.openLastRun'), icon: 'arrowRight', disabled: !last, separate: true, onSelect: () => last && a.openRun(last.id) },
    { label: t('sentinel.menu.duplicate'), icon: 'copy', onSelect: () => void a.duplicate(s) },
    { label: t('sentinel.menu.delete'), danger: true, separate: true, onSelect: () => a.remove(s) },
  ];
}
