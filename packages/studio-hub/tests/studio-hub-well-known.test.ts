import { describe, expect, it } from 'vitest';
import { handleWellKnownRequest, type WellKnownEnv } from '../src/well-known.js';

describe('SS-123 well-known verification files', () => {
  it('returns 404 when variables are missing or empty placeholders', () => {
    const emptyEnv: WellKnownEnv = {
      APPLE_TEAM_ID: '',
      APPLE_BUNDLE_ID: '',
      ANDROID_PACKAGE_NAME: '',
      ANDROID_SHA256_FINGERPRINTS: '',
    };

    const aasa = handleWellKnownRequest(
      new Request('https://hub.example/.well-known/apple-app-site-association'),
      emptyEnv,
    );
    expect(aasa?.status).toBe(404);

    const assetlinks = handleWellKnownRequest(
      new Request('https://hub.example/.well-known/assetlinks.json'),
      emptyEnv,
    );
    expect(assetlinks?.status).toBe(404);
  });

  it('serves AASA and assetlinks.json with application/json when configured', async () => {
    const env: WellKnownEnv = {
      APPLE_TEAM_ID: 'TEAM123456',
      APPLE_BUNDLE_ID: 'studio.synon.app',
      ANDROID_PACKAGE_NAME: 'studio.synon.app',
      ANDROID_SHA256_FINGERPRINTS: 'AA:BB:CC:DD, 11:22:33:44',
    };

    const aasa = handleWellKnownRequest(
      new Request('https://hub.example/.well-known/apple-app-site-association'),
      env,
    );
    expect(aasa?.status).toBe(200);
    expect(aasa?.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(await aasa!.json()).toEqual({
      applinks: {
        details: [
          {
            appIDs: ['TEAM123456.studio.synon.app'],
            components: [
              { '/': '/login' },
              { '/': '/join/*' },
              { '/': '/request/*' },
              { '/': '/me/devices/add' },
            ],
          },
        ],
      },
    });

    const assetlinks = handleWellKnownRequest(
      new Request('https://hub.example/.well-known/assetlinks.json'),
      env,
    );
    expect(assetlinks?.status).toBe(200);
    expect(assetlinks?.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(await assetlinks!.json()).toEqual([
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: 'studio.synon.app',
          sha256_cert_fingerprints: ['AA:BB:CC:DD', '11:22:33:44'],
        },
      },
    ]);
  });
});
