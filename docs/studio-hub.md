# Studio 中台：存储、路由与鉴权（M2 接口说明）

依据：`docs/superpowers/specs/2026-11-10-beluga-studio-design.md`（M1 审计版）§2、§5，以及 M2 的架构设计
（本里程碑的目标说明）。协议本身（`StudioPlanView`、动作帧、回执帧）见 `docs/studio-protocol.md`，本文不重复。

本文定下 M2 实施要照做的全部接口：哪些状态在 D1、哪些在 Durable Object（下称 DO）、每条路由怎么鉴权、
签名串怎么拼、队列和缓存的字段与时限、WebSocket 用 DO 的哪种 API。规则在 `src/net/studio/`，壳在
`packages/studio-hub`；本文同时写明两者的分界。

参照物：`src/net/mailbox/handler.ts`（规则吃 Request 与注入的存储接口，壳只把 SQL 接上）和
`packages/mailbox`（`wrangler.toml`、`src/worker.ts`）。mailbox 只有 HTTP、没有 WebSocket；中台的 WebSocket
是本里程碑的新代码，见 §11。

## 0. 结论摘要

| 状态 | 放哪 | 为什么 |
|---|---|---|
| 工作室、绑定码、daemon 设备、daemon 上报的项目、客户账号、Studio 项目、项目成员、登录令牌、会话、outbox | **D1**（全局） | 这些表要在"还不知道是哪个工作室"之前查：邮箱→客户、绑定码→工作室、daemon 密钥→工作室、项目→工作室。运营者的列表页也是全局的。 |
| 视图缓存、turns、动作队列、opId 回执、频率计数、daemon 连接状态与重放时间戳、alerts | **DO**（每个工作室一个，SQLite） | 这些状态必须按工作室串行：队列顺序、opId 去重、rev 比较、同一 daemon 的连接挤占。一个 DO 单线程，天然没有竞态。 |
| 客户与 daemon 的套接字 | **DO 的 hibernation WebSocket** | 每工作室一个 DO，广播只发给这个工作室的 `app:<project>` 套接字；休眠后状态都在 SQLite 和 attachment 里。 |

一句话规则：**跨工作室的查找在 D1，需要串行的在 DO。** 身份与成员关系每次都从 D1 重查，DO 不缓存授权结论
（休眠会丢内存，也因为"移除立即生效"）；DO 里只放"这个工作室自己的、必须有序的"东西。

## 1. 分层：规则与壳

| 文件 | 内容 | 允许 import |
|---|---|---|
| `src/net/studio/store.ts` | `HubStore`（D1 形状）、`StudioStore`（DO 形状）两个接口，`memoryHub()`/`memoryStudio()` 测试实现；`sha256Hex`、`b64url`、`fromB64`、`randomToken(bytes)`、`equalBytes`（定长比较） | 无（只用 Web Crypto） |
| `src/net/studio/handler.ts` | `routeOf`、`handleHubRequest`、`handleStudioRequest`、运营者令牌、绑定码与登记、daemon 验签、`onDaemonOpen`/`onDaemonMessage`/`onDaemonClose`/`onAppOpen`、传输信封 `DaemonUp`/`HubDown`、`Effect`、`Entitlements`、`Mailer` | store、同目录模块、`src/studio/protocol.ts` |
| `src/net/studio/queue.ts` | `enqueue`、`take`、`ack`、`expire`、`prune`、频率限制、由缓存视图合成 `PlanFacts` | `src/studio/actions.ts`（`checkAction`、`opKey`、`OPID_KEEP_MS`）、store |
| `src/net/studio/views.ts` | `ingestPlan`、`ingestPatch`、`readView`、`listPlans`、`turnsBefore`、`previewLink` | `src/studio/protocol.ts`、store |
| `src/net/studio/session.ts` | 魔法链接令牌、会话、`authCustomer`、登录频率 | store |
| `src/net/studio/accounts.ts` | 邀请、删除、建项目、成员、项目↔daemon 映射、`canAccess` | store |
| `packages/studio-hub/src/worker.ts` | `fetch`：`routeOf` → 全局路由 `handleHubRequest`，工作室路由按 D1 找到 studio 后转 DO | 只 import `src/net/studio/*` 与 `src/studio/protocol.ts`（npm 包除外） |
| `packages/studio-hub/src/hub.ts` | `class StudioHub extends DurableObject`：SQLite 实现 `StudioStore`；`fetch`/`alarm`/`webSocket*` 只转调 handler | 同上 |
| `packages/studio-hub/src/ws.ts` | hibernation 的接入、标签、attachment、把 `Effect[]` 逐条执行 | 同上 |
| `packages/studio-hub/src/admin-page.ts` | `export const ADMIN_HTML: string`（单文件 HTML + 内联 JS） | 无 |
| `packages/studio-hub/schema.sql`、`wrangler.toml`、`package.json`、`tsconfig.json` | D1 表结构、绑定、`dev`/`deploy`/`typecheck` 脚本 | — |

`src/net/studio/queue.ts` import `src/studio/actions.ts` 是允许的：边界检查只查
`packages/studio-hub/src` 里 import 的 `src/` 文件。`actions.ts` 只依赖 `protocol.ts`（zod），Worker 与浏览器都安全。

**壳的判别标准**：壳里没有 `if` 判断业务状态。权限、过期、rev、白名单、映射、签名、限频一律在
`src/net/studio/*` 里判；壳只做四件事：

1. 把 HTTP `Request` 交给 handler，把返回的 `{status, body, headers}` 变成 `Response`；
2. 把 handler 返回的 `Effect[]` 逐条执行（发帧、关套接字、写 alert）；
3. 用 SQL 实现 `HubStore`/`StudioStore`（只做查询与写入，不解释结果）；
4. 按 D1 查到的 `studioId` 选 DO、按标签收发 WebSocket、排 alarm、加安全响应头。

壳里可以有的 `if`：HTTP 方法/路径分发（`routeOf` 在 handler 里）、`instanceof`、`??`、错误转 500；
**不能**有 `if (expired)`、`if (canAccess)`、`if (rev !== ...)`、`if (kind in WHITELIST)` 这类判断。
审计（BLG-63）按这条 grep 与阅读。

### 1.1 共享形状（`store.ts` 与 `handler.ts` 导出）

```ts
export interface Deps {
  hub: HubStore;            // D1
  studio?: StudioStore;     // DO（全局路由没有）
  now: number;
  random(n: number): Uint8Array;      // 测试传固定字节
  mailer: Mailer;
  ent: Entitlements;
  operatorTokenHash: string;          // sha256Hex(OPERATOR_TOKEN)
  origin: string;                     // HUB_ORIGIN，拼魔法链接与（P2）预览链接用
  previewSecret?: string;             // P1 不配；previewLink 的 HMAC 密钥
}

export interface Mailer { send(email: string, link: string): Promise<void>; }

/** P1 只有一个恒放行的实现；调用点在"建项目"和"plan.create 入队"前，P3 再加拒绝码。 */
export interface Entitlements { allows(what: 'project' | 'active-plan', studioId: string, n?: number): Promise<boolean>; }
export const alwaysAllow: Entitlements;

/** handler 处理 WS 消息后返回，壳逐条执行。 */
export type Effect =
  | { to: 'daemon'; daemonId: string; msg: HubDown }
  | { to: 'app'; projectId: string; frame: AppFrame }
  | { to: 'close'; tag: string; code: number; reason: string }
  | { to: 'alert'; daemonId?: string; what: string };

/** HTTP 入口的结果；壳变成 Response（WS 升级时另带套接字）。 */
export interface HubReply { status: number; body?: unknown; headers?: Record<string, string>; effects?: Effect[]; }
```

handler 的入口：

```ts
handleHubRequest(req: Request, deps: Deps): Promise<HubReply>;                       // 全局路由（Worker）
handleStudioRequest(req: Request, deps: Deps & { studio: StudioStore }, auth: InternalAuth): Promise<HubReply>;  // DO 路由
onDaemonOpen(daemonId: string, deps: Deps): Promise<Effect[]>;                     // 升级被接受后
onDaemonMessage(daemonId: string, raw: string, deps: Deps): Promise<Effect[]>;     // 一条 daemon 消息
onDaemonClose(daemonId: string, at: number, deps: Deps): Promise<Effect[]>;       // 断开/被挤占；at 来自 attachment
onAppOpen(customerId: string, projectId: string, deps: Deps): Promise<Effect[]>;   // 客户套接字被接受后
```

`InternalAuth` 就是 `x-studio-auth` 的 JSON（§6）：`{role:'app',customerId,projectId,sessionHash?}`、
`{role:'daemon',daemonId}`、`{role:'operator'}`。

`HubStore` 按表分组的方法（名称实施时可微调，语义不变）：
`createStudio/listStudios/studio`；`issueLinkCode/peekLinkCode/takeLinkCode`；
`daemon/daemonByKey/createDaemon/revokeDaemon/daemonsOfStudio`；
`replaceDaemonProjects/daemonProjects`；
`customer/customerByEmail/customers/createCustomer/removeCustomer`；
`project/projectsOfStudio/projectsOfDaemon/projectsOfCustomer/createProject/bindProject/unbindProject`；
`members/addMember/removeMember/canAccess`；
`createLoginToken(countRecent)/takeLoginToken`；
`createSession/session/touchSession/revokeSession/revokeCustomerSessions`；
`addOutbox/outboxForStudio/dropOutbox`。

`StudioStore`：`readView/listViews/putView/deleteView`；`putTurns/turnsBefore/turnCount`；
`enqueue/takeable/markTaken/requeueTaken/queueByOp/queueRow`；`op/recordOp`；`rateHit/rateAdd`；
`conn/putConn`；`alert/alerts`；`expire/prune`。

## 2. 常量与时限

全部集中在一处（`handler.ts` 顶部或 `store.ts`），测试直接引用，不写字面量。

| 常量 | 值 | 用在哪 |
|---|---|---|
| `STUDIO_LABEL` | `synon-studio-v1` | 所有 daemon 签名串的前缀 |
| `LINK_CODE_TTL_MS` | 15 分钟 | 绑定码有效期 |
| `CLOCK_SKEW_MS` | 5 分钟 | 登记与连接允许的 `abs(now - at)` |
| `LOGIN_TOKEN_TTL_MS` | 15 分钟 | 魔法链接一次性令牌 |
| `LOGIN_PER_EMAIL_PER_HOUR` | 5 | 同一邮箱每小时最多发 5 封 |
| `SESSION_TTL_MS` | 30 天 | 客户会话；每天滑动续期 |
| `QUEUE_TTL_MS` | 7 天 | 队列条目未执行则 `expired` |
| `OPID_KEEP_MS` | 14 天 | `src/studio/actions.ts` 已有；opId 回执至少留这么久 |
| `TURNS_KEEP` | 500 | 每计划保留的 turns |
| `TURNS_PAGE` | 50 | 一次读 turns 的条数（上限 50） |
| `VIEW_TURNS` | 50 | 视图里带的最近 turns（协议上限） |
| `DELIVER_MAX` | 50 | 一次 `take` 最多取走的条数 |
| `RATE_PER_MIN` | 20 | 每客户每项目每分钟的动作条数（有该计划视图时细分为项目+计划） |
| `RATE_PER_DAY` | 300 | 每客户每项目每天的动作条数（同上） |
| `RATE_CHARS_PER_DAY` | 50 000 | 每客户每项目每天客户文字总量（设计 §3.5；只有带文字的 kind 计） |
| `PREVIEW_TTL_MS` | 15 分钟 | 预览链接签名有效期（P2） |
| `OUTBOX_TTL_MS` | 15 分钟 | 魔法链接在 outbox 的保留期 |
| `ALERTS_KEEP` | 200 | 每工作室保留的 alert 条数 |
| `DAY_MS` | 86 400 000 | alarm 周期 |

## 3. 认证

四种身份：运营者（只有令牌）、daemon（设备密钥签名）、客户（会话令牌）、Worker→DO 的内部身份。
没有匿名身份能写数据。

### 3.1 运营者

- 环境变量 `OPERATOR_TOKEN`（本地 `.dev.vars`，线上 `wrangler secret put OPERATOR_TOKEN`）。
  壳把它哈希成 `operatorTokenHash = sha256Hex(OPERATOR_TOKEN)` 放进 `deps`；明文不进程内保存。
- 请求头 `Authorization: Bearer <OPERATOR_TOKEN>`。handler 对收到的令牌做 `sha256Hex`，与
  `operatorTokenHash` 做**定长逐字节比较**（长度都是 64 个 hex 字符），相等才算运营者。
- P1 只有一个运营者；没有运营者账号表，也没有运营者登录。缺头/错令牌 → `401 {"error":"operator-only"}`。
- 运营者能做的事只由 §6 的 `/v1/admin/*` 路由决定；管理页的 HTML 本身不鉴权（里面没有数据），数据都要令牌。

### 3.2 绑定码与 daemon 登记

**格式**：Crockford base32，8 位 = 40 bit。字母表 `0123456789ABCDEFGHJKMNPQRSTVWXYZ`（去掉 I、L、O、U）。
展示形式 `XXXX-XXXX`；输入先规范化：大写、去空格与 `-`、`O→0`、`I/L→1`，其余不在字母表里的字符 → 拒绝。
请求体里的 `code` 必须已经是 `XXXX-XXXX` 形式，签名覆盖这个**原样字符串**；哈希是对去掉 `-` 的 8 位串做
`sha256Hex`。生成用 `random(5)`（40 bit），每 5 bit 一组映射到字母表；不引入 `Math.random`。

**有效期**：15 分钟。存 hash，不存明文；**只在签发响应里出现一次**，管理页丢了就重新签发。

**签发**：
- 新建工作室时自动签发一个（`POST /v1/admin/studios` 的响应里带 `linkCode`）。
- `POST /v1/admin/studios/:sid/link-codes` 再签发一个。签发前把该工作室所有未用的码 `expires_at = now`
  作废（保留行，便于审计），所以同一工作室同时最多一个可用的码。

**兑换（登记）**：`POST /v1/link`，严格 JSON：

```json
{ "code": "AB12-CD34", "key": "<Ed25519 公钥，SPKI DER 的标准 base64>", "name": "Studio Mac", "at": 1760000000000, "sig": "<base64>" }
```

- `at` 是毫秒时间戳；`|now - at| <= 5 分钟`，否则 401。
- 签名串：`synon-studio-v1:link:<code>:<at>`（`<code>` 为 `XXXX-XXXX`，`<at>` 为十进制毫秒）。
  用 `crypto.subtle.verify({name:'Ed25519'}, importKey('spki', ...))` 验证；错签 → 403。
- `daemonId = b64url(sha256(SPKI DER 字节)).slice(0,32)`（与 mailbox 的 `peerIdOf` 相同），所以同一把密钥
  永远是同一个 daemon id。
- 顺序（避免白白消耗绑定码）：
  1. 解析与格式校验（400）；
  2. `peekLinkCode(hash, now)`：码存在、未用、未过期，拿到 `studioId`，否则 403 `bad-or-expired-code`；
  3. `daemonByKey(key)`：
     - 已登记到**同一个** `studioId` → 原子消耗这个码，返回已有的 `{studioId, daemonId}`（200，幂等）；
     - 已登记到**别的**工作室 → 409 `key-taken`，**不消耗**码；
  4. `takeLinkCode(hash, now, daemonId)`：D1 一条
     `UPDATE link_codes SET used_at=?, daemon_id=? WHERE code_hash=? AND used_at IS NULL AND expires_at>?`，
     `meta.changes === 1` 才算成功；否则 403（并发下只有一个赢家）；
  5. 插入 `daemons(id, studio_id, public_key, name, created_at)`；`public_key` UNIQUE 冲突时重查：
     同工作室返回已有 id，异工作室 409（极少见；此时代码已消耗，文档照此记录）；
  6. 返回 `{studioId, daemonId}`。
- 成功不代表已连接；daemon 还要用设备密钥开 WebSocket（§3.3）。管理页此时显示"已登记，未连接"。

### 3.3 daemon 连接签名

`GET /v1/daemon/ws`（WebSocket 升级），请求头：

| 头 | 内容 |
|---|---|
| `x-studio-daemon` | daemon id（`^[A-Za-z0-9_-]{32}$`） |
| `x-studio-at` | 毫秒时间戳，十进制 |
| `x-studio-sig` | Ed25519 签名，标准 base64 |

签名串：`synon-studio-v1:connect:<daemonId>:<at>`。

handler 在 DO 内按顺序判（全部失败都关闭握手，不建套接字）：

1. 头格式不对 → 400。
2. 用 `HubStore.daemon(daemonId)` 查登记：不存在 → 401 `unknown-daemon`；`revoked_at` 非空 → 403 `revoked`。
3. `|now - at| <= 5 分钟` → 否则 401 `clock-skew`。
4. 用**登记的** `public_key` 验签（不接受请求里带来的任何 key）→ 否则 401 `bad-signature`。
5. **重放**：`StudioStore.conn(daemonId).last_at` 存在且 `at <= last_at` → 409 `replayed`。检查与写入在
   DO 内同一次处理中完成（DO 输入门保证不交错），成功后 `last_at = at`。这样 5 分钟窗口内同一个签名
   不能再用第二次。
6. **挤占**：先 `requeueTaken(daemonId)`（旧连接取走但没回执的条目回到 `queued`），再用
   `ctx.getWebSockets('daemon:'+daemonId)` 找到旧连接并 `close(4002, 'replaced')`；接受新连接，
   标签 `daemon:<id>`，attachment `{role:'daemon', daemonId, at}`（`at` 是这个连接的签名时间戳，作为
   连接的代次）；`daemon_conn` 置 `last_at=at, connected_at=now, last_seen_at=now, synced=0`。
   先改 `last_at` 再关旧连接，旧连接的 close 回调看到 `attachment.at !== conn.last_at` 就知道自己已被
   取代，不再清连接状态（见 §7.4）。
7. 返回 101。daemon 随后发 `hello`（§10），再推全量视图，最后 `synced`。

连接不是"登录一次管很久"：每次重连都要新的 `at` 与签名；daemon 用 `Date.now()`，同一毫秒内的重试
会被 409 拒绝（客户端应等到下一毫秒或直接重连一次）。

### 3.4 客户登录与会话

P1 用邮箱魔法链接。**没有开放注册**；只有运营者邀请过、且未被删除的邮箱才可能收到链接。

**`POST /v1/login {email}`**
- 对不是被邀请客户（不存在 / 已删除 / 格式不对 / 超频）的邮箱一律 `202 {"ok":true}`，不泄露任何信息。
- 对被邀请客户（`customers.status IN ('invited','active')`）正常发信后也是 202；**发信失败时回
  `503 {"error":"mail-unavailable"}`**，让 App 显示可重试的「服务暂时不可用」，不吐内部细节。
  这是一个系统故障，不是可靠的「邮箱是否存在」信号（未邀请的邮箱根本不会走到发信），但邮件服务持续
  故障时状态码会不同；频率限制与下面「失败删 token」把可利用窗口压到最小。
- 邮箱先规范化：`trim().toLowerCase()`，长度 ≤ 320；不合格也回 202，不发信。
- 频率：同一邮箱每小时最多 5 次（按 `login_tokens.created_at` 数）。用一条条件插入，
  `COUNT < 5` 才插，避免并发多插。超了静默结束。**发信失败的 token 会被删除，重试不占这 5 次。**
- 生成 32 字节令牌 → `b64url`（43 字符），存 `sha256Hex(token)`，15 分钟，单用。
- 链接：`<HUB_ORIGIN>/login#token=<token>`（`HUB_ORIGIN` 是 Worker 变量，本地 `http://localhost:8790` 时
  由 dev-proxy 同源；直连中台时 `http://localhost:8787`）。
  **token 放 fragment**，不会进服务器日志或 Referer。
  `HUB_ORIGIN` 缺失或不是绝对 http(s) origin 时**拒发链接**：`POST /v1/login` 仍 202 但不发信，管理页的
  `login-link` 回 503 `hub-origin-missing`。**绝不用请求的 Host 兜底**（否则攻击者的 Host 能把 token 引到
  自己的域名）。
- 交给 `Mailer.send(email, link)`，按 `MAIL_MODE` 选三种实现：
  - `outbox`（默认）：写 D1 `outbox(id, customer_id, link, created_at, expires_at=now+15min)`，管理页显示，
    由运营者人工转发；读管理页时先删除过期行。
  - `console`：只打印「login link issued」，不打印邮箱或链接（凭证不进日志）。
  - **`resend`**：用 Resend 真发信（BLG-82/114），见 §3.4.1。

#### 3.4.1 用 Resend 发魔法链接

| 变量 | 值 / 说明 |
|---|---|
| `MAIL_MODE` | `resend`（默认是 `outbox`；没配 key 时 `resend` 会回落到 outbox，避免丢链接） |
| `RESEND_API_KEY` | Resend 的 API key；**只放在 secret / `.dev.vars`，永远不进代码与 git** |
| `MAIL_FROM` | 发件人，例如 `Synon Studio <login@your-verified-domain>`；域名必须先在 Resend 验证 |
| `HUB_ORIGIN` | App 的公开 origin，链接落在 `<HUB_ORIGIN>/login#token=…` |

**本地 `wrangler dev`**（key 放 gitignored 的 `.dev.vars`；Wrangler 本地 dev 不读远端的 secret）：

```sh
cd packages/studio-hub
# .dev.vars 已被 .gitignore；不要把 key 写进代码、wrangler.toml 或提交记录
cat >> .dev.vars <<'EOF'
MAIL_MODE=resend
RESEND_API_KEY=re_...
MAIL_FROM=Synon Studio <login@your-verified-domain>
HUB_ORIGIN=http://localhost:8790
EOF
npm run dev
```

**部署到 Cloudflare**（密钥用 wrangler secret 注入）：

```sh
cd packages/studio-hub
npx wrangler secret put RESEND_API_KEY   # 交互粘贴 key；不会写进 wrangler.toml
npx wrangler secret put MAIL_FROM        # 或把非机密的 MAIL_FROM 放 wrangler.toml [vars]
npx wrangler secret put MAIL_MODE        # 值填 resend；或放 wrangler.toml [vars]
npx wrangler deploy
```

- **发件域名**：先在 Resend 控制台验证域名（SPF/DKIM），再把 `MAIL_FROM` 设成该域名下的地址；用未验证
  的域名 Resend 会拒绝，登录页会收到 503 并把错误显示为「服务暂时不可用」。
- **邮件文案**：中文，标题「登录 Synon Studio」，正文含链接、`15 分钟内有效，只能使用一次`、落款
  `—— Synon Studio`；分钟数来自 `LOGIN_TOKEN_TTL_MS`（15），不是另写的常量。
- **失败**：Resend 非 2xx 或网络错误 → `issueLoginLink` 删除这次 token → `POST /v1/login` 503
  `mail-unavailable`；App 显示「服务暂时不可用，稍后再试。」和可重试的主按钮，不显示 Resend 的状态或正文。
  管理页的 `POST /v1/admin/customers/:cid/login-link` 不受影响：仍返回链接（`delivered:false`），运营者可以
  手动转发。
- **日志**：只记 `[studio] mail: resend answered <status>` 或 `[studio] mail: resend request failed`；
  不记邮箱、链接或 key。

**`POST /v1/login/verify {token}`**
- token 是 43 字符 b64url；`sha256Hex` 后原子消耗：
  `UPDATE login_tokens SET used_at=? WHERE token_hash=? AND used_at IS NULL AND expires_at>?`，
  `changes===1` 才算。失败 → 403 `{"error":"bad-link"}`（不区分已用/过期/不存在）。
- 建会话：32 字节新令牌，存 hash，30 天；同时把客户 `status` 从 `invited` 置为 `active`
  （管理页据此显示"已登录过"）。
- 响应：`200 {"session":"<43 字符>","expiresAt":<ms>,"customerId":"..."}`。会话明文只在这里出现一次。

**HTTP 鉴权**：`Authorization: Bearer <session>`。**WebSocket 鉴权**：
`Sec-WebSocket-Protocol: synon.v1, bearer.<session>`；服务端只回 `synon.v1`。会话**从不**放 query string。

**滑动续期**：每次用会话认证成功后，如果 `expires_at - now < 29 天`，把 `expires_at` 改为 `now + 30 天`。
有效期内最多每天续一次；没有单独字段。

**`POST /v1/logout`**：撤销当前会话（`revoked_at=now`），204。只为这个会话签发的套接字会被关闭（标签
`sess:<token_hash>`，见 §11）。

### 3.5 每个客户请求

1. `authCustomer(sessionToken, deps)`：`sha256Hex` → 查 `sessions`：未撤销、未过期；再查客户：
   `status IN ('invited','active')`（`removed` 一律拒）；同时做滑动续期。失败 → 401 `not-signed-in`。
2. 项目路由再用 `canAccess(customerId, projectId)` 查 `members`（每次查，不缓存）；没有 → 403 `not-yours`。
3. `projectId` 只从 URL 与成员关系来；请求体里的 `projectId`/`customerId`/`studioId` 一律忽略
   （动作帧里也没有这些字段）。
4. 客户被移出项目：下一次 HTTP 立刻 403；同时运营者操作会触发关闭该客户在该工作室的套接字。
5. 客户被删除：会话全部撤销、成员关系删除、令牌与 outbox 清除；所有工作室的套接字关闭。

## 4. D1 表（`packages/studio-hub/schema.sql`）

D1 是全局的，一个 Worker 一个库。时间一律毫秒 `INTEGER`；id 一律 `randomToken` 的 b64url（符合
`protocol.ts` 的 `ref` 正则 `[A-Za-z0-9_-]+`）。`PRAGMA foreign_keys` 在 D1 默认不一定开，删除按
"先子后父"显式做，不依赖级联。

```sql
-- 运营者建的工作室；P1 只有令牌，没有 operator 表
CREATE TABLE studios (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- 一次性绑定码：只存 hash，明文只在签发响应里
CREATE TABLE link_codes (
  code_hash  TEXT PRIMARY KEY,          -- sha256Hex(8 位无横线大写码)
  studio_id  TEXT NOT NULL REFERENCES studios(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at    INTEGER,
  daemon_id  TEXT                       -- 兑换成功后记下是哪台
);
CREATE INDEX link_codes_by_studio ON link_codes (studio_id, created_at);

-- 已登记的 daemon 设备。public_key 是 SPKI DER 的标准 base64
CREATE TABLE daemons (
  id         TEXT PRIMARY KEY,          -- b64url(sha256(key)).slice(0,32)
  studio_id  TEXT NOT NULL REFERENCES studios(id),
  public_key TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX daemons_by_studio ON daemons (studio_id);

-- daemon 在 hello 里报的项目（管理页的下拉数据）；每次 hello 全量替换这台 daemon 的集合
CREATE TABLE daemon_projects (
  daemon_id  TEXT NOT NULL REFERENCES daemons(id),
  project_id TEXT NOT NULL,             -- daemon 本机的项目 id（ref）
  name       TEXT NOT NULL,
  seen_at    INTEGER NOT NULL,
  PRIMARY KEY (daemon_id, project_id)
);

-- 客户账号是全局的：同一个邮箱可以在多个工作室的项目里（P1 只有一个运营者，按邮箱唯一即可）
CREATE TABLE customers (
  id         TEXT PRIMARY KEY,
  email      TEXT NOT NULL UNIQUE,      -- 已 trim + 小写
  name       TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL CHECK (status IN ('invited','active','removed')),
  created_at INTEGER NOT NULL
);

-- 一个 Studio 项目 = 一个 daemon 项目；一项目最多绑一台 daemon
CREATE TABLE projects (
  id                TEXT PRIMARY KEY,
  studio_id         TEXT NOT NULL REFERENCES studios(id),
  name              TEXT NOT NULL,
  daemon_id         TEXT REFERENCES daemons(id),
  daemon_project_id TEXT,
  created_at        INTEGER NOT NULL,
  UNIQUE (daemon_id, daemon_project_id)  -- 同一 daemon 项目只能映射一个 Studio 项目
);
CREATE INDEX projects_by_studio ON projects (studio_id);

CREATE TABLE members (
  project_id  TEXT NOT NULL REFERENCES projects(id),
  customer_id TEXT NOT NULL REFERENCES customers(id),
  added_at    INTEGER NOT NULL,
  PRIMARY KEY (project_id, customer_id)
);
CREATE INDEX members_by_customer ON members (customer_id);

-- 魔法链接令牌，单用，15 分钟
CREATE TABLE login_tokens (
  token_hash  TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  used_at     INTEGER
);
CREATE INDEX login_tokens_by_customer ON login_tokens (customer_id, created_at);

-- 客户会话，30 天，滑动续期，可撤销
CREATE TABLE sessions (
  token_hash  TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  revoked_at  INTEGER
);
CREATE INDEX sessions_by_customer ON sessions (customer_id);

-- 人工转发的魔法链接；过期即删。明文凭证，只给运营者看
CREATE TABLE outbox (
  id          TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  link        TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX outbox_by_time ON outbox (expires_at);
```

**映射规则（`accounts.ts`，在 handler 里判，壳不做）**：
- 绑定时 daemon 必须存在、未吊销、属于同一工作室；
- `daemonProjectId` 必须出现在这台 daemon 的 `daemon_projects` 里（管理页从下拉里选，不手填）；
- 项目已绑了另一台 daemon → `409 already-bound`（要先 `DELETE` 解绑）；
- 该 daemon 项目已映射到另一个 Studio 项目 → `409 already-mapped`；
- 解绑只清 `daemon_id`/`daemon_project_id`，队列里该项目的条目留着，7 天内重新绑定还能送达，否则过期。

**清理**：
- `outbox`：读管理页、发登录链接、登录时删除 `expires_at < now` 的行。
- `login_tokens`：同上，删除过期的。
- 删除客户：`status='removed'`，删除其 `members`、`login_tokens`、`sessions`、`outbox` 行；保留
  `customers` 行作为墓碑（`email` 仍占 UNIQUE）。再次邀请同一邮箱视为**新账号**：删墓碑、新建一行
  `status='invited'`（旧数据已清）。30 天后可再清墓碑，P1 不做定时任务，读管理页时顺手清。
- 删除工作室：P1 不做（没有路由）。

## 5. Durable Object（每工作室一个）

- 绑定名 `STUDIO`，`class StudioHub`；`env.STUDIO.get(env.STUDIO.idFromName(studioId))`。
- DO 同时绑定 D1（`env.DB`）：`hub.ts` 用 D1 实现一个 `HubStore` 交给 handler。daemon 验签要查
  `daemons`，`hello` 要写 `daemon_projects`，客户请求要重查成员关系。**D1 是跨工作室的真相，DO 不缓存它。**
- 存储用 `ctx.storage.sql`（SQLite 后端，Free 计划唯一支持的形式，与 mailbox 的
  `new_sqlite_classes` 相同）。**不用 KV 式 storage 存大对象**；需要原子的是 SQL。
- 构造时 `CREATE TABLE IF NOT EXISTS`（见下），不做迁移框架；M2 是新建的表。
- **所有状态在 SQLite**；内存里不存队列、连接表、授权结论（hibernation 会丢）。

```sql
-- 每个计划的最新一份完整视图（StudioPlanView JSON）
CREATE TABLE views (
  project_id TEXT NOT NULL,
  plan_ref   TEXT NOT NULL,
  rev        INTEGER NOT NULL,
  view_json  TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, plan_ref)
);

-- 客户可见的对话轮次；每计划最多 500 条
CREATE TABLE turns (
  project_id TEXT NOT NULL,
  plan_ref   TEXT NOT NULL,
  turn_id    TEXT NOT NULL,
  at         INTEGER NOT NULL,
  json       TEXT NOT NULL,
  PRIMARY KEY (project_id, plan_ref, turn_id)
);
CREATE INDEX turns_order ON turns (project_id, plan_ref, at, turn_id);

-- 客户动作队列。seq 是到达顺序（AUTOINCREMENT 单调）
CREATE TABLE queue (
  seq         INTEGER PRIMARY KEY AUTOINCREMENT,
  op_key      TEXT NOT NULL UNIQUE,
  op_id       TEXT NOT NULL,
  project_id  TEXT NOT NULL,            -- Studio 项目 id
  plan_ref    TEXT,
  customer_id TEXT NOT NULL,
  kind        TEXT NOT NULL,
  frame_json  TEXT NOT NULL,            -- 校验过的 StudioAction 原帧
  state       TEXT NOT NULL CHECK (state IN ('queued','taken','done','refused','expired')),
  enqueued_at INTEGER NOT NULL,
  taken_by    TEXT,
  taken_at    INTEGER
);
CREATE INDEX queue_take ON queue (state, seq);
CREATE INDEX queue_by_daemon ON queue (taken_by, state);

-- opId 回执：每个 op_key 一条，状态随执行更新；至少留 14 天
CREATE TABLE ops (
  op_key     TEXT PRIMARY KEY,
  state      TEXT NOT NULL CHECK (state IN ('queued','done','refused','expired')),
  code       TEXT,
  at         INTEGER NOT NULL,          -- 第一次入队（或拒绝）的时间
  updated_at INTEGER NOT NULL
);
CREATE INDEX ops_prune ON ops (updated_at);

-- 频率：只存"分钟桶"；当天合计 = SUM(n)、SUM(chars) WHERE window_start >= 当天 0 点
CREATE TABLE rate (
  customer_id  TEXT NOT NULL,
  plan_key     TEXT NOT NULL,           -- 'plan:<ref>'；plan.create 用 'new:<project>'
  window_start INTEGER NOT NULL,        -- now - now % 60000
  n            INTEGER NOT NULL,
  chars        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (customer_id, plan_key, window_start)
);

-- 每台 daemon 的连接与重放状态
CREATE TABLE daemon_conn (
  daemon_id    TEXT PRIMARY KEY,
  last_at      INTEGER NOT NULL,        -- 最近一次被接受的签名时间戳
  connected_at INTEGER,                 -- NULL = 离线
  last_seen_at INTEGER NOT NULL,
  synced       INTEGER NOT NULL DEFAULT 0
);

-- 拒收的帧、坏视图、未映射项目；只放固定代码，不放正文
CREATE TABLE alerts (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  at        INTEGER NOT NULL,
  daemon_id TEXT,
  what      TEXT NOT NULL               -- ≤ 60 字，如 'bad-view:planRef'
);
```

**为什么这样分**：
- 队列的 `seq`、opId 的唯一性、rev 的"加一才应用"、同一 daemon 的"新连接挤掉旧连接"都需要在一个
  单线程里比较后写入。放 D1 会有两个请求同时读、同时写的竞态。
- 授权不放 DO：成员关系在 D1，DO 每次请求重查，所以运营者在管理页移除成员后，DO 里不会留着旧结论。
  休眠唤醒后也没有内存可丢。
- 视图和 turns 是"这个工作室的数据"，广播也只在这个 DO 内，天然按工作室隔离。

**alarm**：每 24 小时跑一次 `expire(now)` + `prune(now)`，然后重排 24 小时后。构造/每次有状态写入后
确保 alarm 存在。读视图、取队列前也先 `expire`（不依赖 alarm 准时）。

## 6. 路由

两条链路：
- **Worker（全局）**：`routeOf` 先解析路径；全局路由直接 `handleHubRequest`，用 D1 的 `HubStore`。
- **DO（工作室）**：Worker 从 D1 找到 `studioId`（daemon→studio、project→studio），把 `Request` 原样
  `fetch` 给 `env.STUDIO.get(idFromName(studioId))`，并加内部头 `x-studio-auth`（JSON）：
  - 客户：`{"role":"app","customerId":"...","projectId":"...","sessionHash":"..."}`
    （`sessionHash` 只在 WS 升级时给，用来打 `sess:` 标签；HTTP 路由不需要）
  - daemon：`{"role":"daemon","daemonId":"..."}`
  - 运营者：`{"role":"operator"}`
  **Worker 必须先剥掉客户端自带的 `x-studio-auth` 与 `x-internal-*` 头，再用自己的值写入**。daemon 的
  `x-studio-daemon`/`x-studio-at`/`x-studio-sig` 是它自己的签名，**原样保留**，不能被当成内部头剥掉。
  DO 的 `fetch` 只能被本 Worker 的 stub 调到（不对公网），所以内部头可信；但 handler 在 DO 内仍会用
  `HubStore` 重查客户成员关系（防壳漏判），daemon 则重验签名与重放。

### 6.1 公开与运营者

| 方法与路由 | 鉴权 | 去处 | 说明 |
|---|---|---|---|
| `GET /` | 无 | Worker | `ADMIN_HTML`；带 CSP、nosniff、no-referrer |
| `GET /healthz` | 无 | Worker | `{"ok":true,"proto":{"major":1,"minor":0}}` |
| `POST /v1/link` | 绑定码 + Ed25519 | Worker + D1 | §3.2 登记，返回 `{studioId, daemonId}` |
| `POST /v1/login` | 无 | Worker + D1 | 恒 202，§3.4 |
| `POST /v1/login/verify` | 令牌 | Worker + D1 | 返回 `{session, expiresAt, customerId}` |
| `POST /v1/logout` | 会话 | Worker + D1 + DO | 撤销会话；按该客户的成员关系找到各工作室，逐个调内部 close 关 `sess:<hash>` 套接字 |
| `GET /v1/admin/studios` | 运营者 | Worker + D1 | `{"studios":[{id,name,createdAt}]}` |
| `POST /v1/admin/studios` | 运营者 | Worker + D1 | `{name}` → `{studio, linkCode:{code,expiresAt}}` |
| `POST /v1/admin/studios/:sid/link-codes` | 运营者 | Worker + D1 | 作废旧码，签发新码：`{code, expiresAt}` |
| `GET /v1/admin/studios/:sid` | 运营者 | Worker（D1）+ DO（在线/alerts） | 管理页详情，见下 |
| `GET /v1/admin/customers` | 运营者 | Worker + D1 | 全局客户列表（`?studio=` 可选过滤），给页面兜底 |
| `POST /v1/admin/customers` | 运营者 | Worker + D1 | `{email, name?}` 邀请；已存在返回已有行；removed 邮箱按新账号 |
| `DELETE /v1/admin/customers/:cid` | 运营者 | Worker + D1 + DO | 删除账号：撤销会话、删成员/令牌/outbox，关各工作室里 `cust:<cid>` 套接字 |
| `POST /v1/admin/customers/:cid/login-link` | 运营者 | Worker + D1 | 立刻发一封魔法链接；返回 `{link, expiresAt}`；超频 429 |
| `POST /v1/admin/studios/:sid/projects` | 运营者 | Worker + D1 | `{name}` → `{project}`；可随后绑定 daemon |
| `PUT /v1/admin/projects/:pid/daemon` | 运营者 | Worker + D1 | `{daemonId, daemonProjectId}` 映射；规则见 §4 |
| `DELETE /v1/admin/projects/:pid/daemon` | 运营者 | Worker + D1 | 解绑，保留项目与成员 |
| `PUT /v1/admin/projects/:pid/members/:cid` | 运营者 | Worker + D1 | 加成员（幂等） |
| `DELETE /v1/admin/projects/:pid/members/:cid` | 运营者 | Worker + D1 + DO | 移除成员；关该客户在该工作室的套接字 |
| `DELETE /v1/admin/daemons/:did` | 运营者 | Worker + D1 + DO | 吊销设备（`revoked_at`）；关 `daemon:<did>`；其 taken 条目回队 |

**`GET /v1/admin/studios/:sid` 的响应**（Worker 合并 D1 与这个工作室 DO 的内部状态）：

```json
{
  "studio": { "id": "...", "name": "...", "createdAt": 0 },
  "daemons": [{ "id": "...", "name": "Studio Mac", "revokedAt": null,
                "online": true, "synced": true,
                "connectedAt": 0, "lastSeenAt": 0 }],
  "daemonProjects": [{ "daemonId": "...", "id": "proj_api", "name": "api", "seenAt": 0 }],
  "projects": [{ "id": "...", "name": "客户 App", "daemonId": "...",
                 "daemonProjectId": "proj_api", "createdAt": 0,
                 "memberIds": ["..."] }],
  "customers": [{ "id": "...", "email": "a@b.c", "name": "", "status": "invited",
                  "projectIds": ["..."] }],
  "alerts": [{ "at": 0, "daemonId": "...", "what": "bad-view:m0" }],
  "outbox": [{ "id": "...", "customerId": "...", "email": "a@b.c", "link": "https://.../login#token=...",
               "createdAt": 0, "expiresAt": 0 }]
}
```

- `customers` 列的是"在这个工作室的某个项目里有成员关系"的客户；刚邀请、还没加入项目的客户靠
  `POST /v1/admin/customers` 的响应直接进入"加入项目"这一步，不依赖这个列表。
- `online` = DO 里 `connected_at` 非空；`synced` = 收到过 `{t:'synced'}`。管理页对"离线超过 15 分钟"
  标红（页面自己比较 `lastSeenAt`）。
- `outbox` 只列未过期的、且客户是该工作室某个项目成员的（outbox 表没有工作室列，按成员关系过滤）；
  Worker 读之前先删过期行。

### 6.2 客户

| 方法与路由 | 鉴权 | 去处 | 说明 |
|---|---|---|---|
| `GET /v1/app/projects` | 会话 | Worker + D1 | `{"projects":[{id, studioId, studioName, name}]}`，只列成员关系里的项目 |
| `GET /v1/app/projects/:pid/plans` | 会话 + 成员 | DO | `{"plans":[{planRef,title,stage,waitingOn,headline,progress,updatedAt}]}` |
| `GET /v1/app/projects/:pid/plans/:ref` | 会话 + 成员 | DO | `{"view":StudioPlanView,"updatedAt":...}`；没有 → 404 `unknown-plan` |
| `GET /v1/app/projects/:pid/plans/:ref/turns?before=&limit=` | 会话 + 成员 | DO | `{"turns":[StudioTurn...],"more":bool}`；`before` 为 turn id（不含），按 `(at,id)` 升序返回，最多 50 |
| `POST /v1/app/projects/:pid/actions` | 会话 + 成员 | DO | 体为 `StudioAction`（strict）；返回 `{"receipt":...}`，见 §7 |
| `GET /v1/app/projects/:pid/ws` | 会话 + 成员（子协议） | DO | 客户 WebSocket，只收本项目的 `plan`/`plan-gone`/`receipt` |
| `GET /v1/app/projects/:pid/previews/:m` | 会话 + 成员 | DO | **P1 恒 403** `{"error":"not-delivered"}` |

客户动作**只走 HTTP**，WebSocket 上不发动作。回执两边都给：HTTP 立刻返回排队/拒绝的回执；执行结果通过
该项目的套接字广播（`receipt`），断线的话下次 `GET plans/:ref` 也能从缓存看到结果。

客户套接字被接受后，DO 先把该项目每个计划的缓存视图各发一帧 `plan`（`view.turns` 取最近 50），
再进入广播；这样客户端"先 GET 列表再连 WS"与"先连 WS"都不会漏掉当前状态。

**动作的 HTTP 状态**：
- 没有会话 → 401 `not-signed-in`；不是成员 → 403 `not-yours`；
- 体不是合法 JSON、或没有可用的 opId（`^[0-9a-f-]{36}$`）→ 400 `bad-args`；
- 其余一律 200，体是回执：`state` 为 `queued` / `done` / `refused` / `expired`，`refused` 带 `code`
  （客户语言由客户端按码显示，不带原文原因）。

### 6.3 daemon

| 方法与路由 | 鉴权 | 去处 | 说明 |
|---|---|---|---|
| `GET /v1/daemon/ws` | §3.3 的签名头 | DO | 唯一的 daemon 入口；Worker 先按 `x-studio-daemon` 查 D1 找到工作室，再转 DO |

### 6.4 Worker → DO 的内部路由（不对公网）

Worker 只在验证/查询之后调用；请求仍带 `x-studio-auth`。handler 在 DO 里判角色，未知路径 404。

| 方法与路由 | 用途 |
|---|---|
| `GET /v1/internal/studios/:sid/status` | 管理页需要的在线状态、`daemon_conn`、alerts |
| `POST /v1/internal/close` | 体 `{role:'daemon' / 'customer' / 'session', id}`；壳关闭匹配标签的套接字（吊销、移除、登出） |
| `POST /v1/internal/resync` | 体 `{daemonId, project}`；M3：项目刚在管理页映射到 daemon 后，让 daemon 立刻推这个项目的全量视图 |

`POST /v1/internal/close` 是纯传输动作：Worker 已经在 D1 改完状态（吊销、移除、登出），这里只让 DO 把
受影响的套接字关掉，不重新判断业务。

### 6.5 错误形状与状态码

```json
{ "error": "not-yours", "code": "not-yours" }
```

`error` 是稳定的小写串（壳与测试都按它断言）；`code` 只在它同时是 `RefusalCode` 时出现。常用：

| 状态 | error | 场景 |
|---|---|---|
| 400 | `bad-args` / `bad-body` | JSON、字段、格式不对 |
| 401 | `not-signed-in` / `operator-only` / `unknown-daemon` / `bad-signature` / `clock-skew` | 未认证 |
| 403 | `not-yours` / `revoked` / `bad-or-expired-code` / `bad-link` / `not-delivered` | 已认证但无权 |
| 404 | `unknown-plan` / `unknown-project` / `unknown-daemon-project` | 不存在 |
| 409 | `key-taken` / `already-bound` / `already-mapped` / `replayed` | 冲突 |
| 429 | `rate-limited` | 频率 |
| 503 | `mail-unavailable` | 被邀请客户的登录邮件发不出去（可重试；不返回邮件服务细节） |
| 500 | `internal` | 未预期错误；不返回堆栈、不记正文 |

日志只记 `{route, status, ms}` 与帧类型/大小；**不记请求体、邮箱、令牌、链接、客户文字**。`MAIL_MODE`
默认是 `outbox`；`console` 只打印“login link issued”，不打印邮箱或链接（凭证不进日志）。

## 7. 队列、opId 与频率（`src/net/studio/queue.ts`）

### 7.1 `enqueue`

入口：`enqueue(frame, ctx, deps)`，`ctx = {studio, projectId, customerId, projectName?}`。步骤：

1. **解析**：`StudioAction.safeParse(frame)`（strict）。失败时若能取出合法 `opId`（`opIdOf`），按
   `checkAction` 的规则回 `refused`（`bad-args` 或 `not-allowed`）并记 ops；否则 400。坏帧也要走到限频。
2. **opKey**：`opKey({studio, plan: planRef, project: projectId}, opId)`（`actions.ts` 原样；键为
   **studio、project、plan、opId**，`opId` 小写）。同一工作室的两个项目可以各有一个 `plan1`，所以 project 必须
   在键里。`plan.create` 没有 `planRef`，plan 段是 `new`。
3. **成员**：`hub.canAccess(customerId, projectId)` 不通过 → 403 `not-yours`。HTTP 路由的 `appGuard` 也先判一次，
   这里是 DO 自己的第二道。
4. **过期与回执优先**：先 `expire(now)`（7 天前的 queued/taken 变 expired），再查 `StudioStore.op(opKey)`：
   存在 → 返回它的**当前**状态（queued/done/refused/expired）。**幂等重发不受频率限制影响**，所以这一步在限频
   之前（见 §15 差异说明）。
5. **频率**（**所有**帧都计入，包括坏帧和命名了不存在计划的帧）：
   - 每客户每项目每分钟 ≤ 20 条；
   - 每天 ≤ 300 条（按 `now - now % DAY_MS` 的 UTC 日，不随本地时区变化）；
   - 键是（客户、项目）；只有当该项目确实有这份缓存视图时，才细分为（客户、项目、计划）——键不来自可无限
     取名的新请求字段；
   - 带文字的 kind 额外计当天总量 ≤ 50 000 字（`chars` = 各字段长度之和：`chat.send.text`、
     `milestone.sendBack.reason`、`decision.answer.text`、`plan.create.goal`）；
   - 超了 → 记 ops `refused/rate-limited`，返回回执 `refused`。
6. **合成 PlanFacts**（从该计划的缓存视图）：
   ```ts
   { id: planRef, home: 'hub', started: stage !== 'drafting' && stage !== 'awaiting-start',
     draftRev: view.draftRev,
     milestones: { 'm0': { id: 'm0', awaitingReview: status === 'review' }, ... },
     decisions: { [decisionId]: { audience: 'customer', open, qid: '',
                                  question, options: { [o.id]: o.label, ... }, multi } } }
   ```
   缓存里的决策已经是"只给客户的"（`view.ts` 构造时过滤），所以 `audience` 恒为 `customer`；
   `qid` 在 hub 侧没有意义，用 `''` 占位（daemon 执行时用自己状态里的真 qid）。`ctx.projectId` 是
   **daemon 项目 id**（来自映射）；没有映射时 `plan.create` 会被 `checkAction` 判 `not-yours`。
   `seen` 传 `() => undefined`（第 4 步已经处理过重放）。
7. **`checkAction`**（`src/studio/actions.ts`，与 daemon 同一份）：
   - `refused` → 记 ops `refused/code`，返回回执；
   - `replay`（理论上第 4 步已拦）→ 返回该回执；
   - `call` / `gate` → **合法**。入队的是**原帧**，不是 `call`。daemon 收到后自己再跑一次
     `checkAction`，得到它那边的 `call`/`gate`，并且 `callRefusal` 再兜一层。
8. **入队**：`INSERT INTO queue(op_key UNIQUE, op_id, project_id, plan_ref, customer_id, kind,
   frame_json, state='queued', enqueued_at=now)`；同时在 `ops` 记 `queued`。`op_key` 唯一冲突 → 回到第 4 步
   （并发重发）。
9. **回执**：立刻返回 `{"t":"receipt","opId","state":"queued",..."planRef"}`；若该项目的 daemon
   已 `synced`，接着 `take` 并投递（§7.2）。

队列条目字段就是上表 `queue` 的列；`frame_json` 是原帧（含 `t:'action'`、opId、kind、payload），
所以 daemon 收到的 `deliver.action` 可以原样再过一次 `checkAction`。

### 7.2 `take(daemonId)`

- 前置：`daemon_conn.synced = 1` 且 `connected_at` 非空；否则不取（daemon 还在 `hello`/全量快照）。
- 先 `expire(now)`。
- 找出"映射到这台 daemon 的 Studio 项目"（`projects.daemon_id = daemonId`）里 `state='queued'` 的条目，
  按 `seq` 升序，最多 `DELIVER_MAX=50` 条；逐条标 `state='taken', taken_by=daemonId, taken_at=now`。
- 为每条产生一个出站效果：
  `{t:'deliver', seq, project: <该项目的 daemon_project_id>, action: <原帧>}`。
- 多条按 `seq` 顺序写入同一个套接字；传输是有序的，daemon 按顺序执行（同一计划严格逐条；不同计划也按
  到达顺序，允许并发执行但校验各自独立）。
- **一条动作被拒不影响后面的**：每条独立按当前状态与 `draftRev` 校验。

### 7.3 `ack(daemonId, receipt)`

- daemon 回的 `StudioReceipt` 必须过 strict schema。`state` 只接受 `done`/`refused`；`queued`/`expired`
  是 hub 侧产生的，daemon 发了就忽略并 alert 一次 `bad-receipt`。
- 找队列行：`state='taken' AND taken_by=daemonId AND op_id=receipt.opId`；若多于一条，用 `planRef` 收窄；
  仍不唯一 → 忽略并 alert。找不到 → 忽略（超时已被 `expired` 的行）。
- 更新：`queue.state = 'done'|'refused'`、`ops.state` 同步、`ops.code`（refused 时），`updated_at=now`。
- 产生给客户的回执效果：`{to:'app', projectId, frame:{t:'receipt',opId,state,code?,planRef}}`，广播给
  `app:<projectId>` 的所有套接字（同一项目的其他成员也能看到这条回执；回执里没有正文）。
- 之后如果还有 `queued`，再 `take` 一批（每次 ack 最多触发一次）。

### 7.4 断开、过期与清理

- **daemon 断开**（`webSocketClose`/`webSocketError`）：
  1. 读 socket 的 attachment `{daemonId, at}`；若 `at !== daemon_conn.last_at`，说明已有新连接接管
     （挤占），**什么都不做**——新连接来之前已经把 taken 条目回队（§3.3 步骤 6）；
  2. 否则：`daemon_conn.connected_at=NULL, synced=0`；该 daemon 所有 `state='taken'` 的条目回到
     `queued`（`taken_by=NULL, taken_at=NULL`，`seq` 不变）；
  3. 不清队列、不给客户发假回执。daemon 自己的 `OpLog` 防止重连后二次执行同一 opId。
- **`expire(now)`**：`state IN ('queued','taken') AND enqueued_at < now - 7 天` → `state='expired'`，
  `ops.state='expired'`；给对应项目广播回执 `expired`（客户看到"没来得及处理，请重新操作"）。
  已 `taken` 的超时条目也过期（daemon 若稍后回执，找不到 taken 行，忽略）。
- **`prune(now)`**：删除 `ops.updated_at < now - 14 天` 且状态终结（done/refused/expired）的行；删除
  `queue` 里终结且 `enqueued_at < now - 14 天` 的行。**opId 回执至少留 14 天**，比队列的 7 天更长，
  所以第 8–14 天重放同一 opId 仍返回原结果，不会重新执行。
- DO alarm 每天 `expire` + `prune`；`enqueue`/`take`/读视图前也先 `expire`，不依赖 alarm 准时。

### 7.5 离线矩阵

| 客户动作 | daemon 离线时 | 客户看到 |
|---|---|---|
| `plan.create` | 排队（项目已映射时） | `queued`：工作室上线后开始规划 |
| `chat.send` | 排队 | 消息旁标"已排队" |
| `decision.answer` | 排队；上线后决策已关 → `refused: not-open` | 已记下，上线后生效 |
| `plan.requestStart` / `draft.apply` | 排队；上线时 `draftRev` 不符 → `refused: stale` | 已确认，等工作室上线 |
| `milestone.pass` / `sendBack` | 排队；`draftRev` 不符或已不在待验收 → 拒 | 已记下 |
| `draft.discard` | 排队 | 同上 |

队列条目的 `state` 从 `queued` → `taken` → `done`/`refused`/`expired`；客户从 HTTP 回执、WebSocket
回执或下次读视图三处之一得知结果。

## 8. 视图缓存与重连（`src/net/studio/views.ts`）

### 8.1 `ingestPlan(daemonId, {project, frame}, deps)`

- `project` 必须是映射到**这台** daemon 的 daemon 项目；否则拒收、写 alert `unmapped-project`，不缓存。
- `frame` 是 `PlanFrame`（`{t:'plan', rev, view}`）。`StudioPlanView.safeParse(frame.view)`（`.strict()`）
  再校验一次（信封解析已经做过一次，这里为了拿到明确错误与审计）；**多余字段、超长、非法枚举 → 整帧拒绝**，
  写 alert `bad-view:<planRef>`，`console.error` 只打类型与 daemon id，**不覆盖旧缓存**。
- 成功：全量替换 `views(project_id, plan_ref, rev=frame.rev, view_json, updated_at=now)`。
- turns：`view.turns` 按 `turn_id` 合并进 `turns`（`INSERT OR REPLACE`，同 id 以新的为准），
  按 `(at, turn_id)` 排序，**每计划只留最近 500 条**（多的删掉）。
- 广播：给 `app:<projectId>` 的套接字发 `{t:'plan', rev, view}`，其中 `view.turns` 取**合并后**（从
  `turns` 表读）最近 50 条，不是只取 daemon 这一帧自带的；`moreTurns = 历史总数 > 50 || view.moreTurns`。
  `view` 仍过 strict schema。
- 全量快照**任何时候都替换**（daemon 重启后 rev 可能归零，不能按"rev 更大"比较）。
- `PlanGoneFrame`：删除该计划的 `views` 与 `turns`，广播 `{t:'plan-gone', planRef}`。

### 8.2 `ingestPatch(daemonId, {project, planRef, rev, set?, turns?}, deps)`

M3 起在线上：`DaemonUp` 的 `patch` 分支（§10.1）收到即调本函数，effects 直接执行。

- `rev === 当前 rev + 1` 才应用；否则丢弃，回 `{t:'resync', project, planRef}`（让 daemon 推全量）。
- `set` 是 `StudioPlanView` 的顶层字段补丁；合并后**整份再过 strict schema**，失败则丢弃、写 alert、
  回 `resync`，不覆盖旧缓存。`set` **不能改 `planRef`**（与请求里的不一致就拒），否则 rev 校验的行和写入的行
  会不是同一份计划。
- `turns` 用与全量相同的合并、排序、截 500。
- 全量快照永远可以覆盖增量状态；增量不能"降级"全量。

### 8.3 重连顺序（固定）

1. daemon 连上（§3.3），发 `hello`（项目列表）→ `daemon_conn` 仍是 `synced=0`；
2. 每个计划发一个全量 `{t:'for', project, frame:{t:'plan',rev,view}}`；
3. 发 `{t:'synced'}` → hub 置 `synced=1`，**这时才** `take` 队列；
4. 之后 daemon 才收到 `deliver`。

这样排队动作不会基于旧视图执行；每条动作在 daemon 那边执行前还会再按当前状态与 `draftRev` 校验一次。

### 8.4 读视图

- `readView(projectId, planRef)`：读 `views` 的 JSON，反序列化后仍过 strict schema（缓存是自己写的，
  但坏了要能发现）；`turns`/`moreTurns` 与广播一样从 `turns` 表取最近 50 条覆盖，保证与
  `GET …/turns` 的分页一致；没有 → 404。
- `listPlans(projectId)`：每行取 `title/stage/waitingOn/headline/progress/updated_at`，按 `updated_at` 倒序。
- `turnsBefore(projectId, planRef, before, limit)`：按 `(at, turn_id)` 的升序返回 `before` 之前的一页，
  最多 50；`more` = 再往前还有。

## 9. 预览链接门控（`src/net/studio/views.ts`）

```ts
previewLink(gate: StudioGate | undefined, req: { objectKey: string }, secret: string, now: number)
  : { ok: true; url: string; exp: number } | { ok: false; code: 'not-delivered' }
```

- **只有** `gate?.kind === 'deliver' && gate.state === 'approved'` 才可能签发；其他一切情况（没有 gate、
  `start`/`changes` gate、pending/declined、未知 kind）都返回 `{ok:false, code:'not-delivered'}`。
  `deliver` 是 P2 才追加进 `StudioGate.kind` 的值；P1 里没有任何路径能构造出它。
- 放行时：`exp = now + 15 分钟`；`sig = HMAC-SHA256(secret, "<objectKey>:<exp>")`（b64url）；
  `url = <deps.origin>/p/<objectKey>?exp=<exp>&sig=<sig>`（P2 的预览路由；P1 不存在）。
- **P1 的路由恒拒**：`GET /v1/app/projects/:pid/previews/:m` 无论 gate 如何都 403
  `{"error":"not-delivered"}`；没有数据来源，`PREVIEW_SECRET` 可以不配。P2 接上存储后才改这条路由。
- 测试必须覆盖：无 gate、start gate approved、changes gate approved、deliver gate pending、
  deliver gate declined、deliver gate approved（唯一放行）；并断言 P1 路由恒 403。

## 10. 传输信封（`handler.ts`，zod strict）

协议里的 `DaemonFrame`/`AppFrame` 是**内层**帧；线上多一层信封，因为同一个套接字要区分项目。所有信封
`.strict()`，字符串上限沿用 `protocol.ts` 的 `LIMITS`。`docs/studio-protocol.md` §4 列的是内层帧；
M3 的 daemon 连接器按本文的信封实现，并在那份文档补一行指向本节（M3 必须照此实现，改动要回写本文）。

### 10.1 daemon → hub：`DaemonUp`

| `t` | 形状 | 说明 |
|---|---|---|
| `hello` | `{t:'hello', proto:{major,minor}, daemon: REF, projects:[{id:REF,name:TITLE}] (≤200)}` | 连接后第一帧。`daemon` 必须等于已认证的 daemon id（否则关闭 4003）。写 `daemon_projects`（全量替换）。`major` 不等 → 回 `outdated` 并关闭 4001。 |
| `for` | `{t:'for', project: REF, frame: PlanFrame \| PlanGoneFrame}` | 视图帧；`project` 必须是映射到本 daemon 的项目。 |
| `receipt` | `StudioReceipt`（`{t:'receipt', opId, state, code?, planRef?}`） | 动作回执（ack）。只接受 `done`/`refused`。 |
| `synced` | `{t:'synced'}` | 全量推完；收到后才开始投递队列。 |
| `patch` | `{t:'patch', project: REF, planRef: REF, rev: int, set?: Record<string, unknown>, turns?: StudioTurn[] (≤50)}` | M3 起的增量帧。`.strict()`；调 `ingestPatch`（§8.2），rev 必须是缓存 + 1，合并后整份再过 strict `StudioPlanView`；缺口、坏字段、计划未知都回 `resync`，不覆盖旧缓存。 |

`hello` 之前收到 `for`/`receipt`/`synced` → 关闭 4003 `not-hello`。任何一帧 JSON 或 schema 失败 →
忽略、写 alert `bad-frame`（每连接最多一条），**不关闭**连接（避免版本差异导致重连风暴）。

### 10.2 hub → daemon：`HubDown`

| `t` | 形状 | 说明 |
|---|---|---|
| `welcome` | `{t:'welcome', studio: REF, proto:{major,minor}}` | `hello` 校验通过后回；`studio` 是 opId 作用域要用的工作室 id。 |
| `deliver` | `{t:'deliver', seq:int, project: REF, action: StudioAction}` | 一条排队动作；`project` 是**daemon 自己的**项目 id。 |
| `resync` | `{t:'resync', project: REF, planRef?: REF}` | 全量重推请求（M3 增量出现缺口时；M2 只对过早的 `patch` 回）。 |
| `outdated` | `{t:'outdated'}` | `hello.proto.major` 与 hub 不等；随后关闭 4001。 |

### 10.3 hub → app：`AppFrame`

直接用 `src/studio/protocol.ts` 的 `AppFrame`：`plan`（`StudioPlanViewLoose`）、`plan-gone`、`receipt`。
客户 app 在 WS 上**不发**动作；动作走 HTTP。

### 10.4 版本

- 同一 `STUDIO_PROTO.major` 内只做加法；hub 对 daemon 视图用 `.strict()`，所以 **hub 先升级、daemon 后升级**。
- daemon 的 `minor` 比 hub 新：hub 仍按自己的 schema 收，未知字段会被 strict 拒绝 → 回 alert；上线顺序避免。
- daemon 的 `major` 更旧或更新：`outdated` + 关闭，管理页标"工作室需要更新"。

## 11. WebSocket：DO 的 hibernation API

mailbox 没有 WebSocket，这是新代码。选 **Durable Object 的 hibernation WebSocket API**（不是普通
`WebSocketPair` + 内存表）：免费/低成本，空闲时 DO 休眠，连接保持；代价是**内存状态会丢**，所以一切状态
放 SQLite 或 `serializeAttachment`。

### 11.1 接入

```ts
// 在 DO 内，handler 判定身份与权限之后
const { 0: client, 1: server } = new WebSocketPair();
ctx.acceptWebSocket(server, tags);                 // 最多 10 个标签，每个 ≤256 字符
server.serializeAttachment({ role:'daemon', daemonId, at });    // 客户：{role:'app', customerId, projectId, sessionHash}
// 客户先收到缓存视图（onAppOpen 的 Effect 自己发）；daemon 在 hello 之前不发任何帧
return new Response(null, { status: 101, webSocket: client,
  headers: { 'Sec-WebSocket-Protocol': 'synon.v1' } });         // 客户连接才回子协议
```

标签：
- daemon：`daemon:<daemonId>`
- 客户：`app:<projectId>`、`cust:<customerId>`、`sess:<token_hash>`

标签是 DO 内查找套接字的唯一方式：广播 `ctx.getWebSockets('app:' + pid)`；挤占旧连接
`ctx.getWebSockets('daemon:' + did)`；登出关 `sess:<hash>`；删客户关 `cust:<cid>`。

### 11.2 生命周期

| API | 做什么 |
|---|---|
| `webSocketMessage(ws, message)` | 读 `ws.deserializeAttachment()`；daemon → `onDaemonMessage(daemonId, message, deps)`；app → 忽略（动作只走 HTTP）。返回的 `Effect[]` 逐条执行。 |
| `webSocketClose(ws, code, reason)` | 读 attachment；daemon → `onDaemonClose(daemonId, at, deps)`（§7.4 回收 taken；被挤占的旧连接由 `at` 判断后不做）；app → 无状态。总是 `ws.close(code, reason)` 收尾。 |
| `webSocketError(ws, err)` | 同 close。 |
| `fetch`（升级请求） | handler 判定身份；拒绝时返回 401/403/409，不建套接字。成功后 `acceptWebSocket` 并回 101。 |
| `alarm()` | `expire` + `prune`，重排 24 小时。 |

**自动 ping/pong**：`ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping','pong'))`；客户与
daemon 都用应用层 `ping` 保活，不唤醒 DO。

**休眠后**：`webSocketMessage` 会重新加载 DO；不要依赖构造函数里的变量，所有东西从 SQLite/attachment 读。
`blockConcurrencyWhile` 只用于建表，不用于业务。

### 11.3 顺序与并发

- DO 的输入门保证：一个存储操作未完成时不会开始下一条 WebSocket 消息的处理；同一工作室的队列、opId、
  rev 比较因此是串行的。
- 广播按 `getWebSockets` 的顺序逐条 `send`；对同一个客户端，消息顺序即发送顺序。
- daemon 与 app 是不同套接字；daemon 的回执 → 更新 SQLite → 广播 app，顺序固定。
- 发送失败（`send` 抛错）→ `ws.close(1011, 'send-failed')`，不影响其他套接字。

### 11.4 上限与关闭码

| 关闭码 | 含义 |
|---|---|
| 4001 | `outdated`：协议 major 不等 |
| 4002 | `replaced`：同一 daemon 有了新连接 |
| 4003 | `bad-frame` / `not-hello`：帧顺序或身份不符 |
| 4004 | `not-yours`：项目不再属于该客户、会话撤销 |
| 4005 | `revoked`：daemon 被吊销 |
| 1011 | `send-failed` / `internal` |

每个 daemon 同时只有一个连接；同一客户在同一工作室可以有多个 app 连接（多个设备），上限 32 个，
超过时关最旧的（壳的纯传输逻辑，不算业务）。DO 的 WebSocket 总数受 Cloudflare 每对象上限约束，
P1 的规模远低于上限。

## 12. 管理页（`packages/studio-hub/src/admin-page.ts`）

`GET /` 返回 `ADMIN_HTML`（单文件，内联 CSS/JS，无外部资源）。它不依赖 `studio-app`，也不 import 任何
业务模块；只用 fetch 调本源 API。

- **令牌**：输入后存 `sessionStorage`，每个请求带 `Authorization: Bearer`；401 时清掉并回到输入框。
- **工作室列表** → 新建工作室 → 显示一次性绑定码、有效期、用法
  `beluga studio link <code> --hub <origin>`；"重新签发"按钮。
- **工作室详情**：
  - daemon：名称、在线/离线、最后在线、吊销按钮；离线超过 15 分钟标红；
  - daemon 上报的项目（来自 `daemonProjects`）供下拉；
  - Studio 项目：新建、绑定/解绑 daemon 项目（下拉，不手填）、成员；
  - 客户：邀请邮箱、加入项目、移除、复制登录链接（outbox 里的人工转发链接）；
  - alerts。
- **渲染**：所有数据用 `textContent`/`createElement`，**不拼 innerHTML**；客户文字与名称一律按纯文本。
- **样式**：按 `packages/companion/lib/theme.ts` 的中性灰 token（`#` 值直接内联；管理页不是手机 App，
  但保持同一套灰阶与圆角）。
- **安全头**（Worker 加）：
  `Content-Security-Policy: default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`，
  `X-Frame-Options: DENY`，`X-Content-Type-Options: nosniff`，`Referrer-Policy: no-referrer`，
  `Cache-Control: no-store`（管理页与所有 API 响应；管理详情里有 outbox 登录链接）。
- M2 的页面验收用 `packages/studio-hub/scripts/fake-daemon.mjs` 模拟登记 + 连接，让"已连接的 daemon"
  出现一行；截图存 `.beluga/scratch/`（BLG-61）。

## 13. 部署两种做法（供 BLG-62 选择）

两种做法代码相同，差别只在 `wrangler.toml` 的 `database_id`、README 与机密配置。M2 的验收标准
（"`npx wrangler dev` 能起，`GET /` 返回管理页，两条 WebSocket 都能连"）两项都满足。

### A. 本地 `wrangler dev`（M2 开发与验收；不对外服务）

- 不需要 Cloudflare 账号；`npx wrangler dev --persist-to .wrangler/state` 在 `http://localhost:8787` 起
  Worker + DO + 本地 D1。数据在 `.wrangler/state/`，重启保留。
- `wrangler.toml` 的 `database_id` 用占位 UUID（如 `00000000-0000-0000-0000-000000000000`）；
  `npx wrangler d1 execute DB --local --file schema.sql` 建表。
- `.dev.vars`：`OPERATOR_TOKEN=<dev 令牌>`、`MAIL_MODE=outbox`（或 `console` / `resend`）、
  `HUB_ORIGIN=http://localhost:8790`（App 同源代理）或 `http://localhost:8787`（只直连中台）、
  `PREVIEW_SECRET=`（P1 不用）；用 Resend 时再加 `RESEND_API_KEY` 与 `MAIL_FROM`（§3.4.1）。
- 只有本机能连；客户与真实 daemon 用不了。适合开发、单测之外的手工联调、M2 截图。
- BLG-60 需要：dev 脚本、本地 D1 建表步骤、README 的 dev 一节；不写 `database_id` 的真实值，不写部署。

### B. Cloudflare 账号真部署（P1 后期给客户用）

- `npx wrangler login` → `npx wrangler d1 create synon-studio` → 把返回的 `database_id` 写进
  `wrangler.toml` → `npx wrangler d1 execute DB --remote --file schema.sql` →
  `npx wrangler secret put OPERATOR_TOKEN`（以及需要时的 `PREVIEW_SECRET`）→ 用 Resend 时
  `npx wrangler secret put RESEND_API_KEY` / `MAIL_FROM` / `MAIL_MODE=resend`（§3.4.1）→ `npx wrangler deploy`。
- `HUB_ORIGIN` 设为部署后的 Worker URL（如 `https://studio.example.workers.dev`）。
- Free 计划够用：D1（有行数与写入限额）、SQLite 后端的 DO（`new_sqlite_classes`）。DO 与 D1 在
  Cloudflare 全球网络，可能跨境；客户条款要写（设计 §5.6）。
- BLG-60 需要：真实的 `database_id`、部署 README、secret 清单；M2 仍先在本地验证。

**建议**：BLG-62 在"M2 只验收本地"与"现在就要一个可给客户打开的地址"之间选。默认建议 A
（M2 不引入账号与线上数据），B 留到 M5 客户端能登录前。两种都按本文实现，切换不改规则代码。
不推荐 `wrangler dev --remote`（依赖账号、临时地址，调试体验差）。

## 14. 测试形状（四个测试文件）

规则层全部可直接调，不需要起 Worker。`memoryHub()`/`memoryStudio()` 用 Map 实现两个 store；
`now` 固定、`random` 固定（可预测的字节）、`mailer` 收集 `{email, link}`、
`operatorTokenHash = await sha256Hex('test-token')`。签名用 Web Crypto 现场生成 Ed25519 密钥，
签 `synon-studio-v1:*`；断言"错签、别人的 key、过期 at、重放、吊销"。

| 文件 | 覆盖 |
|---|---|
| `tests/team/studio-hub.test.ts` | 运营者令牌；绑定码格式/过期/重用/错码；登记幂等与 409；daemon 连接：错签、时钟差、重放同 at、他人 key、吊销后连接、新连接挤占；hello/信封 strict。 |
| `tests/team/studio-hub-queue.test.ts` | 同 opId 只入队一条；第 8–14 天重放返回原回执；第 7 天边界 `expired`；白名单外/坏参数；跨项目、被移除客户、未登录；`draftRev` 过时 `stale`；按 seq 取；ack/断开回队；频率上限。 |
| `tests/team/studio-hub-views.test.ts` | 未登录读视图；跨项目读被拒；`.strict()` 多字段/超长整帧拒 + alert 且不覆盖旧缓存；全量替换后读最新；turns 合并有序去重、留 500、分页；`ingestPatch` rev 跳号 → resync；`previewLink` 只有 deliver+approved 放行，P1 路由恒 403。 |
| `tests/team/studio-hub-accounts.test.ts` | 只有运营者能邀请/加成员/绑定；移除客户会话立刻失效；一个项目绑第二台 daemon 被拒；daemon 必须同工作室；daemon 项目只能映射一次；跨项目视图与动作被拒。 |

WebSocket 的壳不在单测里：handler 的 `onDaemonOpen/onDaemonMessage/onAppOpen` 返回 `Effect[]`，测试直接
断言效果（`{to:'app', projectId, frame}` 等），不建真套接字。壳的端到端靠 `wrangler dev` + fake daemon。

**验收命令**（milestone 通过的判据）：

```console
$ npx vitest run tests/team/studio-hub.test.ts tests/team/studio-hub-queue.test.ts \
    tests/team/studio-hub-views.test.ts tests/team/studio-hub-accounts.test.ts
```

壳的边界：

```console
$ grep -rn "from '.*src/" packages/studio-hub/src
# 只允许 src/net/studio/* 与 src/studio/protocol.ts
```

## 15. 与设计文档的差异与理由

1. **频率多了"每天 5 万字"，并且覆盖所有动作**：M2 设计给的是 20 次/分、300 次/天，只对带文字的动作。
   实现保留这些数，另加设计 §3.5 的"每天对话总字数 ≤ 50 000 字"（`rate.chars`），并且**所有动作**都计入
   条数：坏帧、`plan.verify` 这类零文字动作也能刷 DO 存储/队列。键是（客户、项目），只有该项目真有这份计划
   视图时才细分为（客户、项目、计划），请求里的 `planRef` 不能用来造无限多个新桶（审计 M2-2/M2-8）。
2. **顺序**：设计 §6 是频率先于 `checkAction`。实现是：成员 → `expire` → opId 回执 → 频率 → `checkAction`。
   成员先是为了被移除的客户连旧回执都拿不到；`expire` 先是为了第 8 天重放不再返回 stale `queued`；
   回执先于限频是为了幂等重发不被 `rate-limited` 挡住（审计 M2-3/M2-15）。
3. **`patch` 帧在 M3 上线**：M2 只实现 `ingestPatch` 与测试，线上收到 `patch` 回 `resync`，不让未定稿的
   增量格式进入线上校验。M3 把它加入 `DaemonUp`（strict，`set` 只放顶层字段，`turns` ≤ 50），收到即调
   `ingestPatch`；`STUDIO_PROTO.minor` 升到 1（只做加法）。同时加 `POST /v1/internal/resync`：管理页把
   Studio 项目映射到 daemon 项目后，Worker 让 DO 叫 daemon 立刻推这个项目（映射在 D1，daemon 原来无从知道）。
4. **客户账号不加 `studio_id`**：设计 §4 的 `customers` 没有工作室列，邮箱全局唯一。这允许同一客户
   出现在多个工作室的项目里（P1 只有一个运营者，实际很少见）；授权始终按项目成员查，不按客户所属工作室。
   代价是"已邀请但未加入任何项目"的客户不在工作室详情列表里——管理页在邀请响应里直接拿 id 做下一步。
5. **新增 `GET /v1/admin/customers` 与 `POST /v1/internal/close`**：前者给管理页一个全局客户兜底列表，
   后者让 Worker 在 D1 改完状态后关掉 DO 里的套接字；二者都是壳的转发/读取，不引入业务规则。
6. **WebSocket 用 hibernation API**：设计 §10 已选它；本文补全了标签、attachment、关闭码与"内存会丢"
   的约束。mailbox 没有可参照的 WS，所以这是新代码；端到端靠 fake daemon 验证。
7. **删除客户后再次邀请**：设计没写。本文定为"删墓碑、建新账号"（旧数据已清），避免 UNIQUE 邮箱让
   运营者永远无法重新邀请。
8. **opKey 含 projectId**：设计 §5.3 的作用域写（工作室、计划），`plan.create` 写（工作室、项目）。实现把
   projectId 放进所有键：同一工作室的两个项目可以各有一个 `plan1`（daemon 各自命名），不分开会让回执与
   限频串项目（审计 M2-16）。M3 daemon 必须用同一个 `actions.opKey`。
9. **`HUB_ORIGIN` fail closed**：设计只说链接用 `HUB_ORIGIN`；实现不允许缺失时退回请求 Host，见 §3.4
   （审计 M2-10）。

## 16. 不在本里程碑

- daemon 侧代码（`src/studio/link.ts`、`publish.ts`、`inbox.ts`、`chat.ts`、`gates.ts`）——M3。
- 客户端 `packages/studio-app`——M5。
- 真发邮件、推送、R2/预览产物、交付 Gate 的真实数据来源——P2/M5。
- 运营者账号体系（多运营者、登录）——P1 只有环境变量令牌。
- 删除工作室、导出数据、审计日志表——P1 不做（日志只到 Worker 的运行日志）。
