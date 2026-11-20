import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { File, FileMode, Paths } from 'expo-file-system';
import type { PackageEntry } from './package-pick';
import { isOnline, subscribeOnline } from './net';
import { onResume } from './resume';
import { session } from './session';
import {
  DEFAULT_CHUNK_SIZE,
  computeMissingChunks,
  createUploadStateMachine,
  type ServerReceivedFile,
  type UploadChunkSpec,
  type UploadProgress,
  type UploadProgressListener,
  type UploadStateMachine,
} from './upload-state';
import { inflateRawStream } from './zip-inflate';

/**
 * 设计稿包分块上传与断网/回前台续传（SS-86）：
 * - 复用 `upload-state.ts` 的状态机与 `kv` 持久化；
 * - 按 studio-hub `/v1/app/uploads` 会话接口分块读取与上传；
 * - 断网时自动暂停，恢复在线或 App 回到前台时先查询 `GET /v1/app/uploads/:sessionId` 已收块，
 *   再续传缺失分块，绝不重传已收块；
 * - 与 `lib/submit.ts` 完全解耦：确认清单开会话后即可异步上传，需求可先发，设计稿卡订阅进度。
 */

export interface UploadSessionStatusResponse {
  readonly sessionId: string;
  readonly status: 'uploading' | 'ready' | 'failed' | 'expired';
  readonly files: ReadonlyArray<ServerReceivedFile>;
}

export interface ChunkReader {
  readChunk(entry: PackageEntry, offset: number, size: number): Promise<Uint8Array>;
  computeSha256(entry: PackageEntry): Promise<string>;
  prepareEntry?(entry: PackageEntry, key: string): Promise<PackageEntry>;
  exists?(entry: PackageEntry): boolean;
  cleanupTemp?(uris?: readonly string[]): void;
}

export interface UploaderDeps {
  readonly base?: string;
  readonly fetch?: typeof fetch;
  readonly getToken?: () => string | undefined;
  readonly isOnline?: () => boolean;
  readonly subscribeOnline?: (listener: (online: boolean) => void) => () => void;
  readonly onResume?: (listener: () => void) => () => void;
  readonly stateMachine?: UploadStateMachine;
  readonly reader?: ChunkReader;
  readonly chunkSize?: number;
}

export interface StartUploadInput {
  readonly projectId: string;
  readonly name: string;
  readonly entries: readonly PackageEntry[];
}

export interface PackageUploader {
  readonly machine: UploadStateMachine;
  getProgress(): UploadProgress;
  subscribe(listener: UploadProgressListener): () => void;
  start(input: StartUploadInput): Promise<string>;
  pause(): void;
  resume(): Promise<void>;
  dispose(): void;
}

const envBase = (): string => {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return (env?.EXPO_PUBLIC_HUB_URL ?? '').replace(/\/+$/, '');
};

const HASH_CHUNK_BYTES = 512 * 1024;

function sha256Hex(data: Uint8Array): string {
  return bytesToHex(sha256(data));
}

async function resolveZipDataOffset(file: File, localHeaderOffset: number): Promise<number> {
  const handle = file.open(FileMode?.ReadOnly);
  try {
    handle.offset = localHeaderOffset;
    const header = await handle.readBytes(30);
    const nameLen = (header[26] ?? 0) | ((header[27] ?? 0) << 8);
    const extraLen = (header[28] ?? 0) | ((header[29] ?? 0) << 8);
    return localHeaderOffset + 30 + nameLen + extraLen;
  } finally {
    handle.close();
  }
}

export function createExpoChunkReader(): ChunkReader {
  const tempFiles: File[] = [];

  return {
    async prepareEntry(entry, key) {
      if (entry.source.kind !== 'zip') return entry;
      if (entry.source.compressionMethod === 0) return entry;
      if (entry.source.compressionMethod !== 8) {
        throw new Error(`unsupported-zip-compression:${entry.path}`);
      }

      const zipSource = entry.source;
      const zipFile = new File(zipSource.zipUri);
      const dataOffset = await resolveZipDataOffset(zipFile, zipSource.localHeaderOffset);
      const tmpFile = new File(Paths.cache, 'upload-tmp', `${key}.bin`);
      if (!tmpFile.exists) {
        tmpFile.create({ intermediates: true, overwrite: true });
      }
      tempFiles.push(tmpFile);

      const writeHandle = tmpFile.open(FileMode?.ReadWrite);
      let compressedRead = 0;
      const SLICE = 256 * 1024;

      try {
        await inflateRawStream({
          expectedSize: entry.size,
          expectedCrc32: zipSource.crc32,
          pullChunk: async () => {
            if (compressedRead >= zipSource.compressedSize) return null;
            const len = Math.min(SLICE, zipSource.compressedSize - compressedRead);
            const readHandle = zipFile.open(FileMode?.ReadOnly);
            let slice: Uint8Array;
            try {
              readHandle.offset = dataOffset + compressedRead;
              slice = await readHandle.readBytes(len);
            } finally {
              readHandle.close();
            }
            compressedRead += slice.byteLength;
            return slice;
          },
          onOutput: async (chunk) => {
            await writeHandle.writeBytes(chunk);
          },
        });
      } finally {
        writeHandle.close();
      }

      return {
        path: entry.path,
        size: entry.size,
        source: { kind: 'file', uri: tmpFile.uri },
        issue: entry.issue,
      };
    },

    exists(entry) {
      const uri = entry.source.kind === 'zip' ? entry.source.zipUri : entry.source.uri;
      return new File(uri).exists;
    },

    cleanupTemp(uris?: readonly string[]) {
      const targets = new Set<string>(tempFiles.map((f) => f.uri));
      if (uris) {
        for (const u of uris) {
          if (u.includes('upload-tmp')) targets.add(u);
        }
      }
      tempFiles.length = 0;
      for (const uri of targets) {
        try {
          const f = new File(uri);
          if (f.exists) f.delete();
        } catch {
          // 清理临时文件失败不影响主流程
        }
      }
    },

    async readChunk(entry, offset, size) {
      if (entry.source.kind === 'zip') {
        if (entry.source.compressionMethod !== 0) {
          throw new Error(`unsupported-zip-compression:${entry.path}`);
        }
        const f = new File(entry.source.zipUri);
        if (!f.exists) throw new Error(`source-missing:${entry.path}`);
        const dataOffset = await resolveZipDataOffset(f, entry.source.localHeaderOffset);
        const handle = f.open(FileMode?.ReadOnly);
        try {
          handle.offset = dataOffset + offset;
          return await handle.readBytes(size);
        } finally {
          handle.close();
        }
      }

      const f = new File(entry.source.uri);
      if (!f.exists) throw new Error(`source-missing:${entry.path}`);
      const handle = f.open(FileMode?.ReadOnly);
      try {
        handle.offset = offset;
        return await handle.readBytes(size);
      } finally {
        handle.close();
      }
    },

    async computeSha256(entry) {
      const hasher = sha256.create();
      let offset = 0;
      while (offset < entry.size) {
        const len = Math.min(HASH_CHUNK_BYTES, entry.size - offset);
        const chunk = await this.readChunk(entry, offset, len);
        hasher.update(chunk);
        offset += chunk.byteLength;
        if (chunk.byteLength === 0) break;
      }
      return bytesToHex(hasher.digest());
    },
  };
}

export function createPackageUploader(deps: UploaderDeps = {}): PackageUploader {
  const base = (deps.base ?? envBase()).replace(/\/+$/, '');
  const doFetch = deps.fetch ?? fetch;
  const getToken = deps.getToken ?? (() => session.token());
  const checkOnline = deps.isOnline ?? isOnline;
  const watchOnline = deps.subscribeOnline ?? subscribeOnline;
  const watchResume = deps.onResume ?? onResume;
  const machine = deps.stateMachine ?? createUploadStateMachine();
  const reader = deps.reader ?? createExpoChunkReader();
  const chunkSize = deps.chunkSize ?? DEFAULT_CHUNK_SIZE;

  const entryMap = new Map<number, PackageEntry>();
  let activeRunId = 0;
  let runningLoop: Promise<void> | null = null;
  let pausedByOffline = false;

  const restoreEntriesFromState = (): void => {
    const state = machine.getState();
    if (!state) return;
    for (const f of state.files) {
      if (!entryMap.has(f.fileIndex) && f.source) {
        entryMap.set(f.fileIndex, {
          path: f.path,
          size: f.size,
          source: f.source,
        });
      }
    }
  };

  restoreEntriesFromState();

  const cleanupSessionTemp = (): void => {
    const state = machine.getState();
    const uris = state?.files
      .map((f) => (f.source?.kind === 'file' ? f.source.uri : undefined))
      .filter((u): u is string => Boolean(u));
    reader.cleanupTemp?.(uris);
  };

  const authHeaders = (extra?: Record<string, string>): Record<string, string> => {
    const headers: Record<string, string> = { ...(extra ?? {}) };
    const token = getToken();
    if (token) headers.authorization = `Bearer ${token}`;
    return headers;
  };

  const fetchServerStatus = async (sessionId: string): Promise<UploadSessionStatusResponse> => {
    const res = await doFetch(`${base}/v1/app/uploads/${encodeURIComponent(sessionId)}`, {
      method: 'GET',
      headers: authHeaders(),
    });
    if (!res.ok) {
      throw new Error(`hub-upload-resume-failed:${res.status}`);
    }
    return (await res.json()) as UploadSessionStatusResponse;
  };

  const uploadSingleChunk = async (
    sessionId: string,
    chunk: UploadChunkSpec,
    entry: PackageEntry,
  ): Promise<void> => {
    const bytes = await reader.readChunk(entry, chunk.offset, chunk.size);
    const partSha = sha256Hex(bytes);
    const body = new Uint8Array(bytes.byteLength);
    body.set(bytes);

    const res = await doFetch(
      `${base}/v1/app/uploads/${encodeURIComponent(sessionId)}/files/${chunk.fileIndex}/parts/${chunk.partNumber}`,
      {
        method: 'PUT',
        headers: authHeaders({
          'content-type': 'application/octet-stream',
          'x-part-sha256': partSha,
        }),
        body,
      },
    );
    if (!res.ok) {
      throw new Error(`hub-upload-part-failed:${res.status}`);
    }
  };

  const completeSession = async (sessionId: string): Promise<void> => {
    const res = await doFetch(`${base}/v1/app/uploads/${encodeURIComponent(sessionId)}/complete`, {
      method: 'POST',
      headers: authHeaders({ 'content-type': 'application/json' }),
    });
    if (!res.ok) {
      throw new Error(`hub-upload-complete-failed:${res.status}`);
    }
  };

  const runLoop = (chunksToSend: readonly UploadChunkSpec[]): Promise<void> => {
    const runId = ++activeRunId;
    const promise = (async () => {
      const state = machine.getState();
      if (!state) return;

      for (const chunk of chunksToSend) {
        if (runId !== activeRunId) return;
        const latest = machine.getState();
        if (!latest || latest.status !== 'uploading') return;
        if (!checkOnline()) {
          pausedByOffline = true;
          machine.pause();
          return;
        }
        const entry = entryMap.get(chunk.fileIndex);
        if (!entry) {
          machine.fail(`missing-entry:${chunk.fileIndex}`);
          cleanupSessionTemp();
          return;
        }
        if (reader.exists && !reader.exists(entry)) {
          machine.fail(`source-missing:${entry.path}`);
          cleanupSessionTemp();
          return;
        }

        try {
          await uploadSingleChunk(latest.sessionId, chunk, entry);
        } catch (err) {
          if (runId !== activeRunId) return;
          const msg = err instanceof Error ? err.message : 'upload-part-error';
          if (msg.startsWith('source-missing:')) {
            machine.fail(msg);
            cleanupSessionTemp();
            return;
          }
          if (!checkOnline() || err instanceof TypeError) {
            pausedByOffline = true;
            machine.pause();
            return;
          }
          machine.fail(msg);
          return;
        }

        if (runId !== activeRunId) return;
        machine.markPartReceived(chunk.fileIndex, chunk.partNumber);
      }

      if (runId !== activeRunId) return;
      const doneState = machine.getState();
      if (!doneState || doneState.status !== 'uploading') return;

      try {
        await completeSession(doneState.sessionId);
        if (runId !== activeRunId) return;
        machine.complete();
        cleanupSessionTemp();
      } catch (err) {
        if (runId !== activeRunId) return;
        if (!checkOnline() || err instanceof TypeError) {
          pausedByOffline = true;
          machine.pause();
          return;
        }
        machine.fail(err instanceof Error ? err.message : 'upload-complete-error');
        cleanupSessionTemp();
      }
    })();

    runningLoop = promise.finally(() => {
      if (runningLoop === promise) runningLoop = null;
    });
    return runningLoop;
  };

  const resumeFromServer = async (): Promise<void> => {
    restoreEntriesFromState();
    const state = machine.getState();
    if (!state || state.status === 'done') return;
    if (!checkOnline()) {
      pausedByOffline = true;
      if (state.status === 'uploading') machine.pause();
      return;
    }

    // 中止当前正在进行的旧循环，避免并发重传
    activeRunId += 1;
    pausedByOffline = false;

    try {
      const serverStatus = await fetchServerStatus(state.sessionId);
      if (serverStatus.status === 'ready') {
        machine.reconcileServerParts(serverStatus.files);
        machine.complete();
        return;
      }
      if (serverStatus.status === 'expired' || serverStatus.status === 'failed') {
        machine.fail(`session-${serverStatus.status}`);
        return;
      }

      const missing = machine.reconcileServerParts(serverStatus.files);
      machine.resume();
      await runLoop(missing);
    } catch (err) {
      if (!checkOnline() || err instanceof TypeError) {
        pausedByOffline = true;
        machine.pause();
        return;
      }
      machine.fail(err instanceof Error ? err.message : 'resume-error');
    }
  };

  const unsubOnline = watchOnline((online) => {
    const state = machine.getState();
    if (!state || state.status === 'done') return;
    if (!online) {
      if (state.status === 'uploading') {
        activeRunId += 1;
        pausedByOffline = true;
        machine.pause();
      }
      return;
    }
    if (online && (state.status === 'paused' || pausedByOffline)) {
      void resumeFromServer();
    }
  });

  const unsubResume = watchResume(() => {
    const state = machine.getState();
    if (!state || state.status === 'done' || state.status === 'idle') return;
    if (state.status === 'uploading' || state.status === 'paused') {
      void resumeFromServer();
    }
  });

  return {
    machine,
    getProgress: () => machine.getProgress(),
    subscribe: (listener) => machine.subscribe(listener),

    async start(input) {
      entryMap.clear();
      const manifestFiles: Array<{
        path: string;
        size: number;
        sha256: string;
        source: PackageEntry['source'];
      }> = [];
      const batchId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      for (let i = 0; i < input.entries.length; i++) {
        const rawEntry = input.entries[i]!;
        const entry = reader.prepareEntry
          ? await reader.prepareEntry(rawEntry, `${batchId}-${i}`)
          : rawEntry;
        entryMap.set(i, entry);
        const sha256 = await reader.computeSha256(entry);
        manifestFiles.push({
          path: entry.path,
          size: entry.size,
          sha256,
          source: entry.source,
        });
      }

      const res = await doFetch(`${base}/v1/app/uploads`, {
        method: 'POST',
        headers: authHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({
          projectId: input.projectId,
          name: input.name,
          files: manifestFiles.map(({ path, size, sha256 }) => ({ path, size, sha256 })),
        }),
      });
      if (!res.ok) {
        throw new Error(`hub-upload-begin-failed:${res.status}`);
      }
      const created = (await res.json()) as { readonly sessionId: string };

      const record = machine.initSession({
        sessionId: created.sessionId,
        projectId: input.projectId,
        name: input.name,
        files: manifestFiles,
        chunkSize,
      });
      machine.start();
      const initialMissing = computeMissingChunks(record.files);
      // 异步启动传输，不阻塞调用方继续发需求
      void runLoop(initialMissing);
      return created.sessionId;
    },

    pause() {
      activeRunId += 1;
      pausedByOffline = false;
      machine.pause();
    },

    resume: resumeFromServer,

    dispose() {
      activeRunId += 1;
      unsubOnline();
      unsubResume();
    },
  };
}
