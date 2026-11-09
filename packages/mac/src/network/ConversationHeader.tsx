import type { ReactNode } from 'react';
import { type ActionItem, ActionsDropdown } from '../components/SpecMenu.js';
import { IconButton, Tip, claudeColor } from '../components/ui.js';
import { copyText } from '../lib/copy.js';
import { useApp, useBeluga } from '../lib/beluga.js';
import { type ChatPerson, claudePill } from '@beluga/core/chat-people.js';
import { Icon } from '../components/Icon.js';
import { GroupAvatar, PersonAvatar } from './Avatars.js';
import { useChatPeople } from './use-chat-people.js';
import { MembersButton } from './GroupInfo.js';
import { STATE_LABEL, conversationOf, openGroupInvitation } from './net-model.js';
import { openNet } from './net-sheets.js';
import { useSay } from './use-net.js';
import { channelName } from './chat-model.js';
import { CallButton } from '../call/CallStrip.js';
import s from './network.module.css';
import { useT } from '../i18n/index.js';

export interface HeaderParts {
  readonly title: ReactNode;
  readonly subtitle?: ReactNode;
  readonly right?: ReactNode;
}

/** How many people get a pill before the rest fold into "+3" (the members button lists them all). */
const PILLS = 4;

/** One person in the header (BLG-210): their picture with presence, their name, what their Claude is doing. */
function PersonPill({ p }: { p: ChatPerson }) {
  const t = useT();
  const words = claudePill(p);
  const tip = t(p.me ? 'network.header.yourAgentIs' : 'network.header.theirAgentIs', { who: p.me ? t('network.header.you') : p.name, state: STATE_LABEL[p.presence], what: p.claude === 'working' && p.doing ? t('network.header.isOn', { doing: p.doing }) : words });
  return (
    <Tip label={tip}>
      <span className={s.pill} data-claude={p.claude} aria-label={tip}>
        <PersonAvatar name={p.name} id={p.peerId} state={p.presence} size={18} />
        <span className={s.pillName}>{p.me ? t('network.header.you') : p.name}</span>
        <span className={s.pillState}>
          {p.claude === 'working' || p.claude === 'idle' ? <Icon name="claude" size={11} style={{ color: claudeColor(p.peerId) }} /> : p.claude === 'update' ? <Icon name="alert" size={11} /> : null}
          {words}
        </span>
      </span>
    </Tip>
  );
}

/** Everyone in the conversation as pills, you first. */
function PeoplePills({ id }: { id: string }) {
  const t = useT();
  const { people } = useChatPeople(id);
  if (!people.length) return null;
  const shown = people.slice(0, PILLS);
  return (
    <span className={s.pills} role="list" aria-label={t('network.header.peopleHere')}>
      {shown.map((p) => (
        <span key={p.peerId} role="listitem">
          <PersonPill p={p} />
        </span>
      ))}
      {people.length > PILLS ? <span className={s.pillMore}>+{people.length - PILLS}</span> : null}
    </span>
  );
}

/** The toolbar of a conversation with friends: its name, each person and their Claude as a pill, a ⋯ menu. */
export function useConversationHeader(id: string): HeaderParts {
  const t = useT();
  const { client } = useBeluga();
  const say = useSay();
  const net = useApp((st) => st.network);
  const target = conversationOf(id);
  if (target?.kind === 'dm') {
    const f = net.friends.find((x) => x.peerId === target.peerId);
    if (!f) return { title: t('network.header.conversation') };
    const items: ActionItem[] = [
      { label: t('network.header.newChannelWith', { name: f.name }), icon: 'people', onSelect: () => openNet({ kind: 'new_group', with: [f.peerId] }) },
      { label: t('network.files.copyName'), icon: 'copy', onSelect: () => void copyText(f.name).then(() => say(t('network.files.copiedName', { name: f.name }))) },
      { label: t('network.header.clearChat'), icon: 'x', separate: true, disabled: !net.messages[id]?.length, onSelect: () => openNet({ kind: 'clear_dm', peerId: f.peerId }) },
      { label: t('network.header.remove', { name: f.name }), danger: true, separate: true, onSelect: () => openNet({ kind: 'remove_friend', peerId: f.peerId }) },
    ];
    return {
      title: (
        <span className={s.titleRow} title={f.via === 'relay' && f.online ? t('network.header.relay') : undefined}>
          <Icon name="person" size={15} />
          <span className={s.titleName}>{f.name}</span>
          <PeoplePills id={id} />
        </span>
      ),
      right: (
        <>
          <CallButton id={id} label={f.name} />
          <ActionsDropdown items={items}>
            <IconButton icon="more" label={t('network.header.more', { name: f.name })} />
          </ActionsDropdown>
        </>
      ),
    };
  }
  if (target?.kind === 'group') {
    const g = net.groups.find((x) => x.id === target.groupId);
    if (!g) return { title: t('network.header.channel') };
    const copyLink = async (): Promise<void> => {
      const open = openGroupInvitation(net.invitations, g.id) ?? (await client.api.network['groups.invite'](g.id));
      await copyText(open.link);
      say(t('network.tabs.copiedInvite', { name: g.name }));
    };
    const items: ActionItem[] = g.active
      ? [
          { label: t('network.tabs.channelInfo'), icon: 'people', onSelect: () => openNet({ kind: 'group_info', groupId: g.id }) },
          ...(g.admin
            ? [
                { label: t('network.tabs.addPeople'), icon: 'plus' as const, onSelect: () => openNet({ kind: 'add_people', groupId: g.id }) },
                { label: t('network.tabs.copyInvite'), icon: 'link' as const, onSelect: () => void copyLink().catch(() => undefined) },
              ]
            : []),
          { label: t('network.tabs.leaveChannel'), danger: true, separate: true, onSelect: () => openNet({ kind: 'leave_group', groupId: g.id }) },
        ]
      : [
          { label: t('network.tabs.channelInfo'), icon: 'people', onSelect: () => openNet({ kind: 'group_info', groupId: g.id }) },
          { label: t('network.tabs.deleteChannel'), danger: true, separate: true, onSelect: () => openNet({ kind: 'delete_group', groupId: g.id }) },
        ];
    return {
      title: (
        <span className={s.titleRow}>
          {g.active ? <Icon name="people" size={15} /> : <GroupAvatar name={g.name} id={g.id} size={20} muted />}
          <span className={s.titleName}>{channelName(net, g)}</span>
          {g.active ? <PeoplePills id={id} /> : null}
        </span>
      ),
      ...(g.active ? {} : { subtitle: <span>{t('network.header.noLonger')}</span> }),
      right: (
        <>
          {g.active ? <CallButton id={id} label={`#${g.name}`} /> : null}
          <MembersButton g={g} />
          <ActionsDropdown items={items}>
            <IconButton icon="more" label={t('network.header.more', { name: g.name })} />
          </ActionsDropdown>
        </>
      ),
    };
  }
  return { title: t('network.header.conversation') };
}
