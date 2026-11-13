# Studio M2 安全审计：认证、越权与队列

日期：2026-11-11。分支 `beluga/blg-56-m2-studio-cloudflare`。审计对象：`src/net/studio/*`（规则）与
`packages/studio-hub`（Worker / Durable Object / D1 壳）。审计前 HEAD `441c5eaa`；修复与本文同一次提交。

做法：

1. 按 `docs/studio-hub.md` 逐条读规则与壳，重点看身份、时限、作用域和壳的边界。
2. 写攻击用例并跑：四个 `tests/team/studio-hub*.test.ts`（审计前 44 条，修复后 47 条）+ 临时脚本。
3. 起本地 `wrangler dev`（BLG-62 选的部署方式），用 `scripts/fake-daemon.mjs` 和 Node `ws` 客户端走完整流程：
   登记 → 签名连接 → hello/全量/synced → 客户登录 → WebSocket 视图 → 动作投递/回执 → 重连 → 移除/登出。
4. 另起一个 Opus 代理做只读复核（不同模型），见 §6。

限制：除 §6 的独立代理外，审计与实施是同一个代理；所有结论都在本地 `wrangler dev` 上验证，没有部署到真实
Cloudflare（BLG-62 决定 P1 先本地）。本地代理的行为与线上可能不同，§3 有一条就属于这种情况。

## 0. 结论

- **本次审计（含独立复核）共 18 条已修并复核**（§1、§1b），51 条单测、两处 typecheck、最后一轮 live check
  都通过。
- **没有发现尚未修复的高危或严重问题**；余下是 4 条低风险/结构性观察和已知限制（§3、§3b）。
- **壳里没有业务规则**：`packages/studio-hub/src` 只 import `src/net/studio/*`（§4）。
- **P1 无法签发预览链接**：`previewLink` 只认 `deliver + approved`，P1 的 `StudioGate.kind` 构造不出 `deliver`，
  路由 `GET …/previews/:m` 恒 403（§5）。

## 1. 发现与修复

| # | 严重度 | 类别 | 一句话 | 状态 |
|---|---|---|---|---|
| M2-1 | 高 | 重连顺序 | daemon 未发 `hello` 也能发 `synced`，hub 会先投递队列，绕过“先全量快照再取队列” | 已修 |
| M2-2 | 中 | 队列滥用 | 限频只覆盖带文字的动作；已认证客户可用 `plan.verify` 等零文字动作无限刷队列/存储 | 已修 |
| M2-3 | 低 | 越权（纵深） | `enqueue` 先回放 opId 回执、后查项目成员；被移出项目的客户若绕过路由直接调用可拿回旧回执 | 已修 |
| M2-4 | 中 | 连接清理 | DO 的 `webSocketClose` 对 1006 调 `ws.close(1006)` 抛 `InvalidAccessError`，关闭路径中断并产生未捕获异常 | 已修 |
| M2-5 | 低 | 映射并发 | `bindProject` 的 D1“先查后写”可被并发覆盖；同一 daemon 改绑未要求先解绑 | 已修 |
| M2-6 | 低 | 存储清理 | 限频的分钟桶只增不删，长期增长 | 已修 |
| M2-7 | 低 | 连接上限 | 设计 §11.4 要求每客户每工作室 32 个 app 套接字；壳没有实现，单客户可耗尽 DO 的套接字 | 已修 |

### M2-1 daemon 帧顺序（高）

**复现**：登记一台 daemon，连上后不发 `hello`，直接发 `{"t":"synced"}`。审计前的 `onDaemonMessage` 只查
`daemon_conn` 是否存在（连接时已建），于是把 `synced` 置真并 `take` 队列。若队列里有客户动作，daemon 会在
没有推送任何全量视图的情况下收到 `deliver`，并在自己可能过时的状态上执行。设计 §8.3/§10.1 明确要求
`hello → 每个计划全量 → synced`，否则关闭 4003。

**修复**：`daemon_conn` 加 `hello` 标记（DO 建表、`Conn`、`putConn`）。连接时 `hello=false`；只有 `hello`
（身份与 major 校验通过）才置真；`hello` 之前的 `for`/`receipt`/`synced` 一律返回
`{to:'close', tag:'daemon:<id>', code:4003}`。`synced` 仍要求先 `hello`。

- 代码：`src/net/studio/handler.ts:669-680`、`packages/studio-hub/src/do-store.ts` 的 `connOf/putConn`、
  `packages/studio-hub/src/hub.ts` 的表与 `acceptDaemon`。
- 测试：`tests/team/studio-hub.test.ts` “enforces hello, then the full snapshots, then synced before any delivery”；
  live check 的 daemon 走正常 hello 序列。
- 注意：这是 DO 表的列变更。M2 的本地 `.wrangler/state` 若是旧表，删掉重来（`CREATE TABLE IF NOT EXISTS`
  不会补列）；P1 还没有线上数据。

### M2-2 限频覆盖所有动作（中）

**复现**：审计前 `queue.enqueue` 只对 `chat.send`、`decision.answer`、`milestone.sendBack`、`plan.create` 计数。
一个已认证客户可以对同一计划连发 1 万条 `plan.verify`（无文字、合法白名单），每条一个 UUID opId，全部入队；
7 天内占满 DO 存储与 daemon 的队列，daemon 逐条执行 `plans.verify`。这是已认证客户的拒绝服务/成本放大，
不需要任何越权。

**修复**：每个动作都计入“每客户每计划 20 次/分、300 次/天”；只有带文字的 kind 额外计字数（每天 5 万字）。
超限回执 `refused: rate-limited`，和文字动作一致。

- 代码：`src/net/studio/queue.ts:157-168`。
- 测试：`tests/team/studio-hub-queue.test.ts` “limits every action, not only the ones with text”（20 条
  `plan.verify` 后第 21 条被限）。

### M2-3 成员检查先于 opId 回执（低）

**复现**：审计前 `enqueue` 的顺序是：计算 opKey → 查 `ops` 回执 → 查 `hub.canAccess`。HTTP 路由的 `appGuard`
已经先查成员，所以真实请求不会漏；但规则模块作为“第二道”，在被直接调用（未来的新入口、测试、批处理）时，
一个已被移出项目、却知道旧 opId 的人能拿回旧回执（只有 opId/state/code，没有正文）。这与“移除立即生效”
的语义不一致。

**修复**：成员检查移到 opId 回放之前；非成员一律 403 `not-yours`，不返回任何回执。

- 代码：`src/net/studio/queue.ts:148-155`。
- 测试：`tests/team/studio-hub-queue.test.ts` “does not answer an old opId receipt to a customer removed from the project”。

### M2-4 关闭码 1006 让关闭路径抛错（中）

**复现**：live check 在“移除成员后关闭套接字”时，`wrangler dev` 日志出现未捕获的
`InvalidAccessError: Invalid WebSocket close code: 1006`，位置 `packages/studio-hub/src/hub.ts` 的
`webSocketClose`。1006 是“异常关闭”的只读表示，不能作为关闭帧发送；原代码里 `ws.close(code, reason)` 在
回调收到 1006 时抛错，后续清理被中断。审计前所有单测都不碰真实套接字，所以没有发现。

**修复**：`webSocketClose` 在 `code === 1006` 时不再调 `close`（套接字已经没了），其余情况 try/catch；
`webSocketError` 的 1011 也包 try/catch。

- 代码：`packages/studio-hub/src/hub.ts:193-213`。
- 复核：live check 不再出现该未捕获错误；见 §3 关于本地代理关闭帧的说明。

### M2-5 映射的并发与改绑（低）

**复现**：
(a) D1 的 `bindProject` 先 `SELECT` 项目当前绑定，再 `UPDATE`；两个并发的 PUT 可以都看到“未绑定”，都写入，
后写覆盖前写。运营者只有一个，但两个标签页/重试也能触发。
(b) 同一项目已绑 daemon A 时，再用同一台 daemon A 的另一个 daemon 项目 PUT，审计前会被允许直接改绑，
而管理页的提示是“换绑要先解绑”。

**修复**：任何已绑定项目都返回 `already-bound`（必须先 `DELETE …/daemon`）；D1 的更新加
`WHERE id=? AND daemon_id IS NULL`，`changes===0` 即 `already-bound`；UNIQUE 冲突时重查并返回
`already-mapped`（不再是 500）。

- 代码：`src/net/studio/store.ts` 的内存实现、`packages/studio-hub/src/d1.ts:232-252`。
- 测试：`tests/team/studio-hub-accounts.test.ts` 的映射用例新增“同 daemon 改绑 → 409”。

### M2-6 限频分钟桶的清理（低）

**复现**：`rate` 表按（客户、计划、分钟）一行，只写不删；一个长期活跃的客户每年会留下几十万行。限频只
需要当天，最多两天。

**修复**：`StudioStore.prune` 同时删除 `window_start < before` 的 rate 行（`before` 是 14 天窗口）；内存实现
一致。代码：`packages/studio-hub/src/do-store.ts` 的 `prune`、`src/net/studio/store.ts` 的 `memoryStudio.prune`。
无单独测试（`prune` 已有 14 天 op/queue 的测试覆盖调用路径）。

### M2-7 每个客户的 app 套接字上限（低）

**复现**：一个客户（正常的会话）可以对同一项目反复升级 WebSocket，没有数量上限；Cloudflare 每个 DO 的
套接字总数有上限，一个客户就能把它占满，项目里其他客户连不上。设计 §11.4 要求每客户每工作室 32 个，
超过关最旧的。

**修复**：`acceptApp` 在接受前取 `cust:<customerId>` 的现有套接字；达到 32 时先关掉最早的若干个（1000
`too-many`），再接受新连接。纯传输逻辑，不涉业务状态。代码：`packages/studio-hub/src/hub.ts` 的 `acceptApp`。
无单测（套接字壳不在 vitest 里；live check 未开 33 个连接）。

## 1b. 独立复核（Opus 代理）新增的发现与修复

独立代理（不同模型）只读审计了 HEAD `441c5eaa` + 审计期间的未提交修复，共报 16 条。逐条在最终代码上核对后：
**11 条新问题已修**（下表），4 条低风险/结构性/规格性未修（§3b），1 条（app 套接字上限）在它报告前已由
M2-7 修掉。它的证据与复现脚本在 `.beluga/scratch/agents/9kJOvH9671/`（`tests.log`、`rate-bypass.log`、
`race.log`、两个临时测试）。

| # | 严重度 | 类别 | 一句话 | 状态 |
|---|---|---|---|---|
| M2-8 | 中 | 限频绕过 | 坏帧/未知 planRef 不计频，却仍写 ops/rate；可无限增长 | 已修 |
| M2-9 | 中 | 关闭失败 | 删除/移除/登出的 close 是尽力而为，失败不可重试；旧 socket 仍收广播 | 已修（广播前重查） |
| M2-10 | 中 | Host 注入 | `HUB_ORIGIN` 缺失时用请求 Host 拼魔法链接，攻击者可用自己的域名收 token | 已修（fail closed） |
| M2-11 | 中低 | alarm | 每次构造 DO 都把 24h alarm 往后推，活跃工作室可能饿死 expire/prune | 已修 |
| M2-12 | 中 | 日志凭证 | 默认 console mailer 把完整登录链接（含 token）打进日志 | 已修（默认 outbox，不打 token） |
| M2-13 | 低 | 点击劫持 | 管理页没有 `frame-ancestors`/`X-Frame-Options` | 已修 |
| M2-14 | 低 | 旧连接 | 被挤占的旧 daemon socket 在 close 生效前仍能推帧 | 已修（按 `at` 围栏） |
| M2-15 | 低 | 过期边界 | 第 8 天重放未被扫到的 op 仍回 `queued` | 已修（enqueue 先 expire） |
| M2-16 | 低 | 键作用域 | opKey/rate 不含 projectId，同名 planRef 跨项目共键 | 已修 |
| M2-17 | 低 | 增量帧 | `ingestPatch` 的 `set` 可改 `planRef`，rev 校验与写入行不一致 | 已修 |
| M2-18 | 低 | 缓存 | 管理/会话响应没有 `cache-control: no-store` | 已修 |

关键两条的做法：

- **M2-8**：限频移到 schema 校验之前；键固定为 `project:<projectId>`，只有在该项目确实有这份缓存视图时才
  细分为 `plan:<projectId>:<planRef>`——键不再来自可无限取名的新请求字段。坏帧、未知计划、零文字动作共用
  同一预算；`enqueue` 先 `expire` 再做 opId 回放（M2-15）。测试：“counts malformed frames and unknown plans
  against the same budget”“scopes an opId and the rate budget by project too”。
- **M2-9**：广播 `plan`/`receipt` 前对每个 app socket 重查会话是否未撤销未过期、客户是否 active、是否仍是
  项目成员（`handler.appSocketAllowed`）；不通过就关掉且不发。这样即使 close 帧丢失（见 §3 的本地代理限制），
  被移除/登出的客户也收不到任何新内容。HTTPS 请求本身也早已 403/401。

## 2. 已确认安全的项（攻击用例）

- **绑定码**：`XXXX-XXXX`、Crockford base32 8 位（40 bit）、15 分钟、存 hash、单用。错码、过期、已用、
  跨工作室的 key 全部拒绝；同一 key 同工作室重试幂等；跨工作室 409 且**不消耗**那台的码。原子兑换靠一条
  `UPDATE … WHERE used_at IS NULL AND expires_at>?` 的 `changes===1`。测试在 `studio-hub.test.ts`。
- **daemon 签名**：签名串 `synon-studio-v1:link:<code>:<at>` / `connect:<id>:<at>`；5 分钟时钟差；用**登记的**
  public key 验签（不接受请求里的 key）；同一 `at` 重放 409；吊销后 403；`daemonId = b64url(sha256(SPKI)).slice(0,32)`。
  测试覆盖错签、他人 key、过期时间、重放、吊销、挤占。
- **客户登录**：`POST /v1/login` 恒 202；只有 invited/active 的邮箱才生成令牌；15 分钟、单用、每邮箱每小时 5 次；
  链接 token 在 fragment；会话 30 天、每天滑动、可撤销；移除客户立即撤销全部会话。测试覆盖重复用、过期、
  未知/移除邮箱、限频、滑动、登出。
- **项目隔离**：Worker 先 `authCustomer`、再按项目找工作室；DO 的 `appGuard` 每次都 `canAccess`，不缓存。
  客户 A 读/写客户 B 的项目 → 403；`x-studio-auth` 由 Worker 生成，进站同名头被剥掉；`/v1/internal/*` 公开
  一律 404。测试覆盖跨项目读写；live check 中客户二从未收到项目一的 `plan`。
- **opId/队列**：作用域（工作室, 计划）或（工作室, 项目）；同 opId 二次入队只一条；第 8–14 天重放返回原回执；
  14 天后 prune 才可重做；第 7 天边界后 `expired`；白名单外/坏参数 `not-allowed`/`bad-args`；`draftRev` 过时
  `stale`；按 `seq` 到达顺序取；断开回队。测试在 `studio-hub-queue.test.ts`。
- **视图缓存**：daemon 推来的视图在信封解析之外再用 `StudioPlanView.safeParse`（`.strict()`）校验；多余字段/
  超长整帧拒绝并 alert `bad-view`，**不覆盖旧缓存**；未映射项目拒绝并 alert；全量快照任何时候替换；turns 按
  `(at, id)` 合并去重、每计划 500；增量 `rev+1` 才应用，否则 resync。测试在 `studio-hub-views.test.ts`。
- **管理页**：所有数据用 `textContent`/`createElement`，没有把数据拼进 `innerHTML`；CSP `default-src 'none'`、
  `script-src/style-src 'unsafe-inline'`、`connect-src 'self'`；令牌只在 sessionStorage；登录链接只在运营者
  响应/outbox 里出现，不写日志（console mailer 仅 dev）。
- **D1/DO 存储**：所有 SQL 绑定参数；动态 `IN` 只由数组长度生成占位符；`takeLinkCode`/`takeLoginToken` 用
  条件更新；`createLoginToken` 用一条带 COUNT 条件的 INSERT；ops/turns/alerts 有上限或保留期。

独立代理另确认（与上表一致）：绑定码与签名串、客户会话的过期/滑动/撤销、内部头剥离与 `/v1/internal/*` 404、
WS 子协议与标签隔离、队列 7/14 天与 ack 归属、视图 `.strict()` 与 turns 合并、预览门控、管理页无
`innerHTML`/`eval`、SQL 参数化，均未找到绕过路径。它的 47 条测试日志在 scratch。

## 3. 低风险与已知限制

1. **本地 `wrangler dev` 的 DO 主动关闭**：live check 里 DO 对 `cust:<id>` 调 `ws.close(4004, reason)`（也试过
   1000）后，
   Node `ws` 客户端停在 `CLOSING`（readyState 2）超过 5 秒；服务端代码用的是 Cloudflare 文档的
   `ctx.getWebSockets(tag)` + `ws.close()`。这不影响授权：同一个客户的下一次 HTTP 请求已 403（移除）/
   401（登出），live check 已验证。真实 Cloudflare 部署时要复核关闭帧；若是本地代理限制，P1 的本地验收
   不受影响。审计把“清理套接字”当尽力而为，不当作授权边界。
2. **daemon 连接的并发接受**：`verifyDaemonConnect` 的重放检查与 `putConn(last_at)` 之间有一个 await 窗口；
   同一把设备 key 的两个并发连接理论上能都通过。只有持有私钥的人能触发，且结果仍是一台 daemon 的连接；
   P1 接受。更严的做法是用 `blockConcurrencyWhile` 把检查+接受包起来，或在一个 SQL 事务里比较并写 `last_at`。
3. **登录链接的邮箱级 DoS**：知道某个受邀邮箱的人可以每分钟把它 5 次/小时的额度打满，让客户暂时收不到
   新链接（旧的仍有效）。`POST /v1/login` 恒 202，不泄露邮箱是否存在。加了 IP 级限流可缓解；P1 未做。
4. **绑定码猜测没有单独的失败限流**：40 bit + 15 分钟，暴力不可行；Cloudflare 边缘限流可作为纵深。
5. **登录令牌/outbox 清理**：outbox 在读管理页详情时删过期行；`login_tokens` 的过期行没有定时清理（每客户
   每小时 ≤5 条，增长有限）。限频的分钟桶已并入 `prune`（M2-6）；建议 M3/运维再给 login_tokens 加每日 prune。
6. **`MAIL_MODE`**：默认已是 `outbox`；`console` 只打“link issued”，不打邮箱或链接。本地要看链接用管理页的
   “登录链接”或 outbox。
7. **`take` 可能把动作投给“映射还在、但 daemon 本次 hello 没再上报”的项目**：daemon 侧的执行前校验会拒；
   运营者可在管理页解绑。P1 接受。
8. **管理页令牌在 sessionStorage**：任何 XSS 都能拿走；页面无数据进 HTML、CSP 限制连接，风险低。若以后
   内联脚本变大，建议拆成静态文件 + 更紧的 CSP。

### 3b. 独立复核里未修的低风险/结构性项

1. **hello 后仍可直接 `synced`，没有强制“先发全量 `for`”**（独立 #9，低）：hub 不知道 daemon 应有多少计划；
   daemon 收到动作后自己再 `checkAction`/`callRefusal`，视图状态也由它负责。M3 可在 hello 里报计划数，或在该
   连接的首个 `for` 之前不接受 `synced`。
2. **壳里的连接编排**（独立 #10，低/结构）：`acceptDaemon` 的回队/挤占/`putConn`、`worker.ts` 的 close 标签
   映射是传输与存储步骤；权限、过期、rev、白名单判断都在 `src/net/studio`，独立代理未找到绕过。要更纯，可把
   这些编排改成 handler 返回的 decision/effect（M3 重构）。
3. **`take`/`ack` 的 check-then-act**（独立 #11，SPECULATIVE）：内存实现在 `Promise.all([take, take])` 下能双
   投递；DO 的输入门与 daemon 的 OpLog 是现有防线。建议 M3 用一条 `UPDATE … RETURNING` 原子 claim。
4. **已建连接的 daemon 吊销只靠一次 close**（独立 #12，低）：不在每帧重查 D1（会给每条视图加一次查询）；
   close 失败时旧连接可继续推帧。daemon 本就是可信设备；P1 接受。

## 4. 壳里没有业务规则

`packages/studio-hub/src` 的 `src/` import（grep）：

```console
$ grep -rn "from '.*src/" packages/studio-hub/src
packages/studio-hub/src/reply.ts:import type { HubReply } from '../../../src/net/studio/handler.js';
packages/studio-hub/src/do-store.ts: ... from '../../../src/net/studio/store.js';
packages/studio-hub/src/d1.ts: ... from '../../../src/net/studio/store.js';
packages/studio-hub/src/hub.ts: ... handler.js / queue.js / store.js
packages/studio-hub/src/worker.ts: ... store.js / handler.js / session.js
```

只有 `src/net/studio/*`（另允许 `src/studio/protocol.ts`，壳目前没有直接 import）。人工复核：

- `worker.ts`：按 D1 选 DO、`authCustomer`、转内部身份、合并在线状态、删除/登出后调 internal-close；
  没有权限/过期/rev/白名单判断。
- `hub.ts`：接受套接字、执行 `Effect[]`、alarm 里调 `expire/prune`；`acceptDaemon` 调 `verifyDaemonConnect`，
  `acceptApp` 再 `canAccess`；没有自己的规则。
- `d1.ts`/`do-store.ts`：SQL 与行映射；`expire` 用调用方给的 `before`，`rateHit` 用调用方给的 `limits`，
  7/14 天、20/300 的数值都在 `queue.ts`。
- `admin-page.ts`/`reply.ts`：UI 与 Response 形状。

## 5. 预览链接门控

- `previewLink(gate, …)` 只在 `gate.kind === 'deliver' && gate.state === 'approved'` 时签发；没有 gate、
  `start`/`changes` gate、pending/declined、空 secret、非法 object key 一律 `{ok:false, code:'not-delivered'}`。
- P1 的 `StudioGate.kind` 只有 `start|changes`（协议层），代码里没有任何路径能构造 `deliver`；
- `GET /v1/app/projects/:pid/previews/:m` **恒 403**（`handleStudioRequest` 的 `app-preview` 分支）。
- 测试：`tests/team/studio-hub-views.test.ts` 的 “preview links” 两组 + “have no open route in P1”。

## 6. 独立复核（不同模型）

- 另起一个 Opus 代理只读审计最终树之前的版本（HEAD `441c5eaa` + 审计期间的未提交修复），报 16 条。
- 逐条在最终代码上核对：11 条新问题已修（§1b），4 条低风险/结构性未修（§3b），1 条（每客户 32 个 app
  套接字）在它报告前已由 M2-7 修掉。
- 它审计期间工作树在变；本报告没有直接采用它的结论，所有修复都在最终代码上重跑了 51 条单测与 live check。
- 它的证据与复现脚本：`.beluga/scratch/agents/9kJOvH9671/`（`tests.log`、`rate-bypass.log`、`race.log`、
  两个临时测试）。
- 结论：它的中危新发现（限频绕过、close 失败后的广播、Host 注入、alarm 饿死、日志凭证）均已修；未修的 4 条
  与 §3 的低风险项一致，没有新的越权或凭证泄露路径。

## 7. 复核记录

- 审计前 HEAD `441c5eaa`；本报告的修复与报告同一次提交（BLG-63）。
- `npx tsc --noEmit`（根）与 `packages/studio-hub` 的 `npx tsc --noEmit` 均通过。
- 四个测试文件：**51 条通过**。新增 7 条：hello 顺序、全动作限频、移除后的回执、坏帧/幽灵计划限频、跨项目
  opKey、8 天重放过期、无 origin 拒发链接；另在既有用例里加了 at 围栏、patch 改 planRef、同 daemon 改绑的断言。
- live check（新状态、`wrangler dev`）：daemon 登记/hello/welcome；客户一收到 plan1 与实时更新，客户二只收到
  plan2；动作 `chat.send` 投递并回执 `done`；SIGUSR2 重连后客户再次收到全量；daemon 退出后客户仍能 HTTP 读
  最后一版与计划列表；移除成员后下一次请求 403，登出后下一次请求 401。
- 发现 M2-4 的正是这次 live check：审计前的 `webSocketClose` 在 1006 上抛错；修复后不再出现。
- M2-6/M2-7 之后跑过一次最终 live check；独立复核的修复（§1b）之后又在新状态上跑了最后一轮，仍
  `LIVE-CHECK OK`。本地 `wrangler dev` 里被移除客户 socket 的 readyState 仍是 2（本地代理不完成关闭帧），
  但广播前的 `appSocketAllowed` 已让它收不到任何新内容（§3 第 1 条）。
