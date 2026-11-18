import { useEffect, useState } from 'react';
import { parseCustomAddress } from '../../../../src/shared/custom-address.js';
import { Group, Row } from '../dialogs/settings-controls.js';
import s from '../dialogs/settings.module.css';
import { useApp, useBeluga } from '../lib/beluga.js';

/**
 * Settings › Phone › Advanced (BLG-261, fork): the custom address. The phone relay also listens on
 * this computer's address in a mesh network (GNB, ZeroTier, WireGuard, Nebula, Tailscale…), and the
 * phone tries it beside the direct connection and the Cloudflare relay. Hooked in by one line in
 * `phone/Phone.tsx` (docs/fork.md).
 */

/** What the status line says: whether the relay listens on the address now, and why not. */
export function customStatus(address: string | undefined, custom: { readonly state: 'listening' | 'failed' | 'off'; readonly error?: string } | undefined, remote: string): { readonly text: string; readonly ok: boolean } | undefined {
  if (!address) return undefined;
  if (custom?.state === 'listening') return { text: `Listening on ${address}: phones in that network connect here, end-to-end encrypted.`, ok: true };
  if (custom?.state === 'failed') return { text: `Not listening: ${custom.error ?? 'it could not start'}. Fix the address or the port, then save again.`, ok: false };
  if (remote === 'none') return { text: 'Off: Remote access is set to network only, so this address is not opened.', ok: false };
  return { text: 'Opens as soon as a phone is paired or a pairing is open.', ok: false };
}

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
          <span aria-label={status.ok ? 'Listening' : 'Not listening'} />
        </Row>
      ) : null}
    </Group>
  );
}
