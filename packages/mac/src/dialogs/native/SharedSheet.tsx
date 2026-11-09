import { useState } from 'react';
import type { SharedTab } from '@beluga/core/store.js';
import { Icon, type IconName } from '../../components/Icon.js';
import { Avatar, Button } from '../../components/ui.js';
import { useActions } from '../../lib/actions.js';
import { useApi, useApp } from '../../lib/beluga.js';
import type { NativeMenuProps } from './index.js';
import { Alert, Section, Sheet, Tag } from './parts.js';
import s from './sharing.module.css';
import v from './shared.module.css';
import { t, useT } from '../../i18n/index.js';

const OPEN = (): ReadonlyArray<{ tab: SharedTab; label: string; icon: IconName; detail: string }> => [
  { tab: 'chat', label: t('dialogs.shared.chat'), icon: 'chat', detail: t('dialogs.shared.chatDetail') },
  { tab: 'files', label: t('dialogs.shared.files'), icon: 'folder', detail: t('dialogs.shared.filesDetail') },
  { tab: 'diff', label: t('dialogs.shared.changes'), icon: 'diff', detail: t('dialogs.shared.changesDetail') },
];

/** A workspace someone shared with you: what you can do there, who's in it, and leaving. */
export function SharedSheet({ menu, close }: NativeMenuProps<'shared'>) {
  const t = useT();
  const api = useApi();
  const actions = useActions();
  const w = useApp((st) => st.shared.find((x) => x.owner === menu.owner && x.id === menu.id));
  const peers = useApp((st) => st.peers);
  const roster = useApp((st) => st.roster[menu.id]) ?? [];
  const selfId = useApp((st) => st.selfId);
  const [leaving, setLeaving] = useState(false);
  if (!w) return null;
  const owner = peers.find((p) => p.peerId === w.owner)?.name ?? t('dialogs.shared.someone');
  const nameOf = (id: string): string => (id === selfId ? t('dialogs.shared.you') : (peers.find((p) => p.peerId === id)?.name ?? t('dialogs.shared.someoneLower')));
  if (leaving) {
    return (
      <Alert
        title={t('dialogs.shared.leaveTitle', { name: w.name })}
        message={t('dialogs.shared.leaveMessage', { owner })}
        confirm={t('dialogs.shared.leave')}
        onCancel={() => setLeaving(false)}
        onConfirm={() => {
          void api.sharing.leave(w.owner, w.id);
          close();
        }}
      />
    );
  }
  const open = (tab: SharedTab): void => {
    close();
    actions.run({ type: 'open_shared', owner: w.owner, id: w.id, tab });
  };
  return (
    <Sheet
      title={t('dialogs.shared.title', { owner, name: w.name })}
      subtitle={`${w.project}${w.branch ? ` · ${w.branch}` : ''}`}
      badge={<Avatar name={owner} id={w.owner} size={36} />}
      close={close}
      footer={
        <>
          <Button variant="danger" onClick={() => setLeaving(true)}>
            {t('dialogs.shared.leaveMore')}
          </Button>
          <Button variant="primary" onClick={close}>
            {t('dialogs.shared.done')}
          </Button>
        </>
      }
    >
      <div className={v.role}>
        <Tag tone={w.role === 'contribute' ? 'claude' : 'muted'}>{w.role === 'contribute' ? t('dialogs.shared.canWork') : t('dialogs.shared.following')}</Tag>
        <span>{w.role === 'contribute' ? t('dialogs.shared.contributeLine', { owner }) : t('dialogs.shared.readOnly')}</span>
      </div>
      <div className={v.tiles}>
        {OPEN().map((o) => (
          <button key={o.tab} type="button" className={v.tile} onClick={() => open(o.tab)}>
            <Icon name={o.icon} size={18} />
            <span className={v.tileLabel}>{o.label}</span>
            <span className={v.tileDetail}>{o.detail}</span>
          </button>
        ))}
      </div>
      <Section title={t('dialogs.shared.inWorkspace')}>
        <div className={s.list} role="list" aria-label={t('dialogs.shared.inWorkspace')}>
          <div role="listitem" className={s.item}>
            <Avatar name={owner} id={w.owner} size={22} />
            <span className={s.itemText}>
              <span className={s.itemTitle}>{owner}</span>
            </span>
            <Tag>{t('dialogs.shared.owner')}</Tag>
          </div>
          {roster
            .filter((r) => r.peerId !== w.owner)
            .map((r) => (
              <div key={r.peerId} role="listitem" className={s.item}>
                <Avatar name={nameOf(r.peerId)} id={r.peerId} size={22} />
                <span className={s.itemText}>
                  <span className={s.itemTitle}>{nameOf(r.peerId)}</span>
                </span>
                <Tag tone="muted">{r.role === 'contribute' ? t('dialogs.shared.works') : t('dialogs.shared.follows')}</Tag>
              </div>
            ))}
        </div>
      </Section>
    </Sheet>
  );
}
