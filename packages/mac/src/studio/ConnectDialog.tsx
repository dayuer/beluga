import { useEffect, useState } from 'react';
import type { StudioStatus } from '@beluga/studio/service.js';
import { Alert } from '../components/Alert.js';
import { Field, FormSheet, TextInput, formStyles as f } from '../components/FormSheet.js';
import { Button } from '../components/ui.js';
import { Group, Row, Switch } from '../dialogs/settings-controls.js';
import { t } from '../i18n/index.js';
import { useApi } from '../lib/beluga.js';
import { useClock } from '../lib/window-active.js';
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

const ERROR_KEYS: Readonly<Record<string, string>> = {
  'bad-code': 'That binding code is not right, or it has expired. Get a fresh one from the admin page.',
  'expired-code': 'That binding code has expired. Get a fresh one from the admin page.',
  'bad-hub': 'The studio address must be https, or http on this computer (localhost).',
  unreachable: 'Could not reach the studio hub. Is it running?',
  'clock-skew': 'This Mac’s clock is more than five minutes off. Set it and try again.',
  'key-taken': 'That key is already registered somewhere else. Start over from the admin page.',
  'already-linked': 'This Mac is already connected. Disconnect first.',
  'cannot-save': 'Could not save the link to ~/.beluga/studio.json.',
  'demo-mode': 'Synon Studio is off in a demo.',
};

const STATE_KEYS: Readonly<Record<string, string>> = {
  unlinked: 'Not connected',
  connecting: 'Connecting…',
  online: 'Online',
  offline: 'Offline',
  revoked: 'Revoked: connect again with a new code',
  outdated: 'This app is older than the studio hub: update Beluga',
  'clock-skew': 'This Mac’s clock is more than five minutes off',
  'wrong-studio': 'That link belongs to another studio: connect again',
  stopped: 'Stopped',
};

function StudioBody({ projectId }: { projectId?: string }) {
  const api = useApi();
  const [status, setStatus] = useState<StudioStatus>();
  const [code, setCode] = useState('');
  const [hub, setHub] = useState('');
  const [showHub, setShowHub] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [trouble, setTrouble] = useState<string>();
  // Every two seconds while the dialog is open and you're looking at the window: the clock rests
  // otherwise (lib/window-active, KLD-40), so a dialog left open in another Space asks nothing.
  const now = useClock(true, 2_000);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const next = await api.studio.status();
        if (!alive) return;
        setStatus(next);
        setStudioLinked(next.linked);
      } catch {
        // The daemon may be restarting; the next tick says.
      }
    })();
    return () => {
      alive = false;
    };
  }, [api, now]);

  const reason = (error: string): string => {
    const key = ERROR_KEYS[error];
    return key ? t(key) : t(`The studio said no: ${error}`);
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
        title={t('Connect to Studio')}
        icon="people"
        intro={t('Paste the binding code from the studio’s Synon Studio admin page. This Mac then shows that studio’s customers the plans you share — with no paths, task keys, branches or agent names in them.')}
        submitLabel={t('Connect')}
        canSubmit={code.trim().length > 0}
        onSubmit={connect}
        onCancel={closeStudioDialog}
        width={460}
        footer={
          showHub ? null : (
            <button type="button" className={f.linkButton} onClick={() => setShowHub(true)}>
              {t('Use another studio address')}
            </button>
          )
        }
      >
        <Field label={t('Binding code')} hint={t('Eight letters and digits, like 7K2M-9XQA. The admin page makes a new one.')} htmlFor="studio-code">
          <TextInput id="studio-code" value={code} onChange={setCode} mono placeholder="XXXX-XXXX" data-autofocus />
        </Field>
        {showHub ? (
          <Field label={t('Studio address')} hint={t('https anywhere, or http on this computer (localhost). Empty: this computer’s studio hub.')} htmlFor="studio-hub">
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
        title={t('Disconnect from Synon Studio?')}
        message={status?.state === 'online' ? t('This Mac’s plans stop going to the studio and its customers, the link closes, and the key it made is forgotten. You can connect again with a new code.') : `${t('This Mac’s plans stop going to the studio and its customers, the link closes, and the key it made is forgotten. You can connect again with a new code.')} ${t('The studio hub is offline right now, so it may keep showing the old views until the studio’s operator unbinds this Mac.')}`}
        tone="danger"
        confirm={{
          label: t('Disconnect'),
          destructive: true,
          onClick: () => {
            void api.studio.unlink().then((next) => {
              setStatus(next);
              setStudioLinked(next.linked);
              setTrouble(next.lastError === 'cannot-remove' ? t('Disconnected, but the key file could not be removed: ~/.beluga/studio.json is still on this Mac.') : undefined);
              setDisconnecting(false);
            });
          },
        }}
        onCancel={() => setDisconnecting(false)}
        cancel={t('Cancel')}
      />
    );
  }

  return (
    <FormSheet
      title={t('Synon Studio')}
      icon="people"
      intro={t('The link to your Synon Studio: its state, and what this Mac shares with it.')}
      submitLabel={t('Connect')}
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
              {t('Reconnect')}
            </button>
          ) : null}
          <button type="button" className={f.button} onClick={() => setDisconnecting(true)}>
            {t('Disconnect')}
          </button>
        </>
      }
    >
      <div className={f.hint}>
        <strong>{t(STATE_KEYS[status?.state ?? 'unlinked'] ?? 'Not connected')}</strong>
        {retryIn !== undefined ? ` · ${t(`trying again in ${retryIn}s`)}` : ''}
        {status?.lastError ? ` · ${status.lastError}` : ''}
      </div>
      <div className={f.hint}>{t(`Studio: ${status?.hub ?? ''}`)}</div>
      {projectId && shared ? (
        <Field label={t('Share this project')} hint={t('Its plans go to the studio cleaned of paths, task keys, branches and agent names. A person still maps it on the admin page.')}>
          <Switch
            on={shared.shared}
            label={t('Share this project')}
            onChange={(on) =>
              void api.studio.setProject(projectId, on).then((next) => {
                setStatus(next);
                setStudioLinked(next.linked);
              })
            }
          />
        </Field>
      ) : (
        <div className={f.hint}>{t('To show a project’s plans to customers, open that project’s ⋯ menu and share it there.')}</div>
      )}
    </FormSheet>
  );
}

/** Settings › Advanced: one row that opens the same dialog (no project: share from a project's ⋯ menu). */
export function StudioSettings() {
  const linked = useStudioLinked();
  return (
    <Group title={t('Synon Studio')}>
      <Row label={t('Connect to Studio')} detail={t('Show a studio’s customers the plans you share — as they are written, without paths, task keys or agent names.')}>
        <Button onClick={() => openStudioDialog()}>{linked ? t('Synon Studio…') : t('Connect to Studio…')}</Button>
      </Row>
    </Group>
  );
}
