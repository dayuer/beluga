import type { NotifySettings } from '@beluga/shared/settings-schema.js';
import { DND_CHOICES, type DndChoice, dndActive, dndFor, dndLabel } from '@beluga/shared/quiet.js';
import { Button } from '../components/ui.js';
import { previewRequestPopup } from '../gateway/request-native.js';
import { useApi, useApp } from '../lib/beluga.js';
import { runAccessAction, useNotificationAccess } from '../lib/sounds/access.js';
import { type AccessAction, notifyStatus } from '../lib/sounds/access-model.js';
import { Group, Row, Select, Switch } from './settings-controls.js';
import { NotifyStatusLine } from './sound/NotifyStatus.js';
import { SoundSettings } from './sound/SoundSettings.js';
import { TestNotification } from './sound/TestNotification.js';
import { keyPlatform } from '../lib/shortcuts-model.js';
import { type Key, useT } from '../i18n/index.js';

type Toggle = 'desktop' | 'onlyAway' | 'planMilestones' | 'needsYou' | 'done' | 'doneHere' | 'mentions' | 'people' | 'background' | 'sentinels' | 'problems' | 'pr';

const KINDS: ReadonlyArray<readonly [Toggle, Key, Key]> = [
  ['needsYou', 'settings.notifications.needsYou', 'settings.notifications.needsYouDetail'],
  ['done', 'settings.notifications.done', 'settings.notifications.doneDetail'],
  ['doneHere', 'settings.notifications.doneHere', 'settings.notifications.doneHereDetail'],
  ['mentions', 'settings.notifications.mentions', 'settings.notifications.mentionsDetail'],
  ['people', 'settings.notifications.people', 'settings.notifications.peopleDetail'],
  ['background', 'settings.notifications.background', 'settings.notifications.backgroundDetail'],
  ['sentinels', 'settings.notifications.sentinels', 'settings.notifications.sentinelsDetail'],
  ['problems', 'settings.notifications.problems', 'settings.notifications.problemsDetail'],
  ['pr', 'settings.notifications.pr', 'settings.notifications.prDetail'],
  ['planMilestones', 'settings.notifications.planMilestones', 'settings.notifications.planMilestonesDetail'],
];

/**
 * Settings › Notifications: whether they reach you (and how to fix it when macOS is in the
 * way), the sound with a test right under it, and what reaches you when.
 */
export function NotificationSettings() {
  const api = useApi();
  const n = useApp((st) => st.prefs.notify);
  const t = useT();
  const save = (patch: Partial<NotifySettings>): void => void api.session.setPrefs({ notify: { ...n, ...patch } });
  const quiet = dndActive(n);
  const { access, recheck } = useNotificationAccess();
  const status = notifyStatus(access, { desktop: n.desktop, quietUntil: quiet ? dndLabel(n) : null }, keyPlatform());
  // Opening System Settings: checked again when you come back (window focus). Asking: right away.
  const act = (action: AccessAction): void => void runAccessAction(action).then((a) => a && recheck(a)).catch(() => undefined);
  return (
    <>
      <NotifyStatusLine status={status} onAction={act} />
      <Group>
        <Row label={t('settings.notifications.desktop')} detail={t('settings.notifications.desktopDetail')}>
          <Switch label={t('settings.notifications.desktop')} on={n.desktop} onChange={(v) => save({ desktop: v })} />
        </Row>
        <Row label={t('settings.notifications.popups')} detail={t('settings.notifications.popupsDetail')}>
          <Switch label={t('settings.notifications.popups')} on={n.popup !== false} onChange={(v) => save({ popup: v })} />
        </Row>
        <Row label={t('settings.notifications.seePopup')} detail={t('settings.notifications.seePopupDetail')}>
          <Button onClick={previewRequestPopup}>{t('settings.notifications.preview')}</Button>
        </Row>
        <Row label={t('settings.notifications.onlyAway')} detail={t('settings.notifications.onlyAwayDetail')}>
          <Switch label={t('settings.notifications.onlyAway')} on={n.onlyAway} onChange={(v) => save({ onlyAway: v })} />
        </Row>
      </Group>
      <SoundSettings n={n} save={save} test={<TestNotification n={n} onChecked={recheck} onAction={act} />} />
      <Group>
        <Row label={t('settings.notifications.dnd')} detail={quiet ? t('settings.notifications.dndOn', { until: dndLabel(n) }) : t('settings.notifications.dndDetail')}>
          {quiet ? (
            <Button onClick={() => save({ dnd: null })}>{t('settings.notifications.turnOff')}</Button>
          ) : (
            <Select<'off' | DndChoice>
              label={t('settings.notifications.dnd')}
              value="off"
              options={[{ value: 'off', label: t('settings.common.off') }, ...DND_CHOICES]}
              onChange={(v) => save({ dnd: v === 'off' ? null : dndFor(v) })}
            />
          )}
        </Row>
      </Group>
      <Group title={t('settings.notifications.tellMe')}>
        {KINDS.map(([key, label, detail]) => (
          <Row key={key} label={t(label)} detail={t(detail)}>
            <Switch label={t(label)} on={n[key]} onChange={(v) => save({ [key]: v })} />
          </Row>
        ))}
      </Group>
    </>
  );
}
