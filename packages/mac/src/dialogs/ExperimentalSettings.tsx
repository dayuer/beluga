import { EXPERIMENTS, EXPERIMENT_INFO, type Experiment, experimentOn, withExperiment } from '@beluga/shared/experiments.js';
import { Icon } from '../components/Icon.js';
import { useApi, useApp } from '../lib/beluga.js';
import { Group, Row, Switch } from './settings-controls.js';
import s from './settings.module.css';
import x from './experimental.module.css';
import { tl, useT } from '../i18n/index.js';

/**
 * Settings › Experimental: early features, each off until you turn it on, each saying what it
 * changes in Beluga and what it costs this computer (shared/experiments.ts). Turning one on is
 * saved with your settings, and the daemon follows it at once (what your agent is told, what it
 * may build).
 */
export function ExperimentalSettings() {
  const api = useApi();
  const enabled = useApp((st) => st.prefs.experiments);
  const t = useT();
  const set = (id: Experiment, on: boolean): void => void api.session.setPrefs({ experiments: withExperiment(enabled, id, on) });
  return (
    <>
      <div className={x.intro}>
        <Icon name="flask" size={16} className={x.introIcon} />
        <p>{t('settings.experimental.intro')}</p>
      </div>
      {EXPERIMENTS.map((id) => {
        const info = EXPERIMENT_INFO[id];
        const title = tl('EXPERIMENT_INFO', id, 'title', info.title);
        const on = experimentOn(enabled, id);
        return (
          <Group key={id} title={title}>
            <Row label={title} detail={tl('EXPERIMENT_INFO', id, 'summary', info.summary)}>
              <Switch label={title} on={on} onChange={(v) => set(id, v)} />
            </Row>
            <div className={x.about}>
              <div className={x.heading}>{t('settings.experimental.changes')}</div>
              <ul className={x.changes}>
                {info.changes.map((c, i) => (
                  <li key={c}>{tl('EXPERIMENT_INFO', id, `changes.${i}`, c)}</li>
                ))}
              </ul>
              <div className={x.heading}>{t('settings.experimental.cost')}</div>
              <p className={x.cost}>{tl('EXPERIMENT_INFO', id, 'cost', info.cost)}</p>
            </div>
          </Group>
        );
      })}
      <p className={s.note}>{t('settings.experimental.report')}</p>
    </>
  );
}
