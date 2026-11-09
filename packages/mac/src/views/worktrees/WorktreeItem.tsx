import type { KeyboardEvent, MouseEvent } from 'react';
import type { ArchivePreview } from '@beluga/workspaces/archive.js';
import { formatBytes } from '@beluga/shared/format.js';
import { planTitle } from '@beluga/core/plans/model.js';
import { planOwnerOf } from '@beluga/core/plans/owner.js';
import { Icon, type IconName } from '../../components/Icon.js';
import { ProjectIcon } from '../../components/ProjectIcon.js';
import { type ActionItem, ActionsContext, ActionsDropdown } from '../../components/SpecMenu.js';
import { Button, IconButton, Tip, cx } from '../../components/ui.js';
import { useActions } from '../../lib/actions.js';
import { useApp } from '../../lib/beluga.js';
import { outsideLocation } from '../../layout/outside-model.js';
import { agoText } from '../project/home-model.js';
import { type MadeBy, type WorktreeRow, archivedText } from './worktrees-model.js';
import s from './worktrees.module.css';
import { revealLabel } from '../../lib/os-words.js';
import { type Key, useT } from '../../i18n/index.js';

const ARCHIVING = { saving: 'views.wt.saving', compressing: 'views.wt.compressing', removing: 'views.wt.removing' } as const satisfies Record<string, Key>;
const stop = (e: MouseEvent): void => e.stopPropagation();

export interface ItemActions {
  readonly archive: (rows: readonly WorktreeRow[]) => void;
  readonly free: (rows: readonly WorktreeRow[]) => void;
  readonly restore: (rows: readonly WorktreeRow[]) => void;
  readonly remove: (rows: readonly WorktreeRow[]) => void;
}

/** Who made it, as a small tinted tag: Beluga's own, a sub-agent's (Claude's colour), or another tool's. */
const MADE: Record<MadeBy['kind'], { icon: IconName; short: Key }> = {
  beluga: { icon: 'terminal', short: 'views.wt.byBeluga' },
  agent: { icon: 'bot', short: 'views.wt.subAgent' },
  outside: { icon: 'external', short: 'views.wt.byOutside' },
};

function MadeByTag({ by }: { by: MadeBy }) {
  const t = useT();
  const orphan = by.kind === 'agent' && by.orphan;
  return (
    <span className={cx(s.madeBy, s[`by_${by.kind}`], orphan && s.orphan)} title={by.label}>
      <Icon name={MADE[by.kind].icon} size={11} />
      <span className={s.madeByText}>{orphan ? t('views.wt.gone', { by: t(MADE[by.kind].short) }) : t(MADE[by.kind].short)}</span>
    </span>
  );
}

/** The project it's in, by its icon (its name on hover). */
function ProjectMark({ row }: { row: WorktreeRow }) {
  return (
    <Tip label={row.project.name}>
      <span className={s.project} aria-label={row.project.name}>
        <ProjectIcon id={row.project.id} name={row.project.name} size={16} />
      </span>
    </Tip>
  );
}

/** What's in it that isn't in main, as icons and numbers (the words on hover); done: why it's done. */
function Left({ row }: { row: WorktreeRow }) {
  const t = useT();
  const left = row.left;
  if (row.work.done && !left?.files) {
    return (
      <span className={cx(s.work, s.done)} title={row.work.label}>
        <Icon name="check" size={11} /> {row.work.label}
      </span>
    );
  }
  if (!left) return <span className={cx(s.work, s.pending)}>{row.work.label}</span>;
  return (
    <span className={s.work}>
      {left.files ? (
        <Tip label={t('views.wt.uncommitted', { n: left.files })}>
          <span className={s.count} aria-label={t('views.wt.uncommitted', { n: left.files })}>
            <Icon name="pencil" size={11} />
            {left.files}
          </span>
        </Tip>
      ) : null}
      {left.commits ? (
        <Tip label={t('views.wt.notInMain', { n: left.commits })}>
          <span className={s.count} aria-label={t('views.wt.notInMain', { n: left.commits })}>
            <Icon name="commit" size={12} />
            {left.commits}
          </span>
        </Tip>
      ) : null}
    </span>
  );
}

/** Its name (what a sub-agent was asked, else the worktree's), cut short with all of it on hover; its branch below (and its plan, when it does one's task). */
function NameCell({ row }: { row: WorktreeRow }) {
  const home = useApp((st) => st.home);
  const t = useT();
  const w = row.ws;
  const plan = useApp((st) => {
    const owner = planOwnerOf(st.plans, st.board, w.id);
    return owner ? planTitle(owner.plan) : undefined;
  });
  const where = outsideLocation({ home }, w);
  const task = row.madeBy.kind === 'agent' ? row.madeBy.task : undefined;
  const name = task ?? w.name;
  return (
    <span role="cell" className={s.nameCell}>
      <ProjectMark row={row} />
      <span className={s.nameText}>
        <span className={s.name} title={task ? `${task}\n${w.name}` : name}>
          {name}
        </span>
        <span className={s.sub} title={where?.path ?? w.path}>
          {plan ? (
            <span className={s.planTag} title={t('views.wt.partOfPlan', { plan })}>
              <Icon name="flag" size={10} />
              {plan}
            </span>
          ) : null}
          {[w.branch, where?.folder].filter(Boolean).join(' · ') || w.path}
        </span>
      </span>
    </span>
  );
}

/** One worktree: tick it, open it (click), or right-click for what can be done with it. */
export function WorktreeItem({ row, plan, ticked, onTick, act }: { row: WorktreeRow; plan: ArchivePreview | undefined; ticked: boolean; onTick: (on: boolean) => void; act: ItemActions }) {
  const actions = useActions();
  const t = useT();
  const w = row.ws;
  const open = (): void => actions.run({ type: 'open_ws', id: w.id });
  const parent = row.madeBy.kind === 'agent' ? row.madeBy.parentId : undefined;
  const items: ActionItem[] = [
    { label: t('views.sync.open'), icon: 'forward', onSelect: open },
    ...(parent ? [{ label: t('views.wt.openParent'), icon: 'chat' as const, onSelect: () => actions.run({ type: 'open_ws', id: parent }) }] : []),
    { label: revealLabel(), icon: 'folder', onSelect: () => actions.run({ type: 'ws', id: w.id, action: 'finder' }) },
    { label: t('views.wt.removeBuildFiles'), icon: 'archive', separate: true, disabled: !plan?.dropBytes, hint: plan && !plan.dropBytes ? t('views.wt.noneToRemove') : t('views.wt.removeHint'), onSelect: () => act.free([row]) },
    { label: t('views.wt.archive'), icon: 'archive', hint: t('views.wt.archiveHint'), onSelect: () => act.archive([row]) },
    { label: t('views.overview.deletePermanently'), icon: 'x', danger: true, separate: true, disabled: Boolean(row.archiving), hint: row.madeBy.kind === 'beluga' ? t('views.wt.deleteHintOwn') : t('views.wt.deleteHintOther'), onSelect: () => act.remove([row]) },
  ];
  const onKey = (e: KeyboardEvent): void => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter') open();
    if (e.key === ' ') {
      e.preventDefault();
      onTick(!ticked);
    }
  };
  return (
    <ActionsContext items={items}>
      <div role="row" tabIndex={0} aria-label={w.name} aria-selected={ticked} className={cx(s.row, ticked && s.ticked, row.archiving && s.busy)} onClick={open} onKeyDown={onKey} data-worktree={w.id}>
        <span role="cell" className={s.tick} onClick={stop}>
          <input type="checkbox" aria-label={t('views.wt.select', { name: w.name })} checked={ticked} disabled={Boolean(row.archiving)} onChange={(e) => onTick(e.target.checked)} />
        </span>
        <NameCell row={row} />
        <span role="cell" className={s.madeByCell}>
          <MadeByTag by={row.madeBy} />
        </span>
        <span role="cell">
          <Left row={row} />
        </span>
        <span role="cell" className={s.size}>
          {row.size !== undefined ? formatBytes(row.size) : '–'}
        </span>
        <span role="cell" className={s.size} title={plan?.drop.map((d) => `${d.path} (${d.what}): ${formatBytes(d.bytes)}`).join('\n') || undefined}>
          {row.archiving ? <span className={s.phase}>{t(ARCHIVING[row.archiving])}</span> : plan ? (plan.dropBytes ? formatBytes(plan.dropBytes) : t('views.wt.noneSize')) : <span className={s.pending}>…</span>}
        </span>
        <span role="cell" className={s.more} onClick={stop}>
          <ActionsDropdown items={items}>
            <IconButton icon="more" label={t('views.overview.moreFor', { name: w.name })} />
          </ActionsDropdown>
        </span>
      </div>
    </ActionsContext>
  );
}

/** One archived worktree: whether it can come back (Restore, right there) and what deleting it would lose. */
export function ArchivedItem({ row, ticked, onTick, act, busy }: { row: WorktreeRow; ticked: boolean; onTick: (on: boolean) => void; act: ItemActions; busy: boolean }) {
  const w = row.ws;
  const a = row.archived!;
  const t = useT();
  const text = archivedText(row, formatBytes);
  const items: ActionItem[] = [
    { label: t('views.overview.restore'), icon: 'refresh', disabled: !a.restorable, hint: text.restore, onSelect: () => act.restore([row]) },
    { label: t('views.overview.deletePermanently'), icon: 'x', danger: true, separate: true, hint: text.remove, onSelect: () => act.remove([row]) },
  ];
  const onKey = (e: KeyboardEvent): void => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' && a.restorable) act.restore([row]);
    if (e.key === ' ') {
      e.preventDefault();
      onTick(!ticked);
    }
  };
  return (
    <ActionsContext items={items}>
      <div role="row" tabIndex={0} aria-label={w.name} aria-selected={ticked} className={cx(s.row, s.archivedRow, ticked && s.ticked)} onKeyDown={onKey} data-worktree={w.id}>
        <span role="cell" className={s.tick}>
          <input type="checkbox" aria-label={t('views.wt.select', { name: w.name })} checked={ticked} onChange={(e) => onTick(e.target.checked)} />
        </span>
        <NameCell row={row} />
        <span role="cell" className={s.madeByCell}>
          <MadeByTag by={row.madeBy} />
        </span>
        <span role="cell" className={s.size} title={a.at ? new Date(a.at).toLocaleString() : undefined}>
          {a.at ? agoText(a.at) : '–'}
        </span>
        <span role="cell" className={cx(s.comesBack, !a.restorable && s.cannot)} title={`${text.restore}${t('views.sync.period')} ${text.remove}`}>
          {a.restorable ? (w.archive ? t('views.wt.asItWas') : t('views.wt.fromBranch')) : t('views.wt.cantComeBack')}
        </span>
        <span role="cell" className={s.archivedActions}>
          {a.restorable ? (
            <Button size="small" variant="plain" icon="refresh" disabled={busy} onClick={() => act.restore([row])}>
              {t('views.overview.restore')}
            </Button>
          ) : null}
          <Tip label={text.remove}>
            <Button size="small" variant="quiet" disabled={busy} onClick={() => act.remove([row])}>
              {t('views.wt.delete')}
            </Button>
          </Tip>
        </span>
      </div>
    </ActionsContext>
  );
}
