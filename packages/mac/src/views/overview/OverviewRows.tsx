import type { KeyboardEvent, MouseEvent } from 'react';
import { activityOf } from '@beluga/ui/workspace-models.js';
import { formatBytes } from '@beluga/shared/format.js';
import { Icon } from '../../components/Icon.js';
import { type ActionItem, ActionsContext, ActionsDropdown } from '../../components/SpecMenu.js';
import { Button, Dot, IconButton, Tip, cx } from '../../components/ui.js';
import { useActions } from '../../lib/actions.js';
import { useApp, useBeluga } from '../../lib/beluga.js';
import { sameDeep } from '../../lib/stable.js';
import { workspaceItems } from '../../layout/workspace-row.js';
import type { OverviewItem } from './overview-model.js';
import s from '../overview.module.css';
import { revealLabel } from '../../lib/os-words.js';
import { chordLabel } from '../../lib/shortcuts-model.js';
import { t as tNow, useT } from '../../i18n/index.js';
import { localStateOf, localDescribePr } from '../../lib/engine-words.js';

const ago = (ts: number, now: number): string => {
  const m = Math.round((now - ts) / 60_000);
  if (m < 1) return tNow('views.ago.now');
  if (m < 60) return tNow('views.ago.min', { n: m });
  const h = Math.round(m / 60);
  return h < 24 ? tNow('views.ago.h', { n: h }) : tNow('views.ago.d', { n: Math.round(h / 24) });
};

/** What every row shares: it's focusable (one at a time, the arrow keys move it), and clicking selects it. */
interface RowBase {
  readonly item: OverviewItem;
  readonly selected: boolean;
  readonly onSelect: (id: string) => void;
  /** Return (or a click): open it. */
  readonly onOpen: (item: OverviewItem) => void;
}

const rowProps = ({ item, selected, onSelect, onOpen }: RowBase, label: string) => ({
  role: 'listitem',
  tabIndex: selected ? 0 : -1,
  'data-row': item.ws.id,
  'aria-label': label,
  'aria-current': selected ? ('true' as const) : undefined,
  onFocus: () => onSelect(item.ws.id),
  onClick: (e: MouseEvent) => {
    // A button inside the row does its own thing.
    if ((e.target as HTMLElement).closest('button')) return;
    onOpen(item);
  },
  onKeyDown: (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      onOpen(item);
    }
  },
});

/** A live plan: one row (its tasks are inside it), with what the plan as a whole waits on. */
function PlanItemRow(props: RowBase & { now: number }) {
  const { item, now } = props;
  const plan = item.plan!;
  const act = useApp((st) => activityOf(st.log, `ws:${item.ws.id}`));
  const t = useT();
  const tone = item.needs ? 'warn' : item.rank === 2 ? 'claude' : 'muted';
  const items: ActionItem[] = [{ label: t('views.overview.openPlan'), icon: 'chevronRight', onSelect: () => props.onOpen(item) }];
  return (
    <ActionsContext items={items}>
      <div {...rowProps(props, `${plan.title}${t('views.overview.planSuffix')}${plan.tip ? `, ${plan.tip}` : ''}`)} className={s.row} data-plan-item={plan.plan.id}>
        <span className={s.kind}>
          <Icon name="flag" size={14} />
        </span>
        <span className={s.name}>
          {plan.title}
          {plan.unread ? <span className={s.unread}>{t('views.overview.new', { n: plan.unread })}</span> : null}
        </span>
        <span className={s.branch}>{t('views.overview.plan')}</span>
        <span className={cx(s.state, s[`tone_${tone}`])}>
          <Dot tone={tone === 'claude' ? 'plan' : tone} live={item.rank === 2} />
          {plan.tip || t('views.overview.planCap')}
        </span>
        <span className={s.extra} title={item.last}>
          {item.last ?? ''}
        </span>
        <span className={s.when}>{act.lastTs ? ago(act.lastTs, now) : ''}</span>
      </div>
    </ActionsContext>
  );
}

/** A live worktree or chat: as the Overview always showed it (state, PR, context, when). A plan's is the plan's row. */
export function ActiveRow(props: RowBase & { now: number }) {
  return props.item.plan ? <PlanItemRow {...props} /> : <WorkspaceItemRow {...props} />;
}

const sameRow = <T,>(a: T, b: T): boolean => sameDeep(a, b, 2);

function WorkspaceItemRow(props: RowBase & { now: number }) {
  const { item, now } = props;
  const w = item.ws;
  const actions = useActions();
  const { client } = useBeluga();
  const t = useT();
  // What the row shows, worked out from the shared state: drawn again only when part of it changes.
  const { st, running, lastTs, unread, pr, ctx } = useApp((full) => {
    const act = activityOf(full.log, `ws:${w.id}`);
    return { st: localStateOf(full, w, 0), running: act.running, lastTs: act.lastTs, unread: full.unread[`ws:${w.id}`] ?? 0, pr: full.prs[w.id], ctx: full.context[`ws:${w.id}`] };
  }, sameRow);
  return (
    <ActionsContext items={() => workspaceItems(client.store.getState(), w, actions.run, client)}>
      <div {...rowProps(props, `${w.name}, ${st.label}`)} className={s.row}>
        <span className={s.kind}>
          <Icon name={w.kind === 'chat' ? 'chat' : w.kind === 'main' ? 'folder' : 'branch'} size={14} />
        </span>
        <span className={s.name}>
          {w.name}
          {unread ? <span className={s.unread}>{t('views.overview.new', { n: unread })}</span> : null}
        </span>
        <span className={s.branch}>{w.branch ?? (w.kind === 'chat' ? t('views.overview.chat') : '')}</span>
        <span className={cx(s.state, s[`tone_${st.tone}`])}>
          <Dot tone={running && w.kind === 'worktree' ? 'worktree' : st.tone} live={running} />
          {st.label}
        </span>
        <span className={s.extra} title={item.last}>
          {pr ? localDescribePr(pr) : ''}
          {ctx ? `${pr ? ' · ' : ''}${t('views.overview.context', { pct: Math.round((ctx.used / ctx.window) * 100) })}` : ''}
          {!pr && !ctx && item.last ? item.last : ''}
        </span>
        <span className={s.when}>{lastTs ? ago(lastTs, now) : item.size !== undefined ? formatBytes(item.size) : ''}</span>
      </div>
    </ActionsContext>
  );
}

export interface ArchivedActions {
  readonly restore: (item: OverviewItem) => void;
  readonly read: (item: OverviewItem) => void;
  readonly finder: (item: OverviewItem) => void;
  readonly remove: (item: OverviewItem) => void;
  /** The one being restored right now (its button says so). */
  readonly restoring: string | undefined;
}

/** The archived row's menu: right-click, or its ⋯ button. */
export function archivedItems(item: OverviewItem, act: ArchivedActions): ActionItem[] {
  return [
    { label: tNow('views.overview.restore'), icon: 'refresh', hint: item.ws.kind === 'worktree' ? (item.ws.archive ? tNow('views.overview.restoreAsWas') : tNow('views.overview.restoreFromBranch')) : tNow('views.overview.restoreChat'), onSelect: () => act.restore(item) },
    { label: tNow('views.overview.read'), icon: 'eye', keys: 'Space', onSelect: () => act.read(item) },
    ...(item.project.root ? [{ label: revealLabel('Project'), icon: 'folder' as const, onSelect: () => act.finder(item) }] : []),
    { label: tNow('views.overview.deletePermanently'), danger: true, keys: chordLabel('Cmd+Backspace'), onSelect: () => act.remove(item) },
  ];
}

/**
 * An archived worktree or chat, quiet: its folder is gone (a chat keeps its own), its branch
 * and conversation are kept. Hover (or select) for Restore, Read and ⋯; right-click for all.
 */
export function ArchivedRow(props: RowBase & { act: ArchivedActions }) {
  const { item, act } = props;
  const w = item.ws;
  const worktree = w.kind === 'worktree';
  const busy = act.restoring === w.id;
  const t = useT();
  // Archived smartly: everything of yours is kept, and it says what it freed.
  const smart = w.archive;
  const kept = smart ? (smart.freedBytes ? t('views.overview.freed', { size: formatBytes(smart.freedBytes) }) : t('views.overview.everythingKept')) : worktree && w.branch ? t('views.overview.branchKept') : t('views.overview.conversationKept');
  const keptLong = smart
    ? `${t('views.overview.keptLong', { size: formatBytes(smart.keptBytes) })} ${smart.freedBytes ? (smart.remake.length ? t('views.overview.clearedRemake', { size: formatBytes(smart.freedBytes), remake: smart.remake.join(', ') }) : t('views.overview.cleared', { size: formatBytes(smart.freedBytes) })) : ''}`
    : worktree && w.branch
      ? t('views.overview.folderRemoved', { branch: w.branch })
      : t('views.overview.conversationIsKept');
  const items = archivedItems(item, act);
  return (
    <ActionsContext items={items}>
      <div {...rowProps(props, t('views.overview.archivedAria', { name: w.name }))} className={cx(s.row, s.archived)}>
        <span className={s.kind}>
          <Icon name="archive" size={14} />
        </span>
        <span className={s.name}>{w.name}</span>
        <span className={s.branch}>{w.branch ?? (w.kind === 'chat' ? t('views.overview.chat') : '')}</span>
        <span className={cx(s.state, s.tone_muted)}>
          <Dot tone="muted" />
          {t('views.overview.filterArchived')}
        </span>
        <span className={s.extra} title={keptLong}>
          {kept}
        </span>
        <span className={s.when}>{smart ? formatBytes(smart.keptBytes) : item.size !== undefined ? formatBytes(item.size) : ''}</span>
        <span className={cx(s.hoverActions, busy && s.hoverBusy)}>
          <Tip label={worktree ? (smart ? t('views.overview.restoreAsWasTip') : t('views.overview.restoreFromBranchTip')) : t('views.overview.restoreChatTip')}>
            <Button size="small" variant="plain" disabled={busy} onClick={() => act.restore(item)}>
              {busy ? t('views.overview.restoring') : t('views.overview.restore')}
            </Button>
          </Tip>
          <IconButton icon="eye" label={t('views.overview.read')} keys="Space" onClick={() => act.read(item)} />
          <ActionsDropdown items={items}>
            <button type="button" className={s.more} aria-label={t('views.overview.moreFor', { name: w.name })}>
              <Icon name="more" size={14} />
            </button>
          </ActionsDropdown>
        </span>
      </div>
    </ActionsContext>
  );
}
