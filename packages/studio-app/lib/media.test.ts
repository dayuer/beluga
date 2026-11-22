import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: vi.fn(async () => ({ granted: false })),
  requestMediaLibraryPermissionsAsync: vi.fn(async () => ({ granted: false })),
  launchCameraAsync: vi.fn(),
  launchImageLibraryAsync: vi.fn(),
}));

import { fitLongEdge, pickPhotos, takePhoto } from './media';

describe('lib/media', () => {
  it('scales dimensions so the longest edge is at most 2048', () => {
    expect(fitLongEdge(4096, 2048)).toEqual({ width: 2048, height: 1024 });
    expect(fitLongEdge(1500, 3000)).toEqual({ width: 1024, height: 2048 });
    expect(fitLongEdge(1200, 800)).toEqual({ width: 1200, height: 800 });
    expect(fitLongEdge(0, 100)).toEqual({ width: 0, height: 0 });
  });

  it('returns an in-place explanation when camera or library permission is denied', async () => {
    const cam = await takePhoto('zh');
    expect(cam.ok).toBe(false);
    if (!cam.ok) {
      expect(cam.reason).toBe('denied');
      expect(cam.message).toContain('设置');
    }

    const lib = await pickPhotos('en');
    expect(lib.ok).toBe(false);
    if (!lib.ok) {
      expect(lib.reason).toBe('denied');
      expect(lib.message).toContain('Settings');
    }
  });
});
