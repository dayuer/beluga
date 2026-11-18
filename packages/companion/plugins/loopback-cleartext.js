// Videos stream from the link worklet's own server on the phone's loopback (http://127.0.0.1,
// src/companion/media-stream.ts). Android blocks plain http by default. The custom address
// (Settings › Phone › Advanced on the Mac: GNB, ZeroTier, WireGuard, Nebula, Tailscale…) is a
// ws:// URL to an address only the user knows, so it can't be listed here: cleartext is allowed
// everywhere. Nothing is lost by it: the app's own calls are https URLs, and what crosses a
// ws:// custom address is the Noise stream (same keys, same firewall), ciphertext only.
const fs = require('node:fs');
const path = require('node:path');
const { withAndroidManifest, withDangerousMod } = require('expo/config-plugins');

const XML = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="true" />
</network-security-config>
`;
// Debug builds talk to Metro over the LAN in plain http (the manifest's usesCleartextTraffic,
// which a network security config replaces): the debug resources keep that.
const DEBUG_XML = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="true" />
</network-security-config>
`;

module.exports = function withLoopbackCleartext(config) {
  config = withDangerousMod(config, [
    'android',
    async (c) => {
      const dir = path.join(c.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res', 'xml');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'beluga_network_security.xml'), XML);
      const debug = path.join(c.modRequest.platformProjectRoot, 'app', 'src', 'debug', 'res', 'xml');
      fs.mkdirSync(debug, { recursive: true });
      fs.writeFileSync(path.join(debug, 'beluga_network_security.xml'), DEBUG_XML);
      return c;
    },
  ]);
  return withAndroidManifest(config, (c) => {
    const app = c.modResults.manifest.application?.[0];
    if (app) app.$['android:networkSecurityConfig'] = '@xml/beluga_network_security';
    return c;
  });
};
