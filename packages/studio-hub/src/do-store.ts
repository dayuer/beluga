/**
 * The `StudioStore` over one studio's Durable Object SQLite (docs/studio-hub.md §5). Only SQL and
 * row mapping: the 7/14-day rules, rev checks and queue order live in src/net/studio/queue.ts and
 * views.ts. Turns are ordered by (at, turn_id); the last 500 per plan are kept.
 */

import type { AlertRow, Conn, OpRow, QueueItem, StudioStore, TurnRow, ViewRow } from '../../../src/net/studio/store.js';

interface ViewDb {
  readonly project_id: string;
  readonly plan_ref: string;
  readonly rev: number;
  readonly view_json: string;
  readonly updated_at: number;
}
interface TurnDb {
  readonly project_id: string;
  readonly plan_ref: string;
  readonly turn_id: string;
  readonly at: number;
  readonly json: string;
}
interface QueueDb {
  readonly seq: number;
  readonly op_key: string;
  readonly op_id: string;
  readonly project_id: string;
  readonly plan_ref: string | null;
  readonly customer_id: string;
  readonly kind: string;
  readonly frame_json: string;
  readonly state: QueueItem['state'];
  readonly enqueued_at: number;
  readonly taken_by: string | null;
  readonly taken_at: number | null;
}
interface OpDb {
  readonly op_key: string;
  readonly state: OpRow['state'];
  readonly code: string | null;
  readonly at: number;
  readonly updated_at: number;
}
interface ConnDb {
  readonly daemon_id: string;
  readonly last_at: number;
  readonly connected_at: number | null;
  readonly last_seen_at: number;
  readonly synced: number;
}
interface AlertDb {
  readonly id: number;
  readonly at: number;
  readonly daemon_id: string | null;
  readonly what: string;
}

const viewOf = (r: ViewDb): ViewRow => ({ projectId: r.project_id, planRef: r.plan_ref, rev: r.rev, viewJson: r.view_json, updatedAt: r.updated_at });
const turnOf = (r: TurnDb): TurnRow => ({ projectId: r.project_id, planRef: r.plan_ref, turnId: r.turn_id, at: r.at, json: r.json });
const queueOf = (r: QueueDb): QueueItem => ({
  seq: r.seq,
  opKey: r.op_key,
  opId: r.op_id,
  projectId: r.project_id,
  ...(r.plan_ref !== null ? { planRef: r.plan_ref } : {}),
  customerId: r.customer_id,
  kind: r.kind,
  frameJson: r.frame_json,
  state: r.state,
  enqueuedAt: r.enqueued_at,
  ...(r.taken_by !== null ? { takenBy: r.taken_by } : {}),
  ...(r.taken_at !== null ? { takenAt: r.taken_at } : {}),
});
const opOf = (r: OpDb): OpRow => ({ opKey: r.op_key, state: r.state, ...(r.code !== null ? { code: r.code } : {}), at: r.at, updatedAt: r.updated_at });
const connOf = (r: ConnDb): Conn => ({ daemonId: r.daemon_id, lastAt: r.last_at, ...(r.connected_at !== null ? { connectedAt: r.connected_at } : {}), lastSeenAt: r.last_seen_at, synced: r.synced === 1 });
const alertOf = (r: AlertDb): AlertRow => ({ id: r.id, at: r.at, ...(r.daemon_id !== null ? { daemonId: r.daemon_id } : {}), what: r.what });

const minuteOf = (now: number): number => now - (now % 60_000);
const dayOf = (now: number): number => now - (now % 86_400_000);

export class DoStudioStore implements StudioStore {
  constructor(private readonly sql: SqlStorage) {}

  private rows<T>(query: string, ...values: unknown[]): T[] {
    return this.sql.exec(query, ...values).toArray() as unknown as T[];
  }
  private one<T>(query: string, ...values: unknown[]): T | undefined {
    return this.rows<T>(query, ...values)[0];
  }

  async readView(projectId: string, planRef: string): Promise<ViewRow | undefined> {
    const row = this.one<ViewDb>('SELECT * FROM views WHERE project_id = ? AND plan_ref = ?', projectId, planRef);
    return row ? viewOf(row) : undefined;
  }

  async listViews(projectId: string): Promise<readonly ViewRow[]> {
    return this.rows<ViewDb>('SELECT * FROM views WHERE project_id = ? ORDER BY updated_at DESC', projectId).map(viewOf);
  }

  async putView(view: ViewRow): Promise<void> {
    this.sql.exec(
      `INSERT INTO views (project_id, plan_ref, rev, view_json, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(project_id, plan_ref) DO UPDATE SET rev = excluded.rev, view_json = excluded.view_json, updated_at = excluded.updated_at`,
      view.projectId,
      view.planRef,
      view.rev,
      view.viewJson,
      view.updatedAt,
    );
  }

  async deleteView(projectId: string, planRef: string): Promise<void> {
    this.sql.exec('DELETE FROM views WHERE project_id = ? AND plan_ref = ?', projectId, planRef);
  }

  async putTurns<T extends { readonly id: string; readonly at: number }>(projectId: string, planRef: string, turns: readonly T[], keep: number): Promise<void> {
    for (const turn of turns) {
      this.sql.exec('INSERT OR REPLACE INTO turns (project_id, plan_ref, turn_id, at, json) VALUES (?, ?, ?, ?, ?)', projectId, planRef, turn.id, turn.at, JSON.stringify(turn));
    }
    this.sql.exec(
      `DELETE FROM turns WHERE project_id = ? AND plan_ref = ? AND turn_id NOT IN (
         SELECT turn_id FROM turns WHERE project_id = ? AND plan_ref = ? ORDER BY at DESC, turn_id DESC LIMIT ?)`,
      projectId,
      planRef,
      projectId,
      planRef,
      keep,
    );
  }

  async turnsBefore(projectId: string, planRef: string, before: string | undefined, limit: number): Promise<readonly TurnRow[]> {
    if (before !== undefined) {
      const cut = this.one<{ at: number }>('SELECT at FROM turns WHERE project_id = ? AND plan_ref = ? AND turn_id = ?', projectId, planRef, before);
      if (!cut) return [];
      const rows = this.rows<TurnDb>(
        'SELECT * FROM turns WHERE project_id = ? AND plan_ref = ? AND (at < ? OR (at = ? AND turn_id < ?)) ORDER BY at DESC, turn_id DESC LIMIT ?',
        projectId,
        planRef,
        cut.at,
        cut.at,
        before,
        limit,
      );
      return rows.reverse().map(turnOf);
    }
    const rows = this.rows<TurnDb>('SELECT * FROM turns WHERE project_id = ? AND plan_ref = ? ORDER BY at DESC, turn_id DESC LIMIT ?', projectId, planRef, limit);
    return rows.reverse().map(turnOf);
  }

  async turnCount(projectId: string, planRef: string): Promise<number> {
    return Number(this.one<{ n: number }>('SELECT COUNT(*) AS n FROM turns WHERE project_id = ? AND plan_ref = ?', projectId, planRef)?.n ?? 0);
  }

  async deleteTurns(projectId: string, planRef: string): Promise<void> {
    this.sql.exec('DELETE FROM turns WHERE project_id = ? AND plan_ref = ?', projectId, planRef);
  }

  async enqueue(item: Omit<QueueItem, 'seq' | 'state' | 'takenBy' | 'takenAt'>): Promise<number | undefined> {
    try {
      this.sql.exec(
        'INSERT INTO queue (op_key, op_id, project_id, plan_ref, customer_id, kind, frame_json, state, enqueued_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        item.opKey,
        item.opId,
        item.projectId,
        item.planRef ?? null,
        item.customerId,
        item.kind,
        item.frameJson,
        'queued',
        item.enqueuedAt,
      );
    } catch {
      return undefined;
    }
    return Number(this.one<{ seq: number }>('SELECT seq FROM queue WHERE op_key = ?', item.opKey)?.seq ?? 0);
  }

  async queueRow(opKey: string): Promise<QueueItem | undefined> {
    const row = this.one<QueueDb>('SELECT * FROM queue WHERE op_key = ?', opKey);
    return row ? queueOf(row) : undefined;
  }

  async queueByOp(opId: string, daemonId?: string): Promise<readonly QueueItem[]> {
    const rows = daemonId === undefined
      ? this.rows<QueueDb>('SELECT * FROM queue WHERE op_id = ? ORDER BY seq', opId)
      : this.rows<QueueDb>('SELECT * FROM queue WHERE op_id = ? AND taken_by = ? ORDER BY seq', opId, daemonId);
    return rows.map(queueOf);
  }

  async takeable(projectIds: readonly string[], limit: number): Promise<readonly QueueItem[]> {
    if (projectIds.length === 0) return [];
    const marks = projectIds.map(() => '?').join(', ');
    return this.rows<QueueDb>(`SELECT * FROM queue WHERE state = 'queued' AND project_id IN (${marks}) ORDER BY seq LIMIT ?`, ...projectIds, limit).map(queueOf);
  }

  async markTaken(seqs: readonly number[], daemonId: string, now: number): Promise<void> {
    if (seqs.length === 0) return;
    const marks = seqs.map(() => '?').join(', ');
    this.sql.exec(`UPDATE queue SET state = 'taken', taken_by = ?, taken_at = ? WHERE state = 'queued' AND seq IN (${marks})`, daemonId, now, ...seqs);
  }

  async requeueTaken(daemonId: string): Promise<void> {
    this.sql.exec("UPDATE queue SET state = 'queued', taken_by = NULL, taken_at = NULL WHERE state = 'taken' AND taken_by = ?", daemonId);
  }

  async settle(seq: number, state: 'done' | 'refused'): Promise<void> {
    this.sql.exec('UPDATE queue SET state = ? WHERE seq = ? AND state = ?', state, seq, 'taken');
  }

  async op(opKey: string): Promise<OpRow | undefined> {
    const row = this.one<OpDb>('SELECT * FROM ops WHERE op_key = ?', opKey);
    return row ? opOf(row) : undefined;
  }

  async recordOp(row: OpRow): Promise<void> {
    this.sql.exec(
      `INSERT INTO ops (op_key, state, code, at, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(op_key) DO UPDATE SET state = excluded.state, code = excluded.code, updated_at = excluded.updated_at`,
      row.opKey,
      row.state,
      row.code ?? null,
      row.at,
      row.updatedAt,
    );
  }

  async rateHit(customerId: string, planKey: string, now: number, chars: number, limits: { readonly perMinute: number; readonly perDay: number; readonly charsPerDay: number }): Promise<boolean> {
    const minute = this.one<{ n: number }>('SELECT n FROM rate WHERE customer_id = ? AND plan_key = ? AND window_start = ?', customerId, planKey, minuteOf(now));
    if ((minute?.n ?? 0) >= limits.perMinute) return false;
    const day = this.one<{ n: number; chars: number }>('SELECT COALESCE(SUM(n), 0) AS n, COALESCE(SUM(chars), 0) AS chars FROM rate WHERE customer_id = ? AND plan_key = ? AND window_start >= ?', customerId, planKey, dayOf(now));
    return (day?.n ?? 0) < limits.perDay && (day?.chars ?? 0) + chars <= limits.charsPerDay;
  }

  async rateAdd(customerId: string, planKey: string, now: number, chars: number): Promise<void> {
    this.sql.exec(
      `INSERT INTO rate (customer_id, plan_key, window_start, n, chars) VALUES (?, ?, ?, 1, ?)
       ON CONFLICT(customer_id, plan_key, window_start) DO UPDATE SET n = n + 1, chars = chars + excluded.chars`,
      customerId,
      planKey,
      minuteOf(now),
      chars,
    );
  }

  async conn(daemonId: string): Promise<Conn | undefined> {
    const row = this.one<ConnDb>('SELECT * FROM daemon_conn WHERE daemon_id = ?', daemonId);
    return row ? connOf(row) : undefined;
  }

  async conns(): Promise<readonly Conn[]> {
    return this.rows<ConnDb>('SELECT * FROM daemon_conn ORDER BY daemon_id').map(connOf);
  }

  async putConn(conn: Conn): Promise<void> {
    this.sql.exec(
      `INSERT INTO daemon_conn (daemon_id, last_at, connected_at, last_seen_at, synced) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(daemon_id) DO UPDATE SET last_at = excluded.last_at, connected_at = excluded.connected_at, last_seen_at = excluded.last_seen_at, synced = excluded.synced`,
      conn.daemonId,
      conn.lastAt,
      conn.connectedAt ?? null,
      conn.lastSeenAt,
      conn.synced ? 1 : 0,
    );
  }

  async alert(daemonId: string | undefined, what: string, now: number): Promise<void> {
    this.sql.exec('INSERT INTO alerts (at, daemon_id, what) VALUES (?, ?, ?)', now, daemonId ?? null, what);
    this.sql.exec('DELETE FROM alerts WHERE id NOT IN (SELECT id FROM alerts ORDER BY id DESC LIMIT 200)');
  }

  async alerts(limit: number): Promise<readonly AlertRow[]> {
    return this.rows<AlertDb>('SELECT * FROM alerts ORDER BY id DESC LIMIT ?', limit).map(alertOf);
  }

  async expire(before: number): Promise<readonly QueueItem[]> {
    const rows = this.rows<QueueDb>("SELECT * FROM queue WHERE state IN ('queued', 'taken') AND enqueued_at < ?", before);
    for (const row of rows) this.sql.exec("UPDATE queue SET state = 'expired' WHERE seq = ? AND state IN ('queued', 'taken')", row.seq);
    return rows.map((r) => ({ ...queueOf(r), state: 'expired' as const }));
  }

  async prune(before: number): Promise<void> {
    this.sql.exec("DELETE FROM queue WHERE state IN ('done', 'refused', 'expired') AND enqueued_at < ?", before);
    this.sql.exec("DELETE FROM ops WHERE state IN ('done', 'refused', 'expired') AND updated_at < ?", before);
  }
}
