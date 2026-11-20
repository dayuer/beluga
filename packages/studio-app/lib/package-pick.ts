import * as DocumentPicker from 'expo-document-picker';
import { File, FileMode } from 'expo-file-system';
import { StorageAccessFramework, getInfoAsync } from 'expo-file-system/legacy';
import { Platform } from 'react-native';

/**
 * 设计稿包选择与清单解析（SS-84）。
 *
 * - iOS：仅支持通过系统文档选择器选取 `.zip`。
 * - Android：支持选取 `.zip`，也支持通过 StorageAccessFramework（SAF）选取文件夹。
 * - ZIP 清单读取使用纯 JS 解析 Central Directory（EOCD + CDH），只读取文件尾部目录区，
 *   无需将整包（如 86 MB）解压到内存中，且零外部依赖。
 */

export const PACKAGE_LIMITS = {
  maxPackageBytes: 200 * 1024 * 1024,
  maxFileBytes: 25 * 1024 * 1024,
  maxFiles: 500,
} as const;

export const ALLOWED_PACKAGE_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'webp',
  'svg',
  'pdf',
  'json',
  'fig',
  'sketch',
]);

export type PackageSourceKind = 'zip' | 'directory';
export type PackageEntryIssue =
  | 'file-too-large'
  | 'unsupported-type'
  | 'empty-file'
  | 'encrypted-entry'
  | 'unsupported-compression';

export interface ZipEntrySource {
  readonly kind: 'zip';
  readonly zipUri: string;
  readonly compressionMethod: number;
  readonly compressedSize: number;
  readonly localHeaderOffset: number;
  readonly crc32: number;
}

export interface LocalFileEntrySource {
  readonly kind: 'file';
  readonly uri: string;
}

export interface PackageEntry {
  readonly path: string;
  readonly size: number;
  readonly source: ZipEntrySource | LocalFileEntrySource;
  readonly issue?: PackageEntryIssue;
}

export interface PickedPackage {
  readonly kind: PackageSourceKind;
  readonly name: string;
  readonly uri: string;
  readonly entries: readonly PackageEntry[];
  readonly totalBytes: number;
}

export type PickPackageResult =
  | { readonly canceled: true }
  | { readonly canceled: false; readonly pkg: PickedPackage };

export interface ZipDirectoryEntry {
  readonly path: string;
  readonly size: number;
  readonly compressedSize: number;
  readonly compressionMethod: number;
  readonly localHeaderOffset: number;
  readonly crc32: number;
  readonly encrypted: boolean;
}

const EOCD_SIG = 0x06054b50;
const CDH_SIG = 0x02014b50;
const MAX_EOCD_SEARCH = 65535 + 22;

const utf8Decoder = new TextDecoder('utf-8', { fatal: false });

function readUint16LE(buf: Uint8Array, offset: number): number {
  return (buf[offset] ?? 0) | ((buf[offset + 1] ?? 0) << 8);
}

function readUint32LE(buf: Uint8Array, offset: number): number {
  return (
    ((buf[offset] ?? 0) |
      ((buf[offset + 1] ?? 0) << 8) |
      ((buf[offset + 2] ?? 0) << 16) |
      ((buf[offset + 3] ?? 0) << 24)) >>>
    0
  );
}

function normalizeEntryPath(raw: string): string | undefined {
  const normalized = raw.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
  if (!normalized || normalized.endsWith('/')) return undefined;
  const segments = normalized.split('/');
  if (segments.some((s) => s.length === 0 || s === '.' || s === '..')) return undefined;
  if (segments[0] === '__MACOSX') return undefined;
  const last = segments[segments.length - 1] ?? '';
  if (last === '.DS_Store' || last.startsWith('._')) return undefined;
  return segments.join('/');
}

export function classifyEntryIssue(
  path: string,
  size: number,
  meta?: { readonly encrypted?: boolean; readonly compressionMethod?: number },
): PackageEntryIssue | undefined {
  if (meta?.encrypted) return 'encrypted-entry';
  if (
    meta?.compressionMethod !== undefined &&
    meta.compressionMethod !== 0 &&
    meta.compressionMethod !== 8
  ) {
    return 'unsupported-compression';
  }
  if (!Number.isFinite(size) || size <= 0) return 'empty-file';
  if (size > PACKAGE_LIMITS.maxFileBytes) return 'file-too-large';
  const last = path.split('/').pop() ?? '';
  const dot = last.lastIndexOf('.');
  if (dot <= 0) return 'unsupported-type';
  const ext = last.slice(dot + 1).toLowerCase();
  if (!ALLOWED_PACKAGE_EXTENSIONS.has(ext)) return 'unsupported-type';
  return undefined;
}

/**
 * 在 ZIP 尾部缓冲区中定位 EOCD 记录，返回 Central Directory 的偏移和长度。
 */
export function locateZipCentralDirectory(
  tailBytes: Uint8Array,
  tailStartOffset: number,
): { readonly cdOffset: number; readonly cdSize: number; readonly entryCount: number } {
  if (tailBytes.length < 22) {
    throw new Error('invalid-zip: file too small');
  }
  const minPos = Math.max(0, tailBytes.length - MAX_EOCD_SEARCH);
  let eocdPos = -1;
  for (let i = tailBytes.length - 22; i >= minPos; i--) {
    if (readUint32LE(tailBytes, i) === EOCD_SIG) {
      const commentLen = readUint16LE(tailBytes, i + 20);
      if (i + 22 + commentLen === tailBytes.length) {
        eocdPos = i;
        break;
      }
      if (eocdPos === -1) eocdPos = i;
    }
  }
  if (eocdPos === -1) {
    throw new Error('invalid-zip: EOCD not found');
  }
  const entryCount = readUint16LE(tailBytes, eocdPos + 10);
  const cdSize = readUint32LE(tailBytes, eocdPos + 12);
  const cdOffset = readUint32LE(tailBytes, eocdPos + 16);
  if (cdOffset === 0xffffffff || cdSize === 0xffffffff || entryCount === 0xffff) {
    throw new Error('unsupported-zip: ZIP64 not supported');
  }
  if (cdOffset < 0 || cdSize < 0 || cdOffset + cdSize > tailStartOffset + eocdPos) {
    throw new Error('invalid-zip: central directory out of bounds');
  }
  return { cdOffset, cdSize, entryCount };
}

/**
 * 解析 ZIP Central Directory 字节流，返回所有文件条目（已跳过目录与 macOS 元数据）。
 */
export function parseZipCentralDirectory(cdBytes: Uint8Array): readonly ZipDirectoryEntry[] {
  const entries: ZipDirectoryEntry[] = [];
  let pos = 0;

  while (pos + 46 <= cdBytes.length) {
    const sig = readUint32LE(cdBytes, pos);
    if (sig !== CDH_SIG) break;

    const flags = readUint16LE(cdBytes, pos + 8);
    const encrypted = (flags & 0x0001) !== 0;
    const compressionMethod = readUint16LE(cdBytes, pos + 10);
    const crc32 = readUint32LE(cdBytes, pos + 16);
    const compressedSize = readUint32LE(cdBytes, pos + 20);
    const size = readUint32LE(cdBytes, pos + 24);
    const nameLen = readUint16LE(cdBytes, pos + 28);
    const extraLen = readUint16LE(cdBytes, pos + 30);
    const commentLen = readUint16LE(cdBytes, pos + 32);
    const localHeaderOffset = readUint32LE(cdBytes, pos + 42);

    const nameEnd = pos + 46 + nameLen;
    if (nameEnd > cdBytes.length) {
      throw new Error('invalid-zip: truncated central directory entry');
    }

    const rawName = utf8Decoder.decode(cdBytes.subarray(pos + 46, nameEnd));
    const cleanPath = normalizeEntryPath(rawName);
    if (cleanPath) {
      entries.push({
        path: cleanPath,
        size,
        compressedSize,
        compressionMethod,
        localHeaderOffset,
        crc32,
        encrypted,
      });
    }

    pos = nameEnd + extraLen + commentLen;
  }

  return entries;
}

/**
 * 从完整 ZIP 字节缓冲区中解析目录清单（适合测试或小文件）。
 */
export function parseZipBufferManifest(bytes: Uint8Array): readonly ZipDirectoryEntry[] {
  const tailStart = Math.max(0, bytes.length - MAX_EOCD_SEARCH);
  const { cdOffset, cdSize } = locateZipCentralDirectory(bytes.subarray(tailStart), tailStart);
  return parseZipCentralDirectory(bytes.subarray(cdOffset, cdOffset + cdSize));
}

export interface RandomAccessReader {
  readonly size: number;
  readRange(offset: number, length: number): Promise<Uint8Array>;
}

export async function createExpoFileReader(uri: string): Promise<RandomAccessReader> {
  const f = new File(uri);
  const totalSize = f.size ?? 0;

  if (typeof f.open === 'function' && totalSize > 0) {
    return {
      size: totalSize,
      async readRange(offset: number, length: number): Promise<Uint8Array> {
        const handle = f.open(FileMode?.ReadOnly);
        try {
          handle.offset = offset;
          return await handle.readBytes(length);
        } finally {
          handle.close();
        }
      },
    };
  }

  const all = await f.bytes();
  return {
    size: all.byteLength,
    async readRange(offset: number, length: number): Promise<Uint8Array> {
      return all.subarray(offset, offset + length);
    },
  };
}

export async function readZipManifestFromReader(
  reader: RandomAccessReader,
  zipUri: string,
): Promise<readonly PackageEntry[]> {
  const tailLen = Math.min(reader.size, MAX_EOCD_SEARCH);
  const tailOffset = reader.size - tailLen;
  const tailBytes = await reader.readRange(tailOffset, tailLen);
  const { cdOffset, cdSize } = locateZipCentralDirectory(tailBytes, tailOffset);

  const cdBytes =
    cdOffset >= tailOffset && cdOffset + cdSize <= reader.size
      ? tailBytes.subarray(cdOffset - tailOffset, cdOffset - tailOffset + cdSize)
      : await reader.readRange(cdOffset, cdSize);

  const rawEntries = parseZipCentralDirectory(cdBytes);
  return rawEntries.map((item) => ({
    path: item.path,
    size: item.size,
    source: {
      kind: 'zip',
      zipUri,
      compressionMethod: item.compressionMethod,
      compressedSize: item.compressedSize,
      localHeaderOffset: item.localHeaderOffset,
      crc32: item.crc32,
    },
    issue: classifyEntryIssue(item.path, item.size, {
      encrypted: item.encrypted,
      compressionMethod: item.compressionMethod,
    }),
  }));
}

export interface SafDeps {
  readonly requestDirectoryPermissionsAsync: typeof StorageAccessFramework.requestDirectoryPermissionsAsync;
  readonly readDirectoryAsync: typeof StorageAccessFramework.readDirectoryAsync;
  readonly getInfoAsync: typeof getInfoAsync;
}

const defaultSafDeps: SafDeps = {
  requestDirectoryPermissionsAsync: StorageAccessFramework.requestDirectoryPermissionsAsync,
  readDirectoryAsync: StorageAccessFramework.readDirectoryAsync,
  getInfoAsync,
};

function decodeSafEntryName(uri: string, parentUri: string): string {
  const decoded = decodeURIComponent(uri);
  const decodedParent = decodeURIComponent(parentUri);
  let tail = decoded;
  if (decoded.startsWith(decodedParent)) {
    tail = decoded.slice(decodedParent.length);
  }
  const slashIdx = tail.lastIndexOf('/');
  const colonIdx = tail.lastIndexOf(':');
  const cut = Math.max(slashIdx, colonIdx);
  return cut >= 0 ? tail.slice(cut + 1) : tail;
}

function inferFolderName(directoryUri: string): string {
  const decoded = decodeURIComponent(directoryUri).replace(/\/+$/, '');
  const seg = decoded.split(/[/:]/).filter(Boolean).pop();
  return seg || 'design-package';
}

export async function readSafDirectoryManifest(
  rootUri: string,
  deps: Pick<SafDeps, 'readDirectoryAsync' | 'getInfoAsync'> = defaultSafDeps,
): Promise<readonly PackageEntry[]> {
  const entries: PackageEntry[] = [];

  async function walk(dirUri: string, prefix: string): Promise<void> {
    const children = await deps.readDirectoryAsync(dirUri);
    for (const childUri of children) {
      const name = decodeSafEntryName(childUri, dirUri);
      const relPath = prefix ? `${prefix}/${name}` : name;
      const info = await deps.getInfoAsync(childUri);
      if (!info.exists) continue;
      if (info.isDirectory) {
        if (name === '__MACOSX' || name.startsWith('.')) continue;
        await walk(childUri, relPath);
        continue;
      }
      const cleanPath = normalizeEntryPath(relPath);
      if (!cleanPath) continue;
      const size = typeof info.size === 'number' ? info.size : 0;
      entries.push({
        path: cleanPath,
        size,
        source: { kind: 'file', uri: childUri },
        issue: classifyEntryIssue(cleanPath, size),
      });
    }
  }

  await walk(rootUri, '');
  entries.sort((a, b) => a.path.localeCompare(b.path));
  return entries;
}

export interface PickPackageDeps {
  readonly platformOS?: string;
  readonly pickDocument?: typeof DocumentPicker.getDocumentAsync;
  readonly openReader?: (uri: string) => Promise<RandomAccessReader>;
  readonly saf?: SafDeps;
}

/**
 * 选取 `.zip` 设计稿包并读取内部文件清单（iOS / Android 通用）。
 */
export async function pickZipPackage(deps: PickPackageDeps = {}): Promise<PickPackageResult> {
  const pickDocument = deps.pickDocument ?? DocumentPicker.getDocumentAsync;
  const openReader = deps.openReader ?? createExpoFileReader;

  const picked = await pickDocument({
    type: ['application/zip', 'application/x-zip-compressed', 'public.zip-archive'],
    copyToCacheDirectory: true,
    multiple: false,
  });

  if (picked.canceled || !picked.assets || picked.assets.length === 0) {
    return { canceled: true };
  }

  const asset = picked.assets[0]!;
  const reader = await openReader(asset.uri);
  const entries = await readZipManifestFromReader(reader, asset.uri);
  const totalBytes = entries.reduce((sum, item) => sum + item.size, 0);

  return {
    canceled: false,
    pkg: {
      kind: 'zip',
      name: asset.name,
      uri: asset.uri,
      entries,
      totalBytes,
    },
  };
}

/**
 * 通过 Android StorageAccessFramework 选取文件夹并递归读取文件清单。
 */
export async function pickAndroidFolderPackage(deps: PickPackageDeps = {}): Promise<PickPackageResult> {
  const os = deps.platformOS ?? Platform.OS;
  if (os !== 'android') {
    throw new Error('folder-pick-android-only');
  }
  const saf = deps.saf ?? defaultSafDeps;
  const perm = await saf.requestDirectoryPermissionsAsync();
  if (!perm.granted || !perm.directoryUri) {
    return { canceled: true };
  }

  const entries = await readSafDirectoryManifest(perm.directoryUri, saf);
  const totalBytes = entries.reduce((sum, item) => sum + item.size, 0);

  return {
    canceled: false,
    pkg: {
      kind: 'directory',
      name: inferFolderName(perm.directoryUri),
      uri: perm.directoryUri,
      entries,
      totalBytes,
    },
  };
}

/**
 * 统一入口：根据用户选择的模式（或平台默认）选取设计稿包。
 */
export async function pickDesignPackage(
  mode: PackageSourceKind = 'zip',
  deps: PickPackageDeps = {},
): Promise<PickPackageResult> {
  if (mode === 'directory') {
    return pickAndroidFolderPackage(deps);
  }
  return pickZipPackage(deps);
}
