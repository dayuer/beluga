import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-document-picker', () => ({
  getDocumentAsync: vi.fn(),
}));
vi.mock('expo-file-system', () => ({
  File: class {},
}));
vi.mock('expo-file-system/legacy', () => ({
  StorageAccessFramework: {
    requestDirectoryPermissionsAsync: vi.fn(),
    readDirectoryAsync: vi.fn(),
  },
  getInfoAsync: vi.fn(),
}));

import {
  PACKAGE_LIMITS,
  parseZipBufferManifest,
  pickAndroidFolderPackage,
  pickZipPackage,
  type RandomAccessReader,
} from './package-pick';

const encoder = new TextEncoder();

function buildMinimalZip(
  items: ReadonlyArray<{ readonly name: string; readonly size: number; readonly crc?: number }>,
): Uint8Array {
  const localChunks: Uint8Array[] = [];
  const cdChunks: Uint8Array[] = [];
  let offset = 0;

  for (const item of items) {
    const nameBytes = encoder.encode(item.name);
    // Local file header (30 bytes + name) — 数据区留空占位以模拟大文件而不占内存
    const lfh = new Uint8Array(30 + nameBytes.length);
    const lfhView = new DataView(lfh.buffer);
    lfhView.setUint32(0, 0x04034b50, true);
    lfhView.setUint16(4, 20, true);
    lfhView.setUint16(6, 0x0800, true); // UTF-8
    lfhView.setUint16(8, 0, true); // stored
    lfhView.setUint32(14, item.crc ?? 0x12345678, true);
    lfhView.setUint32(18, 4, true); // compressed size in test buffer
    lfhView.setUint32(22, item.size, true); // uncompressed size
    lfhView.setUint16(26, nameBytes.length, true);
    lfh.set(nameBytes, 30);

    const payload = new Uint8Array(4);
    localChunks.push(lfh, payload);

    const cdh = new Uint8Array(46 + nameBytes.length);
    const cdView = new DataView(cdh.buffer);
    cdView.setUint32(0, 0x02014b50, true);
    cdView.setUint16(4, 20, true);
    cdView.setUint16(6, 20, true);
    cdView.setUint16(8, 0x0800, true);
    cdView.setUint16(10, 0, true);
    cdView.setUint32(16, item.crc ?? 0x12345678, true);
    cdView.setUint32(20, 4, true);
    cdView.setUint32(24, item.size, true);
    cdView.setUint16(28, nameBytes.length, true);
    cdView.setUint32(42, offset, true);
    cdh.set(nameBytes, 46);
    cdChunks.push(cdh);

    offset += lfh.length + payload.length;
  }

  const cdOffset = offset;
  const cdSize = cdChunks.reduce((sum, c) => sum + c.length, 0);
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(8, items.length, true);
  eocdView.setUint16(10, items.length, true);
  eocdView.setUint32(12, cdSize, true);
  eocdView.setUint32(16, cdOffset, true);

  const total = offset + cdSize + eocd.length;
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const c of [...localChunks, ...cdChunks, eocd]) {
    out.set(c, cursor);
    cursor += c.length;
  }
  return out;
}

describe('package-pick', () => {
  it('parses zip central directory and flags oversized or unsupported entries', async () => {
    const zipBytes = buildMinimalZip([
      { name: 'screens/', size: 0 },
      { name: '__MACOSX/._home.png', size: 128 },
      { name: 'screens/.DS_Store', size: 64 },
      { name: 'screens/首页.png', size: 2048 },
      { name: 'tokens/colors.json', size: 512 },
      { name: 'assets/huge-video.png', size: PACKAGE_LIMITS.maxFileBytes + 1 },
      { name: 'notes/readme.txt', size: 100 },
    ]);

    const manifest = parseZipBufferManifest(zipBytes);
    expect(manifest.map((e) => e.path)).toEqual([
      'screens/首页.png',
      'tokens/colors.json',
      'assets/huge-video.png',
      'notes/readme.txt',
    ]);

    const reader: RandomAccessReader = {
      size: zipBytes.length,
      async readRange(off, len) {
        return zipBytes.subarray(off, off + len);
      },
    };

    const result = await pickZipPackage({
      pickDocument: async () => ({
        canceled: false,
        assets: [{ uri: 'file:///tmp/design.zip', name: 'design.zip', lastModified: 0 }],
      }),
      openReader: async () => reader,
    });

    expect(result.canceled).toBe(false);
    if (result.canceled) return;
    expect(result.pkg.kind).toBe('zip');
    expect(result.pkg.name).toBe('design.zip');
    expect(result.pkg.entries).toHaveLength(4);
    expect(result.pkg.entries[0]?.issue).toBeUndefined();
    expect(result.pkg.entries[2]?.issue).toBe('file-too-large');
    expect(result.pkg.entries[3]?.issue).toBe('unsupported-type');
  });

  it('lists Android folder recursively via SAF and rejects iOS folder picking', async () => {
    await expect(pickAndroidFolderPackage({ platformOS: 'ios' })).rejects.toThrow('folder-pick-android-only');

    const rootUri = 'content://com.android.externalstorage.documents/tree/primary%3ADesignPack';
    const subDirUri = `${rootUri}/document/primary%3ADesignPack%2Fscreens`;
    const file1Uri = `${rootUri}/document/primary%3ADesignPack%2Ftokens.json`;
    const file2Uri = `${rootUri}/document/primary%3ADesignPack%2Fscreens%2Flogin.png`;

    const result = await pickAndroidFolderPackage({
      platformOS: 'android',
      saf: {
        requestDirectoryPermissionsAsync: async () => ({
          granted: true,
          directoryUri: rootUri,
        }),
        readDirectoryAsync: async (uri) => {
          if (uri === rootUri) return [subDirUri, file1Uri];
          if (uri === subDirUri) return [file2Uri];
          return [];
        },
        getInfoAsync: async (uri) => {
          if (uri === subDirUri) return { exists: true, isDirectory: true, uri, size: 0, modificationTime: 0 };
          if (uri === file1Uri) return { exists: true, isDirectory: false, uri, size: 420, modificationTime: 0 };
          if (uri === file2Uri) return { exists: true, isDirectory: false, uri, size: 8192, modificationTime: 0 };
          return { exists: false, isDirectory: false, uri };
        },
      },
    });

    expect(result.canceled).toBe(false);
    if (result.canceled) return;
    expect(result.pkg.kind).toBe('directory');
    expect(result.pkg.name).toBe('DesignPack');
    expect(result.pkg.totalBytes).toBe(420 + 8192);
    expect(result.pkg.entries.map((e) => ({ path: e.path, size: e.size }))).toEqual([
      { path: 'screens/login.png', size: 8192 },
      { path: 'tokens.json', size: 420 },
    ]);
  });

  it('returns canceled when user cancels picker', async () => {
    const res = await pickZipPackage({
      pickDocument: async () => ({ canceled: true, assets: null }),
    });
    expect(res).toEqual({ canceled: true });
  });
});
