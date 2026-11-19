/**
 * Universal Links（AASA）与 App Links（assetlinks.json）校验文件路由（SS-123）。
 * 变量从 Worker env 读取；未配置时返回 404，不返回空壳。
 */

import type { Env } from './hub.js';
import { jsonOf } from './reply.js';

export interface WellKnownEnv extends Partial<Env> {
  readonly APPLE_TEAM_ID?: string;
  readonly APPLE_BUNDLE_ID?: string;
  readonly ANDROID_PACKAGE_NAME?: string;
  readonly ANDROID_SHA256_FINGERPRINTS?: string;
}

const AASA_PATH = '/.well-known/apple-app-site-association';
const ASSETLINKS_PATH = '/.well-known/assetlinks.json';
const APP_HTTPS_PATHS = ['/login', '/join/*', '/request/*', '/me/devices/add'] as const;

function nonEmpty(v: string | undefined): string | undefined {
  const trimmed = v?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

export function handleWellKnownRequest(req: Request, env: WellKnownEnv): Response | undefined {
  const { pathname } = new URL(req.url);
  if (pathname !== AASA_PATH && pathname !== ASSETLINKS_PATH) return undefined;
  if (req.method !== 'GET') return jsonOf({ error: 'method-not-allowed' }, 405);

  if (pathname === AASA_PATH) {
    const teamId = nonEmpty(env.APPLE_TEAM_ID);
    const bundleId = nonEmpty(env.APPLE_BUNDLE_ID);
    if (!teamId || !bundleId) return jsonOf({ error: 'not-found' }, 404);

    return jsonOf(
      {
        applinks: {
          details: [
            {
              appIDs: [`${teamId}.${bundleId}`],
              components: APP_HTTPS_PATHS.map((path) => ({ '/': path })),
            },
          ],
        },
      },
      200,
    );
  }

  const packageName = nonEmpty(env.ANDROID_PACKAGE_NAME);
  const fingerprints = (env.ANDROID_SHA256_FINGERPRINTS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (!packageName || fingerprints.length === 0) {
    return jsonOf({ error: 'not-found' }, 404);
  }

  return jsonOf(
    [
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: packageName,
          sha256_cert_fingerprints: fingerprints,
        },
      },
    ],
    200,
  );
}
