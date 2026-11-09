import { useState } from 'react';
import { findWorkspace } from '@beluga/ui/workspace-models.js';
import { Alert, Checkbox } from '../../components/Alert.js';
import { useApp } from '../../lib/beluga.js';
import type { NativeMenuProps } from './index.js';
import { usePick } from './pick.js';
import { useT } from '../../i18n/index.js';

/** Clear a conversation. The choice the terminal lists (for everyone, a fresh Claude) is a checkbox. */
export function ClearAlert({ menu, close }: NativeMenuProps<'clear'>) {
  const t = useT();
  const pick = usePick(menu);
  const ws = useApp((st) => (menu.channel.startsWith('ws:') ? findWorkspace(st.projects, menu.channel.slice(3)) : undefined));
  const [more, setMore] = useState(false);
  if (menu.channel === 'room') {
    return (
      <Alert
        icon="chat"
        tone="caution"
        title={t('dialogs.clear.roomTitle')}
        message={menu.host ? t('dialogs.clear.roomHost') : t('dialogs.clear.roomGuest')}
        confirm={{ label: t('dialogs.clear.clear'), destructive: true, onClick: () => pick(more ? 'clear-everyone' : 'clear-mine') }}
        onCancel={close}
      >
        {menu.host ? <Checkbox checked={more} onChange={setMore} label={t('dialogs.clear.everyone')} detail={t('dialogs.clear.everyoneDetail')} /> : null}
      </Alert>
    );
  }
  return (
    <Alert
      icon="chat"
      tone="caution"
      title={t('dialogs.clear.title', { name: ws?.name ?? t('dialogs.clear.thisConversation') })}
      message={more ? t('dialogs.clear.fresh') : t('dialogs.clear.remembers')}
      confirm={{ label: t('dialogs.clear.clear'), destructive: true, onClick: () => pick(more ? 'clear-fresh' : 'clear-mine') }}
      onCancel={close}
    >
      {ws ? <Checkbox checked={more} onChange={setMore} label={t('dialogs.clear.startFresh')} detail={t('dialogs.clear.startFreshDetail')} /> : null}
    </Alert>
  );
}
