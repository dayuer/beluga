import { useState } from 'react';
import type { SharedFork } from '@beluga/core/friend-share-store.js';
import { trustOf } from '@beluga/core/trust.js';
import { formatBytes } from '@beluga/shared/format.js';
import { findWorkspace } from '@beluga/ui/workspace-models.js';
import { Field, FormSheet, TextInput } from '../../components/FormSheet.js';
import { Icon, type IconName } from '../../components/Icon.js';
import { Button, Tip } from '../../components/ui.js';
import { useActions } from '../../lib/actions.js';
import { useApi, useApp } from '../../lib/beluga.js';
import { openSheet } from '../../lib/sheets.js';
import s from './fork-to-mac.module.css';
import m from './menus.module.css';
import { computerTitle, thisComputer } from '../../lib/os-words.js';
import { rich } from './pick.js';
import { useT } from '../../i18n/index.js';

/** The folder and branch name Beluga makes from a name (as the core's `slug` does). */
const slug = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

function Row({ icon, title, detail }: { icon: IconName; title: string; detail: string }) {
  return (
    <li className={s.row}>
      <span className={s.icon}>
        <Icon name={icon} size={13} />
      </span>
      <span>
        <span className={s.title}>{title}</span>
        <span className={s.detail}>{detail}</span>
      </span>
    </li>
  );
}

/**
 * Fork a friend's shared worktree to this Mac (BLG-312): what comes over, what stays behind, a
 * name, then one button. Their worktree goes on as it is; yours is yours.
 */
export function ForkToMacSheet({ owner, wsId, close }: { owner: string; wsId: string; close: () => void }) {
  const t = useT();
  const api = useApi();
  const ws = useApp((st) => st.shared.find((w) => w.id === wsId && w.owner === owner));
  const ownerName = useApp((st) => st.sharedProjects.find((p) => p.owner === owner)?.ownerName ?? st.network.friends.find((f) => f.peerId === owner)?.name ?? t('dialogs.fork.yourFriend'));
  const full = useApp((st) => trustOf(st, owner) === 'full');
  const [name, setName] = useState(ws?.name ?? '');
  if (!ws) return null;
  return (
    <FormSheet
      title={t('dialogs.fork.title', { name: ws.name, computer: computerTitle() })}
      icon="laptop"
      intro={t('dialogs.fork.intro', { owner: ownerName })}
      submitLabel={t('dialogs.fork.fork')}
      canSubmit={Boolean(slug(name))}
      onSubmit={async () => {
        await api.sharing.fork(owner, wsId, name.trim());
        close();
      }}
      onCancel={close}
      width={540}
    >
      <Field label={t('dialogs.fork.comes')}>
        <ul className={s.list}>
          <Row icon="branch" title={t('dialogs.fork.commits')} detail={t('dialogs.fork.commitsDetail')} />
          <Row icon="folder" title={t('dialogs.fork.scratch')} detail={t('dialogs.fork.scratchDetail')} />
          <Row icon="chat" title={t('dialogs.fork.conversation')} detail={t('dialogs.fork.conversationDetail')} />
        </ul>
      </Field>
      <Field label={t('dialogs.fork.stays')}>
        <div className={m.note}>
          <Icon name="eyeOff" size={14} />
          <span>{t('dialogs.fork.staysDetail')}</span>
        </div>
      </Field>
      {full ? null : (
        <div className={m.note}>
          <Icon name="lock" size={14} />
          <span>{t('dialogs.fork.notTrusted', { owner: ownerName })}</span>
        </div>
      )}
      <Field label={t('dialogs.fork.name')} htmlFor="fork-mac-name" hint={slug(name) ? <>{rich(t('dialogs.fork.branch'), { branch: <code>beluga/{slug(name)}</code> })}</> : undefined}>
        <TextInput id="fork-mac-name" value={name} onChange={setName} maxLength={120} spellCheck={false} />
      </Field>
    </FormSheet>
  );
}

/**
 * A fork coming over, in the header: how much of it is here, with a bar that fills, then that it's
 * being set up. Hover for the sizes and how many files are in it.
 */
function ForkProgress({ fork }: { fork: SharedFork }) {
  const t = useT();
  const { total } = fork;
  if (total === undefined) {
    // A Mac on an older Beluga doesn't say how big it is.
    return (
      <Tip label={t('dialogs.fork.comingOver')}>
        <span className={s.progress} role="status">
          <Icon name="laptop" size={14} />
          {t('dialogs.fork.copying')}
        </span>
      </Tip>
    );
  }
  const received = Math.min(fork.received ?? 0, total);
  const here = received >= total;
  const pct = total ? Math.floor((received / total) * 100) : 100;
  const files = fork.files ? t('dialogs.fork.files', { n: fork.files }) : '';
  const tip = here ? t('dialogs.fork.allHere') : t('dialogs.fork.progress', { received: formatBytes(received), total: formatBytes(total), files });
  return (
    <Tip label={tip}>
      <span className={s.progress} role="progressbar" aria-label={here ? t('dialogs.fork.settingUpLabel') : t('dialogs.fork.copyingLabel')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <Icon name="laptop" size={14} />
        {here ? t('dialogs.fork.settingUp') : t('dialogs.fork.copyingPct', { pct })}
        <span className={s.bar} aria-hidden="true">
          <span style={{ width: `${pct}%` }} />
        </span>
      </span>
    </Tip>
  );
}

/**
 * In a friend's worktree you work in (shared over the network), in its header: Fork to My {computerTitle()},
 * how far a fork got (waiting for their Mac, copying), and Open My Fork once it's made.
 */
export function ForkToMacButton({ owner, wsId }: { owner: string; wsId: string }) {
  const t = useT();
  const actions = useActions();
  const ws = useApp((st) => st.shared.find((w) => w.id === wsId && w.owner === owner));
  const fork = useApp((st) => st.forks[wsId]);
  const mine = useApp((st) => (fork?.wsId ? findWorkspace(st.projects, fork.wsId) : undefined));
  const ownerName = useApp((st) => st.network.friends.find((f) => f.peerId === owner)?.name ?? t('dialogs.fork.their'));
  const online = useApp((st) => Boolean(st.network.friends.find((f) => f.peerId === owner)?.online));
  if (!ws || ws.via !== 'mesh' || ws.role !== 'contribute') return null;
  if (fork?.state === 'ready' && mine && !mine.archived) {
    return (
      <Tip label={t('dialogs.fork.yourFork', { branch: mine.branch ?? t('dialogs.fork.ownBranch') })}>
        <Button variant="quiet" icon="laptop" onClick={() => actions.run({ type: 'view', view: { kind: 'workspace', id: mine.id, tab: 'chat' } })}>
          {t('dialogs.fork.openMine')}
        </Button>
      </Tip>
    );
  }
  if (fork?.state === 'copying') return <ForkProgress fork={fork} />;
  if (fork?.state === 'asking') {
    return (
      <Tip label={online ? t('dialogs.fork.packing', { owner: ownerName }) : t('dialogs.fork.whenBack')}>
        <Button variant="quiet" icon="laptop" disabled aria-busy="true">
          {online ? t('dialogs.fork.packingShort') : t('dialogs.fork.waiting', { owner: ownerName })}
        </Button>
      </Tip>
    );
  }
  return (
    <Tip label={fork?.state === 'failed' ? t('dialogs.fork.lastTime', { error: fork.error ?? t('dialogs.fork.didntWork') }) : t('dialogs.fork.ownCopy', { computer: thisComputer() })}>
      <Button variant="quiet" icon="laptop" onClick={() => openSheet({ kind: 'fork_to_mac', owner, wsId })}>
        {t('dialogs.fork.forkToMy', { computer: computerTitle() })}
      </Button>
    </Tip>
  );
}
