import { Button } from '../components/ui.js';
import { lastCheckedLabel, modeOf, statusLine, switchesOf } from '../lib/update-model.js';
import { checkForUpdates, openUpdateSheet, setUpdateMode, useUpdates } from '../lib/updates.js';
import { Group, Row, Switch } from './settings-controls.js';
import { useT } from '../i18n/index.js';


/** Check Now, and what's happening (or when Beluga last looked). */
function CheckRow({ label }: { label: string }) {
  const { state } = useUpdates();
  const busy = state.phase === 'checking' || state.phase === 'downloading' || state.phase === 'installing';
  const status = statusLine(state);
  const t = useT();
  return (
    <Row label={label} detail={t('settings.updates.lastChecked', { status: status ? `${status} · ` : '', when: lastCheckedLabel(state.lastCheck) })}>
      {state.available ? (
        <Button size="small" onClick={openUpdateSheet}>
          {t('settings.updates.show')}
        </Button>
      ) : null}
      <Button size="small" onClick={() => void checkForUpdates()} disabled={busy}>
        {t('settings.updates.checkNow')}
      </Button>
    </Row>
  );
}

/** Settings › General › Updates. */
export function UpdateSettingsGroup() {
  const { state } = useUpdates();
  const on = switchesOf(state.mode);
  const t = useT();
  return (
    <Group title={t('settings.updates.title')}>
      <Row label={t('settings.updates.auto')} detail={on.auto ? t('settings.updates.autoOn') : t('settings.updates.autoOff')}>
        <Switch label={t('settings.updates.auto')} on={on.auto} onChange={(auto) => void setUpdateMode(modeOf({ auto }, state.mode))} />
      </Row>
      <Row label={t('settings.updates.check')} detail={on.check ? t('settings.updates.checkOn') : t('settings.updates.checkOff')}>
        <Switch label={t('settings.updates.check')} on={on.check} onChange={(check) => void setUpdateMode(modeOf({ check }, state.mode))} />
      </Row>
      <CheckRow label={`Beluga ${state.current}`} />
    </Group>
  );
}

/** Settings › About: the same Check Now. */
export function UpdateAboutRow() {
  const t = useT();
  return <CheckRow label={t('settings.updates.title')} />;
}
