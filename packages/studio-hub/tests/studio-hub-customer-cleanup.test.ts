import { describe, expect, it } from 'vitest';
import { D1HubStore } from '../src/d1.js';
import { sendPushToCustomer, type PushEnv } from '../src/push.js';

function createFkMockDb() {
  const customers = [{ id: 'c1', status: 'active' }];
  const pushTokens = [{ customer_id: 'c1', device: 'dev1', platform: 'ios', token: 'apns-1', updated_at: 1 }];
  const pushDedup = [{ customer_id: 'c1', card_id: 'card-1', sent_at: 1 }];
  const uploadSessions = [{ id: 'up1', customer_id: 'c1' }];
  const uploadFiles = [{ session_id: 'up1', file_index: 0 }];
  const uploadParts = [{ session_id: 'up1', file_index: 0, part_number: 1 }];

  const execSql = (sql: string, args: unknown[]) => {
    const cid = String(args[0]);
    const removedOnly = sql.includes("status = 'removed'");
    const isRemoved = customers.some((c) => c.id === cid && c.status === 'removed');

    if (sql.startsWith("UPDATE customers SET status = 'removed'")) {
      const c = customers.find((x) => x.id === cid);
      if (c) c.status = 'removed';
      return 1;
    }
    if (sql.startsWith('DELETE FROM push_tokens')) {
      if (removedOnly && !isRemoved) return 0;
      const before = pushTokens.length;
      for (let i = pushTokens.length - 1; i >= 0; i--) {
        if (pushTokens[i]?.customer_id === cid) pushTokens.splice(i, 1);
      }
      return before - pushTokens.length;
    }
    if (sql.startsWith('DELETE FROM push_dedup')) {
      if (removedOnly && !isRemoved) return 0;
      const before = pushDedup.length;
      for (let i = pushDedup.length - 1; i >= 0; i--) {
        if (pushDedup[i]?.customer_id === cid) pushDedup.splice(i, 1);
      }
      return before - pushDedup.length;
    }
    if (sql.startsWith('DELETE FROM upload_parts')) {
      if (removedOnly && !isRemoved) return 0;
      const sids = new Set(uploadSessions.filter((s) => s.customer_id === cid).map((s) => s.id));
      const before = uploadParts.length;
      for (let i = uploadParts.length - 1; i >= 0; i--) {
        if (sids.has(uploadParts[i]!.session_id)) uploadParts.splice(i, 1);
      }
      return before - uploadParts.length;
    }
    if (sql.startsWith('DELETE FROM upload_files')) {
      if (removedOnly && !isRemoved) return 0;
      const sids = new Set(uploadSessions.filter((s) => s.customer_id === cid).map((s) => s.id));
      const before = uploadFiles.length;
      for (let i = uploadFiles.length - 1; i >= 0; i--) {
        if (sids.has(uploadFiles[i]!.session_id)) uploadFiles.splice(i, 1);
      }
      return before - uploadFiles.length;
    }
    if (sql.startsWith('DELETE FROM upload_sessions')) {
      if (removedOnly && !isRemoved) return 0;
      const before = uploadSessions.length;
      for (let i = uploadSessions.length - 1; i >= 0; i--) {
        if (uploadSessions[i]?.customer_id === cid) uploadSessions.splice(i, 1);
      }
      return before - uploadSessions.length;
    }
    if (sql.startsWith('DELETE FROM customers')) {
      const hasFk =
        pushTokens.some((r) => r.customer_id === cid) ||
        pushDedup.some((r) => r.customer_id === cid) ||
        uploadSessions.some((r) => r.customer_id === cid);
      if (hasFk) throw new Error('FOREIGN KEY constraint failed');
      const idx = customers.findIndex((c) => c.id === cid && c.status === 'removed');
      if (idx >= 0) customers.splice(idx, 1);
      return idx >= 0 ? 1 : 0;
    }
    return 0;
  };

  const makeStmt = (sql: string) => {
    let args: unknown[] = [];
    const stmt = {
      sql,
      args,
      bind(...values: unknown[]) {
        args = values;
        stmt.args = values;
        return stmt;
      },
      async first<T>() {
        return null as T | null;
      },
      async all<T>() {
        if (sql.includes('FROM push_tokens WHERE customer_id = ?')) {
          const cid = String(args[0]);
          return { results: pushTokens.filter((t) => t.customer_id === cid) as T[] };
        }
        return { results: [] as T[] };
      },
      async run() {
        return { meta: { changes: execSql(sql, args) } };
      },
    };
    return stmt;
  };

  const db = {
    prepare: makeStmt,
    async batch(stmts: Array<{ sql: string; args: unknown[] }>) {
      return stmts.map((s) => ({ meta: { changes: execSql(s.sql, s.args) } }));
    },
  };

  return {
    db: db as unknown as D1Database,
    customers,
    pushTokens,
    pushDedup,
    uploadSessions,
    uploadFiles,
    uploadParts,
  };
}

describe('SS-128 customer removal and deletion cleanup', () => {
  it('clears push_tokens on removeCustomer so customer receives no more pushes', async () => {
    const { db, pushTokens } = createFkMockDb();
    const hub = new D1HubStore(db);

    await hub.removeCustomer('c1', 1_700_000_000_000);
    expect(pushTokens).toEqual([]);

    let fetchCalls = 0;
    const env: PushEnv = { DB: db };
    const result = await sendPushToCustomer(
      db,
      env,
      'c1',
      { title: 't', body: 'b' },
      {
        fetch: async () => {
          fetchCalls++;
          return new Response('{}', { status: 200 });
        },
      },
    );
    expect(result).toEqual({ sent: 0, failed: 0, removed: 0 });
    expect(fetchCalls).toBe(0);
  });

  it('deletes removed customer without foreign key error even with tokens and upload sessions', async () => {
    const { db, customers, pushTokens, pushDedup, uploadSessions, uploadFiles, uploadParts } = createFkMockDb();
    customers[0]!.status = 'removed';
    const hub = new D1HubStore(db);

    await expect(hub.deleteCustomer('c1')).resolves.toBeUndefined();
    expect(customers).toEqual([]);
    expect(pushTokens).toEqual([]);
    expect(pushDedup).toEqual([]);
    expect(uploadSessions).toEqual([]);
    expect(uploadFiles).toEqual([]);
    expect(uploadParts).toEqual([]);
  });
});
