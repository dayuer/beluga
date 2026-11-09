import { useState } from 'react';
import type { WsRole } from '@beluga/protocol.js';
import { Avatar, Button } from '../../components/ui.js';
import { Select } from '../settings-controls.js';
import s from './sharing.module.css';
import { t, useT } from '../../i18n/index.js';

/** A friend you could share with: why not yet, when their Beluga can't take it. */
export interface ShareCandidate {
  readonly peerId: string;
  readonly name: string;
  readonly why?: string;
}

export type Access = WsRole | 'none';

/** What someone you share with can do, as a row's pop-up offers it (removing them too). */
export const ACCESS = (): ReadonlyArray<{ value: Access; label: string }> => [
  { value: 'contribute', label: t('dialogs.share.canWork') },
  { value: 'view', label: t('dialogs.share.canFollow') },
  { value: 'none', label: t('dialogs.share.remove') },
];

const LEVELS = (): ReadonlyArray<{ value: WsRole; label: string; description: string }> => [
  { value: 'contribute', label: t('dialogs.share.canWork'), description: t('dialogs.share.canWorkDetail') },
  { value: 'view', label: t('dialogs.share.canFollow'), description: t('dialogs.share.canFollowDetail') },
];

/**
 * The share sheets' add row (BLG-623): pick one of your friends who doesn't have it yet, pick what
 * they can do, Share. Who already has it is listed under it, each with their level.
 */
export function SharePicker({ candidates, onShare, none }: { readonly candidates: readonly ShareCandidate[]; readonly onShare: (peerId: string, role: WsRole) => void; readonly none: string }) {
  useT(); // shows again when the language changes (ACCESS and LEVELS read it at the call)
  const [who, setWho] = useState('');
  const [role, setRole] = useState<WsRole>('contribute');
  const picked = candidates.find((c) => c.peerId === who);
  if (!candidates.length) return <div className={s.addNone}>{none}</div>;
  const share = (): void => {
    if (!picked || picked.why) return;
    onShare(picked.peerId, role);
    setWho('');
  };
  return (
    <div className={s.addWrap}>
      <div className={s.add}>
        <Select
          label={t('dialogs.share.friend')}
          placeholder={t('dialogs.share.chooseFriend')}
          value={picked ? picked.peerId : ''}
          width="full"
          options={candidates.map((c) => ({ value: c.peerId, label: c.name, icon: <Avatar name={c.name} id={c.peerId} size={16} />, ...(c.why ? { description: t('dialogs.share.newer') } : {}) }))}
          onChange={setWho}
        />
        <Select<WsRole> label={t('dialogs.share.what')} value={role} options={LEVELS()} onChange={setRole} />
        <Button onClick={share} disabled={!picked || Boolean(picked.why)}>
          {t('dialogs.share.share')}
        </Button>
      </div>
      {picked?.why ? <p className={s.addWhy}>{picked.why}</p> : null}
    </div>
  );
}
