import { describe, expect, it, vi } from 'vitest';

const mockFiles = new Map<string, Uint8Array>();

vi.mock('expo-file-system', () => ({
  FileMode: { ReadOnly: 'r' },
  File: class {
    uri: string;
    constructor(uri: string) {
      this.uri = uri;
    }
    open(mode?: string) {
      expect(mode).toBe('r');
      const data = mockFiles.get(this.uri) ?? new Uint8Array();
      let closed = false;
      return {
        offset: 0,
        async readBytes(length: number) {
          await new Promise((r) => setTimeout(r, 5));
          if (closed) throw new Error('file handle is closed');
          return data.subarray(this.offset, this.offset + length);
        },
        close() {
          closed = true;
        },
      };
    }
  },
  Paths: { document: '' },
}));
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));

import type { PackageEntry } from './package-pick';
import { createExpoChunkReader, createPackageUploader, type ChunkReader } from './upload';
import { createUploadStateMachine, type UploadKvStorage } from './upload-state';

function createMemoryKv(): UploadKvStorage {
  const map = new Map<string, unknown>();
  return {
    get<T>(key: string): T | undefined {
      return map.get(key) as T | undefined;
    },
    set(key: string, value: unknown): void {
      map.set(key, JSON.parse(JSON.stringify(value)));
    },
    remove(key: string): void {
      map.delete(key);
    },
  };
}

function makeFakeEntry(path: string, content: Uint8Array): PackageEntry {
  return {
    path,
    size: content.byteLength,
    source: { kind: 'file', uri: `file:///mock/${path}` },
  };
}

async function waitUntil(pred: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitUntil timeout');
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('upload (chunked transfer & offline/foreground resume)', () => {
  it('pauses on offline and resumes from checkpoint via fake hub without re-uploading received parts', async () => {
    const fileA = new Uint8Array(250).fill(65); // 3 chunks (100, 100, 50)
    const fileB = new Uint8Array(120).fill(66); // 2 chunks (100, 20)
    const entries = [makeFakeEntry('a.png', fileA), makeFakeEntry('b.png', fileB)];
    const contents = new Map<string, Uint8Array>([
      ['a.png', fileA],
      ['b.png', fileB],
    ]);

    const reader: ChunkReader = {
      async readChunk(entry, offset, size) {
        const buf = contents.get(entry.path)!;
        return buf.subarray(offset, offset + size);
      },
      async computeSha256() {
        return 'a'.repeat(64);
      },
    };

    let online = true;
    const onlineListeners = new Set<(v: boolean) => void>();
    const resumeListeners = new Set<() => void>();

    const serverParts = new Map<string, number>();
    const uploadedKeys: string[] = [];
    let completed = false;
    let resumeQueries = 0;
    let shouldDropAtPart2 = true;

    const fakeFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      const method = init?.method ?? 'GET';

      if (url.endsWith('/v1/app/uploads') && method === 'POST') {
        return new Response(JSON.stringify({ sessionId: 'up_fake_1' }), { status: 201 });
      }

      const partMatch = url.match(/\/v1\/app\/uploads\/up_fake_1\/files\/(\d+)\/parts\/(\d+)$/);
      if (partMatch && method === 'PUT') {
        const key = `${partMatch[1]}:${partMatch[2]}`;
        uploadedKeys.push(key);
        // 在第 2 块（file 0 part 2）时模拟一次断网
        if (key === '0:2' && shouldDropAtPart2) {
          shouldDropAtPart2 = false;
          online = false;
          for (const l of onlineListeners) l(false);
          throw new TypeError('Network request failed');
        }
        const bodyBytes = init?.body as Uint8Array;
        serverParts.set(key, bodyBytes.byteLength);
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      if (url.endsWith('/v1/app/uploads/up_fake_1') && method === 'GET') {
        resumeQueries += 1;
        const files = [0, 1].map((fileIndex) => {
          const parts: Array<{ partNumber: number; size: number }> = [];
          for (const [k, size] of serverParts.entries()) {
            const [fi, pn] = k.split(':').map(Number);
            if (fi === fileIndex) parts.push({ partNumber: pn!, size });
          }
          parts.sort((a, b) => a.partNumber - b.partNumber);
          return { fileIndex, parts };
        });
        return new Response(JSON.stringify({ sessionId: 'up_fake_1', status: 'uploading', files }), {
          status: 200,
        });
      }

      if (url.endsWith('/v1/app/uploads/up_fake_1/complete') && method === 'POST') {
        completed = true;
        return new Response(JSON.stringify({ sessionId: 'up_fake_1', status: 'ready' }), { status: 200 });
      }

      return new Response(JSON.stringify({ error: 'not-found' }), { status: 404 });
    });

    const machine = createUploadStateMachine({ storage: createMemoryKv() });
    const uploader = createPackageUploader({
      base: 'https://hub.example.com',
      fetch: fakeFetch as unknown as typeof fetch,
      getToken: () => 'tok_1',
      isOnline: () => online,
      subscribeOnline: (l) => {
        onlineListeners.add(l);
        return () => onlineListeners.delete(l);
      },
      onResume: (l) => {
        resumeListeners.add(l);
        return () => resumeListeners.delete(l);
      },
      stateMachine: machine,
      reader,
      chunkSize: 100,
    });

    const sessionId = await uploader.start({
      projectId: 'proj_1',
      name: 'pack.zip',
      entries,
    });
    expect(sessionId).toBe('up_fake_1');

    // 等待断网触发暂停
    await waitUntil(() => uploader.getProgress().status === 'paused');
    expect(serverParts.has('0:1')).toBe(true);
    expect(serverParts.has('0:2')).toBe(false);

    // 恢复在线，自动查服务端已收块并续传剩余块
    online = true;
    for (const l of onlineListeners) l(true);

    await waitUntil(() => uploader.getProgress().status === 'done');
    expect(completed).toBe(true);
    expect(resumeQueries).toBeGreaterThanOrEqual(1);
    // 0:1 已经收到，续传时绝不重传 0:1
    expect(uploadedKeys.filter((k) => k === '0:1')).toHaveLength(1);
    expect(uploadedKeys).toContain('0:2');
    expect(uploadedKeys).toContain('0:3');
    expect(uploadedKeys).toContain('1:1');
    expect(uploadedKeys).toContain('1:2');

    uploader.dispose();
  });

  it('queries received parts on foreground resume and skips already-received chunks', async () => {
    const fileA = new Uint8Array(200).fill(70); // 2 chunks (100, 100)
    const entries = [makeFakeEntry('screen.png', fileA)];
    const reader: ChunkReader = {
      async readChunk(_entry, offset, size) {
        return fileA.subarray(offset, offset + size);
      },
      async computeSha256() {
        return 'b'.repeat(64);
      },
    };

    const resumeListeners = new Set<() => void>();
    const uploadedParts: number[] = [];
    let resumeQueried = false;

    const fakeFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      const method = init?.method ?? 'GET';

      if (url.endsWith('/v1/app/uploads/up_fg') && method === 'GET') {
        resumeQueried = true;
        // 服务端已收到 part 1
        return new Response(
          JSON.stringify({
            sessionId: 'up_fg',
            status: 'uploading',
            files: [{ fileIndex: 0, parts: [{ partNumber: 1, size: 100 }] }],
          }),
          { status: 200 },
        );
      }

      const partMatch = url.match(/\/v1\/app\/uploads\/up_fg\/files\/0\/parts\/(\d+)$/);
      if (partMatch && method === 'PUT') {
        uploadedParts.push(Number(partMatch[1]));
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      if (url.endsWith('/v1/app/uploads/up_fg/complete') && method === 'POST') {
        return new Response(JSON.stringify({ sessionId: 'up_fg', status: 'ready' }), { status: 200 });
      }

      return new Response('{}', { status: 404 });
    });

    const machine = createUploadStateMachine({ storage: createMemoryKv() });
    machine.initSession({
      sessionId: 'up_fg',
      projectId: 'proj_1',
      name: 'fg.zip',
      chunkSize: 100,
      files: [{ path: 'screen.png', size: 200 }],
    });
    machine.start();
    machine.pause();

    const uploader = createPackageUploader({
      base: 'https://hub.example.com',
      fetch: fakeFetch as unknown as typeof fetch,
      getToken: () => 'tok_2',
      isOnline: () => true,
      subscribeOnline: () => () => {},
      onResume: (l) => {
        resumeListeners.add(l);
        return () => resumeListeners.delete(l);
      },
      stateMachine: machine,
      reader,
      chunkSize: 100,
    });

    // 绑定本地文件引用后，模拟 App 回到前台（触发 onResume）
    uploader.bindEntries(entries);
    for (const l of resumeListeners) l();
    await waitUntil(() => uploader.getProgress().status === 'done');
    expect(resumeQueried).toBe(true);
    // 服务端已收 part 1，只传 part 2
    expect(uploadedParts).toEqual([2]);

    // 再触发一次前台事件，已 done 不再发请求
    resumeQueried = false;
    for (const l of resumeListeners) l();
    expect(resumeQueried).toBe(false);

    uploader.dispose();
  });

  it('awaits handle.readBytes before closing handle for both zip and file entries', async () => {
    // 构造一个带 local file header 的最小 zip buffer
    const payload = new Uint8Array([1, 2, 3, 4, 5, 6]);
    const zip = new Uint8Array(30 + 4 + payload.length);
    const view = new DataView(zip.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(26, 4, true); // nameLen = 4
    zip.set(payload, 34);

    mockFiles.set('file:///mock/pack.zip', zip);
    mockFiles.set('file:///mock/raw.png', payload);

    const reader = createExpoChunkReader();
    const zipChunk = await reader.readChunk(
      {
        path: 'a.png',
        size: 6,
        source: {
          kind: 'zip',
          zipUri: 'file:///mock/pack.zip',
          compressionMethod: 0,
          compressedSize: 6,
          localHeaderOffset: 0,
          crc32: 0,
        },
      },
      2,
      3,
    );
    expect(Array.from(zipChunk)).toEqual([3, 4, 5]);

    const fileChunk = await reader.readChunk(
      {
        path: 'raw.png',
        size: 6,
        source: { kind: 'file', uri: 'file:///mock/raw.png' },
      },
      1,
      4,
    );
    expect(Array.from(fileChunk)).toEqual([2, 3, 4, 5]);
  });
});
