import * as Popover from '@radix-ui/react-popover';
import { Avatar, Button, Dot } from '../../components/ui.js';
import { useApi, useApp, useBeluga } from '../../lib/beluga.js';
import { Switch } from '../settings-controls.js';
import { openPerson } from './PersonPopover.js';
import { useFlash } from './parts.js';
import p from './person.module.css';
import r from './room.module.css';
import { t, useT } from '../../i18n/index.js';

type Tone = 'ok' | 'warn' | 'error';

const invite = (): void => void document.dispatchEvent(new CustomEvent('beluga:invite-room'));

/** What remote access is doing, in words. */
function reach(phase: string | undefined, detail: string | undefined, hasLink: boolean): string {
  if (phase === 'ready' || hasLink) return t('dialogs.room.reachReady');
  if (phase === 'local') return t('dialogs.room.reachLocal');
  if (phase === 'failed') return detail ?? t('dialogs.room.reachFailed');
  if (phase) return t('dialogs.room.reachOpening');
  return t('dialogs.room.reachLater');
}

/**
 * The room's status at the bottom of the sidebar ("3 people in kay's room"), as a button: it
 * opens the room's card with who's here, whether new people can join, and its link.
 */
export function RoomStatus({ label, tone }: { label: string; tone: Tone }) {
  const t = useT();
  const api = useApi();
  const { ui } = useBeluga();
  const room = useApp((st) => st.room);
  const peers = useApp((st) => st.peers);
  const selfId = useApp((st) => st.selfId);
  const host = useApp((st) => st.self?.host === true);
  const roomOpen = useApp((st) => st.roomOpen);
  const link = useApp((st) => st.invite);
  const hosting = useApp((st) => st.hosting);
  const status = useApp((st) => st.status);
  const [copied, flash] = useFlash();
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" className={r.status} title={room} aria-label={t('dialogs.room.details', { label })}>
          <Dot tone={tone} />
          <span className={r.statusLabel}>{label}</span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className={`${p.card} ${r.card}`} side="top" align="start" sideOffset={8} collisionPadding={10} aria-label={t('dialogs.room.room')}>
          <div className={r.head}>
            <div className={r.room}>{room}</div>
            <div className={r.line}>
              <Dot tone={tone} />
              {status === 'connected' ? (host ? t('dialogs.room.youHost') : t('dialogs.room.connected')) : status === 'connecting' ? t('dialogs.room.connecting') : t('dialogs.room.offline')}
            </div>
            {host ? <div className={r.dim}>{reach(hosting?.phase, hosting?.detail, Boolean(link))}</div> : null}
          </div>
          <div className={r.people} role="list" aria-label={t('dialogs.room.people')}>
            {peers.map((x, index) => (
              <Popover.Close asChild key={x.peerId}>
                <button
                  type="button"
                  role="listitem"
                  className={r.person}
                  onClick={() => setTimeout(() => openPerson(ui, index, document.querySelector<HTMLElement>(`[data-person-row="${CSS.escape(x.peerId)}"]`)), 0)}
                  title={`${x.name}${x.peerId === selfId ? t('dialogs.room.youSuffix') : ''}`}
                >
                  <Avatar name={x.name} id={x.peerId} size={28} />
                  <span>{x.peerId === selfId ? t('dialogs.room.you') : x.name}</span>
                </button>
              </Popover.Close>
            ))}
          </div>
          {host ? (
            <div className={r.row}>
              <div>
                <div>{t('dialogs.room.canJoin')}</div>
                <div className={r.dim}>{roomOpen ? t('dialogs.room.open') : t('dialogs.room.closed')}</div>
              </div>
              <Switch label={t('dialogs.room.canJoin')} on={roomOpen} onChange={(v) => void api.session.setRoomOpen(v)} />
            </div>
          ) : null}
          <div className={r.buttons}>
            {link ? (
              <Button icon={copied ? 'check' : 'copy'} onClick={() => void api.session.copyInvite().then(() => flash('room'))}>
                {copied ? t('dialogs.room.copied') : t('dialogs.room.copyLink')}
              </Button>
            ) : null}
            <Popover.Close asChild>
              <Button variant="primary" icon="link" onClick={invite}>
                {t('dialogs.room.invite')}
              </Button>
            </Popover.Close>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
