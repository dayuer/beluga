/**
 * The custom address of the phone relay (Settings › Phone › Advanced): `host:port` of this computer
 * in a mesh network (GNB, ZeroTier, WireGuard, Nebula, Tailscale…). Browser-safe: the Mac's
 * settings check it as you type, and the relay (companion/reach.ts) reads it again before it listens.
 */
export function parseCustomAddress(text: string | undefined): { host: string; port: number } | undefined {
  const m = /^(\[[0-9a-fA-F:.]+\]|[\w.-]+):(\d{1,5})$/.exec((text ?? '').trim());
  if (!m) return undefined;
  const port = Number(m[2]);
  if (port < 1 || port > 65535) return undefined;
  const host = m[1]!.replace(/^\[|\]$/g, '');
  // 0.0.0.0 or :: would open every network this Mac is on (a café's Wi-Fi too), and no phone can dial it.
  if (UNSPECIFIED.test(host)) return undefined;
  return { host, port };
}

const UNSPECIFIED = /^(0+(\.0+){0,3}|[0:]*::[0:]*|0+(:0+){7})$/;

/** For a settings schema: a `host:port` the relay could listen on (the same check as `parseCustomAddress`). */
export const isCustomAddress = (text: string): boolean => parseCustomAddress(text) !== undefined;

/** What the status line says: whether the relay listens on the address now, and why not. */
export function customStatus(address: string | undefined, custom: { readonly state: 'listening' | 'failed' | 'off'; readonly error?: string } | undefined, remote: string): { readonly text: string; readonly ok: boolean } | undefined {
  if (!address) return undefined;
  if (custom?.state === 'listening') return { text: `Listening on ${address}: phones in that network connect here, end-to-end encrypted.`, ok: true };
  if (custom?.state === 'failed') return { text: `Not listening: ${custom.error ?? 'it could not start'}. It tries again every 30 seconds; if it keeps failing, fix the address or the port.`, ok: false };
  if (remote === 'none') return { text: 'Off: Remote access is set to network only, so this address is not opened.', ok: false };
  return { text: 'Opens as soon as a phone is paired or a pairing is open.', ok: false };
}
