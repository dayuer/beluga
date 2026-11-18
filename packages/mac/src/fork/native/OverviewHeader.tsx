import type { OverviewSort } from '../../views/overview/overview-model.js';
import { Icon } from '../../components/Icon.js';
import h from './overview-header.module.css';

/**
 * The Overview's column headers, as an NSTableView has them (fork; Claude Design "Beluga topic/native ·
 * Mac 原生走查", 1a). One row above the groups, on the rows' own columns; Name and the last column
 * sort, the others only name what's under them. The sort itself stays the Overview's (its Recent ▾
 * menu and these headers set the same preference).
 */
export function OverviewHeader({ sort, onSort }: { sort: OverviewSort; onSort: (sort: OverviewSort) => void }) {
  const last: OverviewSort = sort === 'size' ? 'size' : 'recent';
  return (
    <div className={h.head} role="row" data-fork-overview-head="">
      <span />
      <SortHeader label="Name" on={sort === 'name'} onClick={() => onSort('name')} />
      <span className={h.cell}>Branch</span>
      <span className={h.cell}>Status</span>
      <span className={h.cell}>Details</span>
      <SortHeader label={last === 'size' ? 'Size' : 'Updated'} on={sort !== 'name'} end onClick={() => onSort(sort === 'recent' ? 'size' : 'recent')} />
    </div>
  );
}

function SortHeader({ label, on, end, onClick }: { label: string; on: boolean; end?: boolean; onClick: () => void }) {
  return (
    <button type="button" role="columnheader" aria-sort={on ? (label === 'Name' ? 'ascending' : 'descending') : 'none'} className={[h.cell, h.sort, on ? h.on : '', end ? h.end : ''].join(' ')} onClick={onClick}>
      <span>{label}</span>
      {on ? <Icon name="chevronDown" size={9} /> : null}
    </button>
  );
}
