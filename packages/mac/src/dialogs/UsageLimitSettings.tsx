import { resetWords } from '@beluga/shared/run-failure.js';
import { Button } from '../components/ui.js';
import { toast, useApi, useApp, useBeluga } from '../lib/beluga.js';
import { Group, Row, Switch } from './settings-controls.js';
import { useT } from '../i18n/index.js';

/**
 * Settings › Agent › Usage limits (BLG-757): an agent that stopped on your plan's usage limit is
 * told to continue once it resets. On by default; the limit card turns it off for one chat or for
 * this session, and the rows here undo that. Turned back on here, it starts from now: runs whose
 * reset already passed while it was off aren't sent on all at once.
 */
export function UsageLimitSettings() {
  const api = useApi();
  const { client } = useBeluga();
  const p = useApp((st) => st.prefs);
  const t = useT();
  const set = (patch: Parameters<typeof api.session.setPrefs>[0]): void => void api.session.setPrefs(patch).catch((err: unknown) => toast(client, err instanceof Error ? err.message : String(err), 'error'));
  const now = Date.now();
  const skipping = p.autoContinue && p.autoContinueSkip > now;
  const chats = p.autoContinueOff.length;
  return (
    <Group title={t('settings.usage.title')}>
      <Row
        label={t('settings.usage.continue')}
        detail={p.autoContinue ? t('settings.usage.continueOn') : t('settings.usage.continueOff')}
      >
        <Switch label={t('settings.usage.continue')} on={p.autoContinue} onChange={(v) => set(v ? { autoContinue: true, autoContinueSkip: Date.now() } : { autoContinue: false })} />
      </Row>
      {skipping ? (
        <Row label={t('settings.usage.skipped')} detail={t('settings.usage.skippedDetail', { when: resetWords(p.autoContinueSkip, now) })}>
          <Button size="small" onClick={() => set({ autoContinueSkip: 0 })}>
            {t('settings.usage.turnBackOn')}
          </Button>
        </Row>
      ) : null}
      {p.autoContinue && chats > 0 ? (
        <Row label={t('settings.usage.chatsOff')} detail={t('settings.usage.chatsOffDetail', { chats })}>
          <Button size="small" onClick={() => set({ autoContinueOff: [] })}>
            {t('settings.usage.turnOnAll')}
          </Button>
        </Row>
      ) : null}
    </Group>
  );
}
