import { useState } from 'react';
import { Button } from '../components/ui.js';
import { useApp, useBeluga } from '../lib/beluga.js';
import { Group, Row, Select, Switch } from '../dialogs/settings-controls.js';
import { openNet } from './net-sheets.js';
import { errorText, quietly, useNetwork } from './use-net.js';
import { upFirst, yourComputer } from '../lib/os-words.js';
import { useT } from '../i18n/index.js';

/** Settings › People & access: talking with friends directly (the Beluga network), on or off. */
export function NetworkSettings() {
  const t = useT();
  const { client, ui } = useBeluga();
  const net = useNetwork();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const turn = async (on: boolean): Promise<void> => {
    setBusy(true);
    setError(undefined);
    try {
      await quietly(client, client.api.network.setEnabled(on));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  const friends = net.friends.length;
  const groups = net.groups.filter((g) => g.active).length;
  const chatClaude = useApp((st) => st.prefs.chatClaude);
  const shareUsage = useApp((st) => st.prefs.shareUsage);
  const readReceipts = useApp((st) => st.prefs.readReceipts);
  return (
    <Group title={t('network.settings.friends')}>
      <Row
        label={t('network.settings.talk')}
        detail={
          error ? (
            <span style={{ color: 'var(--error)' }}>{error}</span>
          ) : busy ? (
            t('network.settings.turningOn')
          ) : net.enabled ? (
            t('network.settings.on', { computer: upFirst(yourComputer()), friends, groups })
          ) : (
            t('network.settings.off')
          )
        }
      >
        <Switch label={t('network.settings.talk')} on={net.enabled || busy} onChange={(v) => void turn(v)} />
      </Row>
      {net.enabled ? (
        <Row label={t('network.settings.addFriend')} detail={t('network.settings.addFriendDetail')}>
          <Button
            onClick={() => {
              ui.patch({ settings: undefined });
              openNet({ kind: 'add_friend' });
            }}
          >
            {t('network.settings.addFriendButton')}
          </Button>
        </Row>
      ) : null}
      {net.enabled ? (
        <Row label={t('network.settings.whoAsks')} detail={t('network.settings.whoAsksDetail')}>
          <Select<'everyone' | 'trusted' | 'off'>
            label={t('network.settings.whoAsks')}
            value={chatClaude}
            options={[
              { value: 'everyone', label: t('network.settings.friendsInChat') },
              { value: 'trusted', label: t('network.settings.peopleITrust') },
              { value: 'off', label: t('network.settings.onlyMe') },
            ]}
            onChange={(v) => void client.api.session.setPrefs({ chatClaude: v })}
          />
        </Row>
      ) : null}
      {net.enabled ? (
        <Row label={t('network.settings.whoSeesUsage')} detail={t('network.settings.usageDetail')}>
          <Select<'trusted' | 'everyone' | 'off'>
            label={t('network.settings.whoSeesUsage')}
            value={shareUsage}
            options={[
              { value: 'trusted', label: t('network.settings.peopleITrust') },
              { value: 'everyone', label: t('network.settings.allFriends') },
              { value: 'off', label: t('network.settings.noOne') },
            ]}
            onChange={(v) => void client.api.session.setPrefs({ shareUsage: v })}
          />
        </Row>
      ) : null}
      {net.enabled ? (
        <Row label={t('network.settings.seen')} detail={t('network.settings.seenDetail')}>
          <Switch label={t('network.settings.seen')} on={readReceipts} onChange={(v) => void client.api.session.setPrefs({ readReceipts: v })} />
        </Row>
      ) : null}
    </Group>
  );
}
