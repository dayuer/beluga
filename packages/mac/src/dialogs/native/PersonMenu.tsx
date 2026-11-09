import * as Context from '@radix-ui/react-context-menu';
import { type ReactNode, useState } from 'react';
import { TRUST_INFO, canRunOn, trustOf } from '@beluga/core/trust.js';
import { defaultAgentOf } from '@beluga/protocol.js';
import { agentName } from '@beluga/shared/agent-label.js';
import { cx } from '../../components/ui.js';
import { befriend, openFriendCard } from '../../network/use-net.js';
import { useActions } from '../../lib/actions.js';
import { useApi, useApp, useBeluga } from '../../lib/beluga.js';
import { Alert, optionIndex } from './parts.js';
import { RunCommandSheet, addressTo } from './PeerSheets.js';
import { presetShareWith } from './ShareFolderSheet.js';
import m from '../../components/SpecMenu.module.css';
import p from './person.module.css';
import { useT, tl } from '../../i18n/index.js';

interface Item {
  readonly label: string;
  readonly run: () => void;
  readonly danger?: boolean;
}

/**
 * Right-click on someone in your room: their trust (said, and changed in their friend card), then
 * what you can do with them. The same actions as their room card.
 */
export function PersonContextMenu({ index, children }: { index: number; children: ReactNode }) {
  const t = useT();
  const [removing, setRemoving] = useState<{ name: string; guest: boolean; run: () => void }>();
  const [running, setRunning] = useState(false);
  const peer = useApp((st) => st.peers[index]);
  return (
    <>
      <Context.Root modal={false}>
        <Context.Trigger asChild>{children}</Context.Trigger>
        <Context.Portal>
          <Context.Content className={m.menu} collisionPadding={8}>
            <Items index={index} onRemove={setRemoving} onRun={() => setRunning(true)} />
          </Context.Content>
        </Context.Portal>
      </Context.Root>
      {running && peer ? <RunCommandSheet peer={peer} close={() => setRunning(false)} /> : null}
      {removing ? (
        <Alert
          title={t('dialogs.personMenu.removeTitle', { name: removing.name })}
          message={removing.guest ? t('dialogs.personMenu.removeGuest') : t('dialogs.personMenu.removePeer', { name: removing.name })}
          confirm={t('dialogs.personMenu.remove')}
          onCancel={() => setRemoving(undefined)}
          onConfirm={() => {
            setRemoving(undefined);
            removing.run();
          }}
        />
      ) : null}
    </>
  );
}

function Items({ index, onRemove, onRun }: { index: number; onRemove: (r: { name: string; guest: boolean; run: () => void }) => void; onRun: () => void }) {
  const t = useT();
  const api = useApi();
  const actions = useActions();
  const { client, ui } = useBeluga();
  const state = useApp((st) => st);
  const peer = state.peers[index];
  if (!peer) return null;
  const menu = { kind: 'person', index } as const;
  const pick = (id: string): void => {
    const i = optionIndex(client.store.getState(), menu, id);
    if (i >= 0) actions.pick(menu, i);
  };
  const me = peer.peerId === state.selfId;
  const guest = state.guests[peer.peerId];
  const grant = state.granted[peer.peerId];
  const items: Item[] = me
    ? [
        { label: t('dialogs.personMenu.askMy', { agent: agentName(defaultAgentOf(peer)) }), run: () => addressTo(ui, actions, state.view, { peerId: peer.peerId, name: peer.name, claude: true, self: true }) },
        { label: t('dialogs.personMenu.shareFolder'), run: () => pick('share-folder') },
        { label: t('dialogs.personMenu.settings'), run: () => ui.patch({ settings: 'general' }) },
      ]
    : [
        { label: t('dialogs.personMenu.message'), run: () => addressTo(ui, actions, state.view, { peerId: peer.peerId, name: peer.name, claude: false }) },
        ...(peer.agent ? [{ label: t('dialogs.personMenu.askTheir', { name: peer.name, agent: agentName(defaultAgentOf(peer)) }), run: () => addressTo(ui, actions, state.view, { peerId: peer.peerId, name: peer.name, claude: true }) }] : []),
        ...(!guest && canRunOn(grant?.level) ? [{ label: t('dialogs.personMenu.runCommand', { name: peer.name }), run: onRun }] : []),
        ...(guest ? [] : [{ label: state.follow === peer.peerId ? t('dialogs.personMenu.stopFollowing', { name: peer.name }) : t('dialogs.personMenu.follow', { name: peer.name }), run: () => pick(state.follow === peer.peerId ? 'unfollow' : 'follow') }]),
        ...(!guest && peer.shares[0] ? [{ label: t('dialogs.personMenu.browse', { name: peer.name }), run: () => pick('browse') }] : []),
        ...(guest ? [] : [{ label: t('dialogs.personMenu.inviteWs'), run: () => pick('person-invite-ws') }]),
        ...(guest ? [] : [{ label: t('dialogs.personMenu.shareWith', { name: peer.name }), run: () => (presetShareWith(peer.peerId), pick('person-share')) }]),
      ];
  const trust = trustOf(state, peer.peerId);
  const friend = state.network.friends.some((f) => f.peerId === peer.peerId);
  const host = state.self?.host === true;
  return (
    <>
      <Context.Item className={m.item} onSelect={() => ui.openMenu(menu)}>
        <span className={m.label}>{me ? t('dialogs.personMenu.myCard') : t('dialogs.personMenu.theirCard', { name: peer.name })}</span>
      </Context.Item>
      <Context.Separator className={m.separator} />
      {!me && !guest ? (
        <>
          {/* Trust is set in one place, their friend card (BLG-202): here it's only said. */}
          <Context.Item className={cx(m.item, p.subTrigger)} disabled>
            <span className={m.label}>{t('dialogs.personMenu.trust')}</span>
            <span className={p.subValue}>{tl('TRUST_INFO', trust, 'label', TRUST_INFO[trust].label)}</span>
          </Context.Item>
          {friend ? (
            <Context.Item className={m.item} onSelect={() => openFriendCard(client, peer.peerId)}>
              <span className={m.label}>{t('dialogs.personMenu.changeInCard')}</span>
            </Context.Item>
          ) : (
            <Context.Item className={m.item} onSelect={() => void befriend(client, peer.peerId, peer.name)}>
              <span className={m.label}>{t('dialogs.personMenu.addFriend')}</span>
              <span className={m.hint}>{t('dialogs.personMenu.trustHint')}</span>
            </Context.Item>
          )}
          <Context.Separator className={m.separator} />
        </>
      ) : null}
      {items.map((it) => (
        <Context.Item key={it.label} className={m.item} onSelect={it.run}>
          <span className={m.label}>{it.label}</span>
        </Context.Item>
      ))}
      {!me && (host || guest) ? (
        <>
          <Context.Separator className={m.separator} />
          <Context.Item className={cx(m.item, m.danger)} onSelect={() => onRemove({ name: peer.name, guest: Boolean(guest), run: () => (guest ? void api.invites.remove(peer.peerId) : pick('person-remove')) })}>
            <span className={m.label}>{t('dialogs.personMenu.removeMore', { name: peer.name })}</span>
          </Context.Item>
        </>
      ) : null}
    </>
  );
}
