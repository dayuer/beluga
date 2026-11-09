import { useEffect, useState } from 'react';
import { PARALLEL_RUNS_MAX, PARALLEL_RUNS_MIN, clampParallelRuns } from '@beluga/shared/run-slots.js';
import { useApi, useApp } from '../lib/beluga.js';
import { Group, Row } from './settings-controls.js';
import s from './settings.module.css';
import { useT } from '../i18n/index.js';

/**
 * Settings › Claude › Working at once: how many conversations your Claude works in at the same
 * time. A message past it waits for one to finish, and its card says so.
 */
export function ParallelSettings() {
  const api = useApi();
  const saved = clampParallelRuns(useApp((st) => st.prefs.parallelRuns));
  const t = useT();
  // The slider moves freely; the setting is saved when you let go.
  const [n, setN] = useState(saved);
  useEffect(() => setN(saved), [saved]);
  const commit = (): void => {
    if (n !== saved) void api.session.setPrefs({ parallelRuns: n });
  };
  return (
    <Group title={t('settings.parallel.title')}>
      <Row
        label={t('settings.parallel.label')}
        detail={t('settings.parallel.detail', { n })}
      >
        <span className={s.sliderEnds}>
          <span>{t('settings.parallel.fewer')}</span>
          <input
            className={s.slider}
            type="range"
            aria-label={t('settings.parallel.aria')}
            min={PARALLEL_RUNS_MIN}
            max={PARALLEL_RUNS_MAX}
            step={1}
            value={n}
            onChange={(e) => setN(Number(e.target.value))}
            onPointerUp={commit}
            onKeyUp={commit}
            onBlur={commit}
          />
          <span>{t('settings.parallel.more')}</span>
        </span>
      </Row>
    </Group>
  );
}
