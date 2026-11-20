import { kv } from './kv';
import type { LocalFileEntrySource, ZipEntrySource } from './package-pick';

/**
 * 上传状态机与进度订阅（SS-121，纯逻辑，不碰网络）：
 * - 持久化会话 ID、文件块表、已收块集合到 `kv`；
 * - 状态流转：`idle -> uploading -> paused -> done | failed`；
 * - 进度：`receivedBytes / totalBytes`，支持订阅；
 * - 缺块计算：结合服务端已收块表算出待传块列表。
 */

export const DEFAULT_CHUNK_SIZE = 5 * 1024 * 1024;
export const UPLOAD_STATE_STORAGE_KEY = 'upload:session:v1';

export type UploadStatus = 'idle' | 'uploading' | 'paused' | 'done' | 'failed';

export interface UploadChunkSpec {
  readonly fileIndex: number;
  readonly partNumber: number;
  readonly offset: number;
  readonly size: number;
}

export type UploadFileSource = ZipEntrySource | LocalFileEntrySource;

export interface UploadFilePlan {
  readonly fileIndex: number;
  readonly path: string;
  readonly size: number;
  readonly sha256?: string;
  readonly source?: UploadFileSource;
  readonly chunks: readonly UploadChunkSpec[];
  readonly receivedParts: readonly number[];
}

export interface UploadSessionRecord {
  readonly sessionId: string;
  readonly projectId: string;
  readonly name: string;
  readonly status: UploadStatus;
  readonly totalBytes: number;
  readonly receivedBytes: number;
  readonly error?: string;
  readonly files: readonly UploadFilePlan[];
  readonly updatedAt: number;
}

export interface UploadProgress {
  readonly sessionId: string | null;
  readonly status: UploadStatus;
  readonly receivedBytes: number;
  readonly totalBytes: number;
  readonly fraction: number;
  readonly completedFiles: number;
  readonly totalFiles: number;
  readonly error?: string;
}

export interface ServerReceivedFile {
  readonly fileIndex: number;
  readonly parts: ReadonlyArray<{ readonly partNumber: number; readonly size?: number }>;
}

export interface UploadKvStorage {
  get<T>(key: string): T | undefined;
  set(key: string, value: unknown): void;
  remove(key: string): void;
}

export interface InitUploadSessionInput {
  readonly sessionId: string;
  readonly projectId: string;
  readonly name: string;
  readonly files: ReadonlyArray<{
    readonly path: string;
    readonly size: number;
    readonly sha256?: string;
    readonly source?: UploadFileSource;
  }>;
  readonly chunkSize?: number;
}

export type UploadProgressListener = (
  progress: UploadProgress,
  state: UploadSessionRecord | null,
) => void;

export function buildFileChunks(
  fileIndex: number,
  fileSize: number,
  chunkSize: number = DEFAULT_CHUNK_SIZE,
): readonly UploadChunkSpec[] {
  if (fileSize <= 0 || chunkSize <= 0) return [];
  const chunks: UploadChunkSpec[] = [];
  let offset = 0;
  let partNumber = 1;
  while (offset < fileSize) {
    const size = Math.min(chunkSize, fileSize - offset);
    chunks.push({ fileIndex, partNumber, offset, size });
    offset += size;
    partNumber += 1;
  }
  return chunks;
}

function sumReceivedBytes(files: readonly UploadFilePlan[]): number {
  let received = 0;
  for (const file of files) {
    const receivedSet = new Set(file.receivedParts);
    for (const chunk of file.chunks) {
      if (receivedSet.has(chunk.partNumber)) {
        received += chunk.size;
      }
    }
  }
  return received;
}

/**
 * 计算还需上传的分块：若提供 `serverFiles`，以服务端已收块表为准过滤；
 * 否则使用本地记录的 `receivedParts`。
 */
export function computeMissingChunks(
  files: readonly UploadFilePlan[],
  serverFiles?: readonly ServerReceivedFile[],
): readonly UploadChunkSpec[] {
  const serverMap = new Map<number, Set<number>>();
  if (serverFiles) {
    for (const sf of serverFiles) {
      serverMap.set(
        sf.fileIndex,
        new Set(sf.parts.map((p) => p.partNumber)),
      );
    }
  }

  const missing: UploadChunkSpec[] = [];
  for (const file of files) {
    const received = serverFiles
      ? (serverMap.get(file.fileIndex) ?? new Set<number>())
      : new Set(file.receivedParts);
    for (const chunk of file.chunks) {
      if (!received.has(chunk.partNumber)) {
        missing.push(chunk);
      }
    }
  }
  return missing;
}

export function computeUploadProgress(record: UploadSessionRecord | null): UploadProgress {
  if (!record) {
    return {
      sessionId: null,
      status: 'idle',
      receivedBytes: 0,
      totalBytes: 0,
      fraction: 0,
      completedFiles: 0,
      totalFiles: 0,
    };
  }

  let completedFiles = 0;
  for (const file of record.files) {
    const receivedSet = new Set(file.receivedParts);
    if (file.chunks.length > 0 && file.chunks.every((c) => receivedSet.has(c.partNumber))) {
      completedFiles += 1;
    }
  }

  const fraction =
    record.totalBytes > 0
      ? Math.min(1, record.receivedBytes / record.totalBytes)
      : record.status === 'done'
        ? 1
        : 0;

  return {
    sessionId: record.sessionId,
    status: record.status,
    receivedBytes: record.receivedBytes,
    totalBytes: record.totalBytes,
    fraction,
    completedFiles,
    totalFiles: record.files.length,
    error: record.error,
  };
}

export interface UploadStateMachine {
  getState(): UploadSessionRecord | null;
  getProgress(): UploadProgress;
  subscribe(listener: UploadProgressListener): () => void;
  initSession(input: InitUploadSessionInput): UploadSessionRecord;
  start(): UploadSessionRecord;
  pause(): UploadSessionRecord;
  resume(): UploadSessionRecord;
  markPartReceived(fileIndex: number, partNumber: number): UploadSessionRecord;
  reconcileServerParts(serverFiles: readonly ServerReceivedFile[]): readonly UploadChunkSpec[];
  complete(): UploadSessionRecord;
  fail(error: string): UploadSessionRecord;
  reset(): void;
}

export function createUploadStateMachine(options?: {
  readonly storage?: UploadKvStorage;
  readonly storageKey?: string;
  readonly now?: () => number;
}): UploadStateMachine {
  const storage = options?.storage ?? kv;
  const storageKey = options?.storageKey ?? UPLOAD_STATE_STORAGE_KEY;
  const now = options?.now ?? (() => Date.now());
  const listeners = new Set<UploadProgressListener>();

  let current: UploadSessionRecord | null = storage.get<UploadSessionRecord>(storageKey) ?? null;

  const notify = () => {
    const progress = computeUploadProgress(current);
    for (const listener of listeners) {
      listener(progress, current);
    }
  };

  const commit = (next: UploadSessionRecord | null): void => {
    current = next;
    if (next) {
      storage.set(storageKey, next);
    } else {
      storage.remove(storageKey);
    }
    notify();
  };

  const requireSession = (): UploadSessionRecord => {
    if (!current) {
      throw new Error('upload-state: no active session');
    }
    return current;
  };

  return {
    getState: () => current,
    getProgress: () => computeUploadProgress(current),
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    initSession(input) {
      const chunkSize = input.chunkSize ?? DEFAULT_CHUNK_SIZE;
      const files: UploadFilePlan[] = input.files.map((f, fileIndex) => ({
        fileIndex,
        path: f.path,
        size: f.size,
        sha256: f.sha256,
        source: f.source,
        chunks: buildFileChunks(fileIndex, f.size, chunkSize),
        receivedParts: [],
      }));
      const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
      const record: UploadSessionRecord = {
        sessionId: input.sessionId,
        projectId: input.projectId,
        name: input.name,
        status: 'idle',
        totalBytes,
        receivedBytes: 0,
        files,
        updatedAt: now(),
      };
      commit(record);
      return record;
    },
    start() {
      const prev = requireSession();
      if (prev.status === 'done') return prev;
      const next: UploadSessionRecord = {
        ...prev,
        status: 'uploading',
        error: undefined,
        updatedAt: now(),
      };
      commit(next);
      return next;
    },
    pause() {
      const prev = requireSession();
      if (prev.status === 'done' || prev.status === 'paused') return prev;
      const next: UploadSessionRecord = {
        ...prev,
        status: 'paused',
        updatedAt: now(),
      };
      commit(next);
      return next;
    },
    resume() {
      const prev = requireSession();
      if (prev.status === 'done') return prev;
      const next: UploadSessionRecord = {
        ...prev,
        status: 'uploading',
        error: undefined,
        updatedAt: now(),
      };
      commit(next);
      return next;
    },
    markPartReceived(fileIndex, partNumber) {
      const prev = requireSession();
      const files = prev.files.map((f) => {
        if (f.fileIndex !== fileIndex) return f;
        if (f.receivedParts.includes(partNumber)) return f;
        return {
          ...f,
          receivedParts: [...f.receivedParts, partNumber].sort((a, b) => a - b),
        };
      });
      const receivedBytes = sumReceivedBytes(files);
      const next: UploadSessionRecord = {
        ...prev,
        files,
        receivedBytes,
        updatedAt: now(),
      };
      commit(next);
      return next;
    },
    reconcileServerParts(serverFiles) {
      const prev = requireSession();
      const serverMap = new Map<number, number[]>();
      for (const sf of serverFiles) {
        serverMap.set(
          sf.fileIndex,
          Array.from(new Set(sf.parts.map((p) => p.partNumber))).sort((a, b) => a - b),
        );
      }
      const files = prev.files.map((f) => ({
        ...f,
        receivedParts: serverMap.get(f.fileIndex) ?? [],
      }));
      const receivedBytes = sumReceivedBytes(files);
      const next: UploadSessionRecord = {
        ...prev,
        files,
        receivedBytes,
        updatedAt: now(),
      };
      commit(next);
      return computeMissingChunks(files, serverFiles);
    },
    complete() {
      const prev = requireSession();
      const next: UploadSessionRecord = {
        ...prev,
        status: 'done',
        error: undefined,
        updatedAt: now(),
      };
      commit(next);
      return next;
    },
    fail(error) {
      const prev = requireSession();
      const next: UploadSessionRecord = {
        ...prev,
        status: 'failed',
        error,
        updatedAt: now(),
      };
      commit(next);
      return next;
    },
    reset() {
      commit(null);
    },
  };
}
