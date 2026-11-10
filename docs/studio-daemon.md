# Synon Studio daemon 连接器（M3 设计）

依据：`docs/superpowers/specs/2026-11-10-beluga-studio-design.md`（M1 修订版）、计划 `synon-studio-p1-web` 的
M3 技术设计，以及已经落地的 M1/M2 代码：`src/studio/protocol.ts`、`src/studio/view.ts`、`src/studio/sanitize.ts`、
`src/net/studio/handler.ts`、`src/net/studio/views.ts`、`packages/studio-hub/`。本文只定 daemon 这一侧怎么接：
模块边界、密钥与本地存储、登记与出站连接、重连、增量与全量、IPC/CLI/coverage、Mac 对话框。**不推翻上面的设计**；
与它不同的地方集中在文末 §10，每条都写了理由。

到本文为止，`src/studio/{link,keys,publish,service}.ts` 都还不存在；`src/studio/{protocol,view,sanitize,actions}.ts`
已存在且是 browser-safe 的纯函数，M3 原样使用，不改它们。

## 0. 读代码时发现的三件事（实施必须照做）

1. **中台还不收增量。** `src/net/studio/handler.ts:656-661` 收到 `t:'patch'` 只写 alert `patched-early`，然后回
   `resync`；`src/net/studio/views.ts:114` 的 `ingestPatch` 已经写好并测过，但没接上线。M3 把它接上（§6）。
2. **映射之后 daemon 不知道。** 运营者在管理页把 Studio 项目映射到 daemon 项目，走的是 Worker + D1
   （`packages/studio-hub/src/worker.ts` → `handleHubRequest` → `bindProject`），DO 不会收到任何通知；映射之前
   daemon 推的帧会被 `ingestPlan` 当成 `unmapped-project` 丢掉（`views.ts:88`）。所以要加一条 Worker → DO 的内部
   路由，映射成功后让 DO 给 daemon 发 `resync`（§6.2）。
3. **Mac 的挂接点在 `ProjectTree.tsx`。** 项目 ⋯ 菜单的条目在 `packages/mac/src/layout/ProjectTree.tsx:212` 的
   `extra` 数组里组建（`earningsMenuItem(p, earning)` 就在那里）；`ProjectGroups.tsx` 只建"移到分组"。BLG-70 只改
   `ProjectTree.tsx`（§8）。

## 1. 模块与依赖方向

新增文件都只在 Node 里跑，**不列进 browser-safe**（`tests/browser-safe.test.ts` 不收它们），但都进
`tests/boundaries.test.ts` 的 `CORE`，由测试强制"核心不依赖界面"。

```
daemon/core.ts ─► studio/service.ts ─► link.ts ─► keys.ts
                                    └► publish.ts ─► view.ts, core/plans/progress.ts (planView)
link.ts / keys.ts ─► net/studio/handler.ts（只取 DaemonUp、HubDown、STUDIO_LABEL、normalizeLinkCode）
                  ─► studio/protocol.ts
ipc/studio-handlers.ts ─► studio/service.ts（studioOf(session)）
```

- `src/studio/{keys,link,publish,service}.ts` 不得 import `react`、`ink`、`src/ui/*`，也不得读写 `process.stdout`。
  BLG-67 在 `tests/boundaries.test.ts:10` 的 `CORE` 里加 `'src/studio'` 一项。
- `src/net/studio/*` 与 `packages/studio-hub/*` **绝不能** import `src/studio/{keys,link,publish,service}`：中台是
  Worker/浏览器环境，既没有 `node:crypto` 的私钥操作，也不该拿到 daemon 的本地配置。两者只共享
  `src/studio/protocol.ts` 与 `src/net/studio/handler.ts` 里的规则函数。
- `protocol.ts` / `sanitize.ts` / `view.ts` / `actions.ts` 维持现状：纯函数、browser-safe，M3 不改。

| 文件 | 任务 | 职责 |
|---|---|---|
| `src/studio/keys.ts` | 67 | 读写 `~/.beluga/studio.json`（0600 原子写）；生成 Ed25519 身份；`studioSign`；`refOf` 不透明 ref |
| `src/studio/link.ts` | 67 | 用绑定码登记（HTTP），出站 WSS，握手顺序，心跳，退避重连，`send` 唯一出口 |
| `src/studio/publish.ts` | 68 | 订阅 Store，构造客户视图，算增量，推全量；`diffView` 纯函数 |
| `src/studio/service.ts` | 69 | 把 link 与 publish 接起来；`studio.*` 的实现；`launchStudio`、`attachStudio`/`studioOf` |
| `src/ipc/studio-api.ts` / `studio-handlers.ts` | 69 | 五个 `studio.*` 方法（形状与实现分开，照其他 `*-api` / `*-handlers` 成对的文件） |
| `src/cli/studio.ts` | 69 | `beluga studio link/status/unlink/share/unshare`，经 `callDaemon` 调 IPC |
| `packages/mac/src/studio/ConnectDialog.tsx` + `studio-dialog.ts` | 70 | 「连接到 Studio…」对话框与它的小 store |

M3 留给 M4 的三个接口（M4 接手时不用改 M3 的文件）：

- `StudioLink` 的 `onDeliver?(f: Deliver)`：M3 注入一个什么都不做的函数；M4 的 inbox 接管。
- `StudioPublisher` 的 `extras?(planId)`：M4 的 chat 与 gates 从这里注入 `turns/typing/moreTurns/gate`。
- `refOf` 的反查：M4 收到 `planRef` 后，遍历共享项目的计划现算 ref 比对（§2.3）。

## 2. 密钥与本地存储（`keys.ts`）

### 2.1 文件与权限

```ts
studioPath(): string                      // path.join(belugaHome(), 'studio.json')（src/core/home.ts 的 belugaHome）

interface StudioConfig {
  v: 1;
  hub: string;                            // 规范化后的中台基址，没有结尾斜杠
  studioId: string;                       // 中台分配
  daemonId: string;                       // = identity.peerId（与中台 daemonIdOf 同一算法）
  name: string;                           // 登记时上报的电脑名
  linkedAt: number;                       // 毫秒
  key: string;                            // PKCS8 PEM（identityPem），永不出现在 status、日志或错误里
  refKey: string;                         // 32 字节 base64url，用来算 ref
  lastAt?: number;                        // 最后一次连接用的 at（毫秒）；见 §4.4（本文新增）
  projects: Record<string, { since: number }>;  // 共享给 Studio 的 Beluga projectId
  published?: Record<string, string[]>;    // 每个项目已告诉中台的 planRef（只有 ref，没有计划 id）
}

loadStudioConfig(file?): StudioConfig | undefined   // 坏文件、缺字段、v 不对：一律当作未绑定，不抛
saveStudioConfig(cfg, file?): void
removeStudioConfig(file?): void
```

- 目录 0700、文件 0600，先写 `${file}.${pid}.tmp` 再 `rename`，照 `src/net/crypto.ts:115` 的 `saveIdentity`。
  `mkdirSync(dir, { recursive: true, mode: 0o700 })` 之后，如果目录已存在且更宽，`chmodSync(dir, 0o700)`。
- 读取时若 POSIX 权限比 0600 宽（例如有人 `cp` 过这个文件），`chmodSync(file, 0o600)` 修回来，best-effort；
  Windows 跳过（mode 无意义）。
- `key` 只在 `keys.ts` 内部换成 `Identity`；`service.status()` 与任何日志都只拿 `daemonId`。

### 2.2 身份、签名与 ref

```ts
newStudioIdentity(): Identity                    // src/net/crypto.ts 的 generateIdentity（Ed25519）
identityOf(cfg): Identity                        // identityFromPem(cfg.key)
studioSign(id: Identity, text: string): string   // src/net/mesh/keys.ts 的 signText(id, STUDIO_LABEL, text)
refOf(refKey: string, kind: 'project' | 'plan', id: string): string
```

- `STUDIO_LABEL = 'synon-studio-v1'`（`src/net/studio/store.ts:16`，经 `handler.ts` re-export）。中台的
  `signedBy` 校验的就是 `synon-studio-v1:<text>`，与 `signText` 拼出的字节完全一致。
- `refOf`：`('dp' | 'p') + b64url(HMAC-SHA256(key = base64url 解码的 refKey, msg = kind + '\0' + id)).slice(0, 20)`。
  结果 22 个字符，满足中台的 `REF = /^[A-Za-z0-9_-]{1,64}$/`。`project` 用 `dp` 前缀，`plan` 用 `p`。
- **每次 link 都生成新密钥**；unlink 删掉整个 `studio.json`。所以不会遇到 `key-taken`（同一个 key 登记到另一个
  工作室），也不需要"轮换密钥"的逻辑。
- **`refKey` 必须持久化**：中台的映射（`projects.daemon_project_id`）存的是 ref，daemon 重启后如果 ref 变了，
  所有已映射的帧都会变成 `unmapped-project`。refKey 只在本地、永不上送。
- **上线一律用 ref，不用 Beluga 的 projectId**：projectId 可能是 `local:/路径`（`src/core/local-key.ts`），
  `hello.projects[].id`、`for.project` 都要求 REF，路径既不合规也不该上中台。计划的 `planRef` 同理。
- 反查（M4 用，M3 也要用一次，见 §6.2）：收到 `planRef` 时遍历 `config.projects` 里每个项目的计划，现算
  `refOf('plan', plan.id)` 比对，不建反查表。

### 2.3 一个 Studio 项目只绑一台 daemon

这条规则**由中台强制**，daemon 只负责不绕过它：

- `projects` 表一行只有一个 `daemon_id` + `daemon_project_id`，`UNIQUE (daemon_id, daemon_project_id)`；
  `bindProject`（`packages/studio-hub/src/d1.ts:232`）拒绝 `already-bound`（这个 Studio 项目已绑过）与
  `already-mapped`（这个 daemon 项目已被另一个 Studio 项目占用），并用条件 UPDATE 挡住两个标签页同时绑。
- daemon 侧：一台 daemon 只连一个工作室（`studio.json` 只有一个 `hub` + `studioId`），本地"共享"只是把这个
  项目放进 `config.projects`；真正建立"Studio 项目 ↔ daemon 项目"的是运营者在管理页做的映射。所以同一个
  Beluga 项目不可能被两台 daemon 同时供给同一个 Studio 项目；换绑要先解绑，中台会拒绝重复绑定。
- 本地的 `studio.setProject(id, false)` 与中台的映射是两件事：取消共享后 daemon 发 `plan-gone`，但映射行还在，
  运营者可以在管理页解绑。管理页也允许对没在共享的项目保持映射；daemon 只会推 `config.projects` 里的项目。

## 3. 用绑定码登记（`link.ts`）

```ts
registerWithCode(o: { hub: string; code: string; name: string; identity: Identity; fetch?: typeof fetch; now?: () => number }):
  Promise<{ ok: true; studioId: string; daemonId: string }
        | { ok: false; error: 'bad-code' | 'expired-code' | 'key-taken' | 'clock-skew' | 'unreachable' | 'bad-hub' }>
```

### 3.1 中台地址

- `BELUGA_STUDIO_HUB` 优先；没设就是 `http://localhost:8787`（M2 选定的本地 `wrangler dev`）。
- 只接受 `https:`；`http:` 只允许 `localhost` 与 `127.0.0.1`，其余 `bad-hub`，**不发请求**。
- 去掉结尾斜杠后再拼路径；URL 解析失败 → `bad-hub`。

### 3.2 请求

```
POST {hub}/v1/link
{ "code": "XXXX-XXXX", "key": <base64 SPKI DER>, "name": <≤200>, "at": <毫秒>, "sig": <base64> }
sig = studioSign(identity, `link:${code}:${at}`)
```

- `code` 先用中台的 `normalizeLinkCode`（`handler.ts:269`）规范化（大写、去空格/横线、O→0、I/L→1）；
  不合法直接 `bad-code`，不发请求。
- `at` 是**毫秒**（中台 `CLOCK_SKEW_MS` 与 `deps.now = Date.now()` 都是毫秒）。
- `name` 默认取电脑名（daemon 配置里的名字，否则 `os.hostname()`，否则 `Beluga`），截到 80 个字符（IPC 的上限）。

### 3.3 结果映射

| 中台 | 结果 |
|---|---|
| `200 {studioId, daemonId}` | `{ ok: true, studioId, daemonId }` |
| `401 clock-skew` | `clock-skew`（提示用户校准系统时间） |
| `403 bad-signature` / `bad-or-expired-code` | `bad-code`（新生成的密钥不可能签错；文案写"绑定码不对或已过期"） |
| `409 key-taken` | `key-taken` |
| fetch 抛错 / 超时（10 秒） / 其他状态 | `unreachable`（HTTP 状态只进日志，不进错误文案） |

登记成功后由 `service.link` 写 `studio.json` 并 `start()` 连接（§5）。

## 4. 出站连接（`link.ts`）

只有出站连接，不开端口。客户端 WebSocket 可注入（`ws?: WsFactory`，默认 `ws` 包——Node 的全局
`WebSocket` 不能带头）。

### 4.1 状态与接口

```ts
type LinkState = 'connecting' | 'online' | 'offline' | 'revoked' | 'outdated' | 'clock-skew' | 'wrong-studio' | 'stopped';

interface LinkStatus {
  state: LinkState;
  daemonId: string;
  studioId: string;
  onlineAt?: number;
  retryAt?: number;        // 下一次重连的时刻
  lastError?: string;      // 只有码：'1006' | 'replayed' | 'clock-skew' | 'hello-timeout' | 'bad-hub' …
  attempt: number;         // 退避的 n，连上并同步后归零
  dropped: number;         // 被拒绝的下行帧 + 没能发出的上行帧
}

interface SnapshotSource {
  projects(): { id: string; name: string }[];          // id 都是 refOf('project', …)
  snapshot(): DaemonUpFor[];                            // 全量，按项目顺序
  onResync(project: string, planRef?: string): void;
  onOnline(): void;
}

class StudioLink {
  constructor(d: {
    config: StudioConfig; identity: Identity; source: SnapshotSource;
    ws?: WsFactory; now?: () => number; random?: () => number; timers?: Timers;
    onState?(s: LinkStatus): void;
    onDeliver?(f: Extract<HubDown, { t: 'deliver' }>): void;   // M3：什么都不做
    onAt?(at: number): void;                                    // 记下 lastAt（§4.4）
  });
  start(): void;
  stop(code?: number): void;
  reconnectNow(): void;
  status(): LinkStatus;
  send(frame: DaemonUp): boolean;    // 唯一出口
}
```

- **`send` 是唯一出口。** 先 `DaemonUp.parse(frame)`；不过就丢弃并 `dropped++`，返回 `false`，**绝不发未校验的
  帧**。审计因此只要看这一个函数，就能确认没有帧绕过过滤。连接不在 `online` 时也返回 `false`（见 §5.4）。
- `start`/重连/`send`/`stop` 都不往调用方抛错；错误只写进 `status().lastError`，内容是码，不是原文。
- 日志只打 `daemonId`、状态变化和关闭码；**绝不打印 key、sig、绑定码或完整 URL 的 query**。

### 4.2 连接与握手（固定顺序）

```
GET {hub → ws}/v1/daemon/ws
  x-studio-daemon: <daemonId>
  x-studio-at:     <at>
  x-studio-sig:    <studioSign(identity, `connect:${daemonId}:${at}`)>
```

1. `open` → 发 `hello { proto: STUDIO_PROTO, daemon: config.daemonId, projects: source.projects() }`，
   起一个 **10 秒的 `welcome` 超时**，超时就断开重连（`lastError = 'hello-timeout'`）。
2. `welcome`：`studio !== config.studioId` → `wrong-studio`，**停下**（这是一台给别的 daemon 的套接字）。
   连接按 `major` 不匹配已经会被中台 `outdated` + 关闭，不重复实现。
3. 按 `source.snapshot()` 的顺序逐帧 `send`（都是 `{t:'for', project, frame:{t:'plan',rev,view}}`）。
4. 发 `{t:'synced'}`；退避的 `n` 归零；状态 `online`，`onlineAt = now`；调 `source.onOnline()`。
5. **只有 `online` 之后**才处理 `deliver`。之前收到的 `deliver` 丢弃并计数：中台在 socket 关闭时
   `requeueTaken`（`handler.ts:714`），并在 `synced` 之后才 `take`，所以丢掉不会让动作消失。

`hello` 在连接中途可以再发（`projectsChanged`，§5.6）：中台整表替换 `daemon_projects`。

### 4.3 下行

- 纯文本 `'pong'`：**先于** `JSON.parse` 处理，只刷新"最近听到"的时间（中台用
  `setWebSocketAutoResponse('ping','pong')` 自动回，`packages/studio-hub/src/hub.ts:110`）。
- 其他文本：`JSON.parse` 失败 → `dropped++`，忽略；`HubDown.safeParse` 失败 → 同上。**不关闭连接**：
  版本差异不能变成重连风暴。
- `resync` → `source.onResync(project, planRef)`。
- `outdated` → 状态 `outdated`，停下。
- `welcome` 重复 → 忽略（计一次 `dropped`）。
- `deliver` → `online` 之后才交给 `onDeliver`；M3 注入的是空函数，**不执行、不回执**，中台会在 outbox TTL
  后重新入队，M4 接手时才真正消费。

### 4.4 `at` 与重放

- `at = Math.max(now(), lastAt + 1)`；`lastAt` 初值取 `config.lastAt ?? 0`，每次连接前更新，
  并通过 `onAt` 由 `service` 写回 `studio.json`（下一次启动接着用）。
  中台要求 `at` 严格大于它记下的上一个 `lastAt`（`verifyDaemonConnect`，`handler.ts:345`），而这个值存在
  DO 里、跨 daemon 重启仍在。**把 `lastAt` 持久化**，是为了让 daemon 快速重启（时钟还在同一毫秒）时不会
  一上来就 409 `replayed`（§10 的偏差 2）。
- `at` 与中台时间相差超过 5 分钟 → 中台 401 `clock-skew`。

### 4.5 心跳

- 每 25 秒发一次纯文本 `'ping'`（不经过 `send`，它不是协议帧）。
- 收到任何消息（含 `pong`）就重置一个 **60 秒的静默计时器**；计时器到点 → `terminate()` → 按 §4.6 重连。
  25/60 保证一次丢失的 ping 不会误判。

### 4.6 退避与结果处理

`delay = max(250, random() * min(60_000, 1000 * 2^n))`（full jitter），`n` 每次失败 +1，`synced` 时归零。
`offline`/`clock-skew` 状态都带 `retryAt`，`reconnectNow()` 可跳过等待。

| 结果 | 处理 |
|---|---|
| 网络错、1006、1011、握手超时、`hello` 超时、pong 超时 | `offline`，按退避重连 |
| 握手 401 `clock-skew` | `clock-skew`，继续按退避（上限 60 秒）重试 |
| 握手 409 `replayed` | 立刻用 `at + 1` 重试一次；再失败按普通退避 |
| 握手 401 `unknown-daemon`、401 `bad-signature`、403 `revoked`、关闭码 4005 | `revoked`，**停下**（要重新 link；签名与中台记录不符时重试永远不会成功） |
| 关闭码 4001 / `outdated` | `outdated`，**停下** |
| 关闭码 4002 `replaced` | 至少等 5 秒再按退避重连（同一把钥匙从另一处连上了） |
| 关闭码 4003 `not-hello` / 4004 | `offline`，按退避重连（本地状态可能坏了，重来一遍握手） |

握手阶段 HTTP 失败用 `ws` 的 `unexpected-response` 事件读状态码与 `{error}`（响应体上限 1 KB）；
读不到就按网络错误处理。

## 5. 增量与全量（`publish.ts`）

### 5.1 帧

- 全量：`{ t: 'for', project: <dp ref>, frame: { t: 'plan', rev, view } }`（已有）。
- 增量：`{ t: 'patch', project, planRef, rev, set?, turns? }`（M3 新加，中台 §6 接上）。
  `set` 只放**顶层字段**里有变化的那几个；`turns` 有变化时带最近 50 条。
- 计划没了、或项目取消共享：`{ t: 'for', project, frame: { t: 'plan-gone', planRef } }`。

### 5.2 `diffView`（纯函数）

```ts
export function diffView(prev: StudioPlanView, next: StudioPlanView):
  { set?: Partial<StudioPlanView>; turns?: StudioTurn[] } | undefined;
```

- 逐字段做结构比较（`JSON.stringify` 前保证键序一致：两个视图都出自同一个 `studioPlanView` 构造器，
  键序天然一致；比较前仍包一层稳定的 `canon(key, value)`）。`planRef` 永不进 `set`（它不可能变）。
- `turns` 按内容比较（最多 50 条，成本可忽略），变了就整体带上。
- `set` 为空且 `turns` 未变 → `undefined`（不发帧）。
- **有字段"消失"时不能只发 `set`**：中台的合并是 `{...current, ...set}`（`views.ts:148`），删不掉键。
  `diffView` 仍返回 `set`，由 `publisher` 另外检查"prev 有、next 没有"的顶层键；有就整份重发该计划的全量。

### 5.3 `StudioPublisher`

```ts
class StudioPublisher implements SnapshotSource {
  constructor(d: {
    store: Store;
    config: () => StudioConfig | undefined;
    send: (f: DaemonUp) => boolean;
    extras?: (planId: string) => { turns?: StudioTurn[]; typing?: boolean; moreTurns?: boolean; gate?: StudioGate };
    debounceMs?: number;   // 默认 250（尾部）
    maxWaitMs?: number;    // 默认 750（最多等这么久）
    timers?: Timers;
  });
  start(): void;
  stop(): void;
  projects(): { id: string; name: string }[];
  snapshot(): DaemonUpFor[];
  onResync(project: string, planRef?: string): void;
  onOnline(): void;
  projectsChanged(): void;
  leave(): void;                              // unlink：逐计划 plan-gone（尽力）
  status(): { lastError?: string; lastPushAt?: number; plans: number };  // service 的 StudioStatus 用
}
```

**取数据**：`store.subscribe`，只在 `state.plans` 或 `state.board` 的引用变了时才排一次刷新（其余 slice 的变化
直接返回）。尾部去抖 250ms，最多等 750ms，所以一次改动 1 秒内一定推出去。

**范围**：只包括 `config().projects` 里的项目：`state.plans.plans.filter((p) => shared[p.projectId])`。

**视图**：

```ts
studioPlanView({
  planRef: refOf('plan', plan.id),
  view: planView(plan, state.board),                  // 不传 live（src/core/plans/progress.ts:229）
  keyPrefixes,                                        // 该项目在 board 里的 KEY 前缀，见下
  ...extras(plan.id),                                 // M3：undefined
})
```

- 说明：任务描述里的 `planPageView` 是 companion 屏用的，**不用它**。
- `keyPrefixes`：`state.board.projects[plan.projectId]?.prefix`，再加上所有 `repos` 含该 projectId 的独立
  board 的 `prefix`（`src/core/board/model.ts:376` 的 `reposOf` 语义），去重。净化器用它把 `BLG-12` 这类本
  工作室的 KEY 无条件去掉（`src/studio/sanitize.ts:276`）。
- 构造时抛错，或 `PlanFrame.safeParse` 不过：跳过这个计划（不发它），`status().lastError = 'bad-view'`，
  日志打一次 `planRef` 与错误类型，不打视图内容。

**基线与 rev**：每个计划记 `{ planRef, projectRef, view, rev }`。`rev` 是 publisher 内存里每计划单调递增的
计数器（从 1 开始）；**`snapshot()` 生成全量、重置基线并返回帧**（rev 继续用计数器的下一个值：中台的全量
任何时候都覆盖，不比较 rev；之后第一条 patch 必须是 `rev = 快照 rev + 1`）。daemon 重启后计数器归零没问题，
因为第一帧总是全量。

**刷新**：对每个在范围内的计划：

- 基线里没有 → 发全量，建基线；
- 有 → `diffView`；`undefined` 不发；有"消失的键" → 发全量；否则发 patch，`rev = 上次 + 1`，成功发送后更新基线；
- 基线里有、现在不在（计划删了）→ 发 `plan-gone`，删基线。

不在 `online` 时：只标脏，不构造、不发。`onOnline()`：`online = true`；脏就立刻刷新一次（正常是空 diff，
因为刚推过全量）。`send` 返回 `false` 时标脏并置 `online = false`。

**`onResync(project, planRef?)`**：重推该项目（或这一个计划）的全量，并重置对应基线。**每个计划每 5 秒最多
一次**：防止"全量被拒 → patch → resync"循环；被节流时只记下来，下次刷新时再补。

**`projectsChanged()`**：先 `send(hello)` 重发项目表，然后：新共享的项目全体全量；取消共享的项目，其基线里
每个计划发 `plan-gone` 并删基线。调用方是 `service.setProject`。

**离线期间删掉的计划（M3 审计 A1）**：中台的视图缓存没有 TTL，只靠内存基线会漏。每个成功推出（全量、patch
或 `plan-gone`）的 `planRef` 都写进 `studio.json` 的 `published`（只有 ref，没有计划 id、没有项目 id）；`snapshot()`
先推出当前全量，再对 `published` 里这次不再推出的 ref 发 `plan-gone` 并从 `published` 划掉。「计划发布过 → 关机
→ 删掉计划 → 再连上」因此也能撤回。

## 6. 中台接线（BLG-68 一并做）

### 6.1 收增量

- `src/studio/protocol.ts`：`STUDIO_PROTO.minor` 改为 `1`（只做了加法）。
- `src/net/studio/handler.ts`：
  ```ts
  export const PatchUp = z.object({
    t: z.literal('patch'),
    project: ref,
    planRef: ref,
    rev: z.number().int().min(0),
    set: z.record(z.unknown()).optional(),
    turns: z.array(StudioTurn).max(50).optional(),
  }).strict();
  ```
  加进 `DaemonUp` 联合；删掉 `patched-early` 分支，改成 `await ingestPatch(daemonId, frame.data, deps)` 并回它的
  effects（`ingestPatch` 会整份再走一遍 strict `StudioPlanView`；rev 有缺口、`set` 不能合并、计划未知时回
  `resync`，且不覆盖旧缓存）。
- 注意 `DaemonUp` 的联合顺序：`patch` 是独立的 `t`，放在 `for` 之后即可；`ref` 与 `StudioUp` 的其它常量
  已在同一模块。

### 6.2 映射之后让 daemon 重推

- `handler.ts` 的 `RouteName` 加 `'internal-resync'`；`routeOf` 的 internal 段加
  `if (p.length === 3 && s(2) === 'resync') return at('internal-resync', 'studio')`。
- `handleStudioRequest` 加分支：`auth.role === 'operator'`，`POST`，body
  `z.object({ daemonId: /^[A-Za-z0-9_-]{32}$/, project: REF }).strict()`，返回
  `{ status: 200, body: { ok: true }, effects: [{ to: 'daemon', daemonId, msg: { t: 'resync', project } }] }`。
- `packages/studio-hub/src/worker.ts`：`admin-project-daemon` 的 `PUT` 成功（`reply.status === 200`）后，
  从 `reply.body.project` 取 `studioId`、`daemonId`、`daemonProjectId`，`callDo(env, studioId,
  '/v1/internal/resync', 'POST', { daemonId, project: daemonProjectId })`。失败只记日志，不影响绑定结果
  （daemon 下次重连仍会推全量）。
- 映射之前 daemon 推的帧仍是 `unmapped-project`（`ingestPlan`），这是正确的：没映射的项目不该有客户视图。

### 6.3 回写文档

`docs/studio-hub.md` §8.2 / §10.1 / §15 与 `docs/studio-protocol.md` §4：`patch` 上线、`ingestPatch` 已接、
内部 resync 路由、`minor = 1`。

## 7. service、IPC 与 CLI（BLG-69）

### 7.1 `service.ts`

```ts
class StudioService {
  link(code: string, hub?: string, name?: string): Promise<{ ok: true; status: StudioStatus } | { ok: false; error: string }>;
  unlink(): Promise<StudioStatus>;
  status(): StudioStatus;
  setProject(projectId: string, shared: boolean): StudioStatus;
  reconnect(): StudioStatus;
}

function launchStudio(d: { session: object; store: Store; demo: boolean }): () => void;
function attachStudio(session: object, service: StudioService): void;
function studioOf(session: object): StudioService;   // 没有时抛一句明确的错，照 earningsOf
```

- `src/daemon/core.ts` 的 `opts.network` 那组加 `stopStudio = launchStudio({ session, store, demo: Boolean(demo) })`，
  在 stop 时调用。demo 模式：空服务（`status()` 返回 `{ linked: false, state: 'unlinked', projects: [] }`），
  不发网络请求。
- `launchStudio`：没有 `studio.json` 时只建服务、不连接；有就 `publisher.start()` → `link.start()`。
- `link()`：已有配置 → `{ ok: false, error: 'already-linked' }`；否则规范化绑定码与 hub → `registerWithCode` →
  成功则写 `studio.json`、构造 publisher/link、启动，返回 status。
- `unlink()`：先 best-effort 给基线里每个计划发 `plan-gone`（离线就跳过），再 `link.stop()`、`publisher.stop()`、
  删 `studio.json`，返回未绑定的 status。
- `setProject(id, shared)`：改 `config.projects`，写回文件，`publisher.projectsChanged()`，返回 status。
  项目不存在（`state.projects` 里没有）→ 抛给 IPC 变成参数错误。
- `status()`：合并 link 的状态与 config，**不含 key / refKey**。

```ts
interface StudioStatus {
  linked: boolean;
  state: LinkState | 'unlinked';
  hub?: string;
  studioId?: string;
  daemonId?: string;
  name?: string;
  since?: number;                 // linkedAt；未绑定时没有
  retryAt?: number;
  lastError?: string;
  projects: { projectId: string; shared: boolean; plans: number }[];
  lastPushAt?: number;
}
```

`projects` 列**所有**项目：`config.projects` 里的 `shared: true`，其余 `shared: false`（对话框的"共享这个
项目"开关要能显示当前状态）。`plans` 是该项目在 Studio 范围内的计划数。

### 7.2 IPC 方法与归类

文件：`src/ipc/studio-api.ts`（形状，zod）与 `src/ipc/studio-handlers.ts`（实现），在 `src/ipc/api.ts` 与
`src/ipc/handlers.ts` 各展开一行。三个 coverage 文件、`docs/parity.md` 都要逐个方法加一行。

| 方法 | 参数（zod） | 返回 | companion | machines | external |
|---|---|---|---|---|---|
| `studio.link` | `[code: string ≤20, hub?: url ≤300, name?: string ≤80]` | `{ok:true,status}` / `{ok:false,error}`；已绑定 `already-linked` | `mac` | `refuse` | `{ refused: "A person links Studio with the admin page's code" }` |
| `studio.unlink` | `[]` | `StudioStatus` | `mac` | `refuse` | `{ refused: "A person unlinks Studio from this computer's app" }` |
| `studio.status` | `[]` | `StudioStatus` | `mac` | `drive` | `ui_only` |
| `studio.setProject` | `[projectId: string ≤200, shared: boolean]` | `StudioStatus` | `mac` | `refuse` | `{ refused: "Publishing a project to customers is a person's choice" }` |
| `studio.reconnect` | `[]` | `StudioStatus` | `mac` | `drive` | `ui_only` |

- 归类理由：绑定、解绑、共享项目是**人的选择**（对外名字是 Synon Studio，绑上就相当于把计划给客户看），
  手机上不能做，机器与你自己的外部 agent 也不能；`status`/`reconnect` 没有数据、不改变 Beluga 保存的东西，
  所以 machine 可 `drive`（"看看连上没有"是遥控的日常），external 是 `ui_only`。
- `docs/parity.md` 的 API methods 每行一句，和表里一致。

### 7.3 CLI（`src/cli/studio.ts`）

`src/cli.ts` 只是入口，命令都在 `src/cli/`；`src/cli/main.ts` 加 `case 'studio'`，经仓库现有的 `attached()` + `SocketClient` 调 IPC（与 `beluga computers`、`beluga phones` 一致；不是旧的 `callDaemon`）。

```
beluga studio link <code> [--hub URL] [--name N]
beluga studio status [--json]
beluga studio unlink
beluga studio share|unshare [path]     # 默认当前目录所在的项目
```

- `link` 成功打印 "Connected to <hub> as <daemonId>"，失败按错误码给一句人话（绑定码不对/已过期、中台不可达、
  时钟偏差、已绑定）。
- `status` 打印 `state`、hub、项目数与每个项目的共享状态；`--json` 打 `StudioStatus`。
- `share/unshare`：用 `path` 或 `cwd` 找到项目（`state.projects` 里根目录匹配），调 `studio.setProject`。

## 8. Mac 对话框（BLG-70，本里程碑的页面）

- `packages/mac/src/studio/ConnectDialog.tsx` + `studio-dialog.ts`：一个小 store（打开/关闭），照
  `packages/mac/src/lib/earnings.ts` 的 `openEarnings` / `useEarningsSheet` 写法。
- 挂接（只这三处）：
  - `packages/mac/src/layout/ProjectTree.tsx:212` 的 `extra` 里，紧挨 `earningsMenuItem(p, earning)` 加一项：
    未连接时「连接到 Studio…」，已连接时「Synon Studio…」；`onSelect` 打开对话框并带上 `projectId`。
  - `packages/mac/src/App.tsx` 挂 `<StudioConnectDialog/>`（一行）。
  - `packages/mac/src/dialogs/settings-index.ts` 的 `advanced` 窗格加一条搜索行（Synon Studio / 绑定码），
    对应窗格文件里加一行入口按钮，打开同一个对话框。
- 对话框：绑定码输入（`XXXX-XXXX`，宽松规范化，复用 `readCode` 的写法）、可展开的 hub 地址、「连接」按钮、
  状态行（在线 / 重连中带倒计时 / 已吊销需重新绑定）、「共享这个项目」开关（`studio.setProject`）和断开。
  打开期间每 2 秒调一次 `studio.status`（关闭对话框就停）。
- 文案只加到已有的 `packages/mac/src/i18n/en/studio.ts` 与 `zh-CN/studio.ts`；对外名字写 Synon Studio。
- 截图放 `.beluga/scratch/m3-*.png`。

## 9. 测试清单

### `tests/studio-link.test.ts`（BLG-67）

拿**真实的中台规则**当假 hub：`registerDaemon`、`verifyDaemonConnect`、`onDaemonMessage`，配
`src/net/studio/store.ts` 的 `memoryHub`、`memoryStudio`，套接字用内存对（`ws` 注入）。

- 登记成功；改过的签名/被换过的 body 被拒（403），状态不会变 `online`。
- 断线重连后的帧顺序必须是 `hello → for* → synced`；离线期间入队的动作要在 `synced` 之后才收到 `deliver`，
  `synced` 之前收到的 `deliver` 被丢弃。
- 退避落在 `[250, min(60_000, 1000·2^n)]` 内（用注入的 `random` 断言上下界），`synced` 后归零；
  `fetch` 或 `ws` 抛错时不抛到调用方，只改状态。
- `revoked` 停下；`replayed` 用 `at+1` 重试；pong 超时（假 timers 推 60 秒）会重连；`outdated` 停下。
- `studio.json` 是 0600（Windows 上跳过）；坏文件当作未绑定、不抛；`key` 不出现在 `status()` 里。
- `send` 拒绝不过 schema 的帧，且 `dropped` 增加。

### `tests/studio-publish.test.ts`（BLG-68）

用假 timers、真 Store（`plan_put`/`board_issue` 等 action 驱动）。

- 改标题后 ≤1s 只出一个 patch，`set` 恰好等于 `{title}`（键集合也断言）。
- 未共享项目的计划在任何帧里都不出现。
- 视图输入里放了 KEY、路径、模型名：每帧都能过 `DaemonUp.parse`，JSON 里也找不到这些。
- `resync` 重推全量；删计划、取消共享都发 `plan-gone`；取消共享后重发 `hello`。
- 字段消失（例如 `review`）时发全量而不是 patch。
- patch 交给真实的 `ingestPatch` 后，`readView` 能读到新标题。

### `tests/team/studio-hub.test.ts`（补三条）

`patch` 被接受并写缓存；rev 缺口回 `resync`；`/v1/internal/resync` 产生一条 `resync` effect。

## 10. 与设计稿的偏差与细化

1. **`DaemonUpFor` 用中台的信封类型推导**：`type DaemonUpFor = Extract<DaemonUp, { t: 'for' }>`，从
   `src/net/studio/handler.ts` 拿。理由：`for` 的 `project` 是 REF、`frame` 是 `PlanFrame | PlanGoneFrame`，
   两处各写一份迟早会漂；测试里也要用同一个 `DaemonUp.parse` 验收。
2. **`lastAt` 持久化进 `studio.json`**（设计只说"内存里递增"）。理由：中台的 `conn.lastAt` 存在 DO 存储里、
   跨 daemon 重启仍在，daemon 若在同一毫秒内重启会一直拿到 409 `replayed`；把用过的 `at` 存下来，
   `max(now, lastAt+1)` 才能真的严格递增。
3. **`refKey` 必须持久化**（设计已隐含，这里写明理由）：中台映射存的是 `refOf` 的结果，重启后 ref 变了，
   所有已映射的帧都会 `unmapped-project`。
4. **字段"消失"时发全量**：`ingestPatch` 的合并是浅合并，删不掉顶层键。设计没说这一条；不处理会让
   `review`/`gate`/`draftDiff` 撤不掉。
5. **登记错误码收敛**：中台对"错码"与"过期码"都回 403 `bad-or-expired-code`，daemon 无法区分，所以 403
   一律映射 `bad-code`，文案写"不对或已过期"。错误联合里保留 `expired-code` 只为以后的中台。
6. **`at` 是毫秒**：设计只写 `at`，中台实现（`CLOCK_SKEW_MS` 对 `Date.now()`）是毫秒，文档写明，避免实施
   用秒。
7. **`StudioStatus.since` 未绑定时缺省**：设计把它写成必填；未绑定没有"自何时起"，做成可选更诚实。
8. **`projects()` 只报共享项目**：`hello.projects` 是管理页映射下拉的选项来源；报未共享的项目会让运营者能
   映射一个 daemon 根本不会推的项目。设计说"共享给 Studio 的项目"，这里写明它是 `hello` 的来源。
9. **`clock-skew` 的退避上限 60 秒**：设计与其余失败共用指数退避，但时钟偏差通常会持续一段时间，指数退避
   到 60 秒上限后保持即可；同时状态里保留原因，让用户去校准时间。

## 11. 风险

- **分支漂移**：`plan/synon-studio-p1-web` 落后 main 33 个提交（main 已改成"代码里写英文 + zh-CN.json"的
  i18n 结构）。M3 照计划分支现有的 `i18n/en|zh-CN/studio.ts` 写；计划合回 main 时要统一转换，不是 M3 的事。
- **M5 并行**：BLG-68 改 `handler.ts`、`worker.ts`、`protocol.ts`；M5 只碰 `packages/studio-app`。如果 M5 需要
  客户路由，先跟 68 协调 `handler.ts`。
- **Store 刷新太频繁**：引用检查、去抖、空 diff 三层挡住；构造视图仍是每个范围内的计划一次，计划很多时靠
  这三层限制频率。
- **反复全量被拒**：`bad-view` 时中台不覆盖缓存；daemon 每计划每 5 秒最多重推一次，并把原因写进 status。

## 12. 交接

- **BLG-67** 留给后面的是：`StudioLink` + `SnapshotSource` 接口、`keys.ts` 的 `refOf`/`loadStudioConfig`/
  `saveStudioConfig`/`removeStudioConfig`、`registerWithCode`，以及 `tests/boundaries.test.ts` 的一行。
- **BLG-68** 只导出 `StudioPublisher` 与 `diffView`，**不碰 `service.ts`**；中台接线（§6）在同一任务里做完。
- **BLG-69** 拿到两边的接口后写 `service.ts`、IPC、CLI、coverage 与 parity。
- **BLG-70** 只做 Mac；**BLG-71** 审计重点：唯一出口 `link.send`、下行白名单、M3 不执行 deliver、0600 权限、
  日志里没有密钥、unlink 之后（连接已关、文件已删、计划已 `plan-gone`）。
