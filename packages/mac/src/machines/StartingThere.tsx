import { Button, Empty } from '../components/ui.js';
import side from '../layout/Sidebar.module.css';
import { GettingReady } from './GettingReady.js';
import { MachineMark } from './MachineMark.js';
import { type Starting, dismissStarting } from './start-there.js';
import c from './machines.module.css';
import { useT } from '../i18n/index.js';

/**
 * New work on its way to one of your computers (BLG-788): reaching it, getting the project ready
 * there step by step (BLG-787), then making it; it opens in the pane as soon as it's made.
 */
export function StartingThere({ start }: { start: Starting }) {
  const t = useT();
  const where = start.machine.name;
  if (start.phase === 'failed') {
    return (
      <Empty
        icon="alert"
        title={t('machines.starting.failed', { what: start.what, where })}
        {...(start.error ? { detail: start.error } : {})}
        action={
          <Button size="small" onClick={dismissStarting}>
            {t('machines.starting.back')}
          </Button>
        }
      />
    );
  }
  return (
    <div className={c.starting} aria-label={t('machines.starting.aria', { where })}>
      <div className={c.startingHead}>
        <MachineMark machine={start.machine} size={16} />
        <span>{t('machines.starting.head', { what: start.what, where })}</span>
      </div>
      {start.phase === 'ready' && start.run && start.client ? (
        <GettingReady client={start.client} run={start.run} />
      ) : (
        <div className={c.startingLine} role="status">
          <span className={side.making} aria-hidden="true" />
          {start.phase === 'connecting' ? t('machines.starting.reaching', { where }) : t('machines.starting.making', { where })}
        </div>
      )}
    </div>
  );
}
