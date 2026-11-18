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
  return { host: m[1]!.replace(/^\[|\]$/g, ''), port };
}
