import type { ConfigContext, ExpoConfig } from 'expo/config';
import { getHubHost } from './lib/links.ts';

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

  const android = {
    ...config.android,
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
