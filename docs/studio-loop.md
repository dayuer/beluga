# Synon Studio 需求入口与交付验收循环（P2 设计稿）

状态：**设计稿，未实施，未审计**。它把「客户提需求或反馈 → 分析并确认 → 计划 → 工作室批准 → 全自动开发 →
工作室确认交付 → 客户看结果 → 不满意再来一轮」写成 Studio 的一条闭环。中间的开发段（计划、pilot、checker）
是 Beluga 已有的，本文不改；本文只设计**最前面**（入口到计划）和**最后面**（交付到下一轮），以及两头与
中间段的接缝。

> **2026-11-18 改：Beluga 无人值守，客户自己做决定。** 本文原稿里「你批准开工」「你确认交付」「你加预览」「你合并」
> 都默认有人坐在 Beluga 前面。现在：**客户在 Studio 里批准开工（设备签名）**；**交付 Gate 在检查通过、预览生成后
> 自动通过**；预览由节点部署到测试环境自动生成；合并由节点自动做。下文相关段落已按此改过，签名与无人值守的细节
> 见 [`studio-standalone.md`](studio-standalone.md) §3、§5。

读这篇之前先读：[`studio.md`](studio.md)（P1 运营手册）、[`studio-gates.md`](studio-gates.md)（收件箱、开工
Gate、客户回合）、[`studio-protocol.md`](studio-protocol.md)（视图与动作白名单）、[`sentinel.md`](sentinel.md)。

## 0. 结论摘要

- **入口放在 Studio，不放在 Beluga 的成员机制里。** Beluga 的邀请链接、朋友分享、团队看板都要求对方装
  Beluga，且都看得到代码；访客没有看板和计划的权限是有意的（`security.md`）。需求方 / 产品经理是 Studio 的
  **客户**：浏览器登录，只看白名单视图，不碰代码。
- **P1 已经有的**：客户提需求（`plan.create`）、计划长出来、对话、确认计划、开工 Gate、里程碑验收（通过 /
  还不行）。
- **P2 在两头各补一段**：
  1. 前面：**需求单**（`StudioRequest`）。客户提的是需求或反馈，不直接变成计划；哨兵接住，用搭环境时指定的模型分析、
     追问、给出理解，客户确认后才起计划。
  2. 后面：**交付 Gate**（`deliver`）。开发跑完、检查通过、预览生成后自动通过，客户就看得到结果；客户「通过」
     结束这一轮，「还不行」带着原因回到分析，开下一轮。
- **接缝改一处**：P1 禁止共享计划用 autopilot（`studio-gates.md` §3.6）。P2 允许 Autopilot，条件是这个计划改成
  **交付时验收**（§4.2）。运行方式是项目的设置，客户批准开工时按它跑。Full Autopilot 仍然禁止。

## 1. 一条闭环

| # | 环节 | 谁 | 机制 | P1 / P2 |
|---|---|---|---|---|
| 1 | 提需求或反馈 | 客户 | `request.create` | P2 新 |
| 2 | 接住 | 哨兵 | 触发器 `studio`：`request-received` | P2 新 |
| 3 | 分析、追问、给出理解 | 指定的模型 | 哨兵的 Ask Your Agent 步骤 + `studio_reply` | P2 新 |
| 4 | 确认理解 | 客户 | `request.confirm` | P2 新 |
| 5 | 写计划草稿 | 规划 agent | `plans.create`（客户回合，只改草稿） | P1 |
| 6 | 看计划，批准开工 | 客户 | 开工 Gate，Studio 里的批准，设备签名 | P1 是你在 Beluga 里批；改 |
| 7 | 全自动开发 | AI 团队 | Autopilot：pilot、checker，自动合并 | Beluga 已有，P2 解禁 |
| 8 | 交付 | 自动 | 交付 Gate：检查通过且预览已生成时自己通过 | P2 新 |
| 9 | 看结果 | 客户 | `previews[]` + 预览链接 | P2（中台门控已写好） |
| 10 | 通过，或还不行 | 客户 | `delivery.accept` / `delivery.sendBack` | P2 新 |
| 11 | 再来一轮 | 哨兵 | 触发器 `studio`：`delivery-sent-back`，回到 3 | P2 新 |

## 2. 需求单（最前面）

### 2.1 为什么不让需求直接变成计划

P1 里 `plan.create` 一到，规划 agent 就开始写里程碑。两个问题：一句模糊的话会长出一份没人要的计划；「反馈」
（对已交付东西的意见）没有地方落。所以在计划之前加一层：先把话说清楚，客户点头，再写计划。

### 2.2 数据

```ts
StudioRequest = {
  ref: REF,                       // refOf(refKey, 'request', id)
  kind: 'need' | 'feedback',
  about?: REF,                    // feedback：针对哪个已交付的计划（planRef）
  platform?: Platform,            // need：iOS / Android / 微信小程序 / Web
  status: 'received' | 'analysing' | 'asking' | 'ready' | 'planned' | 'closed',
  summary?: { rev: int, title: TITLE, points: TEXT[], outOfScope?: TEXT[] },   // 分析给出的理解
  turns: StudioTurn[],            // 与 P1 同一形状：customer / ai / studio
  planRef?: REF,                  // planned 之后
  at: int,
}
```

- `summary` 是客户要确认的东西：一句标题，几条「我们理解你要的是…」，可选几条「这次不做」。它有自己的
  `rev`，客户确认的是某一版。
- 落盘：`studio-inbox.json` 增 `requests` 段（0600）。视图：项目视图里加 `requests[]`（白名单构造，文本过
  净化器），每个需求单只带最近 50 条 turn。

### 2.3 状态

| status | 含义 | 客户页状态行 | 等谁 |
|---|---|---|---|
| `received` | 已收下，分析还没开始 | 已收到，马上开始看 | AI |
| `analysing` | 分析的 run 在跑 | AI 正在看你的需求 | AI |
| `asking` | 分析问了问题，等回答 | 在等你：回答问题 | 客户 |
| `ready` | 理解写好了 | 在等你：确认我们的理解 | 客户 |
| `planned` | 已确认，计划已起 | 已变成计划「{title}」 | — |
| `closed` | 客户撤回 | 已关闭 | — |

`ready` 时客户页的主按钮是 **「就是这样」**（`request.confirm{requestRef, rev}`），次要动作是继续对话（回到
`analysing`，`summary.rev` 会变，旧确认一律 `stale`）。

### 2.4 客户动作（进白名单）

| 动作 | 载荷 | 结果 |
|---|---|---|
| `request.create` | `{kind, text ≤4000, platform?, about?}` | 建需求单，回执 `done` 表示已收下 |
| `request.say` | `{requestRef, text ≤4000}` | 追加一条客户 turn |
| `request.confirm` | `{requestRef, rev}` | `rev` 不是当前 → `stale`；否则起计划（§2.6） |
| `request.close` | `{requestRef}` | 关闭；已 `planned` 的 → `not-allowed` |

限流沿用 P1 的两层数字（`studio-gates.md` §5.1），需求单的消息与计划对话合并计数。`about` 必须是这个客户所在
项目里一个已 `done` 的计划，否则 `bad-args`。`plan.create` 在本 major 内继续应答（旧客户端），新客户端只发
`request.create`。

### 2.5 哨兵接住，指定的模型分析

**触发器**（`src/core/sentinel/triggers/studio.ts`，新 `kind: 'studio'`）：

| `what` | 何时 | payload |
|---|---|---|
| `request-received` | 新需求单落盘 | `{requestRef, kind, project, about?}` |
| `request-reply` | 客户在 `asking` / `ready` 的需求单里说了话 | `{requestRef}` |
| `delivery-sent-back` | 客户对交付点了「还不行」（§5.4） | `{planRef, requestRef}` |
| `delivery-accepted` | 客户通过交付 | `{planRef}` |

- payload 里**没有客户的原话**，只有 ref。原话由分析步骤用工具取（下），取到的是 `wrapCustomerText` 包好的整段：
  客户文字永远是材料，不是指令。
- core 的触发器只读 store 的 `studio` slice，不 import `src/studio/`（与 §3.6 的写法一致，`boundaries.test`
  照旧通过）。游标是已见过的 `(requestRef, turn 数)`，重启不重发。

**步骤**：就是哨兵已有的 Ask Your Agent（`claude`），`where: 'project'`，`runtime` / `model` 由搭环境的人选——
「指定的模型」就落在这里，不新造配置。由 `studio` 触发的 run 多两条规则：

- **工具边界与客户回合相同**（`PolicyContext.customerTurn`）：Read / Grep / Glob 只限本项目且避开密钥；Bash、
  写文件、网络、其他 MCP 一律禁；不产生任何权限请求。
- 只多三个工具（`beluga_studio`，只给 `studio` 触发的 run）：
  - `studio_request_get(requestRef)`：需求单、它的 turns（包好的）、`about` 指向的计划的客户视图。
  - `studio_reply(requestRef, text, asking: boolean)`：给客户回一条。过净化器后成为 `who: 'ai'` 的 turn；
    `asking: true` 把状态置 `asking`。
  - `studio_summarize(requestRef, {title, points, outOfScope?})`：写出理解，`summary.rev + 1`，状态置 `ready`。

**内置配方「接需求」**：项目第一次 `studio share` 时建一个并直接开着；模型由搭环境的人在
`beluga studio share --model …` 时选（不选就用这台节点的默认）。提示词要点：先读需求单
和相关代码；说不清的地方一次问完（最多 3 个问题）；能说清就写理解；是反馈就先判断是缺陷、改动还是新需求。

**兜底，不丢需求**（Beluga 前面没有人，兜底不能是一张等人点的卡）：

- 没有开着的 `studio` 哨兵，或它失败 / 被暂停：连接器直接跑一次同样配方的分析，不经哨兵；连这个也失败，需求单留在
  `received`，客户看到「等待：这条需求需要人看一下」，节点发 `needsHuman`，中台给搭环境的人发邮件
  （`studio-standalone.md` §4.6）。
- 一个需求单同时只有一个分析 run；run 期间来的客户消息排队，run 结束后触发一次 `request-reply`。
- 一个需求单最多 8 轮分析，超过同样按「需要人」处理。

### 2.6 确认之后：变成计划

`request.confirm` 通过后，daemon 调 `plans.create({projectId, goal})`，`goal` 是**确认的那版 `summary`**（不是
客户的原话），`{customerTurn: true}`，并记下 `plan.requestRef`。之后与 P1 相同：规划 agent 写草稿，客户页跟着
长出来。

**与 P1 不同**：P1 是客户「确认计划」升起开工 Gate，再由你在 Beluga 里批准。现在两步合成客户的一步：草稿写完
（不在 typing、有里程碑）就升起开工 Gate，**由客户在 Studio 里批准**。客户在批准前说话会让草稿变、Gate 变
`stale`（P1 已有的行为）。

## 3. 开工 Gate：客户批准

开工 Gate 显示在客户的对话里与待办里（`studio-ui.md` 的「批准开工」卡）：

- 显示：确认过的 `summary`、计划的几步与每步「做好的标准」、预计时长、按项目上限还能不能马上开始
  （`studio-standalone.md` §7）。
- 主按钮 **开始做**：`gate.answer{gateId, approve: true, draftRev}`，**客户设备签名**，节点验签后调用那一次
  `plans.approve`。运行方式取项目设置（**每一步都验收** 或 **全自动，交付时验收一次**），卡上不放选项。
- 次要 **先不做…**：写一句原因，草稿留着，客户可以接着说。
- `plans.approve` 仍然只从 Gate 调用一次，`draftRev` 不符仍是 `stale`。
- P1 在 Beluga 铃铛里出的 `studio-start` 卡不再升起（Beluga 前面没有人）。

## 4. 与中间段的接缝

### 4.1 解禁 Autopilot（改 `studio-gates.md` §3.6）

| | P1 | P2 |
|---|---|---|
| 共享计划设 `autopilot` | 抛错，已有的降回 `gated` | 允许，前提是验收方式为 `delivery` |
| 共享计划设 `fullAuto` | 抛错 | **仍然抛错**：替身 agent 会替人回答问题，其中可能有客户的决策 |
| pilot 自动通过里程碑 | 从不 | `delivery` 方式下，checker 通过的里程碑由 pilot 通过；最后一个通过后交付 Gate 按 §5.1 自动通过，**客户的验收从不自动** |

### 4.2 验收方式

计划多一个字段 `acceptance: 'each-milestone' | 'delivery'`，批准开工时定，之后不变。

- `each-milestone`（P1）：每个里程碑进 `review` 等客户验收。只能配 Check-ins。
- `delivery`（P2）：中间里程碑是内部的，客户页只看到进度；客户只在交付时验收一次。Autopilot 必须用它。

发布视图前的兜底改成：`autopilot` 且不是 `delivery` → 按 `gated` 看待。

### 4.3 客户的决策

Autopilot 跑的过程中，`audience: 'customer'` 的决策照常到客户页的 `decide` 阶段，计划在那一步等着；pilot 不替
客户回答。没有运营方在场：原本问运营方的技术决策（`audience: 'operator'`）由 pilot 按默认做并记进动态；要外部
条件才能继续的（账号、权限、额度）按「需要人」处理（`studio-standalone.md` §4.6），客户看到「等待」。

## 5. 交付与验收（最后面）

### 5.1 交付 Gate

**何时升起**：`delivery` 方式下最后一个里程碑的检查通过；`each-milestone` 方式下不升（P1 行为不变）。

```ts
StudioGate.kind 追加 'deliver'    // studio-protocol.md §3.4 已留位
```

**自动通过，没有人点**。连接器在三件事都满足时调用 `gates.ts` 通过它：

1. 最后一个里程碑 checker 通过；
2. 这一轮的代码已合并到默认分支（`studio-forges.md` §3.2，自动合并）；
3. 至少一个预览已生成（§5.2）。

验收说明（`review.notes`）由规划 agent 按计划里每一步「做好的标准」写一段「怎么看、看什么」，过净化器。

任何一条不满足就不交付：checker 不过，pilot 接着补任务；合并有冲突或预览生成失败，重试三次，仍不行按「需要人」
处理，客户看到「等待：快好了，在准备给你看的版本」。不会把半成品交给客户。

### 5.2 预览从哪来

`previews: [{ milestoneRef?, kind: 'web' | 'testflight' | 'apk' | 'miniprogram', title, url?, expiresAt? }]`
（形状已在 `studio-protocol.md` §3.4）。**由节点上的上线步骤生成，不由 agent 加**：

- 每个项目有一个**测试环境**（`studio-env.md`）。合并后，节点按测试环境的配置部署一次：Web 构建上传到中台得到
  `objectKey`，或上传小程序体验版、TestFlight、APK，得到外部链接。部署结果就是预览。
- 上传到中台的：客户通过 `GET /v1/app/projects/:pid/previews/:m` 拿 15 分钟的签名链接。中台的门控已写好：只有
  `deliver` + `approved` 才签（`studio-hub.md` §9）。
- 外部链接只收 `https`，去掉查询参数里像密钥的东西。

预览里永远没有源代码、diff、分支名。上传前节点先扫一遍：`isSecretPath` 命中、带 source map、带 `.env` 的一律拒绝，
按「需要人」处理。agent 写不了预览，也调不了上线步骤：它们是节点的流水线，不是 agent 的工具。

### 5.3 客户看到什么

`deliver` Gate `approved` 后：`stage = 'awaiting-review'`，视图带 `previews[]` 与 `review.notes`。计划页进新阶段
`delivered`（`pagePhase` 在 `review` 之后、`changes` 之前加一条）：

- 内容区顶部「交付卡」：预览入口（一个主入口，其余在卡内列表）、验收说明、当初确认的 `summary`。
- 主按钮 **通过**（10 秒撤销，与 P1 的里程碑验收相同）；次要 **还不行…**（原因抽屉，10–4000 字）。

### 5.4 通过，或再来一轮

| 动作 | 载荷 | 结果 |
|---|---|---|
| `delivery.accept` | `{planRef, draftRev}`，设备签名 | 计划 `done`；需求单保持 `planned`；触发 `delivery-accepted`；按项目的代码交付方式打标签、推送（`studio-forges.md` §3.2） |
| `delivery.sendBack` | `{planRef, draftRev, reason 10–4000}` | 见下 |

- **合并在交付前就做了**（§5.1），所以「通过」只打交付标签、按设置推送，客户的动作本身不碰 git。
- **还不行**：`deliver` Gate 作废，预览链接立刻失效；原因作为一条客户 turn 追加到需求单，状态回 `analysing`；
  触发 `delivery-sent-back`，哨兵的分析步骤判断：
  - 是**没做对**（在确认过的 `summary` 之内）→ 用 `plan_update` 在同一个计划上起草改动，走 P1 已有的
    `draftDiff` + `changes` Gate：**客户**批准改动（签名），Autopilot 接着跑，再到交付 Gate。
  - 是**新要求**（超出 `summary`）→ 回客户一句说明，写一版新 `summary`，客户确认后是一个新计划，
    `plan.follows = 旧 planRef`。
- **通过之后还有意见**：客户在项目页点「提反馈」→ `request.create{kind: 'feedback', about: planRef}`，从 §2
  重新走。这就是下一轮。

一个计划最多 5 次 `delivery.sendBack`，再多按「需要人」处理：客户看到「这条需求需要人看一下」，搭环境的人收到
邮件。

## 6. 协议与视图的改动（都是加法）

`STUDIO_PROTO.minor + 1`，major 不动：

- 动作：`request.create` / `request.say` / `request.confirm` / `request.close` / `delivery.accept` /
  `delivery.sendBack`。
- 视图：项目视图 `requests?: StudioRequestView[]`；计划视图 `previews?`、`acceptance?`、`requestRef?`、
  `follows?`；`gate.kind` 追加 `'deliver'`。
- 旧客户端：不认识 `deliver` 的按未知 Gate 处理（显示「快好了」），不会出现可点却无效的按钮。旧客户端不会签名，
  所以批准开工、通过交付在旧客户端上不可用，提示升级。
- `callRefusal` 放行名单不变；新动作在 daemon 里走 `src/studio/requests.ts` 与 `gates.ts`，不经 `PLANS_API`。
  `plans.approve` 仍只有开工 Gate 持有。

## 7. Mac 与手机

Beluga 前面没有人，所以这个循环**不在 Beluga 的 Mac 应用与手机伴侣里新增任何「等你」的卡**；所有决定都在客户的
Studio 应用里（它自己的手机 App 负责通知）。原稿里的 `studio-request`、`studio-deliver` 两张卡不做。

Beluga 里只多一点只读的东西，给搭环境的人排查用：

- Mac 计划页的 Studio 区块多「预览」列表、「验收方式」与「交付状态」三行，只读。`docs/parity.md` 各加一行。
- `beluga studio status` 多列出排队、等待中与「需要人」的需求单。
- `src/companion/coverage.ts`：新增的只读方法归 `mac`；没有新的 `phone` 方法。

## 8. 安全边界（不变的与新增的）

不变：白名单视图 + 净化器；客户文字一律包裹；客户回合没有审批路径；opId 至多一次；中台读不到代码。

新增要守的：

- 分析 run 读得到代码，但它说给客户的每一句都过净化器；`summary` 也过。
- 哨兵触发的 payload 不带客户原话，避免原话进 `{{trigger}}` 模板后被别的步骤（脚本、HTTP）带出去。`studio` 触发
  的哨兵里，`script` / `http` / `message` / `friend` 步骤一律不给 `studio_*` 工具，也拿不到 turns。
- 中台现在还读得到需求单的文字与预览文件：`studio-terms.md` §2 要补这两条，开通前发给客户。
- 预览上传有大小上限与类型白名单，签名链接 15 分钟，`sendBack` 与 Gate 作废时立即失效。

## 9. 与 P1 的差异一览

| 项 | P1 | 本设计 | 理由 |
|---|---|---|---|
| 入口 | `plan.create` 直接起计划 | 先需求单，确认后起计划 | 模糊需求、反馈无处落 |
| 分析的模型 | 规划 agent（计划的 planner） | 哨兵步骤上选，搭环境时定 | 指定模型；复用哨兵的限额、历史 |
| 客户确认 | 确认计划 | 确认理解，再批准开工（都是客户，签名） | Beluga 无人值守 |
| 谁批准开工 | 你，在 Beluga | 客户，在 Studio | 同上 |
| Autopilot | 共享计划禁止 | `delivery` 验收方式下允许 | 批准后全自动开发 |
| 验收 | 每个里程碑 | 可选：只在交付时 | 配合 Autopilot |
| 交付 | 无（留给 P2） | 交付 Gate 自动通过 + 自动生成的预览 | 检查通过就给客户看 |
| 不满意 | 里程碑 `sendBack` | 交付 `sendBack` → 分析 → 改动或新一轮 | 闭环 |

## 10. 建议的里程碑

| # | 内容 | 依赖 |
|---|---|---|
| M8 | 需求单：协议、动作白名单、`requests.ts`、落盘、视图、中台缓存；客户 Web 的需求单页 | — |
| M9 | 哨兵：`studio` 触发器、`beluga_studio` 三个工具、工具边界、配方「接需求」、兜底（直接分析与「需要人」）与上限 | M8 |
| M10 | 接缝：`acceptance`、解禁 Autopilot、项目的默认运行方式；客户批准开工（依赖签名，`studio-standalone.md` S2）；改 `studio-gates.md` §3.6 及其测试 | M8 |
| M11 | 交付：自动合并、测试环境部署生成预览、`deliver` Gate 自动通过、客户页 `delivered` 阶段、`delivery.*` 动作 | M10 |
| M12 | 再来一轮：`delivery-sent-back` 的两条分支、`follows`、提反馈入口；全链路演练与独立审计 | M9, M11 |

每个里程碑照 P1 的做法：先接口说明，后实施，独立审计，一次真实链路演练。

## 11. 待你决定

1. 默认运行方式：新共享的项目默认「每一步都验收」还是「全自动，交付时验收一次」（§3）。本稿倾向后者：Beluga
   无人值守，前者让客户多等多点。
2. 预览文件放哪：中台自带存储（Cloudflare R2）还是只支持外部链接起步（§5.2）。只做外链的话 M11 小得多。
3. 原本问运营方的技术决策由 pilot 按默认做（§4.3），还是一律转给客户用大白话问。本稿按默认做并记进动态。
