import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../../../src/net/studio/store.js';
import { D1HubStore } from '../src/d1.js';
import {
  handleUploadRequest,
  pruneExpiredUploadSessions,
  UPLOAD_LIMITS,
  type UploadEnv,
} from '../src/upload.js';

function createMockR2() {
  const uploads = new Map<string, { key: string; parts: Map<number, { etag: string; data: Uint8Array }> }>();
  const objects = new Map<string, Uint8Array>();
  let seq = 0;

  const bucket = {
    async createMultipartUpload(key: string) {
      const uploadId = `up-${++seq}`;
      uploads.set(uploadId, { key, parts: new Map() });
      return bucket.resumeMultipartUpload(key, uploadId);
    },
    resumeMultipartUpload(key: string, uploadId: string) {
      return {
        key,
        uploadId,
        async uploadPart(partNumber: number, value: ArrayBuffer | ArrayBufferView) {
          const entry = uploads.get(uploadId);
          if (!entry) throw new Error('upload-not-found');
          const bytes =
            value instanceof ArrayBuffer
              ? new Uint8Array(value.slice(0))
              : new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
          const etag = `etag-${partNumber}-${bytes.byteLength}`;
          entry.parts.set(partNumber, { etag, data: bytes });
          return { partNumber, etag };
        },
        async complete(parts: Array<{ partNumber: number; etag: string }>) {
          const entry = uploads.get(uploadId);
          if (!entry) throw new Error('upload-not-found');
          const sorted = [...parts].sort((a, b) => a.partNumber - b.partNumber);
          const chunks: Uint8Array[] = [];
          let total = 0;
          for (const p of sorted) {
            const saved = entry.parts.get(p.partNumber);
            if (!saved || saved.etag !== p.etag) throw new Error('part-mismatch');
            chunks.push(saved.data);
            total += saved.data.byteLength;
          }
          const merged = new Uint8Array(total);
          let offset = 0;
          for (const c of chunks) {
            merged.set(c, offset);
            offset += c.byteLength;
          }
          objects.set(key, merged);
          uploads.delete(uploadId);
          return { key, size: total };
        },
        async abort() {
          uploads.delete(uploadId);
        },
      };
    },
    async get(key: string) {
      const data = objects.get(key);
      if (!data) return null;
      return {
        key,
        size: data.byteLength,
        async arrayBuffer() {
          return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
        },
      };
    },
    async delete(keys: string | string[]) {
      const list = Array.isArray(keys) ? keys : [keys];
      for (const k of list) objects.delete(k);
    },
  };

  return { bucket: bucket as unknown as R2Bucket, objects, uploads };
}

function createUploadMockDb(seed: {
  customerId: string;
  projectId: string;
  sessionHash: string;
  now: number;
}) {
  const sessions = new Map<string, Record<string, unknown>>();
  const files = new Map<string, Record<string, unknown>>();
  const parts = new Map<string, Record<string, unknown>>();

  const db = {
    prepare(sql: string) {
      let args: unknown[] = [];
      const stmt = {
        bind(...values: unknown[]) {
          args = values;
          return stmt;
        },
        async first<T>() {
          if (sql.includes('FROM sessions')) {
            return (args[0] === seed.sessionHash
              ? {
                  token_hash: seed.sessionHash,
                  customer_id: seed.customerId,
                  created_at: seed.now - 1000,
                  expires_at: seed.now + 30 * 24 * 60 * 60 * 1000,
                  revoked_at: null,
                }
              : null) as T | null;
          }
          if (sql.includes('FROM customers')) {
            return (args[0] === seed.customerId
              ? { id: seed.customerId, email: 'c@example.com', name: 'C', status: 'active', created_at: seed.now }
              : null) as T | null;
          }
          if (sql.includes('FROM members WHERE project_id = ? AND customer_id = ?')) {
            return (args[0] === seed.projectId && args[1] === seed.customerId
              ? { project_id: seed.projectId, customer_id: seed.customerId, added_at: seed.now }
              : null) as T | null;
          }
          if (sql.includes('FROM upload_sessions WHERE id = ?')) {
            return (sessions.get(String(args[0])) ?? null) as T | null;
          }
          if (sql.includes('FROM upload_files WHERE session_id = ? AND file_index = ?')) {
            return (files.get(`${args[0]}:${args[1]}`) ?? null) as T | null;
          }
          return null;
        },
        async all<T>() {
          if (sql.includes("FROM upload_sessions WHERE status = 'uploading' AND expires_at <= ?")) {
            const cutoff = Number(args[0]);
            const rows = [...sessions.values()].filter(
              (s) => s.status === 'uploading' && Number(s.expires_at) <= cutoff,
            );
            return { results: rows as T[] };
          }
          if (sql.includes('FROM upload_files WHERE session_id = ?')) {
            const sid = String(args[0]);
            const rows = [...files.values()]
              .filter((f) => f.session_id === sid)
              .sort((a, b) => Number(a.file_index) - Number(b.file_index));
            return { results: rows as T[] };
          }
          if (sql.includes('FROM upload_parts WHERE session_id = ?')) {
            const sid = String(args[0]);
            const rows = [...parts.values()]
              .filter((p) => p.session_id === sid)
              .sort(
                (a, b) =>
                  Number(a.file_index) - Number(b.file_index) || Number(a.part_number) - Number(b.part_number),
              );
            return { results: rows as T[] };
          }
          return { results: [] as T[] };
        },
        async run() {
          if (sql.includes('INSERT INTO upload_sessions')) {
            const [id, customer_id, project_id, name, total_files, total_bytes, created_at, expires_at, updated_at] =
              args as [string, string, string, string, number, number, number, number, number];
            sessions.set(id, {
              id,
              customer_id,
              project_id,
              name,
              total_files,
              total_bytes,
              status: 'uploading',
              created_at,
              expires_at,
              updated_at,
            });
            return { meta: { changes: 1 } };
          }
          if (sql.includes('INSERT INTO upload_files')) {
            const [session_id, file_index, path, size, sha256, r2_key, r2_upload_id] = args as [
              string,
              number,
              string,
              number,
              string,
              string,
              string,
            ];
            files.set(`${session_id}:${file_index}`, {
              session_id,
              file_index,
              path,
              size,
              sha256,
              r2_key,
              r2_upload_id,
            });
            return { meta: { changes: 1 } };
          }
          if (sql.includes('INSERT INTO upload_parts')) {
            const [session_id, file_index, part_number, etag, size, sha256, created_at] = args as [
              string,
              number,
              number,
              string,
              number,
              string,
              number,
            ];
            parts.set(`${session_id}:${file_index}:${part_number}`, {
              session_id,
              file_index,
              part_number,
              etag,
              size,
              sha256,
              created_at,
            });
            return { meta: { changes: 1 } };
          }
          if (sql.includes('UPDATE upload_sessions SET updated_at = ? WHERE id = ?')) {
            const row = sessions.get(String(args[1]));
            if (row) row.updated_at = args[0];
            return { meta: { changes: row ? 1 : 0 } };
          }
          if (sql.includes("UPDATE upload_sessions SET status = 'ready'")) {
            const row = sessions.get(String(args[1]));
            if (row) {
              row.status = 'ready';
              row.updated_at = args[0];
            }
            return { meta: { changes: row ? 1 : 0 } };
          }
          if (sql.includes("UPDATE upload_sessions SET status = 'expired'")) {
            const row = sessions.get(String(args[1]));
            if (row) {
              row.status = 'expired';
              row.updated_at = args[0];
            }
            return { meta: { changes: row ? 1 : 0 } };
          }
          if (sql.includes('DELETE FROM upload_parts WHERE session_id = ?')) {
            const sid = String(args[0]);
            let removed = 0;
            for (const [k, v] of parts.entries()) {
              if (v.session_id === sid) {
                parts.delete(k);
                removed++;
              }
            }
            return { meta: { changes: removed } };
          }
          if (sql.includes('DELETE FROM upload_files WHERE session_id = ?')) {
            const sid = String(args[0]);
            let removed = 0;
            for (const [k, v] of files.entries()) {
              if (v.session_id === sid) {
                files.delete(k);
                removed++;
              }
            }
            return { meta: { changes: removed } };
          }
          return { meta: { changes: 0 } };
        },
      };
      return stmt;
    },
  };

  return { db: db as unknown as D1Database, sessions, files, parts };
}

async function setup() {
  const now = 1_700_000_000_000;
  const token = 'upload-session-token';
  const sessionHash = await sha256Hex(token);
  const { db, sessions, files, parts } = createUploadMockDb({
    customerId: 'c1',
    projectId: 'p1',
    sessionHash,
    now,
  });
  const { bucket, objects, uploads } = createMockR2();
  const hub = new D1HubStore(db);
  const env = { DB: db, ASSETS: bucket } as unknown as UploadEnv;
  return { db, sessions, files, parts, bucket, objects, uploads, hub, env, now, token };
}

describe('SS-82 design package upload', () => {
  it('uploads a 38-file, 86 MB package via multipart and completes', async () => {
    const { env, hub, now, token, objects } = await setup();

    // 34 个 2 MB + 4 个 4.5 MB = 68 + 18 = 86 MB
    const MB = 1024 * 1024;
    const fileContents: Array<{ path: string; bytes: Uint8Array; sha256: string }> = [];
    for (let i = 0; i < 38; i++) {
      const size = i < 34 ? 2 * MB : 4.5 * MB;
      const bytes = new Uint8Array(size);
      bytes[0] = i + 1;
      bytes[size - 1] = (i * 7) & 0xff;
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      fileContents.push({
        path: `screens/screen-${i}.png`,
        bytes,
        sha256,
      });
    }

    const beginRes = await handleUploadRequest(
      new Request('https://hub.example/v1/app/uploads', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          projectId: 'p1',
          name: 'app-v1-design',
          files: fileContents.map((f) => ({ path: f.path, size: f.bytes.byteLength, sha256: f.sha256 })),
        }),
      }),
      env,
      hub,
      now,
    );
    expect(beginRes?.status).toBe(201);
    const began = (await beginRes!.json()) as { sessionId: string; totalFiles: number; totalBytes: number };
    expect(began.totalFiles).toBe(38);
    expect(began.totalBytes).toBe(86 * MB);

    // 逐文件按块上传（4.5 MB 文件分 2 块上传）
    for (let i = 0; i < fileContents.length; i++) {
      const f = fileContents[i]!;
      const chunkSize = 3 * MB;
      let partNum = 1;
      for (let offset = 0; offset < f.bytes.byteLength; offset += chunkSize) {
        const chunk = f.bytes.slice(offset, Math.min(offset + chunkSize, f.bytes.byteLength));
        const putRes = await handleUploadRequest(
          new Request(`https://hub.example/v1/app/uploads/${began.sessionId}/files/${i}/parts/${partNum}`, {
            method: 'PUT',
            headers: { authorization: `Bearer ${token}` },
            body: chunk,
          }),
          env,
          hub,
          now + 100,
        );
        expect(putRes?.status).toBe(200);
        partNum++;
      }
    }

    const completeRes = await handleUploadRequest(
      new Request(`https://hub.example/v1/app/uploads/${began.sessionId}/complete`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      }),
      env,
      hub,
      now + 200,
    );
    expect(completeRes?.status).toBe(200);
    const completed = (await completeRes!.json()) as { status: string; totalFiles: number; totalBytes: number };
    expect(completed).toEqual({
      sessionId: began.sessionId,
      status: 'ready',
      totalFiles: 38,
      totalBytes: 86 * MB,
    });
    expect(objects.size).toBe(38);
  });

  it('rejects completion when received data does not match the manifest', async () => {
    const { env, hub, now, token } = await setup();
    const content = new TextEncoder().encode('hello design');
    const realSha = createHash('sha256').update(content).digest('hex');

    const beginRes = await handleUploadRequest(
      new Request('https://hub.example/v1/app/uploads', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          projectId: 'p1',
          name: 'bad-pkg',
          files: [{ path: 'spec.json', size: content.byteLength, sha256: realSha }],
        }),
      }),
      env,
      hub,
      now,
    );
    const { sessionId } = (await beginRes!.json()) as { sessionId: string };

    // 上传相同大小但内容不同的字节
    const tampered = new TextEncoder().encode('tampered!!!!');
    expect(tampered.byteLength).toBe(content.byteLength);
    await handleUploadRequest(
      new Request(`https://hub.example/v1/app/uploads/${sessionId}/files/0/parts/1`, {
        method: 'PUT',
        headers: { authorization: `Bearer ${token}` },
        body: tampered,
      }),
      env,
      hub,
      now + 50,
    );

    const completeRes = await handleUploadRequest(
      new Request(`https://hub.example/v1/app/uploads/${sessionId}/complete`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      }),
      env,
      hub,
      now + 100,
    );
    expect(completeRes?.status).toBe(400);
    const err = (await completeRes!.json()) as { error: string; detail?: string };
    expect(err.error).toBe('manifest-mismatch');
    expect(err.detail).toContain('checksum-mismatch');
  });

  it('rejects disallowed paths, extensions, and oversized packages', async () => {
    const { env, hub, now, token } = await setup();
    const dummySha = 'a'.repeat(64);

    const traversal = await handleUploadRequest(
      new Request('https://hub.example/v1/app/uploads', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          projectId: 'p1',
          name: 'bad',
          files: [{ path: '../.env', size: 10, sha256: dummySha }],
        }),
      }),
      env,
      hub,
      now,
    );
    expect(traversal?.status).toBe(400);

    const tooBig = await handleUploadRequest(
      new Request('https://hub.example/v1/app/uploads', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          projectId: 'p1',
          name: 'huge',
          files: [{ path: 'a.png', size: 26 * 1024 * 1024, sha256: dummySha }],
        }),
      }),
      env,
      hub,
      now,
    );
    expect(tooBig?.status).toBe(400);
  });
});

describe('SS-83 resume query and 24h expiration', () => {
  it('queries received chunks after disconnect and completes after resuming', async () => {
    const { env, hub, now, token, objects } = await setup();

    const f0 = new Uint8Array(1024 * 1024);
    f0.fill(1);
    const f1 = new Uint8Array(512 * 1024);
    f1.fill(2);

    const sha0 = createHash('sha256').update(f0).digest('hex');
    const sha1 = createHash('sha256').update(f1).digest('hex');

    const beginRes = await handleUploadRequest(
      new Request('https://hub.example/v1/app/uploads', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          projectId: 'p1',
          name: 'resume-pkg',
          files: [
            { path: 'a.png', size: f0.byteLength, sha256: sha0 },
            { path: 'b.json', size: f1.byteLength, sha256: sha1 },
          ],
        }),
      }),
      env,
      hub,
      now,
    );
    const { sessionId } = (await beginRes!.json()) as { sessionId: string };

    // 断线前只传了 file 0 的 part 1（前 512 KB）
    const half = 512 * 1024;
    await handleUploadRequest(
      new Request(`https://hub.example/v1/app/uploads/${sessionId}/files/0/parts/1`, {
        method: 'PUT',
        headers: { authorization: `Bearer ${token}` },
        body: f0.slice(0, half),
      }),
      env,
      hub,
      now + 100,
    );

    // 断线重连后查询已收到哪些块
    const statusRes = await handleUploadRequest(
      new Request(`https://hub.example/v1/app/uploads/${sessionId}`, {
        method: 'GET',
        headers: { authorization: `Bearer ${token}` },
      }),
      env,
      hub,
      now + 200,
    );
    expect(statusRes?.status).toBe(200);
    const statusBody = (await statusRes!.json()) as {
      status: string;
      files: Array<{ fileIndex: number; receivedBytes: number; parts: Array<{ partNumber: number; size: number }> }>;
    };
    expect(statusBody.status).toBe('uploading');
    expect(statusBody.files[0]?.receivedBytes).toBe(half);
    expect(statusBody.files[0]?.parts.map((p) => p.partNumber)).toEqual([1]);
    expect(statusBody.files[1]?.receivedBytes).toBe(0);
    expect(statusBody.files[1]?.parts).toEqual([]);

    // 续传剩余块：file 0 part 2 和 file 1 part 1
    await handleUploadRequest(
      new Request(`https://hub.example/v1/app/uploads/${sessionId}/files/0/parts/2`, {
        method: 'PUT',
        headers: { authorization: `Bearer ${token}` },
        body: f0.slice(half),
      }),
      env,
      hub,
      now + 300,
    );
    await handleUploadRequest(
      new Request(`https://hub.example/v1/app/uploads/${sessionId}/files/1/parts/1`, {
        method: 'PUT',
        headers: { authorization: `Bearer ${token}` },
        body: f1,
      }),
      env,
      hub,
      now + 400,
    );

    const completeRes = await handleUploadRequest(
      new Request(`https://hub.example/v1/app/uploads/${sessionId}/complete`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      }),
      env,
      hub,
      now + 500,
    );
    expect(completeRes?.status).toBe(200);
    expect(objects.size).toBe(2);
  });

  it('expires and prunes sessions after 24 hours', async () => {
    const { env, hub, now, token, uploads } = await setup();
    const data = new Uint8Array(1024);
    const sha = createHash('sha256').update(data).digest('hex');

    const beginRes = await handleUploadRequest(
      new Request('https://hub.example/v1/app/uploads', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          projectId: 'p1',
          name: 'stale-pkg',
          files: [{ path: 'stale.png', size: data.byteLength, sha256: sha }],
        }),
      }),
      env,
      hub,
      now,
    );
    const { sessionId } = (await beginRes!.json()) as { sessionId: string };
    expect(uploads.size).toBe(1);

    const pruned = await pruneExpiredUploadSessions(env, now + UPLOAD_LIMITS.sessionTtlMs + 1);
    expect(pruned).toBe(1);
    expect(uploads.size).toBe(0);

    const statusRes = await handleUploadRequest(
      new Request(`https://hub.example/v1/app/uploads/${sessionId}`, {
        method: 'GET',
        headers: { authorization: `Bearer ${token}` },
      }),
      env,
      hub,
      now + UPLOAD_LIMITS.sessionTtlMs + 2,
    );
    expect(statusRes?.status).toBe(410);
  });
});
