import { useEffect, useState } from 'react';
import type { StudioStatus } from '@beluga/studio/service.js';
import { Alert } from '../components/Alert.js';
import { Field, FormSheet, TextInput, formStyles as f } from '../components/FormSheet.js';
import { Button } from '../components/ui.js';
import { Group, Row, Switch } from '../dialogs/settings-controls.js';
import { type Key, useT } from '../i18n/index.js';
import { useApi } from '../lib/beluga.js';
import { closeStudioDialog, openStudioDialog, setStudioLinked, useStudioDialog, useStudioLinked } from './studio-dialog.js';

/**
 * Connect this Mac to a Synon Studio (docs/studio-daemon.md §8): the binding code from the studio's
 * admin page, the address when it isn't this computer's hub, then the link's state — online, trying
 * again in n seconds, or revoked and needing a new code — with "Share this project" and Disconnect.
 * While it is open it asks the daemon every two seconds.
 */
export function StudioConnectDialog() {
  const api = useApi();
  const state = useStudioDialog();
  const opened = state !== undefined;
  // The menu says Connect or Synon Studio… from the last status: one call when the window starts,
  // another each time the dialog opens (it is mounted once, in App.tsx).
  useEffect(() => {
    let alive = true;
    void api.studio
      .status()
      .then((status) => {
        if (alive) setStudioLinked(status.linked);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [api, opened]);
  if (!state) return null;
  return <StudioBody projectId={state.projectId} />;
}

const ERROR_KEYS: Readonly<Record<string, Key>> = {
  'bad-code': 'studio.error.badCode',
  'expired-code': 'studio.error.expiredCode',
  'bad-hub': 'studio.error.badHub',
  unreachable: 'studio.error.unreachable',
  'clock-skew': 'studio.error.clockSkew',
  'key-taken': 'studio.error.keyTaken',
  'already-linked': 'studio.error.alreadyLinked',
  'cannot-save': 'studio.error.cannotSave',
  'demo-mode': 'studio.error.demoMode',
};

const STATE_KEYS: Readonly<Record<string, Key>> = {
  unlinked: 'studio.state.unlinked',
  connecting: 'studio.state.connecting',
  online: 'studio.state.online',
  offline: 'studio.state.offline',
  revoked: 'studio.state.revoked',
  outdated: 'studio.state.outdated',
  'clock-skew': 'studio.state.clockSkew',
  'wrong-studio': 'studio.state.wrongStudio',
  stopped: 'studio.state.stopped',
};

function StudioBody({ projectId }: { projectId?: string }) {
  const t = useT();
  const api = useApi();
  const [status, setStatus] = useState<StudioStatus>();
  const [code, setCode] = useState('');
  const [hub, setHub] = useState('');
  const [showHub, setShowHub] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [trouble, setTrouble] = useState<string>();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let alive = true;
    const refresh = async (): Promise<void> => {
      try {
        const next = await api.studio.status();
        if (!alive) return;
        setStatus(next);
        setStudioLinked(next.linked);
      } catch {
        // The daemon may be restarting; the next poll says.
      }
    };
    void refresh();
    const timer = setInterval(() => {
      setNow(Date.now());
      void refresh();
    }, 2_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [api]);

  const reason = (error: string): string => {
    const key = ERROR_KEYS[error];
    return key ? t(key) : t('studio.error.other', { error });
  };

  const linked = status?.linked === true;
  const shared = projectId ? status?.projects.find((p) => p.projectId === projectId) : undefined;
  const retryIn = status?.retryAt !== undefined ? Math.max(0, Math.round((status.retryAt - now) / 1000)) : undefined;

  if (!linked) {
    const connect = async (): Promise<string | undefined> => {
      const result = await api.studio.link(code.trim(), hub.trim() || undefined, undefined);
      if (!result.ok) return reason(result.error);
      setStatus(result.status);
      setStudioLinked(result.status.linked);
      setCode('');
      return undefined;
    };
    return (
      <FormSheet
        title={t('studio.connect.title')}
        icon="people"
        intro={t('studio.connect.intro')}
        submitLabel={t('studio.connect.submit')}
        canSubmit={code.trim().length > 0}
        onSubmit={connect}
        onCancel={closeStudioDialog}
        width={460}
        footer={
          showHub ? null : (
            <button type="button" className={f.linkButton} onClick={() => setShowHub(true)}>
              {t('studio.connect.otherHub')}
            </button>
          )
        }
      >
        <Field label={t('studio.connect.code')} hint={t('studio.connect.codeHint')} htmlFor="studio-code">
          <TextInput id="studio-code" value={code} onChange={setCode} mono placeholder="XXXX-XXXX" data-autofocus />
        </Field>
        {showHub ? (
          <Field label={t('studio.connect.hub')} hint={t('studio.connect.hubHint')} htmlFor="studio-hub">
            <TextInput id="studio-hub" value={hub} onChange={setHub} mono placeholder="http://localhost:8787" />
          </Field>
        ) : null}
        {trouble ? <div className={f.hint}>{trouble}</div> : null}
      </FormSheet>
    );
  }

  if (disconnecting) {
    return (
      <Alert
        title={t('studio.disconnect.title')}
        message={status?.state === 'online' ? t('studio.disconnect.message') : `${t('studio.disconnect.message')} ${t('studio.disconnect.offline')}`}
        tone="danger"
        confirm={{
          label: t('studio.disconnect.confirm'),
          destructive: true,
          onClick: () => {
            void api.studio.unlink().then((next) => {
              setStatus(next);
              setStudioLinked(next.linked);
              setTrouble(next.lastError === 'cannot-remove' ? t('studio.disconnect.cannotRemove') : undefined);
              setDisconnecting(false);
            });
          },
        }}
        onCancel={() => setDisconnecting(false)}
        cancel={t('common.ui.cancel')}
      />
    );
  }

  return (
    <FormSheet
      title={t('studio.panel.title')}
      icon="people"
      intro={t('studio.panel.intro')}
      submitLabel={t('studio.connect.submit')}
      onSubmit={() => undefined}
      hideSubmit
      onCancel={closeStudioDialog}
      width={520}
      footer={
        <>
          {status?.state !== 'online' ? (
            <button
              type="button"
              className={f.button}
              onClick={() =>
                void api.studio.reconnect().then((next) => {
                  setStatus(next);
                  setStudioLinked(next.linked);
                })
              }
            >
              {t('studio.action.reconnect')}
            </button>
          ) : null}
          <button type="button" className={f.button} onClick={() => setDisconnecting(true)}>
            {t('studio.action.disconnect')}
          </button>
        </>
      }
    >
      <div className={f.hint}>
        <strong>{t(STATE_KEYS[status?.state ?? 'unlinked'] ?? 'studio.state.unlinked')}</strong>
        {retryIn !== undefined ? ` · ${t('studio.status.retry', { seconds: retryIn })}` : ''}
        {status?.lastError ? ` · ${status.lastError}` : ''}
      </div>
      <div className={f.hint}>{t('studio.panel.hub', { hub: status?.hub ?? '' })}</div>
      {projectId && shared ? (
        <Field label={t('studio.share.label')} hint={t('studio.share.detail')}>
          <Switch
            on={shared.shared}
            label={t('studio.share.label')}
            onChange={(on) =>
              void api.studio.setProject(projectId, on).then((next) => {
                setStatus(next);
                setStudioLinked(next.linked);
              })
            }
          />
        </Field>
      ) : (
        <div className={f.hint}>{t('studio.panel.noProject')}</div>
      )}
    </FormSheet>
  );
}

/** Settings › Advanced: one row that opens the same dialog (no project: share from a project's ⋯ menu). */
export function StudioSettings() {
  const t = useT();
  const linked = useStudioLinked();
  return (
    <Group title={t('studio.settings.title')}>
      <Row label={t('studio.settings.label')} detail={t('studio.settings.detail')}>
        <Button onClick={() => openStudioDialog()}>{linked ? t('studio.menu.open') : t('studio.menu.connect')}</Button>
      </Row>
    </Group>
  );
}
