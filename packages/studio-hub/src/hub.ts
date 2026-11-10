/**
 * One studio's Durable Object (docs/studio-hub.md §5, §11). It only wires storage and requests:
 * `handleStudioRequest` decides everything, and the effects it returns are sent or closed here.
 * The SQL is in do-store.ts. WebSockets arrive in BLG-65; until then an upgrade answers 501.
 */

import { DurableObject } from 'cloudflare:workers';
import { alwaysAllow, handleStudioRequest, internalAuthOf, type Effect, type HubReply, type StudioDeps } from '../../../src/net/studio/handler.js';
import { expire, prune } from '../../../src/net/studio/queue.js';
import { DAY_MS, sha256Hex } from '../../../src/net/studio/store.js';
import { D1HubStore } from './d1.js';
import { DoStudioStore } from './do-store.js';
import { jsonOf, responseOf } from './reply.js';

export interface Env {
  readonly DB: D1Database;
  readonly STUDIO: DurableObjectNamespace<StudioHub>;
  readonly OPERATOR_TOKEN?: string;
  readonly MAIL_MODE?: string;
  readonly HUB_ORIGIN?: string;
  readonly PREVIEW_SECRET?: string;
}

const NOOP_MAILER = { send: async (): Promise<void> => {} };

const TABLES: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS views (
     project_id TEXT NOT NULL,
     plan_ref   TEXT NOT NULL,
     rev        INTEGER NOT NULL,
     view_json  TEXT NOT NULL,
     updated_at INTEGER NOT NULL,
     PRIMARY KEY (project_id, plan_ref)
   )`,
  `CREATE TABLE IF NOT EXISTS turns (
     project_id TEXT NOT NULL,
     plan_ref   TEXT NOT NULL,
     turn_id    TEXT NOT NULL,
     at         INTEGER NOT NULL,
     json       TEXT NOT NULL,
     PRIMARY KEY (project_id, plan_ref, turn_id)
   )`,
  'CREATE INDEX IF NOT EXISTS turns_order ON turns (project_id, plan_ref, at, turn_id)',
  `CREATE TABLE IF NOT EXISTS queue (
     seq         INTEGER PRIMARY KEY AUTOINCREMENT,
     op_key      TEXT NOT NULL UNIQUE,
     op_id       TEXT NOT NULL,
     project_id  TEXT NOT NULL,
     plan_ref    TEXT,
     customer_id TEXT NOT NULL,
     kind        TEXT NOT NULL,
     frame_json  TEXT NOT NULL,
     state       TEXT NOT NULL CHECK (state IN ('queued', 'taken', 'done', 'refused', 'expired')),
     enqueued_at INTEGER NOT NULL,
     taken_by    TEXT,
     taken_at    INTEGER
   )`,
  'CREATE INDEX IF NOT EXISTS queue_take ON queue (state, seq)',
  'CREATE INDEX IF NOT EXISTS queue_by_daemon ON queue (taken_by, state)',
  `CREATE TABLE IF NOT EXISTS ops (
     op_key     TEXT PRIMARY KEY,
     state      TEXT NOT NULL CHECK (state IN ('queued', 'done', 'refused', 'expired')),
     code       TEXT,
     at         INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   )`,
  'CREATE INDEX IF NOT EXISTS ops_prune ON ops (updated_at)',
  `CREATE TABLE IF NOT EXISTS rate (
     customer_id  TEXT NOT NULL,
     plan_key     TEXT NOT NULL,
     window_start INTEGER NOT NULL,
     n            INTEGER NOT NULL,
     chars        INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (customer_id, plan_key, window_start)
   )`,
  `CREATE TABLE IF NOT EXISTS daemon_conn (
     daemon_id    TEXT PRIMARY KEY,
     last_at      INTEGER NOT NULL,
     connected_at INTEGER,
     last_seen_at INTEGER NOT NULL,
     synced       INTEGER NOT NULL DEFAULT 0
   )`,
  'CREATE TABLE IF NOT EXISTS alerts (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, daemon_id TEXT, what TEXT NOT NULL)',
];

export class StudioHub extends DurableObject<Env> {
  private readonly sql: SqlStorage;
  private operatorHash: string | undefined;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    for (const statement of TABLES) this.sql.exec(statement);
    void ctx.storage.setAlarm(Date.now() + DAY_MS);
  }

  private store(): DoStudioStore {
    return new DoStudioStore(this.sql);
  }

  private async deps(): Promise<StudioDeps> {
    this.operatorHash ??= await sha256Hex(this.env.OPERATOR_TOKEN ?? '');
    return {
      hub: new D1HubStore(this.env.DB),
      studio: this.store(),
      studioId: this.ctx.id.name ?? '',
      now: Date.now(),
      random: (n) => crypto.getRandomValues(new Uint8Array(n)),
      mailer: NOOP_MAILER,
      ent: alwaysAllow,
      operatorTokenHash: this.operatorHash,
      origin: this.env.HUB_ORIGIN ?? '',
      ...(this.env.PREVIEW_SECRET ? { previewSecret: this.env.PREVIEW_SECRET } : {}),
    };
  }

  async fetch(req: Request): Promise<Response> {
    const auth = internalAuthOf(req.headers.get('x-studio-auth'));
    if (!auth) return jsonOf({ error: 'not-yours' }, 403);
    // The hibernation sockets are BLG-65; the HTTP routes are complete here.
    if (req.headers.get('upgrade') === 'websocket') return jsonOf({ error: 'websocket-not-implemented' }, 501);
    const reply: HubReply = await handleStudioRequest(req, await this.deps(), auth);
    await this.apply(reply.effects ?? []);
    return responseOf(reply);
  }

  private async apply(effects: readonly Effect[]): Promise<void> {
    for (const effect of effects) {
      if (effect.to === 'daemon') {
        for (const ws of this.ctx.getWebSockets(`daemon:${effect.daemonId}`)) {
          try {
            ws.send(JSON.stringify(effect.msg));
          } catch {
            ws.close(1011, 'send-failed');
          }
        }
      } else if (effect.to === 'app') {
        for (const ws of this.ctx.getWebSockets(`app:${effect.projectId}`)) {
          try {
            ws.send(JSON.stringify(effect.frame));
          } catch {
            ws.close(1011, 'send-failed');
          }
        }
      } else if (effect.to === 'close') {
        for (const ws of this.ctx.getWebSockets(effect.tag)) {
          try {
            ws.close(effect.code, effect.reason);
          } catch {
            // Already closed.
          }
        }
      } else {
        await this.store().alert(effect.daemonId, effect.what, Date.now());
      }
    }
  }

  async alarm(): Promise<void> {
    const deps = await this.deps();
    const now = Date.now();
    for (const expired of await expire(now, deps)) {
      for (const ws of this.ctx.getWebSockets(`app:${expired.projectId}`)) {
        try {
          ws.send(JSON.stringify(expired.receipt));
        } catch {
          ws.close(1011, 'send-failed');
        }
      }
    }
    await prune(now, deps);
    await this.ctx.storage.setAlarm(now + DAY_MS);
  }
}
