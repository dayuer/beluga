// 真机联调（SS-239）：App 用 http://127.0.0.1:8787 连本机中台（USB 上 `adb reverse tcp:8787 tcp:8787`），
// 而 Android 默认只允许 https。这里只为 127.0.0.1 / localhost 放行明文，其它域名仍然 https-only。
// debug 构建保持不变（Metro 走 LAN 明文）。
const fs = require('node:fs');
const path = require('node:path');
const { withAndroidManifest, withDangerousMod } = require('expo/config-plugins');

const XML = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <domain-config cleartextTrafficPermitted="true">
    <domain includeSubdomains="false">127.0.0.1</domain>
    <domain includeSubdomains="false">localhost</domain>
  </domain-config>
</network-security-config>
`;

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
      fs.writeFileSync(path.join(dir, 'studio_network_security.xml'), XML);
      const debug = path.join(c.modRequest.platformProjectRoot, 'app', 'src', 'debug', 'res', 'xml');
      fs.mkdirSync(debug, { recursive: true });
      fs.writeFileSync(path.join(debug, 'studio_network_security.xml'), DEBUG_XML);
      return c;
    },
  ]);
  return withAndroidManifest(config, (c) => {
    const app = c.modResults.manifest.application?.[0];
    if (app) app.$['android:networkSecurityConfig'] = '@xml/studio_network_security';
    return c;
  });
};
