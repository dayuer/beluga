import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ConfigContext, ExpoConfig } from 'expo/config';

/** 从 `EXPO_PUBLIC_HUB_URL` 提取中台主机名（内联于此，避免 @expo/config 编译 CJS 时解析不到 ./lib/links）。 */
function getHubHost(hubUrl = process.env.EXPO_PUBLIC_HUB_URL): string | null {
  if (!hubUrl) return null;
  try {
    const parsed = new URL(hubUrl.trim());
    return parsed.hostname ? parsed.host.toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * 动态 Expo 配置（SS-25）：从 `EXPO_PUBLIC_HUB_URL` 派生 iOS `associatedDomains`
 * 与 Android `intentFilters`（`autoVerify`），不在代码里写死中台域名。
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const host = getHubHost(process.env.EXPO_PUBLIC_HUB_URL);

  const ios = {
    ...config.ios,
    ...(host ? { associatedDomains: [`applinks:${host}`] } : {}),
  };

  const googleServicesPath = resolve(__dirname, 'google-services.json');
  const hasGoogleServices = existsSync(googleServicesPath);

  const android = {
    ...config.android,
    ...(hasGoogleServices ? { googleServicesFile: './google-services.json' } : {}),
    ...(host
      ? {
          intentFilters: [
            {
              action: 'VIEW',
              autoVerify: true,
              data: [
                { scheme: 'https', host, pathPrefix: '/join/' },
                { scheme: 'https', host, pathPrefix: '/request/' },
                { scheme: 'https', host, pathPrefix: '/login' },
                { scheme: 'https', host, pathPrefix: '/me/devices/add' },
              ],
              category: ['BROWSABLE', 'DEFAULT'],
            },
          ],
        }
      : {}),
  };

  return {
    ...config,
    name: config.name ?? 'Synon Studio',
    slug: config.slug ?? 'synon-studio',
    ios,
    android,
  };
};
