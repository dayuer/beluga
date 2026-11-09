import { useState } from 'react';
import type { AppState } from '@beluga/core/store.js';
import { formatBytes } from '@beluga/shared/format.js';
import { Alert } from '../../components/Alert.js';
import { Icon } from '../../components/Icon.js';
import { ProjectIcon } from '../../components/ProjectIcon.js';
import { Button } from '../../components/ui.js';
import { toast, useApi, useBeluga } from '../../lib/beluga.js';
import { type Cleanup, REASON } from './usage-model.js';
import s from './usage.module.css';
import { t as tNow, useT } from '../../i18n/index.js';

/** How many suggestions the card lists before "and N more". */
const SHOWN = 4;

const nameOf = (c: Cleanup): string => (c.ws ? c.ws.name : tNow('views.cleanup.agentWorktrees', { n: c.agents?.clean ?? 0 }));
const sizeOf = (c: Cleanup): string => (c.disk ? formatBytes(c.disk) : '–');

/** Put the chosen folders away, one after the other: worktrees are archived, sub-agent leftovers removed. */
function useCleanUp(onDone: () => void): { busy: boolean; run: (items: readonly Cleanup[]) => Promise<void> } {
  const api = useApi();
  const { client } = useBeluga();
  const [busy, setBusy] = useState(false);
  const run = async (items: readonly Cleanup[]): Promise<void> => {
    setBusy(true);
    try {
      for (const c of items) {
        if (c.ws) await api.workspaces.archive(c.ws.id);
        else await api.workspaces.cleanAgentWorktrees(c.project.id);
      }
    } catch (err) {
      toast(client, tNow('views.cleanup.failed', { error: err instanceof Error ? err.message : String(err) }), 'error');
    } finally {
      setBusy(false);
      onDone();
    }
  };
  return { busy, run };
}

/** Asks first, listing every folder, why it's safe and what it frees. Ones with env changes wait. */
function CleanupAlert({ items, state, onConfirm, onCancel }: { items: readonly Cleanup[]; state: AppState; onConfirm: (go: readonly Cleanup[]) => void; onCancel: () => void }) {
  const t = useT();
  const envOf = (c: Cleanup): boolean => Boolean(c.ws && state.envChanges[c.ws.id]?.length);
  const go = items.filter((c) => !envOf(c));
  const frees = go.reduce((n, c) => n + c.disk, 0);
  const one = items.length === 1 ? items[0] : undefined;
  return (
    <Alert
      icon="archive"
      tone="info"
      title={one ? (one.ws ? t('views.cleanup.archiveOne', { name: one.ws.name }) : t('views.cleanup.removeOne', { name: nameOf(one) })) : t('views.cleanup.cleanN', { n: items.length })}
      message={
        <>
          <p>
            {frees ? <>{t('views.cleanup.frees')}<strong>{formatBytes(frees)}</strong>{t('views.cleanup.freesEnd')}</> : null}
            {items.some((c) => c.ws) ? t('views.cleanup.keptRestore') : t('views.cleanup.keptBranches')}
          </p>
          <p>{t('views.cleanup.untouched')}</p>
        </>
      }
      table={{
        columns: [t('views.info.folder'), t('views.cleanup.why'), t('views.overview.sortSize')],
        rows: items.map((c) => [
          <span key="n" className={s.alertName}>
            {c.project.root ? <ProjectIcon id={c.project.id} name={c.project.name} size={14} /> : null}
            {nameOf(c)}
          </span>,
          envOf(c) ? <span key="w" className={s.alertWarn}>{t('views.cleanup.envWarn')}</span> : REASON[c.reason],
          <span key="z" className={s.num}>{sizeOf(c)}</span>,
        ]),
      }}
      confirm={{ label: one ? (one.ws ? t('views.cleanup.archive') : t('views.info.remove')) : t('views.cleanup.cleanUp'), disabled: !go.length, onClick: () => onConfirm(go) }}
      onCancel={onCancel}
    />
  );
}

/**
 * "Free up space": worktrees that are merged, have nothing new, or sat idle, and folders
 * sub-agents left behind, with what each frees; one click cleans them all up.
 */
export function CleanupCard({ items, state, onDone }: { items: readonly Cleanup[]; state: AppState; onDone: () => void }) {
  const t = useT();
  const api = useApi();
  const [asking, setAsking] = useState<readonly Cleanup[] | undefined>(undefined);
  const { busy, run } = useCleanUp(onDone);
  if (!items.length) return null;
  const total = items.reduce((n, c) => n + c.disk, 0);
  const folders = items.reduce((n, c) => n + (c.ws ? 1 : (c.agents?.clean ?? 0)), 0);
  const ask = (list: readonly Cleanup[]): void => {
    // Env files changed in a worktree would be lost: look first, so the alert can hold those back.
    for (const c of list) if (c.ws) void api.workspaces.prepareRemoval(c.ws.id);
    setAsking(list);
  };
  return (
    <section className={s.cleanup} aria-label={t('views.cleanup.aria')}>
      <div className={s.cleanupHead}>
        <span className={s.cleanupIcon} aria-hidden="true">
          <Icon name="archive" size={18} />
        </span>
        <div className={s.cleanupText}>
          <h2 className={s.cleanupTitle}>{total ? t('views.cleanup.freeUp', { size: formatBytes(total) }) : t('views.cleanup.tidy')}</h2>
          <p className={s.cleanupDetail}>
            {t('views.cleanup.detail', { n: folders })}
          </p>
        </div>
        <Button variant="primary" icon="archive" disabled={busy} onClick={() => ask(items)}>
          {busy ? t('views.cleanup.cleaning') : t('views.cleanup.cleanUpEllipsis')}
        </Button>
      </div>
      <ul className={s.cleanupList}>
        {items.slice(0, SHOWN).map((c) => (
          <li key={c.key} className={s.cleanupItem}>
            {c.project.root ? <ProjectIcon id={c.project.id} name={c.project.name} size={16} /> : <Icon name="chat" size={14} />}
            <span className={s.cleanupName}>
              {nameOf(c)}
              <span className={s.cleanupProject}>{c.project.root ? c.project.name : t('views.overview.chats')}</span>
            </span>
            <span className={s.reason}>{REASON[c.reason]}</span>
            <span className={s.cleanupSize}>{sizeOf(c)}</span>
            <Button size="small" variant="quiet" disabled={busy} onClick={() => ask([c])} aria-label={`${c.ws ? t('views.cleanup.archive') : t('views.info.remove')} ${nameOf(c)}`}>
              {c.ws ? t('views.cleanup.archive') : t('views.info.remove')}
            </Button>
          </li>
        ))}
        {items.length > SHOWN ? <li className={s.cleanupMore}>{t('views.cleanup.andMore', { n: items.length - SHOWN })}</li> : null}
      </ul>
      {asking ? (
        <CleanupAlert
          items={asking}
          state={state}
          onCancel={() => setAsking(undefined)}
          onConfirm={(go) => {
            setAsking(undefined);
            void run(go);
          }}
        />
      ) : null}
    </section>
  );
}
