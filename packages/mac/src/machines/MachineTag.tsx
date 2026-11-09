import type { SocketClient } from '@beluga/ipc/socket-client.js';
import { linkHealth } from '@beluga/machines/links.js';
import { Icon } from '../components/Icon.js';
import { cx } from '../components/ui.js';
import { useLinkSample } from './use-link-sample.js';
import { useBeluga, useMachine } from '../lib/beluga.js';
import { MachineMark } from './MachineMark.js';
import { useMachineView } from './use-machines.js';
import c from './machines.module.css';
import { useT } from '../i18n/index.js';

/** Inside a computer's page: its mark and name, for the toolbar's title ("on build-box"). */
export function MachineTag() {
  const machine = useMachine();
  const { home } = useBeluga();
  if (!machine) return null;
  return <Tag machine={machine} home={home} />;
}

function Tag({ machine, home }: { machine: string; home: SocketClient }) {
  const t = useT();
  const view = useMachineView(home, machine);
  // The link as this window feels it (BLG-792): said when it's slow or lost, never felt as a freeze.
  const sample = useLinkSample(machine);
  const name = view?.name ?? t('machines.yourComputer');
  const link = sample ? linkHealth(sample, name) : { state: 'ok' as const, words: t('machines.tag.runsOn', { name }) };
  return (
    <span className={cx(c.tag, link.state !== 'ok' && c.tagDim)} title={link.words} data-link={link.state}>
      {view ? <MachineMark machine={view} size={12} /> : null}
      {name}
      {link.state === 'slow' ? (
        <span className={cx(c.linkBadge, c.linkSlow)}>
          <Icon name="clock" size={10} />
          {t('machines.tag.slow')}
        </span>
      ) : link.state === 'lost' ? (
        <span className={cx(c.linkBadge, c.linkLost)}>
          <Icon name="refresh" size={10} />
          {t('machines.tag.reconnecting')}
        </span>
      ) : null}
    </span>
  );
}
