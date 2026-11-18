import { useEffect, useState } from 'react';
import { customStatus, parseCustomAddress } from '../../../../src/shared/custom-address.js';
import { cx } from '../components/ui.js';
import { Group, Row } from '../dialogs/settings-controls.js';
import s from '../dialogs/settings.module.css';
import ph from '../phone/phone.module.css';
import { useApp, useBeluga } from '../lib/beluga.js';

/**
 * Settings › Phone › Advanced (BLG-261, fork): the custom address. The phone relay also listens on
 * this computer's address in a mesh network (GNB, ZeroTier, WireGuard, Nebula, Tailscale…), and the
 * phone tries it beside the direct connection and the Cloudflare relay. Hooked in by one line in
 * `phone/Phone.tsx` (docs/fork.md).
 */

export function PhoneAdvanced() {
  const { client } = useBeluga();
  const saved = useApp((st) => st.prefs.customAddress);
  const custom = useApp((st) => st.companion.custom);
  const remote = useApp((st) => st.prefs.tunnel);
  const [value, setValue] = useState(saved ?? '');
  const [problem, setProblem] = useState<string>();
  useEffect(() => setValue(saved ?? ''), [saved]);
  const save = (): void => {
    const text = value.trim();
    if (text === (saved ?? '')) return setProblem(undefined);
    if (text && !parseCustomAddress(text)) return setProblem('Use the form address:port, for example 10.147.17.5:7788.');
    setProblem(undefined);
    void client.api.session.setPrefs({ customAddress: text || null });
  };
  const status = problem ? { text: problem, ok: false } : customStatus(saved, custom, remote);
  return (
    <Group title="Advanced">
      <Row label="Custom address" detail="Enter this computer’s address in a GNB, ZeroTier, WireGuard, Nebula or Tailscale network your phone is in, then a port. The phone tries it beside the direct connection and the relay; whichever connects first is used. Same encryption and the same paired phones. Leave it empty to turn it off.">
        <input aria-label="Custom address" className={s.text} value={value} placeholder="10.147.17.5:7788" spellCheck={false} aria-invalid={problem ? true : undefined} onChange={(e) => setValue(e.target.value)} onBlur={save} onKeyDown={(e) => e.key === 'Enter' && save()} />
      </Row>
      {status ? (
        <Row label="Custom address status" detail={status.text}>
          <span className={cx(ph.relayDot, status.ok && ph.relayOk)} aria-label={status.ok ? 'Listening' : 'Not listening'} />
        </Row>
      ) : null}
    </Group>
  );
}
