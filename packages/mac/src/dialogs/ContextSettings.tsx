import { useEffect, useState } from 'react';
import { AUTO_COMPACT_MAX, AUTO_COMPACT_MIN, clampThreshold } from '@beluga/shared/context-usage.js';
import { useApi, useApp } from '../lib/beluga.js';
import { Group, Row, Switch } from './settings-controls.js';
import s from './settings.module.css';
import { useT } from '../i18n/index.js';

/**
 * Settings › Claude › Context: the meter, and compacting on its own when a conversation is nearly
 * full (Claude summarizes its working memory and keeps going; the chat stays on screen).
 */
export function ContextSettings() {
  const api = useApi();
  const p = useApp((st) => st.prefs);
  const t = useT();
  const saved = clampThreshold(p.autoCompactAt);
  // The slider moves freely; the setting is saved when you let go.
  const [at, setAt] = useState(saved);
  useEffect(() => setAt(saved), [saved]);
  const commit = (): void => {
    if (at !== saved) void api.session.setPrefs({ autoCompactAt: at });
  };
  return (
    <Group title={t('settings.context.title')}>
      <Row label={t('settings.context.meter')} detail={t('settings.context.meterDetail')}>
        <Switch label={t('settings.context.meter')} on={p.contextMeter} onChange={(v) => void api.session.setPrefs({ contextMeter: v })} />
      </Row>
      <Row
        label={t('settings.context.autoCompact')}
        detail={p.autoCompact ? t('settings.context.autoCompactOn') : t('settings.context.autoCompactOff')}
      >
        <Switch label={t('settings.context.autoCompactShort')} on={p.autoCompact} onChange={(v) => void api.session.setPrefs({ autoCompact: v })} />
      </Row>
      <Row label={t('settings.context.compactAt')} detail={t('settings.context.compactAtDetail', { at })}>
        <input
          className={s.slider}
          type="range"
          aria-label={t('settings.context.compactAt')}
          min={AUTO_COMPACT_MIN}
          max={AUTO_COMPACT_MAX}
          step={1}
          value={at}
          disabled={!p.autoCompact}
          onChange={(e) => setAt(Number(e.target.value))}
          onPointerUp={commit}
          onKeyUp={commit}
          onBlur={commit}
        />
      </Row>
    </Group>
  );
}
