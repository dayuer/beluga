import type { View } from '@beluga/core/store.js';
import { cx } from '../components/ui.js';
import { useActions } from '../lib/actions.js';
import { onMachine } from './pane-model.js';
import { type Tagged, whereLine } from './remote-work.js';
import { MachineChip } from './RemoteRows.js';
import c from './machines.module.css';
import { useT } from '../i18n/index.js';

/**
 * A list's work on your computers (BLG-785): Plans, Sentinels, Tasks and Dashboards each show
 * theirs after this Mac's, every row with its computer's mark and short name; an offline
 * computer's greyed, saying when it was seen. Opening one opens it in the pane with that
 * computer's client. Nothing shows when there's none.
 */

export interface RemoteItem {
  readonly id: string;
  readonly title: string;
  /** One line under it (a project, a status). */
  readonly sub?: string;
  /** Its page on the computer. */
  readonly page: View;
}

export function RemoteList({ title: given, rows }: { title?: string; rows: ReadonlyArray<Tagged<RemoteItem>> }) {
  const t = useT();
  const title = given ?? t('machines.rows.onYourComputers');
  const actions = useActions();
  if (!rows.length) return null;
  return (
    <section className={c.remoteList} aria-label={title}>
      <div className={c.remoteHead}>{title}</div>
      <ul>
        {rows.map((row) => (
          <li key={`${row.machine.id}/${row.item.id}`}>
            <button type="button" className={cx(c.remoteRow, row.offline && c.offlineRow)} title={whereLine(row)} aria-label={t('machines.rows.itemOn', { item: row.item.title, name: row.machine.name })} onClick={() => actions.run({ type: 'view', view: onMachine(row.machine.id, row.item.page) })}>
              <span className={c.remoteMain}>
                <span className={c.remoteTitle}>{row.item.title}</span>
                {row.item.sub || row.offline ? <span className={c.remoteSub}>{[row.item.sub, row.offline ? whereLine(row) : undefined].filter(Boolean).join(' · ')}</span> : null}
              </span>
              <MachineChip machine={row.machine} offline={row.offline} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
