/**
 * 设计稿整包上传接口（SS-82 / docs/studio-env.md 第二部分）。
 * 流程：
 * 1. POST /v1/app/uploads                                     开会话（校验清单与上限）
 * 2. PUT  /v1/app/uploads/:sessionId/files/:idx/parts/:part   按块上传（R2 multipart）
 * 3. POST /v1/app/uploads/:sessionId/complete                 校验清单完整性与 sha256，合并完成
 */

import { randomToken, sha256Hex } from '../../../src/net/studio/store.js';
import { authCustomer, bearerOf } from '../../../src/net/studio/session.js';
import type { D1HubStore } from './d1.js';
import type { Env } from './hub.js';
import { jsonOf } from './reply.js';

export const UPLOAD_LIMITS = {
  maxPackageBytes: 200 * 1024 * 1024,
  maxFileBytes: 25 * 1024 * 1024,
  maxFiles: 500,
  sessionTtlMs: 24 * 60 * 60 * 1000,
} as const;

const ALLOWED_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'svg', 'pdf', 'json', 'fig', 'sketch']);
const SHA256_RE = /^[a-f0-9]{64}$/i;
const UPLOAD_PREFIX = '/v1/app/uploads';
const MAX_MANIFEST_JSON_BYTES = 512 * 1024;
const random = (n: number): Uint8Array => crypto.getRandomValues(new Uint8Array(n));
const NOOP_MAILER = { send: async (): Promise<void> => {} };

export interface UploadEnv extends Env {
  readonly ASSETS?: R2Bucket;
}

export interface ManifestFileInput {
  readonly path: string;
  readonly size: number;
  readonly sha256: string;
}

interface SessionRow {
  readonly id: string;
  readonly customer_id: string;
  readonly project_id: string;
  readonly name: string;
  readonly total_files: number;
  readonly total_bytes: number;
  readonly status: 'uploading' | 'ready' | 'failed' | 'expired';
  readonly created_at: number;
  readonly expires_at: number;
  readonly updated_at: number;
}

interface FileRow {
  readonly session_id: string;
  readonly file_index: number;
  readonly path: string;
  readonly size: number;
  readonly sha256: string;
  readonly r2_key: string;
  readonly r2_upload_id: string;
}

interface PartRow {
  readonly session_id: string;
  readonly file_index: number;
  readonly part_number: number;
  readonly etag: string;
  readonly size: number;
  readonly sha256: string;
  readonly created_at: number;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function normalizeSafePath(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > 512) return undefined;
  if (trimmed.startsWith('/') || trimmed.includes('\\') || trimmed.includes('\0') || /^[A-Za-z]:/.test(trimmed)) {
    return undefined;
  }
  const segments = trimmed.split('/');
  if (segments.some((s) => s.length === 0 || s === '.' || s === '..')) return undefined;
  const last = segments[segments.length - 1] ?? '';
  const dot = last.lastIndexOf('.');
  if (dot <= 0) return undefined;
  const ext = last.slice(dot + 1).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) return undefined;
  return segments.join('/');
}

async function sha256BytesHex(data: ArrayBuffer | Uint8Array): Promise<string> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest('SHA-256', copy.buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function readManifestBody(req: Request): Promise<unknown> {
  try {
    const text = await req.text();
    if (text.length === 0 || text.length > MAX_MANIFEST_JSON_BYTES) return undefined;
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function partObjectKey(sessionId: string, fileIndex: number, partNumber: number): string {
  return `upload-parts/${sessionId}/${fileIndex}/${partNumber}`;
}

async function deletePartObjects(
  bucket: R2Bucket,
  sessionId: string,
  parts: ReadonlyArray<{ readonly file_index: number; readonly part_number: number }>,
): Promise<void> {
  if (parts.length === 0) return;
  const keys = parts.map((p) => partObjectKey(sessionId, p.file_index, p.part_number));
  try {
    await bucket.delete(keys);
  } catch {
    // 尽力清理临时分块对象
  }
}

export async function beginUploadSession(
  env: UploadEnv,
  hub: D1HubStore,
  customerId: string,
  input: { readonly projectId: string; readonly name: string; readonly files: readonly ManifestFileInput[] },
  now: number,
): Promise<{ ok: true; status: 201; body: unknown } | { ok: false; status: number; error: string }> {
  if (!env.ASSETS) return { ok: false, status: 503, error: 'storage-not-configured' };
  if (!(await hub.canAccess(customerId, input.projectId))) return { ok: false, status: 403, error: 'not-yours' };

  const name = input.name.trim();
  if (name.length === 0 || name.length > 200) return { ok: false, status: 400, error: 'invalid-name' };
  if (input.files.length === 0 || input.files.length > UPLOAD_LIMITS.maxFiles) {
    return { ok: false, status: 400, error: 'too-many-files' };
  }

  let totalBytes = 0;
  const seenPaths = new Set<string>();
  const normalizedFiles: Array<{ index: number; path: string; size: number; sha256: string }> = [];

  for (let i = 0; i < input.files.length; i++) {
    const f = input.files[i]!;
    const safePath = normalizeSafePath(f.path);
    if (!safePath || seenPaths.has(safePath)) return { ok: false, status: 400, error: 'invalid-file-path' };
    seenPaths.add(safePath);

    if (!Number.isInteger(f.size) || f.size <= 0 || f.size > UPLOAD_LIMITS.maxFileBytes) {
      return { ok: false, status: 400, error: 'file-size-exceeded' };
    }
    if (!SHA256_RE.test(f.sha256)) return { ok: false, status: 400, error: 'invalid-sha256' };

    totalBytes += f.size;
    if (totalBytes > UPLOAD_LIMITS.maxPackageBytes) {
      return { ok: false, status: 400, error: 'package-size-exceeded' };
    }

    normalizedFiles.push({ index: i, path: safePath, size: f.size, sha256: f.sha256.toLowerCase() });
  }

  const sessionId = randomToken(16);
  const expiresAt = now + UPLOAD_LIMITS.sessionTtlMs;

  await env.DB.prepare(
    `INSERT INTO upload_sessions (id, customer_id, project_id, name, total_files, total_bytes, status, created_at, expires_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'uploading', ?, ?, ?)`,
  )
    .bind(sessionId, customerId, input.projectId, name, normalizedFiles.length, totalBytes, now, expiresAt, now)
    .run();

  for (const file of normalizedFiles) {
    const r2Key = `assets/${input.projectId}/${sessionId}/${file.path}`;
    await env.DB.prepare(
      `INSERT INTO upload_files (session_id, file_index, path, size, sha256, r2_key, r2_upload_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(sessionId, file.index, file.path, file.size, file.sha256, r2Key, '')
      .run();
  }

  return {
    ok: true,
    status: 201,
    body: {
      sessionId,
      projectId: input.projectId,
      name,
      totalFiles: normalizedFiles.length,
      totalBytes,
      expiresAt,
      files: normalizedFiles,
    },
  };
}

export async function putUploadPart(
  env: UploadEnv,
  customerId: string,
  input: {
    readonly sessionId: string;
    readonly fileIndex: number;
    readonly partNumber: number;
    readonly data: ArrayBuffer;
    readonly expectedSha256?: string;
  },
  now: number,
): Promise<{ ok: true; status: 200; body: unknown } | { ok: false; status: number; error: string }> {
  if (!env.ASSETS) return { ok: false, status: 503, error: 'storage-not-configured' };
  if (!Number.isInteger(input.fileIndex) || input.fileIndex < 0) return { ok: false, status: 400, error: 'invalid-file-index' };
  if (!Number.isInteger(input.partNumber) || input.partNumber < 1 || input.partNumber > 10_000) {
    return { ok: false, status: 400, error: 'invalid-part-number' };
  }
  if (input.data.byteLength <= 0 || input.data.byteLength > UPLOAD_LIMITS.maxFileBytes) {
    return { ok: false, status: 400, error: 'invalid-part-size' };
  }

  const session = await env.DB.prepare('SELECT * FROM upload_sessions WHERE id = ?').bind(input.sessionId).first<SessionRow>();
  if (!session) return { ok: false, status: 404, error: 'session-not-found' };
  if (session.customer_id !== customerId) return { ok: false, status: 403, error: 'not-yours' };
  if (session.status !== 'uploading') return { ok: false, status: 409, error: 'session-closed' };
  if (now >= session.expires_at) return { ok: false, status: 410, error: 'session-expired' };

  const file = await env.DB.prepare('SELECT * FROM upload_files WHERE session_id = ? AND file_index = ?')
    .bind(input.sessionId, input.fileIndex)
    .first<FileRow>();
  if (!file) return { ok: false, status: 404, error: 'file-not-found' };

  const actualSha = await sha256BytesHex(input.data);
  if (input.expectedSha256 && actualSha !== input.expectedSha256.toLowerCase()) {
    return { ok: false, status: 400, error: 'part-checksum-mismatch' };
  }

  const partKey = partObjectKey(input.sessionId, input.fileIndex, input.partNumber);
  const putResult = await env.ASSETS.put(partKey, input.data);
  const etag = putResult?.httpEtag ?? actualSha;

  await env.DB.prepare(
    `INSERT INTO upload_parts (session_id, file_index, part_number, etag, size, sha256, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (session_id, file_index, part_number) DO UPDATE SET
       etag = excluded.etag,
       size = excluded.size,
       sha256 = excluded.sha256,
       created_at = excluded.created_at`,
  )
    .bind(input.sessionId, input.fileIndex, input.partNumber, etag, input.data.byteLength, actualSha, now)
    .run();

  await env.DB.prepare('UPDATE upload_sessions SET updated_at = ? WHERE id = ?').bind(now, input.sessionId).run();

  return {
    ok: true,
    status: 200,
    body: {
      sessionId: input.sessionId,
      fileIndex: input.fileIndex,
      partNumber: input.partNumber,
      etag,
      size: input.data.byteLength,
      sha256: actualSha,
    },
  };
}

export async function completeUploadSession(
  env: UploadEnv,
  customerId: string,
  sessionId: string,
  now: number,
): Promise<{ ok: true; status: 200; body: unknown } | { ok: false; status: number; error: string; detail?: string }> {
  if (!env.ASSETS) return { ok: false, status: 503, error: 'storage-not-configured' };

  const session = await env.DB.prepare('SELECT * FROM upload_sessions WHERE id = ?').bind(sessionId).first<SessionRow>();
  if (!session) return { ok: false, status: 404, error: 'session-not-found' };
  if (session.customer_id !== customerId) return { ok: false, status: 403, error: 'not-yours' };
  if (session.status === 'ready') {
    return {
      ok: true,
      status: 200,
      body: { sessionId, status: 'ready', totalFiles: session.total_files, totalBytes: session.total_bytes },
    };
  }
  if (session.status !== 'uploading') return { ok: false, status: 409, error: 'session-closed' };
  if (now >= session.expires_at) return { ok: false, status: 410, error: 'session-expired' };

  const { results: files } = await env.DB.prepare('SELECT * FROM upload_files WHERE session_id = ? ORDER BY file_index ASC')
    .bind(sessionId)
    .all<FileRow>();
  if (files.length !== session.total_files) {
    return { ok: false, status: 400, error: 'manifest-mismatch', detail: 'file-count-mismatch' };
  }

  const { results: allParts } = await env.DB.prepare(
    'SELECT * FROM upload_parts WHERE session_id = ? ORDER BY file_index ASC, part_number ASC',
  )
    .bind(sessionId)
    .all<PartRow>();

  const partsByFile = new Map<number, PartRow[]>();
  for (const p of allParts) {
    const list = partsByFile.get(p.file_index) ?? [];
    list.push(p);
    partsByFile.set(p.file_index, list);
  }

  // 先验证所有文件的分块是否连续且总大小严格匹配清单。
  for (const file of files) {
    const parts = partsByFile.get(file.file_index) ?? [];
    if (parts.length === 0) {
      return { ok: false, status: 400, error: 'manifest-mismatch', detail: `missing-parts:${file.path}` };
    }
    let sum = 0;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      if (part.part_number !== i + 1) {
        return { ok: false, status: 400, error: 'manifest-mismatch', detail: `gap-in-parts:${file.path}` };
      }
      sum += part.size;
    }
    if (sum !== file.size) {
      return { ok: false, status: 400, error: 'manifest-mismatch', detail: `size-mismatch:${file.path}` };
    }
  }

  // 按顺序读取临时分块对象并拼接，核对总长度与整文件 sha256 一致后再写入最终 r2_key，最后删除临时对象。
  const completedKeys: string[] = [];
  const cleanup = async () => {
    for (const k of completedKeys) {
      try {
        await env.ASSETS!.delete(k);
      } catch {
        // 忽略清理错误
      }
    }
    await deletePartObjects(env.ASSETS!, sessionId, allParts);
  };

  try {
    for (const file of files) {
      const parts = partsByFile.get(file.file_index) ?? [];
      const merged = new Uint8Array(file.size);
      let offset = 0;

      for (const p of parts) {
        const obj = await env.ASSETS.get(partObjectKey(sessionId, file.file_index, p.part_number));
        if (!obj) {
          await cleanup();
          return { ok: false, status: 400, error: 'manifest-mismatch', detail: `missing-part-object:${file.path}:${p.part_number}` };
        }
        const chunkBuf = await obj.arrayBuffer();
        if (offset + chunkBuf.byteLength > file.size) {
          await cleanup();
          return { ok: false, status: 400, error: 'manifest-mismatch', detail: `size-mismatch:${file.path}` };
        }
        merged.set(new Uint8Array(chunkBuf), offset);
        offset += chunkBuf.byteLength;
      }

      if (offset !== file.size) {
        await cleanup();
        return { ok: false, status: 400, error: 'manifest-mismatch', detail: `size-mismatch:${file.path}` };
      }

      const actualSha = await sha256BytesHex(merged);
      if (actualSha !== file.sha256) {
        await cleanup();
        return { ok: false, status: 400, error: 'manifest-mismatch', detail: `checksum-mismatch:${file.path}` };
      }

      await env.ASSETS.put(file.r2_key, merged);
      completedKeys.push(file.r2_key);
    }
  } catch {
    await cleanup();
    return { ok: false, status: 502, error: 'storage-error', detail: 'r2-assemble-failed' };
  }

  await deletePartObjects(env.ASSETS, sessionId, allParts);

  await env.DB.prepare(`UPDATE upload_sessions SET status = 'ready', updated_at = ? WHERE id = ?`)
    .bind(now, sessionId)
    .run();

  return {
    ok: true,
    status: 200,
    body: {
      sessionId,
      status: 'ready',
      totalFiles: session.total_files,
      totalBytes: session.total_bytes,
    },
  };
}

/** 查询上传会话及各文件已收到的分块（SS-83 断点续传）。 */
export async function getUploadSessionStatus(
  env: UploadEnv,
  customerId: string,
  sessionId: string,
  now: number,
): Promise<{ ok: true; status: 200; body: unknown } | { ok: false; status: number; error: string }> {
  const session = await env.DB.prepare('SELECT * FROM upload_sessions WHERE id = ?').bind(sessionId).first<SessionRow>();
  if (!session) return { ok: false, status: 404, error: 'session-not-found' };
  if (session.customer_id !== customerId) return { ok: false, status: 403, error: 'not-yours' };
  if (session.status === 'expired' || (session.status === 'uploading' && now >= session.expires_at)) {
    return { ok: false, status: 410, error: 'session-expired' };
  }

  const { results: files } = await env.DB.prepare('SELECT * FROM upload_files WHERE session_id = ? ORDER BY file_index ASC')
    .bind(sessionId)
    .all<FileRow>();
  const { results: parts } = await env.DB.prepare(
    'SELECT * FROM upload_parts WHERE session_id = ? ORDER BY file_index ASC, part_number ASC',
  )
    .bind(sessionId)
    .all<PartRow>();

  const partsByFile = new Map<number, PartRow[]>();
  for (const p of parts) {
    const list = partsByFile.get(p.file_index) ?? [];
    list.push(p);
    partsByFile.set(p.file_index, list);
  }

  return {
    ok: true,
    status: 200,
    body: {
      sessionId: session.id,
      projectId: session.project_id,
      name: session.name,
      status: session.status,
      totalFiles: session.total_files,
      totalBytes: session.total_bytes,
      expiresAt: session.expires_at,
      files: files.map((f) => {
        const fileParts = partsByFile.get(f.file_index) ?? [];
        const receivedBytes = fileParts.reduce((acc, p) => acc + p.size, 0);
        return {
          fileIndex: f.file_index,
          path: f.path,
          size: f.size,
          sha256: f.sha256,
          receivedBytes,
          parts: fileParts.map((p) => ({
            partNumber: p.part_number,
            size: p.size,
            etag: p.etag,
            sha256: p.sha256,
          })),
        };
      }),
    },
  };
}

/** 清理超过 24 小时未完成的上传会话：中止 R2 multipart 并清理分块记录。 */
export async function pruneExpiredUploadSessions(env: UploadEnv, now: number): Promise<number> {
  const { results: expired } = await env.DB.prepare(
    `SELECT * FROM upload_sessions WHERE status = 'uploading' AND expires_at <= ?`,
  )
    .bind(now)
    .all<SessionRow>();

  let count = 0;
  for (const session of expired) {
    if (env.ASSETS) {
      const { results: parts } = await env.DB.prepare('SELECT file_index, part_number FROM upload_parts WHERE session_id = ?')
        .bind(session.id)
        .all<{ readonly file_index: number; readonly part_number: number }>();
      await deletePartObjects(env.ASSETS, session.id, parts);
    }
    await env.DB.prepare('DELETE FROM upload_parts WHERE session_id = ?').bind(session.id).run();
    await env.DB.prepare('DELETE FROM upload_files WHERE session_id = ?').bind(session.id).run();
    await env.DB.prepare(`UPDATE upload_sessions SET status = 'expired', updated_at = ? WHERE id = ?`)
      .bind(now, session.id)
      .run();
    count++;
  }
  return count;
}

/**
 * 处理 `/v1/app/uploads*` 请求，不匹配时返回 `undefined`。
 */
export async function handleUploadRequest(
  req: Request,
  env: UploadEnv,
  hub: D1HubStore,
  now: number,
): Promise<Response | undefined> {
  const url = new URL(req.url);
  if (url.pathname !== UPLOAD_PREFIX && !url.pathname.startsWith(`${UPLOAD_PREFIX}/`)) {
    return undefined;
  }

  const auth = await authCustomer(bearerOf(req), {
    hub,
    now,
    random,
    mailer: NOOP_MAILER,
    origin: env.HUB_ORIGIN ?? '',
  });
  if (!auth.ok) return jsonOf({ error: auth.error }, auth.status);

  const segments = url.pathname.slice(UPLOAD_PREFIX.length).split('/').filter((s) => s.length > 0);

  // POST /v1/app/uploads
  if (segments.length === 0 && req.method === 'POST') {
    const body = await readManifestBody(req);
    if (!isRecord(body) || typeof body.projectId !== 'string' || typeof body.name !== 'string' || !Array.isArray(body.files)) {
      return jsonOf({ error: 'invalid-body' }, 400);
    }
    const files: ManifestFileInput[] = [];
    for (const item of body.files) {
      if (!isRecord(item) || typeof item.path !== 'string' || typeof item.size !== 'number' || typeof item.sha256 !== 'string') {
        return jsonOf({ error: 'invalid-body' }, 400);
      }
      files.push({ path: item.path, size: item.size, sha256: item.sha256 });
    }
    const result = await beginUploadSession(env, hub, auth.customer.id, {
      projectId: body.projectId,
      name: body.name,
      files,
    }, now);
    return result.ok ? jsonOf(result.body, result.status) : jsonOf({ error: result.error }, result.status);
  }

  // PUT /v1/app/uploads/:sessionId/files/:fileIndex/parts/:partNumber
  if (segments.length === 5 && segments[1] === 'files' && segments[3] === 'parts' && req.method === 'PUT') {
    const sessionId = segments[0]!;
    const fileIndex = Number(segments[2]);
    const partNumber = Number(segments[4]);
    const data = await req.arrayBuffer();
    const expectedSha256 = req.headers.get('x-part-sha256') ?? undefined;
    const result = await putUploadPart(
      env,
      auth.customer.id,
      { sessionId, fileIndex, partNumber, data, expectedSha256 },
      now,
    );
    return result.ok ? jsonOf(result.body, result.status) : jsonOf({ error: result.error }, result.status);
  }

  // GET /v1/app/uploads/:sessionId
  if (segments.length === 1 && req.method === 'GET') {
    const sessionId = segments[0]!;
    const result = await getUploadSessionStatus(env, auth.customer.id, sessionId, now);
    return result.ok ? jsonOf(result.body, result.status) : jsonOf({ error: result.error }, result.status);
  }

  // POST /v1/app/uploads/:sessionId/complete
  if (segments.length === 2 && segments[1] === 'complete' && req.method === 'POST') {
    const sessionId = segments[0]!;
    const result = await completeUploadSession(env, auth.customer.id, sessionId, now);
    return result.ok
      ? jsonOf(result.body, result.status)
      : jsonOf({ error: result.error, ...(result.detail ? { detail: result.detail } : {}) }, result.status);
  }

  return jsonOf({ error: 'not-found' }, 404);
}
