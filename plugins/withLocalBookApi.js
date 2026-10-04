const { withAndroidManifest, withDangerousMod } = require('expo/config-plugins');
const fs = require('node:fs/promises');
const path = require('node:path');

// CNG owns these generated files. Only the selected loopback/emulator host can use HTTP.
module.exports = config => {
  let host;
  try {
    const url = new URL(process.env.EXPO_PUBLIC_BOOK_API_BASE_URL || '');
    if (url.protocol === 'http:' && ['10.0.2.2', 'localhost', '127.0.0.1'].includes(url.hostname)) host = url.hostname;
  } catch { /* No local backend configured. */ }
  config = withAndroidManifest(config, mod => {
    const app = mod.modResults.manifest.application[0].$;
    if (host) app['android:networkSecurityConfig'] = '@xml/bookmarkit_network_security';
    else if (app['android:networkSecurityConfig'] === '@xml/bookmarkit_network_security') delete app['android:networkSecurityConfig'];
    return mod;
  });
  return withDangerousMod(config, ['android', async mod => {
    if (host) {
      const directory = path.join(mod.modRequest.platformProjectRoot, 'app/src/main/res/xml');
      await fs.mkdir(directory, { recursive: true });
      await fs.writeFile(path.join(directory, 'bookmarkit_network_security.xml'),
        `<?xml version="1.0" encoding="utf-8"?><network-security-config><base-config cleartextTrafficPermitted="false"/><domain-config cleartextTrafficPermitted="true"><domain includeSubdomains="false">${host}</domain></domain-config></network-security-config>`);
    }
    return mod;
  }]);
};
