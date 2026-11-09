import { useEffect, useState } from 'react';
import type { EnvChange } from '@beluga/workspaces/env.js';
import { EnvKeys } from '../../dialogs/native/ConfirmAlert.js';
import { Icon } from '../../components/Icon.js';
import { ActionsDropdown } from '../../components/SpecMenu.js';
import { Button, IconButton, Tip } from '../../components/ui.js';
import { useApi, useApp } from '../../lib/beluga.js';
import { openSheet } from '../../lib/sheets.js';
import { sameDeep } from '../../lib/stable.js';
import s from './env-asks.module.css';
import { useT } from '../../i18n/index.js';

const NONE: readonly EnvChange[] = [];

/**
 * A worktree changed a .env value the main folder doesn't have (BLG-369; brand-new keys went there
 * on their own): its keys, then Copy to Main Folder (every worktree's untouched copy follows), Save
 * in Beluga (every run gets them, the file stays), or behind ••• Keep in This Worktree Only.
 */
function EnvAsk({ wsId, changes, name }: { wsId: string; changes: readonly EnvChange[]; name?: string }) {
  const api = useApi();
  const t = useT();
  const [busy, setBusy] = useState(false);
  const files = changes.map((c) => c.file);
  const act = (run: () => Promise<unknown>): void => {
    setBusy(true);
    void run().finally(() => setBusy(false));
  };
  return (
    <div className={s.ask} role="status" aria-label={t('views.env.aria')}>
      <Icon name="lock" size={13} className={s.icon} />
      <span className={s.text}>
        {name ? <strong>{name} </strong> : null}
        {t('views.env.changed')} {files.length === 1 ? <code>{files[0]}</code> : t('views.env.files', { n: files.length })}
        {changes.length === 1 ? (
          <>
            {' '}
            <EnvKeys change={changes[0]!} />
          </>
        ) : null}
        <span className={s.detail}>{name ? '' : t('views.env.mainLacks')}</span>
      </span>
      <Tip label={t('views.env.copyTip')}>
        <Button size="small" disabled={busy} onClick={() => act(() => api.workspaces.applyEnvBack(wsId))}>
          {t('views.env.copy')}
        </Button>
      </Tip>
      <Tip label={t('views.env.saveTip')}>
        <Button size="small" variant="quiet" disabled={busy} onClick={() => act(() => api.workspaces.saveEnvInBeluga(wsId))}>
          {t('views.env.save')}
        </Button>
      </Tip>
      <ActionsDropdown items={[{ label: t('views.env.keep'), hint: t('views.env.keepHint'), onSelect: () => act(() => api.workspaces.keepEnvHere(wsId)) }]}>
        <IconButton icon="more" label={t('views.env.more')} disabled={busy} />
      </ActionsDropdown>
    </div>
  );
}

/** In a worktree's conversation, under its other strips. */
export function EnvStrip({ workspaceId }: { workspaceId: string }) {
  const changes = useApp((st) => st.envAsks[workspaceId] ?? NONE);
  const projectId = useApp((st) => st.projects.find((p) => p.workspaces.some((w) => w.id === workspaceId))?.id);
  const api = useApi();
  // Opening it looks again (an edit made outside Beluga since).
  useEffect(() => {
    if (projectId) void api.workspaces.checkEnv(projectId).catch(() => undefined);
  }, [workspaceId, projectId]);
  if (!changes.length) return null;
  return (
    <div className={s.strip}>
      <EnvAsk wsId={workspaceId} changes={changes} />
    </div>
  );
}

/** On a project's page: each of its worktrees that changed a .env. */
export function ProjectEnvAsks({ projectId }: { projectId: string }) {
  const api = useApi();
  const asks = useApp((st) => {
    const ws = st.projects.find((p) => p.id === projectId)?.workspaces ?? [];
    return ws.filter((w) => st.envAsks[w.id]?.length).map((w) => ({ id: w.id, name: w.name, changes: st.envAsks[w.id]! }));
  }, sameDeep);
  useEffect(() => {
    void api.workspaces.checkEnv(projectId).catch(() => undefined);
  }, [projectId]);
  if (!asks.length) return null;
  return (
    <div className={s.list}>
      {asks.map((a) => (
        <EnvAsk key={a.id} wsId={a.id} name={a.name} changes={a.changes} />
      ))}
    </div>
  );
}

/** The project page's Environment pill: how many it sets here, and the sheet to change them. */
export function EnvPill({ projectId, root }: { projectId: string; root: string }) {
  const own = useApp((st) => st.envKeys.projects[root]?.keys.length ?? 0);
  const off = useApp((st) => st.envKeys.projects[root]?.dotenv === false);
  const t = useT();
  return (
    <Tip label={off ? t('views.env.pillOffTip') : t('views.env.pillTip')}>
      <button type="button" className={s.pill} onClick={() => openSheet({ kind: 'project_env', projectId })}>
        <Icon name="lock" size={11} />
        {t('views.env.environment')}
        {own ? <strong>{own}</strong> : null}
      </button>
    </Tip>
  );
}
