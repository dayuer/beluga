/**
 * One studio's Durable Object (docs/studio-hub.md §5, §11). It only wires storage and requests:
 * `handleStudioRequest` decides everything, and the effects it returns are sent or closed here.
 * The SQL is in do-store.ts. WebSockets arrive in BLG-65; until then an upgrade answers 501.
 */

import { DurableObject } from 'cloudflare:workers';
import {
  alwaysAllow,
  appSocketAllowed,
  handleStudioRequest,
  internalAuthOf,
  onAppOpen,
  onDaemonClose,
  onDaemonMessage,
  onDaemonOpen,
  verifyDaemonConnect,
  type Effect,
  type HubReply,
  type StudioDeps,
} from '../../../src/net/studio/handler.js';
import { expire, prune } from '../../../src/net/studio/queue.js';
import { DAY_MS, sha256Hex } from '../../../src/net/studio/store.js';
import { D1HubStore } from './d1.js';
import { DoStudioStore } from './do-store.js';
import { sendPushToCustomer, type PushEnv, type PushOptions } from './push.js';
import { jsonOf, responseOf } from './reply.js';
import { type AppAttachment, type DaemonAttachment, appTags, attachmentOf, daemonTags } from './ws.js';

export interface Env extends PushEnv {
  readonly DB: D1Database;
  readonly STUDIO: DurableObjectNamespace<StudioHub>;
  readonly OPERATOR_TOKEN?: string;
  readonly MAIL_MODE?: string;
  /** BLG-82: Resend. `MAIL_MODE=resend` uses these; without the key it falls back to the outbox. */
  readonly RESEND_API_KEY?: string;
  readonly MAIL_FROM?: string;
  readonly HUB_ORIGIN?: string;
  readonly PREVIEW_SECRET?: string;
}

export interface WaitingCard {
  readonly cardId: string;
  readonly title: string;
  readonly body: string;
  readonly path: string;
}

interface PlanFrameView {
  readonly planRef: string;
  readonly draftRev?: number;
  readonly title: string;
  readonly stage?: string;
  readonly typing?: boolean;
  readonly decisions: ReadonlyArray<{ readonly decisionId: string; readonly question: string; readonly open: boolean }>;
  readonly milestones: ReadonlyArray<{ readonly ref: string; readonly title: string; readonly status: string }>;
  readonly draftDiff?: { readonly draftRev: number };
  readonly gate?: { readonly kind: string; readonly state: string; readonly draftRev: number };
}

const CUSTOMER_GATE_KINDS = new Set(['start', 'changes', 'release', 'deliver']);

function gateTitleAndBody(kind: string): { title: string; body: string } {
  switch (kind) {
    case 'start':
      return { title: '方案待启动确认', body: '方案已就绪，请签名确认启动' };
    case 'changes':
      return { title: '方案变更待确认', body: '有新的方案变更等待签名确认' };
    case 'release':
      return { title: '发布待确认', body: '交付物已就绪，请签名确认发布' };
    case 'deliver':
      return { title: '交付待确认', body: '代码交付等待你的签名确认' };
    default:
      return { title: '需要你确认', body: '有一个待确认事项' };
  }
}

function cardPath(planRef: string, cardId: string): string {
  return `/request/${encodeURIComponent(planRef)}?card=${encodeURIComponent(cardId)}`;
}

/** 从计划视图中提取所有正在等待客户处理的卡片。 */
export function extractWaitingCards(projectId: string, view: PlanFrameView): WaitingCard[] {
  const cards: WaitingCard[] = [];

  for (const d of view.decisions) {
    if (!d.open) continue;
    const cardId = `${projectId}:${view.planRef}:decision:${d.decisionId}`;
    cards.push({
      cardId,
      title: view.title || '需要你做决定',
      body: d.question,
      path: cardPath(view.planRef, cardId),
    });
  }

  for (const m of view.milestones) {
    if (m.status !== 'review') continue;
    const cardId = `${projectId}:${view.planRef}:review:${m.ref}`;
    cards.push({
      cardId,
      title: view.title || '里程碑待验收',
      body: `请验收：${m.title}`,
      path: cardPath(view.planRef, cardId),
    });
  }

  const gatePending = view.gate?.state === 'pending';
  if (gatePending && view.gate && CUSTOMER_GATE_KINDS.has(view.gate.kind)) {
    const cardId = `${projectId}:${view.planRef}:gate:${view.gate.kind}:${view.gate.draftRev}`;
    const copy = gateTitleAndBody(view.gate.kind);
    cards.push({
      cardId,
      title: view.title || copy.title,
      body: copy.body,
      path: cardPath(view.planRef, cardId),
    });
  }

  if (view.draftDiff && !(gatePending && view.gate?.kind === 'changes')) {
    const cardId = `${projectId}:${view.planRef}:draftDiff:${view.draftDiff.draftRev}`;
    cards.push({
      cardId,
      title: view.title || '方案有调整',
      body: '请查看并应用或放弃方案变更',
      path: cardPath(view.planRef, cardId),
    });
  }

  if (view.stage === 'drafting' && view.milestones.length > 0 && !view.typing && !gatePending) {
    const cardId = `${projectId}:${view.planRef}:confirm:${view.draftRev ?? 0}`;
    cards.push({
      cardId,
      title: view.title || '请确认方案理解',
      body: '规划草案已生成，请确认是否开始执行',
      path: cardPath(view.planRef, cardId),
    });
  }

  return cards;
}

/** 对项目成员按 (customer_id, card_id) 去重，仅对首次出现的「等你」卡片发送推送。 */
export async function notifyWaitingCards(
  db: D1Database,
  env: PushEnv,
  projectId: string,
  view: PlanFrameView,
  opts: PushOptions = {},
): Promise<number> {
  const cards = extractWaitingCards(projectId, view);
  if (cards.length === 0) return 0;

  const { results: memberRows } = await db
    .prepare('SELECT customer_id FROM members WHERE project_id = ?')
    .bind(projectId)
    .all<{ readonly customer_id: string }>();
  if (memberRows.length === 0) return 0;

  const now = opts.now ?? Date.now();
  let notified = 0;

  for (const member of memberRows) {
    for (const card of cards) {
      const inserted = await db
        .prepare('INSERT OR IGNORE INTO push_dedup (customer_id, card_id, sent_at) VALUES (?, ?, ?)')
        .bind(member.customer_id, card.cardId, now)
        .run();
      if (Number(inserted.meta.changes ?? 0) === 0) continue;

      const res = await sendPushToCustomer(
        db,
        env,
        member.customer_id,
        {
          title: card.title,
          body: card.body,
          path: card.path,
          data: { projectId, planRef: view.planRef, cardId: card.cardId },
        },
        opts,
      );
      if (res.sent > 0) notified++;
    }
  }

  return notified;
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
     hello        INTEGER NOT NULL DEFAULT 0,
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
    // Application-level keepalive: answered without waking the object.
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    // Do not push an existing alarm forward on every hibernation wake: expire/prune would starve.
    void ctx.storage.getAlarm().then((alarm) => {
      if (alarm === null) void ctx.storage.setAlarm(Date.now() + DAY_MS);
    });
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
    const url = new URL(req.url);
    const socketRoute = url.pathname === '/v1/daemon/ws' ? 'daemon' : /^\/v1\/app\/projects\/[^/]+\/ws$/.test(url.pathname) ? 'app' : undefined;

    if ((req.headers.get('upgrade') ?? '').toLowerCase() === 'websocket') {
      if (socketRoute === undefined) return jsonOf({ error: 'not-found' }, 404);
      const deps = await this.deps();
      if (socketRoute === 'daemon') return this.acceptDaemon(req, auth, deps);
      if (auth.role !== 'app') return jsonOf({ error: 'not-yours' }, 403);
      return this.acceptApp(auth, deps);
    }
    if (socketRoute !== undefined) return jsonOf({ error: 'upgrade-required' }, 400);

    const reply: HubReply = await handleStudioRequest(req, await this.deps(), auth);
    await this.apply(reply.effects ?? []);
    return responseOf(reply);
  }

  /** The daemon signed in §3.3; hand it the socket, after requeueing what the old one took. */
  private async acceptDaemon(req: Request, auth: { role: string; daemonId?: string }, deps: StudioDeps): Promise<Response> {
    if (auth.role !== 'daemon' || auth.daemonId === undefined) return jsonOf({ error: 'not-yours' }, 403);
    const daemonId = auth.daemonId;
    const at = Number(req.headers.get('x-studio-at'));
    const sig = req.headers.get('x-studio-sig') ?? '';
    const check = await verifyDaemonConnect({ daemonId, at, sig }, deps);
    if (!check.ok) return jsonOf({ error: check.error }, check.status);

    await deps.studio.requeueTaken(daemonId);
    for (const old of this.ctx.getWebSockets(`daemon:${daemonId}`)) old.close(4002, 'replaced');

    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1], daemonTags(daemonId));
    pair[1].serializeAttachment({ role: 'daemon', daemonId, at } satisfies DaemonAttachment);
    await deps.studio.putConn({ daemonId, lastAt: at, connectedAt: deps.now, lastSeenAt: deps.now, hello: false, synced: false });
    await this.apply(await onDaemonOpen(daemonId, deps));
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  /** A customer's project socket: membership was checked by the Worker and is checked again. */
  private async acceptApp(auth: AppAttachment, deps: StudioDeps): Promise<Response> {
    if (!(await deps.hub.canAccess(auth.customerId, auth.projectId))) return jsonOf({ error: 'not-yours' }, 403);
    // A customer may have a few devices; beyond 32 in a studio, the oldest go (design §11.4).
    const open = this.ctx.getWebSockets(`cust:${auth.customerId}`);
    if (open.length >= 32) {
      for (const old of open.slice(0, open.length - 31)) {
        try {
          old.close(1000, 'too-many');
        } catch {
          // Already closed.
        }
      }
    }
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1], appTags(auth.customerId, auth.projectId, auth.sessionHash));
    pair[1].serializeAttachment({ role: 'app', customerId: auth.customerId, projectId: auth.projectId, ...(auth.sessionHash !== undefined ? { sessionHash: auth.sessionHash } : {}) } satisfies AppAttachment);
    for (const effect of await onAppOpen(auth.customerId, auth.projectId, deps)) {
      if (effect.to === 'app') pair[1].send(JSON.stringify(effect.frame));
      else if (effect.to === 'close') pair[1].close(effect.code, effect.reason);
    }
    return new Response(null, { status: 101, webSocket: pair[0], headers: { 'Sec-WebSocket-Protocol': 'synon.v1' } });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const att = attachmentOf(ws);
    if (att?.role !== 'daemon') return; // customers act over HTTP only
    const raw = typeof message === 'string' ? message : new TextDecoder().decode(message);
    await this.apply(await onDaemonMessage(att.daemonId, raw, await this.deps(), att.at));
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    const att = attachmentOf(ws);
    if (att?.role === 'daemon') await this.apply(await onDaemonClose(att.daemonId, att.at, await this.deps()));
    // 1006 is "closed abnormally" and cannot be sent in a close frame; the socket is already gone.
    try {
      if (code !== 1006) ws.close(code, reason);
    } catch {
      // Already closed.
    }
  }

  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    void error;
    const att = attachmentOf(ws);
    if (att?.role === 'daemon') await this.apply(await onDaemonClose(att.daemonId, att.at, await this.deps()));
    try {
      ws.close(1011, 'internal');
    } catch {
      // Already closed.
    }
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
        if (effect.frame.t === 'plan') {
          try {
            await notifyWaitingCards(this.env.DB, this.env, effect.projectId, effect.frame.view);
          } catch {
            // 推送失败不影响 WebSocket 视图广播。
          }
        }
        const deps = await this.deps();
        for (const ws of this.ctx.getWebSockets(`app:${effect.projectId}`)) {
          const att = attachmentOf(ws);
          // The close after a removal/logout is best effort; the gate is this per-send check.
          if (att?.role !== 'app' || !(await appSocketAllowed(att.customerId, effect.projectId, att.sessionHash, deps))) {
            try {
              ws.close(4004, 'not-yours');
            } catch {
              // Already closed.
            }
            continue;
          }
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
