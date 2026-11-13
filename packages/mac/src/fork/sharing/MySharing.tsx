import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { TRUST_INFO } from '@beluga/core/trust.js';
import { Avatar, Button, cx } from '../../components/ui.js';
import { Select } from '../../components/Select.js';
import { Group, Row } from '../../dialogs/settings-controls.js';
import { t } from '../../i18n/index.js';
import { openSheet } from '../../lib/sheets.js';
import { useApi, useApp, useBeluga } from '../../lib/beluga.js';
import { openNet } from '../../network/net-sheets.js';
import { openFriendCard } from '../../network/use-net.js';
import { demoApply, demoCount, demoDefault, demoView } from './demo.js';
import {
  ALL_LEVELS,
  DEFAULT_LEVELS,
  POLICY_OF,
  type Circle,
  type DefaultLevel,
  type FilterShow,
  type Level,
  type SharingState,
  type SharingView,
  effective,
  filterCircles,
  isException,
  migrate,
  planBatch,
  sharingOf,
} from './model.js';
import { quietSuccess } from './quiet.js';
import s from './sharing.module.css';

/**
 * 「我的共享」（M7，docs/calm/sharing.md）：一个默认 + 少数例外。
 *
 * 取代设置 › 成员与访问里「在房间中」「之前记住的」两组（只在沉稳模式开时；沉稳关时上游原样）。
 * 数据仍是 policy / levels / remembered，写仍走 people.setTrust / people.forget /
 * session.setClaudeSharing，所以每个圈的实际共享结果不变。列表只按名字排序、固定 36px 行高、
 * 虚拟化；改一行时其他行不挪位。轻反馈是行内文字，重反馈先确认、完成后一条汇总 toast。
 */

const KIND_LABEL: Readonly<Record<Circle['kind'], string>> = { friend: 'Friend', room: 'Room', remembered: 'Remembered' };

/** 固定 36px 行高；列表高度 min(60vh, 行数×36)。 */
const ROW_PX = 36;

const showOptions = (): { value: FilterShow; label: string }[] => [
  { value: 'exceptions', label: t('Exceptions') },
  { value: 'all', label: t('All') },
  ...ALL_LEVELS.map((level) => ({ value: level, label: t(TRUST_INFO[level].label) })),
];

function levelOptions<T extends Level>(levels: readonly T[]): { value: T; label: string; description: string }[] {
  return levels.map((level) => ({ value: level, label: t(TRUST_INFO[level].label), description: t(TRUST_INFO[level].detail) }));
}

export function MySharing() {
  const api = useApi();
  const { client, ui } = useBeluga();

  // 只挑列表用到的几片状态：房间、好友、记住的人、默认策略。
  const policy = useApp((st) => st.policy);
  const levels = useApp((st) => st.levels);
  const remembered = useApp((st) => st.remembered);
  const peers = useApp((st) => st.peers);
  const selfId = useApp((st) => st.selfId);
  const guests = useApp((st) => st.guests);
  const friends = useApp((st) => st.network.friends);
  const netOn = useApp((st) => st.network.enabled);

  const state = useMemo<SharingState>(
    () => ({ policy, levels, remembered, peers, selfId, guests, network: { friends } }),
    [policy, levels, remembered, peers, selfId, guests, friends],
  );
  const realView = useMemo(() => sharingOf(state), [state]);

  // 演示源（只有 DEV + localStorage 数字时）：改它自己的内存，不发 IPC。
  const [demo, setDemo] = useState<SharingView | undefined>(() => {
    const n = demoCount();
    return n === undefined ? undefined : demoView(n);
  });
  const view = demo ?? realView;
  const def = view.def;

  const [q, setQ] = useState('');
  const [show, setShow] = useState<FilterShow>('exceptions');
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [kept, setKept] = useState<ReadonlySet<string>>(() => new Set());
  const [busy, setBusy] = useState<{ done: number; total: number } | undefined>();
  const undo = useRef(new Map<string, Level>());
  const migrated = useRef(false);

  const say = (text: string, level: 'success' | 'error' | 'info' = 'success'): void => {
    client.store.dispatch({ type: 'toast', text, level });
  };

  // 页面打开时迁移：去掉与默认相同的逐人设置，实际结果按构造不变（可重复运行）。
  useEffect(() => {
    if (migrated.current || demo) return;
    migrated.current = true;
    const drop = migrate(state).drop;
    if (!drop.length) return;
    void quietSuccess(async () => {
      for (const id of drop) {
        try {
          await api.people.forget(id);
        } catch {
          // 一个失败不影响其他；下次打开会再试。
        }
      }
    });
    // 只在打开时跑一次：之后的选择由下面的操作负责。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visible = useMemo(() => {
    const base = filterCircles(view, { q, show });
    if (show !== 'exceptions' || kept.size === 0) return base;
    const seen = new Set(base.map((c) => c.id));
    const restored = view.circles.filter((c) => kept.has(c.id) && !seen.has(c.id));
    return [...base, ...restored].sort((a, b) => a.name.localeCompare(b.name, 'zh') || a.id.localeCompare(b.id));
  }, [view, q, show, kept]);

  const exceptions = view.circles.filter((c) => isException(c, def)).length;
  const followers = view.circles.length - exceptions;

  const parent = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: () => parent.current,
    estimateSize: () => ROW_PX,
    overscan: 8,
  });
  const maxList = typeof window === 'undefined' ? 540 : Math.round(window.innerHeight * 0.6);
  const listHeight = Math.min(visible.length * ROW_PX, maxList);

  const toggle = (id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const clearKept = (): void => setKept(new Set());

  const onQuery = (value: string): void => {
    setQ(value);
    clearKept();
  };
  const onShow = (value: FilterShow): void => {
    setShow(value);
    clearKept();
  };

  /** 一个人改级别：轻反馈，行内变，不发 toast（quiet 压掉 daemon 的）。 */
  const changeOne = (c: Circle, level: Level): void => {
    keepScroll();
    if (level === def) {
      restoreOne(c);
      return;
    }
    if (demo) {
      setDemo(demoApply(demo, [c.id], level));
      return;
    }
    void quietSuccess(async () => {
      try {
        await api.people.setTrust(c.id, level);
      } catch (err) {
        say(t(`Couldn't change it: ${errorText(err)}`), 'error');
      }
    });
  };

  /** 回到默认：行原地保留，可撤销，直到改搜索/筛选或离开页面。 */
  const restoreOne = (c: Circle): void => {
    keepScroll();
    if (c.pinned !== undefined) undo.current.set(c.id, c.pinned);
    setKept((prev) => new Set(prev).add(c.id));
    if (demo) {
      setDemo(demoApply(demo, [c.id], 'default'));
      return;
    }
    void quietSuccess(async () => {
      try {
        await api.people.forget(c.id);
      } catch (err) {
        say(t(`Couldn't change it: ${errorText(err)}`), 'error');
      }
    });
  };

  const undoOne = (c: Circle): void => {
    keepScroll();
    const level = undo.current.get(c.id);
    if (level === undefined) return;
    undo.current.delete(c.id);
    setKept((prev) => {
      const next = new Set(prev);
      next.delete(c.id);
      return next;
    });
    if (demo) {
      setDemo(demoApply(demo, [c.id], level));
      return;
    }
    void quietSuccess(async () => {
      try {
        await api.people.setTrust(c.id, level);
      } catch (err) {
        say(t(`Couldn't change it: ${errorText(err)}`), 'error');
      }
    });
  };

  /** 顺序执行（persist 每次读盘，不能并发），进行中写批量条，结束后一条汇总 toast。 */
  const runBatch = async (ids: readonly string[], to: Level | 'default'): Promise<void> => {
    const plan = planBatch(view, ids, to);
    const total = plan.set.length + plan.forget.length;
    if (total === 0) {
      say(t('Nothing to change: they are already set.'), 'info');
      setSelected(new Set());
      return;
    }
    if (demo) {
      setDemo(demoApply(demo, ids, to));
      say(to === 'default' ? t(`${total} circles now follow the default.`) : t(`${total} circles are now ${TRUST_INFO[to].label}.`), 'success');
      setSelected(new Set());
      return;
    }
    setBusy({ done: 0, total });
    const failed: string[] = [];
    let done = 0;
    const nameOf = new Map(view.circles.map((c) => [c.id, c.name]));
    await quietSuccess(async () => {
      for (const [id, level] of plan.set) {
        try {
          await api.people.setTrust(id, level);
        } catch {
          failed.push(nameOf.get(id) ?? id);
        }
        setBusy({ done: ++done, total });
      }
      for (const id of plan.forget) {
        try {
          await api.people.forget(id);
        } catch {
          failed.push(nameOf.get(id) ?? id);
        }
        setBusy({ done: ++done, total });
      }
    });
    setBusy(undefined);
    setSelected(new Set());
    if (failed.length) say(t(`Couldn't change ${failed.length}: ${failed.join(', ')}`), 'error');
    else if (to === 'default') say(t(`${total} circles now follow the default.`), 'success');
    else say(t(`${total} circles are now ${TRUST_INFO[to].label}.`), 'success');
  };

  /** 批量改的入口：≥10 个或回默认先确认，写清后果。 */
  const request = (ids: readonly string[], to: Level | 'default'): void => {
    if (!ids.length) return;
    const plan = planBatch(view, ids, to);
    const total = plan.set.length + plan.forget.length;
    if (total === 0) {
      say(t('Nothing to change: they are already set.'), 'info');
      return;
    }
    if (total >= 10 || to === 'default') {
      openSheet({
        kind: 'confirm',
        title: t(`Change ${total} circles?`),
        message:
          to === 'default'
            ? t(`${total} circles go back to the default (${TRUST_INFO[def].label}).`)
            : t(`${total} circles: ${TRUST_INFO[to].label}. ${TRUST_INFO[to].detail}`),
        confirm: to === 'default' ? t('Restore the Default') : t('Change Them'),
        run: () => void runBatch(ids, to),
      });
      return;
    }
    void runBatch(ids, to);
  };

  /** 改默认：先迁移，再 setClaudeSharing；对所有跟随默认的圈立即生效。 */
  const applyDefault = async (level: DefaultLevel): Promise<void> => {
    if (demo) {
      setDemo(demoDefault(demo, level));
      return;
    }
    await quietSuccess(async () => {
      for (const id of migrate(state).drop) {
        try {
          await api.people.forget(id);
        } catch {
          // 迁移是幂等的：失败的下次打开再试，不挡默认的修改。
        }
      }
      try {
        await api.session.setClaudeSharing(POLICY_OF[level]);
        say(t(`Every circle without its own level is now ${TRUST_INFO[level].label}.`), 'success');
      } catch (err) {
        say(t(`Couldn't change it: ${errorText(err)}`), 'error');
      }
    });
  };

  const requestDefault = (level: DefaultLevel): void => {
    if (level === def) return;
    const following = view.circles.filter((c) => c.pinned === undefined).length;
    openSheet({
      kind: 'confirm',
      title: t(`Use ${TRUST_INFO[level].label} for every circle?`),
      message: t(`The ${following} circles that follow the default change at once. Circles with their own level stay as they are.`),
      confirm: t('Change the Default'),
      run: () => void applyDefault(level),
    });
  };

  const openCard = (c: Circle): void => {
    if (demo || !friends.some((f) => f.peerId === c.id)) return;
    ui.patch({ settings: undefined });
    openFriendCard(client, c.id);
  };

  // 改一个人的级别时，Select 关闭会把焦点还给按钮，浏览器可能顺手把列表（或设置这一栏）滚一下；
  // 这里记住原来的滚动位置，画完再放回去，行不挪、列表也不跳。
  const scrollAt = useRef<readonly (readonly [HTMLElement, number])[] | undefined>(undefined);
  const keepScroll = (): void => {
    if (!parent.current) return;
    const saved: [HTMLElement, number][] = [[parent.current, parent.current.scrollTop]];
    // 设置窗口自己也是滚动容器：焦点回到控件时它可能先把这一行居中。
    let node: HTMLElement | null = parent.current.parentElement;
    while (node) {
      const flow = getComputedStyle(node).overflowY;
      if ((flow === 'auto' || flow === 'scroll') && node.scrollHeight > node.clientHeight) {
        saved.push([node, node.scrollTop]);
        break;
      }
      node = node.parentElement;
    }
    scrollAt.current = saved;
  };
  useLayoutEffect(() => {
    const saved = scrollAt.current;
    scrollAt.current = undefined;
    if (!saved) return;
    const put = (): void => {
      for (const [el, top] of saved) {
        if (el.isConnected && Math.abs(el.scrollTop - top) > 1) el.scrollTop = top;
      }
    };
    put();
    // Popover 关闭后才把焦点还给按钮，那一刻浏览器还会再滚一次。
    requestAnimationFrame(put);
  });

  const selectedIds = [...selected];
  const empty = view.circles.length === 0;
  const searchMissed = !empty && q.trim() !== '' && visible.length === 0;

  return (
    <div className={s.page} data-sharing="">
      <Group title="My sharing">
        <Row
          label="All circles"
          detail={
            <>
              {t('The level for every circle that doesn’t have its own.')} <span className={s.count}>{t(`${followers} following the default · ${exceptions} exceptions`)}</span>
            </>
          }
        >
          <Select<DefaultLevel>
            label={t('Default level')}
            value={def as DefaultLevel}
            options={levelOptions(DEFAULT_LEVELS)}
            onChange={requestDefault}
          />
        </Row>
      </Group>
      <p className={s.note}>{t('“Full trust” can only be given to one circle at a time: it lets their agent work on this Mac without asking.')}</p>

      {empty ? (
        <div className={s.empty}>
          <div className={s.emptyTitle}>{t('No friends or people in the room yet.')}</div>
          {demo ? null : <Button onClick={() => openNet({ kind: 'add_friend' })}>{t('Add a friend')}</Button>}
        </div>
      ) : (
        <>
          <div className={s.tools}>
            <input
              className={s.search}
              type="search"
              aria-label={t('Search circles by name')}
              placeholder={t('Search circles by name')}
              value={q}
              onChange={(e) => onQuery(e.target.value)}
            />
            <Select<FilterShow> label={t('Filter')} value={show} options={showOptions()} onChange={onShow} className={s.filter} />
          </div>
          {!netOn ? <p className={s.hint}>{t('Turn on the Beluga network to see friends here.')}</p> : null}

          <div className={cx(s.batch, selected.size > 0 && s.batchOn)}>
            {busy ? (
              <span className={s.progress}>{t(`Changing ${busy.done}/${busy.total}…`)}</span>
            ) : selected.size > 0 ? (
              <>
                <span className={s.selectedCount}>{t(`${selected.size} selected`)}</span>
                <span className={s.batchActions}>
                  <Select<string>
                    label={t('Set the selected circles to')}
                    value=""
                    placeholder={t('Set to…')}
                    options={[
                      ...ALL_LEVELS.map((level) => ({ value: level as string, label: t(TRUST_INFO[level].label) })),
                      { value: 'default', label: t('Back to the default') },
                    ]}
                    onChange={(value) => {
                      if (!value) return;
                      request(selectedIds, value === 'default' ? 'default' : (value as Level));
                    }}
                    size="small"
                  />
                  <Button size="small" variant="quiet" disabled={Boolean(busy)} onClick={() => request(selectedIds, 'default')}>
                    {t('Restore default')}
                  </Button>
                  <Button size="small" variant="quiet" disabled={Boolean(busy)} onClick={() => setSelected(new Set())}>
                    {t('Clear selection')}
                  </Button>
                </span>
              </>
            ) : (
              <span className={s.batchHint}>{t('Select circles to change them together.')}</span>
            )}
          </div>

          {searchMissed ? (
            <div className={s.empty}>
              <div className={s.emptyTitle}>{t(`No circles named “${q.trim()}”.`)}</div>
              <Button size="small" variant="quiet" onClick={() => onQuery('')}>
                {t('Clear search')}
              </Button>
            </div>
          ) : visible.length === 0 ? (
            <p className={s.quiet}>{t('Every circle follows the default.')}</p>
          ) : (
            <div ref={parent} className={s.list} style={{ height: `${listHeight}px` }} role="list" aria-label={t('Circles')}>
              <div className={s.listInner} style={{ height: `${virtualizer.getTotalSize()}px` }}>
                {virtualizer.getVirtualItems().map((item) => {
                  const c = visible[item.index]!;
                  const friend = friends.some((f) => f.peerId === c.id);
                  const isKept = kept.has(c.id);
                  return (
                    <div
                      key={c.id}
                      className={cx(s.row, isKept && s.rowKept)}
                      style={{ transform: `translateY(${item.start}px)` }}
                      role="listitem"
                      data-circle={c.id}
                      data-kept={isKept ? '' : undefined}
                    >
                      <input
                        type="checkbox"
                        className={s.check}
                        checked={selected.has(c.id)}
                        aria-label={t(`Select ${c.name} (${t(KIND_LABEL[c.kind])})`)}
                        onChange={() => toggle(c.id)}
                      />
                      <Avatar name={c.name} id={c.id} size={20} />
                      <span className={s.nameWrap}>
                        {c.online ? <span className={s.online} aria-hidden="true" /> : null}
                        {friend ? (
                          <button type="button" className={s.nameButton} onClick={() => openCard(c)} title={t('Open their card')}>
                            {c.name}
                          </button>
                        ) : (
                          <span className={s.name}>{c.name}</span>
                        )}
                        <span className={s.kind}>{t(KIND_LABEL[c.kind])}</span>
                      </span>
                      {isKept ? (
                        <span className={s.restored}>
                          {t('Restored to default')} ·{' '}
                          <button type="button" className={s.link} onClick={() => undoOne(c)}>
                            {t('Undo')}
                          </button>
                        </span>
                      ) : (
                        <>
                          {isException(c, def) ? (
                            <button type="button" className={s.link} onClick={() => restoreOne(c)}>
                              {t('Restore default')}
                            </button>
                          ) : null}
                          <Select<Level>
                            label={t(`Trust for ${c.name} (${t(KIND_LABEL[c.kind])})`)}
                            value={effective(c, def)}
                            options={levelOptions(ALL_LEVELS)}
                            onChange={(level) => changeOne(c, level)}
                            size="small"
                            className={s.level}
                          />
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
