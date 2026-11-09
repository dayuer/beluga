import { useState } from 'react';
import type { GuestCan } from '@beluga/protocol.js';
import { CAN_INFO, DAY_MS, expiresIn } from '@beluga/shared/invites.js';
import { fallbackFor } from '@beluga/shared/runtime-fallbacks.js';
import { useMyAgent } from '../../lib/agent-words.js';
import { CAN_ORDER, type InviteChoice } from '@beluga/ui/invite-menus.js';
import { Icon } from '../../components/Icon.js';
import { BELUGA } from '../../components/beluga-path.js';
import { Avatar, Button, Tip, cx } from '../../components/ui.js';
import { toast, useApi, useApp, useBeluga } from '../../lib/beluga.js';
import { Select } from '../settings-controls.js';
import type { NativeMenuProps } from './index.js';
import { Check, Choice, Field, Section, Sheet, Tag, useFlash } from './parts.js';
import s from './sharing.module.css';
import v from './invite.module.css';
import { thisComputer } from '../../lib/os-words.js';
import { rich } from './pick.js';
import { t, useT, tl } from '../../i18n/index.js';

const sentence = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** What remote access is doing, when there's no link to copy yet. */
function hostingNote(phase: string | undefined, detail: string | undefined): string {
  if (phase === 'failed') return detail ?? t('dialogs.invite.failed');
  if (phase === 'local') return t('dialogs.invite.local');
  if (phase) return t('dialogs.invite.opening');
  return t('dialogs.invite.firstTime');
}

/**
 * Invite someone: where to, what they can do there, how the link behaves, then Copy. The links
 * you made are listed underneath (copy again, or revoke), with anyone waiting at the door.
 * The choices and actions of the shared Invite menu.
 */
export function InviteSheet({ menu, close }: NativeMenuProps<'invite_link'>) {
  const host = useApp((st) => st.self?.host === true);
  if (!host) return <GuestInvite close={close} />;
  return <HostInvite menu={menu} close={close} />;
}

function HostInvite({ menu, close }: NativeMenuProps<'invite_link'>) {
  const t = useT();
  const api = useApi();
  const { client } = useBeluga();
  const projects = useApp((st) => st.projects);
  const links = useApp((st) => st.links);
  const invite = useApp((st) => st.invite);
  const hosting = useApp((st) => st.hosting);
  const [c, setC] = useState<InviteChoice>(() => ({ scope: menu.scope, can: menu.can, knock: menu.knock, singleUse: menu.singleUse, expires: menu.expires, ...(menu.from ? { from: menu.from } : {}) }));
  const [copied, flash] = useFlash();
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<InviteChoice>): void => setC((x) => ({ ...x, ...patch }));
  // Your agent is Codex: guests who prompt it are turned away, so the sheet says so before you share (BLG-461).
  const noGuests = fallbackFor(useMyAgent().runtime, 'guests');
  const invitable = projects.filter((p) => p.root);
  const scopes = [{ value: 'room', label: t('dialogs.invite.everything') }, ...invitable.map((p) => ({ value: p.id, label: p.id === c.from ? t('dialogs.invite.thisProject', { name: p.name }) : p.name }))];
  const fail = (err: unknown): void => toast(client, err instanceof Error ? err.message : String(err), 'error');

  const copy = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      const id = await api.invites.create({ scope: c.scope, can: c.can, knock: c.knock, singleUse: c.singleUse, expiresInMs: c.expires ? DAY_MS : 0 });
      if (id && invite) flash('new');
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };
  const copyAgain = (id: string): void => void api.invites.copyLink(id).then(() => flash(id), fail);
  const copyRoom = (): void => void api.session.copyInvite().then(() => flash('room'), fail);

  return (
    <Sheet
      title={t('dialogs.invite.title')}
      subtitle={t('dialogs.invite.subtitle')}
      icon="link"
      wide
      close={close}
      onReturn={() => void copy()}
      footer={
        <>
          {invite ? (
            <Tip label={t('dialogs.invite.roomTip')}>
              <Button variant="quiet" icon={copied === 'room' ? 'check' : 'copy'} className={cx(copied === 'room' && s.copied)} onClick={copyRoom}>
                {copied === 'room' ? t('dialogs.invite.copied') : t('dialogs.invite.copyRoom')}
              </Button>
            </Tip>
          ) : (
            <span />
          )}
          <Button onClick={close}>{t('dialogs.invite.done')}</Button>
          <Button variant="primary" icon={copied === 'new' ? 'check' : 'link'} disabled={busy} onClick={() => void copy()} aria-keyshortcuts="Enter">
            {copied === 'new' ? t('dialogs.invite.copied') : t('dialogs.invite.copyInvite')}
          </Button>
        </>
      }
    >
      <Field label={t('dialogs.invite.inviteTo')}>
        <Select label={t('dialogs.invite.inviteTo')} value={c.scope} options={scopes} onChange={(scope) => set({ scope })} />
        <span className={s.hint}>{c.scope === 'room' ? t('dialogs.invite.roomHint') : t('dialogs.invite.projectHint')}</span>
      </Field>
      <Field label={t('dialogs.invite.theyCan')}>
        <Choice<GuestCan> label={t('dialogs.invite.theyCan')} value={c.can} options={CAN_ORDER.map((can) => ({ value: can, label: tl('CAN_INFO', can, 'label', CAN_INFO[can].label), icon: can === 'watch' ? 'eye' : can === 'prompt' ? 'chat' : 'pencil' }))} onChange={(can) => set({ can })} />
        <span className={s.hint}>
          {sentence(tl('CAN_INFO', c.can, 'detail', CAN_INFO[c.can].detail))}{t('common.punct.period')}{noGuests && c.can !== 'watch' ? ` ${noGuests}` : ''}
        </span>
      </Field>
      <Field label={t('dialogs.invite.theLink')}>
        <Check checked={c.knock} onChange={(knock) => set({ knock })} label={t('dialogs.invite.knock')} detail={c.knock ? t('dialogs.invite.knockOn') : t('dialogs.invite.knockOff')} />
        <Check checked={c.singleUse} onChange={(singleUse) => set({ singleUse })} label={t('dialogs.invite.single')} detail={c.singleUse ? t('dialogs.invite.singleOn') : t('dialogs.invite.singleOff')} />
        <Check checked={c.expires} onChange={(expires) => set({ expires })} label={t('dialogs.invite.expires')} detail={c.expires ? undefined : t('dialogs.invite.expiresOff')} />
      </Field>
      {!invite ? <div className={v.status}>{hostingNote(hosting?.phase, hosting?.detail)}</div> : null}
      <HowTheyJoin knock={c.knock} />
      <Waiting />
      <Section title={t('dialogs.invite.active')}>
        <div className={s.list} role="list" aria-label={t('dialogs.invite.active')}>
          {links.length ? (
            [...links]
              .sort((a, b) => b.createdAt - a.createdAt)
              .map((l) => (
                <div key={l.id} role="listitem" className={s.item} aria-label={t('dialogs.invite.linkTo', { label: l.label })}>
                  <Icon name="link" size={14} className={s.itemIcon} />
                  <div className={s.itemText}>
                    <span className={s.itemTitle}>
                      {l.label === 'everything' ? t('dialogs.invite.everythingLabel') : l.label} <Tag tone="accent">{tl('CAN_INFO', l.can, 'short', CAN_INFO[l.can].short)}</Tag>
                    </span>
                    <span className={s.itemDetail}>{[sentence(expiresIn(l.expiresAt, Date.now())), l.used ? t('dialogs.invite.usedBy', { name: l.used }) : t('dialogs.invite.notUsed'), l.singleUse ? t('dialogs.invite.onePerson') : t('dialogs.invite.anyone'), l.knock ? t('dialogs.invite.knocksFirst') : t('dialogs.invite.noKnock')].join(' · ')}</span>
                  </div>
                  <div className={s.itemButtons}>
                    <Button size="small" variant="quiet" icon={copied === l.id ? 'check' : 'copy'} className={cx(copied === l.id && s.copied)} onClick={() => copyAgain(l.id)} aria-label={t('dialogs.invite.copyTo', { label: l.label })}>
                      {copied === l.id ? t('dialogs.invite.copied') : t('dialogs.invite.copy')}
                    </Button>
                    <Button size="small" variant="danger" onClick={() => void api.invites.revoke(l.id).catch(fail)} aria-label={t('dialogs.invite.revokeTo', { label: l.label })}>
                      {t('dialogs.invite.revoke')}
                    </Button>
                  </div>
                </div>
              ))
          ) : (
            <div className={s.empty}>{t('dialogs.invite.noLinks')}</div>
          )}
        </div>
      </Section>
    </Sheet>
  );
}

/** The three steps, for you to pass on. */
function HowTheyJoin({ knock }: { knock: boolean }) {
  const t = useT();
  return (
    <ol className={v.steps} aria-label={t('dialogs.invite.how')}>
      <li>
        <span className={v.stepIcon}><Icon name="send" size={13} /></span>
        <span>{rich(t('dialogs.invite.step1'), { strong: <strong>{t('dialogs.invite.step1Strong')}</strong> })}</span>
      </li>
      <li>
        <span className={v.stepIcon}>
          {/* The app's beluga: this step is about the app, not Claude. */}
          <svg width="15" height="12" viewBox="56 147 912 730" aria-hidden="true"><path d={BELUGA} fill="currentColor" fillRule="evenodd" /></svg>
        </span>
        <span>{rich(t('dialogs.invite.step2'), { strong: <strong>{t('dialogs.invite.step2Strong')}</strong> })}</span>
      </li>
      <li>
        <span className={v.stepIcon}><Icon name={knock ? 'hand' : 'check'} size={13} /></span>
        <span>{knock ? rich(t('dialogs.invite.step3Knock'), { strong: <strong>{t('dialogs.invite.step3KnockStrong')}</strong> }) : rich(t('dialogs.invite.step3In', { computer: thisComputer() }), { strong: <strong>{t('dialogs.invite.step3InStrong')}</strong> })}</span>
      </li>
    </ol>
  );
}

/** People at the door with one of your links. */
function Waiting() {
  const t = useT();
  const api = useApi();
  const knocks = useApp((st) => st.knocks);
  const peers = useApp((st) => st.peers);
  const links = useApp((st) => st.links);
  if (!knocks.length) return null;
  return (
    <Section title={t('dialogs.invite.waiting')}>
      <div className={s.list} role="list" aria-label={t('dialogs.invite.waiting')}>
        {knocks.map((k) => {
          const name = peers.find((p) => p.peerId === k.peerId)?.name ?? t('dialogs.invite.someone');
          const link = links.find((l) => l.id === k.linkId);
          return (
            <div key={k.peerId} role="listitem" className={s.item}>
              <Avatar name={name} id={k.peerId} size={24} />
              <div className={s.itemText}>
                <span className={s.itemTitle}>{name}</span>
                <span className={s.itemDetail}>{link ? t('dialogs.invite.wants', { label: link.label, can: tl('CAN_INFO', link.can, 'short', CAN_INFO[link.can].short) }) : t('dialogs.invite.atDoor')}</span>
              </div>
              <div className={s.itemButtons}>
                <Button size="small" variant="quiet" onClick={() => void api.invites.decline(k.peerId)}>
                  {t('dialogs.invite.decline')}
                </Button>
                <Button size="small" variant="primary" onClick={() => void api.invites.letIn(k.peerId)}>
                  {t('dialogs.invite.letIn')}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

/** In someone else's room you can pass on its invite, not make links of your own. */
function GuestInvite({ close }: { close: () => void }) {
  const t = useT();
  const api = useApi();
  const invite = useApp((st) => st.invite);
  const room = useApp((st) => st.room);
  const [copied, flash] = useFlash();
  const copy = (): void => void api.session.copyInvite().then(() => flash('room'));
  return (
    <Sheet
      title={t('dialogs.invite.title')}
      subtitle={t('dialogs.invite.to', { room: String(room) })}
      icon="link"
      close={close}
      onReturn={invite ? copy : undefined}
      footer={
        <>
          <span />
          <Button onClick={close}>{t('dialogs.invite.done')}</Button>
          {invite ? (
            <Button variant="primary" icon={copied ? 'check' : 'copy'} onClick={copy}>
              {copied ? t('dialogs.invite.copied') : t('dialogs.invite.copyRoomInvite')}
            </Button>
          ) : null}
        </>
      }
    >
      <p className={v.lead}>
        {invite
          ? t('dialogs.invite.guestHas')
          : t('dialogs.invite.guestNone')}
      </p>
      {invite ? <HowTheyJoin knock={false} /> : null}
    </Sheet>
  );
}
