import { assistantTitle } from '../lib/brand.js';
import { CHAT_LIMIT_DEFAULT, CHAT_LIMIT_NONE, CHAT_LIMIT_PRESETS } from '@beluga/shared/chat-limit.js';
import { useApi, useApp } from '../lib/beluga.js';
import { Group, Row, Select } from './settings-controls.js';
import { t as tNow, useT } from '../i18n/index.js';

const label = (n: number): string => (n === CHAT_LIMIT_NONE ? tNow('settings.chatLimit.none') : tNow('settings.chatLimit.chats', { n }));

/**
 * Settings › Agent › Open chats: how many chats Your Mac and Sentinel each keep as tabs. Past it a
 * new chat is refused with a note that points here; No limit never refuses.
 */
export function ChatLimitSettings() {
  const api = useApi();
  const saved = useApp((st) => st.prefs.chatLimit ?? CHAT_LIMIT_DEFAULT);
  const t = useT();
  // A number set in settings.json by hand still shows as itself.
  const values = CHAT_LIMIT_PRESETS.some((n) => n === saved) ? [...CHAT_LIMIT_PRESETS] : [...CHAT_LIMIT_PRESETS, saved].sort((a, b) => (a || Infinity) - (b || Infinity));
  return (
    <Group title={t('settings.chatLimit.title')}>
      <Row
        label={t('settings.chatLimit.label')}
        detail={saved === CHAT_LIMIT_NONE ? t('settings.chatLimit.noneDetail', { mac: assistantTitle() }) : t('settings.chatLimit.detail', { mac: assistantTitle(), n: saved })}
      >
        <Select
          label={t('settings.chatLimit.title')}
          value={String(saved)}
          onChange={(v) => void api.session.setPrefs({ chatLimit: Number(v) })}
          options={values.map((n) => ({ value: String(n), label: label(n) }))}
        />
      </Row>
    </Group>
  );
}
