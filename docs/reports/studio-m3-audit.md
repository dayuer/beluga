# Studio M3 安全审计：连接器、视图泄露与解绑

日期：2026-11-11。分支 `beluga/blg-66-m3-daemon`（从 `plan/synon-studio-p1-web` 开）。审计对象：
`src/studio/{keys,link,publish,service}.ts`、`src/ipc/studio-*.ts`、`src/net/studio/handler.ts` 的 M3 增量
（`PatchUp`、`onDaemonMessage` 的 patch 分支、`/v1/internal/resync`）、`packages/studio-hub/src/worker.ts` 的
映射通知，以及 `tests/studio-*.test.ts`、`tests/team/studio-hub.test.ts`。设计见 `docs/studio-daemon.md`。
审计开始时的 HEAD 是 `3b91aa5c`；修复、测试与本文同一次提交。

做法：

1. 按设计 §2–§7 逐条读实现，盯住四个边界：**什么能离开这台 Mac**、**谁能让它做动作**、**密钥落在哪**、
   **解绑是否真的断了**。
2. 写/跑测试与一次真实链路：11 个 Studio 测试文件、三个 typecheck（根、`packages/mac`、`packages/studio-hub`）；
   本地 `wrangler dev` 上用真实 `StudioPublisher` + `StudioLink` 走完 登记 → 签名连接 → hello/全量/synced →
   管理页映射 → 客户登录 → 读客户视图 → 改计划标题 → 再读，得到 `Before` → `After`。
3. 另起两个只读复核代理（不同模型：一个 Opus 全量、一个 Sonnet 窄口径），见 §5；它们的发现逐条核实、
   修复并写进 §1，和本代理自己的发现不分先后。

限制：审计与实施除 §5 的两个代理外是同一个代理；没有部署到真实 Cloudflare；M5 客户端的渲染沙箱不在本次范围。

## 0. 结论

- **计划数据只有一条出口链**：`StudioPublisher.build()` → `studioPlanView()`（M1 白名单 + 净化器）→
  `DaemonUp.parse` → `StudioLink.send` → `socket.send`。没有第二条路径把计划原文送出去（§2.1）。
- **中台能做的只有**：`welcome`、`resync`（只触发重推视图）、`outdated`、`deliver`（M3 空操作）。
  没有任何下行帧能触发 IPC、文件读写或执行（§2.3）。
- **私钥**只在 `~/.beluga/studio.json`（目录 0700、文件 0600、tmp+rename），`status()` 与任何日志都不含
  key/refKey；解绑先尽力发 `plan-gone`、关 socket，再删文件（§2.4）。
- 两个独立复核都没有发现高危或严重问题；本轮共 **14 条发现，4 条中等、10 条低**，其中 **13 条已修**，
  1 条（解绑不在中台吊销密钥）作为已知限制写进 §3。修复后 11 个 Studio 测试文件、三个 typecheck 全绿。

## 1. 发现与修复

| # | 严重度 | 类别 | 一句话 | 状态 |
|---|---|---|---|---|
| A1 | 中 | 视图残留（泄露） | 计划发布过、daemon 关机、计划被删（或取消共享），再连上时 `plan-gone` 永远不会发：中台的视图缓存没有 TTL，客户一直看到已删除的计划 | 已修：`studio.json` 新增 `published`（只存 planRef），成功推出的 ref 记入、成功撤回的划掉；`snapshot()` 对“记过但这次不再推出”的 ref 发 `plan-gone`。测试：`retracts what it published before a restart…`、`remembers each ref it publishes` |
| A2 | 中 | 解绑预告不实 | 离线时 `leave()` 的 `plan-gone` 发不出去，但 CLI/对话框仍说“项目不再共享” | 已修：CLI 与 Mac 对话框在解绑前检查 `state !== 'online'`，明说“中台可能仍显示旧视图，直到运营者解绑”；本地删密钥（安全动作）不变 |
| A3 | 中 | 卸载假成功 | `removeStudioConfig` 把 EACCES/EPERM/EBUSY 都当“已删除”，私钥文件可能还在，下次启动又连回去 | 已修：只忽略 ENOENT；`unlink()` 删不掉时返回 `lastError: 'cannot-remove'`，CLI 与 Mac 对话框都提示 |
| A4 | 中 | 越权（web） | 浏览器会话（`kind:'web'`）的门禁只拒 `WEB_ADMIN`，M3 的 `studio.link/unlink/setProject` 默认可调：被盗 cookie 能解绑工作室或把任意项目发布给客户 | 已修：`src/daemon/server.ts` 新增 `WEB_STUDIO` 并拒绝；`tests/web-security.test.ts` 加断言 |
| A5 | 低 | 坏文件留密钥 | `unlink()` 在 `config` 为空（文件损坏、私钥解析失败）时提前返回，含私钥的文件留下 | 已修：解绑无条件删文件（ENOENT 之外才报错）；测试：`removes a corrupt key file too when unlinked` |
| A6 | 低 | 文本注入 | 中台在握手失败时可回任意 `{error}` 字符串，原样进 `lastError`，CLI 会打印（含控制字符的可能），Mac 对话框会显示伪造文案 | 已修：只接受协议已知的错误码，其余显示 HTTP 状态码 |
| A7 | 低 | 重连风暴 | `synced` 即把退避清零：一个“接受后立刻断开”的 hub 能让 daemon 每 250–1000ms 重连并重发全量 | 已修：在线持续 ≥ 30 秒才清零 `attempt`；抖动与 60s 上限不变 |
| A8 | 低 | 入站帧无上限 | `ws` 默认 `maxPayload` 是 100 MiB，`onData` 先 `JSON.parse` 再判断 | 已修：`maxPayload: 512 KiB` + `onData` 先查长度，超限只计数 |
| A9 | 低 | 临时文件权限 | `writeFileSync(..., {mode:0600})` 不改已存在文件的权限；崩溃残留的同名 tmp 可能更宽 | 已修：写完 `chmod 0600` 再 rename；rename 失败清理 tmp |
| A10 | 低 | 吊销 | 解绑只删本地文件，中台登记的公钥仍有效；复制过 `studio.json` 的人仍可冒充这台 Mac，直到运营者在管理页吊销 | **未修（已知限制）**：需要中台新增 daemon 自签名吊销路由，超出 M3；写进 §3，管理页的吊销已可用 |
| A11 | 低 | 并发登记 | 两个 IPC 同时 `studio.link` 会各注册一把钥匙，文件与活动连接可能不一致 | 已修：`linking` 锁 + await 返回后重新检查 `config` |
| A12 | 低 | resync 放大 | 每来一个 `resync` 都复制/过滤整个基线，5 秒节流只挡发送不挡扫描 | 已修：按项目的粗粒度冷却 + 10 秒内最多 100 个 `resync`；`sendGone` 同时清 `revs`/`lastResync` |
| A13 | 低 | 视图串项目（本代理发现） | 计划换了项目时，旧项目下的缓存视图没有 `plan-gone`，客户会看到已不属于该项目的计划 | 已修：`refresh()`/`snapshot()` 先给旧项目发 `plan-gone`；测试：`moves a plan between shared projects…` |
| A14 | 低 | ref 可猜（本代理发现） | `refKey` 只检查非空；被截断成非法 base64 时解码为 0 字节，ref 退化成空密钥 HMAC | 已修：refKey 必须解码为 32 字节，否则当作未绑定 |

顺带补的攻击用例（此前没有）：`synced` 之后收到 `deliver` 而 M3 没有消费者时，链接保持在线、`dropped` 不增、
什么也不做；未知 `t` 的帧只计数、不关连接；`outdated` 停止且不再重连；`StudioService` 的 status/setProject/
unlink/demo 共 5 条；`publisher.leave()`（解绑的 `plan-gone`）。

## 2. 逐项检查（结论）

### 2.1 计划数据只能经过滤后离开

- 唯一构造视图的地方是 `StudioPublisher.build()`：输入 `planView(plan, state.board)`，经 `studioPlanView()` 逐字段
  白名单拷贝、每个自由文本过 `sanitizeText`，再用 `PlanFrame.safeParse` 验一次。计划原文对象没有别的出口。
- 帧里的项目名来自用户给项目起的名字（`state.projects[].name`），缺失时用 `'Project'`，**不回落成项目 id**
  （`local:/路径` 这类 id 不会上行）。
- `hello.projects[].id`、`for.project`、`planRef` 都是 `refOf(refKey, …)` 的 22 字符不透明名；计划 id、项目 id、
  路径不出现在任何上行帧里。`plan-gone` 只带 `planRef`；`patch` 的 `set` 来自同一份 `StudioPlanView`；`turns`
  M3 恒为空。
- 测试在标题/目标/验收里塞了 `BLG-12`、`src/auth.ts`、`/Users/me`、`plan/synon-studio-p1`、`claude-opus-5-5`、
  `API_KEY=abc`，断言每一帧都过 `DaemonUp.parse` 且 JSON 里找不到这些；未共享项目的计划不出现在任何帧里。

### 2.2 `link.send` 是唯一出口，且先过白名单

- `src/studio/link.ts` 里 `socket.send` 只有两处：`write()`（先 `DaemonUp.safeParse`，不过就丢弃、`dropped++`、
  不发）和心跳纯文本 `'ping'`（不是协议帧）。`publish.ts` 也先自己 parse 再调 `send`；服务、IPC、CLI 不碰 socket。
- 连接不在 `online` 时 `send` 返回 `false` 并计数，调用方据此标脏、置离线。
- 测试：非法帧返回 `false`、`dropped` 增加、hub 收不到；顺序严格 `hello → for* → synced`。

### 2.3 下行白名单，M3 不执行动作

- `link.onData` 先处理 `pong`，再 `JSON.parse` + `HubDown.safeParse`；失败只计数、不关连接。
- `resync` → 只重推视图（每计划 5 秒一次、全局限量）；`outdated` → 停；`welcome` 校验 `studio === config.studioId`，
  不一致进 `wrong-studio` 并停；`deliver` 只在 `online` 后交给可选回调。
- `service.connect()` 构造 `StudioLink` 时**没有**传 `onDeliver`，M3 的 deliver 是空操作；没有把 `StudioAction`
  翻译成 IPC 的代码（M4 的 inbox 才会加）。

### 2.4 密钥与本地存储

- 目录 0700、文件 0600、tmp+rename、读取时修复过宽权限（Windows 跳过 mode）；`published` 只存 ref。
- `StudioStatus` 不含 key/refKey/绑定码；`src/studio/*` 没有一行 `console.*`；错误只回已知码。
- 解绑：`publisher.leave()`（基线 + `published` 里未在本轮推出的 ref 都尽力 `plan-gone`）→ 停 publisher →
  `link.stop()`（关 socket、清定时器）→ 删文件 → 未连接；删不掉时 `lastError='cannot-remove'`。
- 测试：0600、坏 JSON 当作未绑定、status JSON 不含 `PRIVATE KEY`/`key`/`refKey`、损坏文件也能被 `unlink` 删除。

### 2.5 重放、时钟与退避

- `at = max(now, lastAt+1)`，`lastAt` 经 `onAt` 同步写回 `studio.json`；409 `replayed` 用 `at+1` 立刻重试一次。
- 退避 full jitter：`max(250, random()*min(60_000, 1000*2^n))`，在线 ≥30 秒或首次上线的 `synced` 才清零；
  失败不抛到调用方。测试用固定 `random=0.5` 断言前三步 500/1000/2000ms。
- `revoked`/`outdated`/`wrong-studio` 停下、不再重连；4002 至少等 5 秒；pong 60 秒超时 terminate 重连。

### 2.6 中台侧（M3 新增部分）

- `PatchUp` `.strict()`，`set` 只收对象、`turns ≤ 50`；`onDaemonMessage` 把 `patch` 交给 `ingestPatch`：rev 必须
  `cached+1`，`set.planRef` 不许与帧里的不一致，合并后 strict 校验，失败回 `resync` 且不覆盖旧缓存（测试覆盖）。
- `POST /v1/internal/resync`：只有 3 段路径命中，要求 `auth.role === 'operator'`、body 严格解析；Worker 的公网入口
  对 `/v1/internal/*` 一律 404，只有 Worker 自己的 `callDo` 能到。
- 映射成功后 Worker 调它，DO 只产生一个 `{t:'resync', project}` effect；daemon 离线时下次连接的全量覆盖。

### 2.7 一个 Studio 项目只绑一台 daemon

- 中台 `projects` 一行只有一个 `daemon_id`/`daemon_project_id`，`UNIQUE (daemon_id, daemon_project_id)`；
  `bindProject` 拒绝已绑、已映射，条件 UPDATE 挡住并发。
- daemon 侧一个 `studio.json` 只对应一个工作室。真实链路验证：daemon 上报 ref → 管理页映射 → 客户读到计划。

## 3. 已知限制与遗留缺口

- **告示 honest、动作仍本地的解绑**：离线时 `plan-gone` 发不出去，中台的旧视图留到运营者解绑/吊销。这是设计
  选择（密钥必须能立刻删掉）；CLI 与 Mac 对话框现在会明确说这一点。
- **A10：解绑不在中台吊销**：复制过 `studio.json` 的密钥仍能连接到运营者吊销为止。管理页
  `DELETE /v1/admin/daemons/:did` 已可用；M4/P1 后期可加一条 daemon 自签名吊销路由。
- **M3 不消费 deliver**：中台在 `synced` 后仍会投递排队动作，M3 丢弃、不回执；中台按 outbox TTL 重新入队，
  不丢动作，但多一次投递。M4 接管 `onDeliver` 后消失。
- **视图缓存没有 TTL**：现在的撤回依赖 daemon 记住 `published`（A1）。若 `studio.json` 被删而中台映射还在，
  旧视图依然会留到运营者解绑——与管理页的映射是运营者的一步，与此一致。
- **M5 客户端不在本次范围**：客户端必须按纯文本渲染视图；净化器挡不住“用话念出路径”（M1 已注明）。

## 4. 复核记录

两个只读复核代理（模型与实施不同），发现与本代理的逐条核实：

| 来源 | 发现 | 核实 | 处理 |
|---|---|---|---|
| Opus 全量复核（185k tokens，72 次工具） | A1 A2 A3 A4 A5 A6 A7 A8 A9 A10 A11 A12 与一条测试盲区 | 全部对着代码与一次真实链路复核；无一条是误报 | 12 条修复（A1–A9、A11、A12 与补测试），A10 记为已知限制 |
| Sonnet 窄口径第三方（53k tokens，7 次工具） | 错误字符串注入、maxPayload、`revs/lastResync` 增长、离线 unlink、synced 重置退避 | 与上表 A6/A8/A12/A2/A7 是同一批问题；`revs/lastResync` 泄漏已在 `sendGone` 里清理 | 同上 |
| 本代理自己的检查 | A13 视图串项目、A14 refKey 长度 | 各写了一条回归测试 | 已修 |

两个代理都确认的“checked, OK”：上行唯一出口且先过 `DaemonUp`；计划数据没有绕过 `studioPlanView` 的路径；
下行全部先过 `HubDown`；`deliver` 是 no-op；`status()`/错误不含密钥或绑定码；0600/0700 与原子写；解绑顺序；
`at` 严格递增并持久化；退避有界；连接头只含签名不含秘密；中台 patch 路径严格；`internal-resync` 只给 operator。

未采纳或未修的：A10（需要中台新路由，写进 §3）；没有采纳“把 `resync` 完全按项目丢弃”的建议，因为
`resync(project, planRef)` 需要能重推单个计划，改为项目级冷却 + 全局限量。

## 5. 独立复核（不同模型）

- **Opus 全量代理**：只读，审计范围与本文相同，被要求逐条回答 7 个问题并给出 file:line 证据；运行 5 分钟，
  结论“无 critical/high”，列 12 条 find+1 条测试盲区。
- **Sonnet 窄口径第三方**：只读、不跑命令、限定文件与 5 个问题，60 秒返回 5 条 low，与 Opus 的发现高度重合，
  用来确认前者的结论不是单一模型的偏置。
- 两个代理的结论都经过本代理逐条对照代码与真实链路核实；没有发现误报（A10 是范围问题，不是误报）。
