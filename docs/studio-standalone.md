# 独立的 Synon Studio 应用与 Beluga 集群对接（设计稿）

状态：**设计稿，未实施，未审计**。P1 里 Studio 是「客户 Web + 中台 + 编在 Beluga 里的一块界面」。本文把它改成一个
**独立产品**：自己的桌面应用、手机 App 和 Web，后面接的不是一台 Beluga，而是**你自己的几台 Beluga**。

**已定的前提（2026-11-18）**：

- 集群里的节点都是工作室主人一个人的机器，用同一个人的登录与订阅。不做多位开发者各带各的 Beluga；那种情况需要
  成员账号与逐人信任，本文不含。
- **桌面做 Tauri 壳，并把本机能力用上**（§2.2）；手机 App 与 Web 同时做。（当天先定过「只做 Web 和手机」，
  随后改回。）界面怎么排见 [`studio-ui.md`](studio-ui.md)，代码怎么交付见 [`studio-forges.md`](studio-forges.md)。

先读：[`studio.md`](studio.md)（P1）、[`studio-loop.md`](studio-loop.md)（需求单与交付 Gate）、
[`studio-hub.md`](studio-hub.md)、[`studio-daemon.md`](studio-daemon.md)、[`machines.md`](machines.md)。

## 0. 结论摘要

- **Studio 应用不依赖 Beluga 的界面。** 客户和你都用 Studio 应用；Beluga 的 Mac 应用里只留「连接」与「状态」。
  你不用打开 Beluga 也能批准开工、确认交付。
- **Beluga 是执行节点。** 每个节点是你的一台跑着 Beluga daemon 的机器（Mac、Mac mini、服务器，有没有窗口都行），
  里面带 Studio 连接器（`src/studio/`）。节点主动连中台，不需要公网地址。
- **对接只有一个契约**：中台 ↔ 节点的 Studio 协议（`studio-hub.md` §10）。Studio 应用永远不直接连节点。
- **集群的单位是计划，不是任务。** 一个需求单 / 计划归一个节点；中台只做「放到哪个节点」，依据是节点自己报的
  「能不能接、还有多少空位」。
- **搬家用 Beluga 现成的。** 这些节点本来就是你在 Beluga 里配好的「Your Computers」，计划在它们之间搬动已有
  **Move To**；Studio 只需要认得搬过去之后还是同一个计划。
- **批准必须端到端签名。** 批准从 Beluga 铃铛搬到 Studio 应用后，中台就站在批准的路上；所以开工 / 交付的批准由你
  设备上的密钥签名，节点验签。中台被攻破也伪造不了批准。

## 1. 两种人，三样东西

| 谁 | 用什么 | 能做什么 |
|---|---|---|
| **客户**（需求方、产品经理） | Studio 应用（客户身份） | 提需求和反馈、确认理解、回答决策、看交付、通过 / 还不行 |
| **你**（工作室主人，开发） | Studio 应用（主人身份） | 看需求单与计划、批准开工、确认交付、加预览、和客户说话、管节点与客户 |
| **节点** | 你的 Beluga daemon + 连接器 | 分析、规划、开发、检查；发布净化后的视图；执行白名单动作 |

```
Studio 桌面 / 手机 / Web ──► 中台 ◄── 出站连接 ── 节点 A（你的 Mac）
       客户 · 你                 │  ◄── 出站连接 ── 节点 B（你的 Mac mini）
                                 └─ ◄── 出站连接 ── 节点 C（你的服务器，无窗口）
```

## 2. 应用

### 2.1 三个目标，一套界面代码

| 目标 | 做法 | 现状 |
|---|---|---|
| 桌面（macOS 先，之后 Windows） | 新 `packages/studio-desktop`：Tauri 2 壳装 `packages/studio-app` 的 Web 构建，加本机能力 | 新 |
| iOS / Android | 同一个 Expo 工程出原生包；推送走 APNs / FCM | P2 已列入 |
| Web | Expo 导出静态站，中台同源托管；不装应用的客户用它 | P1 已有（开发代理） |

三个目标都**不内嵌 daemon**，这是它和 Beluga 应用的根本区别。界面代码只有一份；本机能力经一层
`lib/native.ts`（桌面走 Tauri 命令，手机走 Expo 模块，Web 给降级实现），页面不直接碰平台。

### 2.2 桌面壳用上的本机能力

Beluga 的 Mac 应用已经在用这些 Tauri 插件（notification、deep-link、dialog、opener、window-state、
clipboard-manager、single-instance、updater、global-shortcut、tray-icon），Studio 的壳照搬同一套，不引入新技术。

| 能力 | 给谁 | 做什么 | Web 上的降级 |
|---|---|---|---|
| 钥匙串 | 你 | 设备密钥（§5）存系统钥匙串，不可导出 | WebCrypto 不可导出密钥，存 IndexedDB |
| 系统通知 + 菜单栏图标 | 都 | 「等你」的事立刻通知；菜单栏图标带待办数，点开是待办列表 | Web Push |
| 深链 `synon://` | 都 | 登录链接、通知、邮件直接打开到那条需求 | 普通 `https` 链接 |
| 全局快捷键 | 客户 | 任何时候呼出「提需求」小窗 | 无 |
| 截屏并标注 | 客户 | 提反馈时截当前屏幕、圈出问题，作为附件 | 上传图片 |
| 拖入文件与文件夹 | 客户 | 把需求文档、设计稿、表格拖进输入框当附件（只读，逐个确认后才上传） | 文件选择框 |
| 本机预览 | 都 | 交付的 Web 构建在内置窗口里打开；安装包下载后用系统打开 | 新标签页 |
| 本机 git | 都 | 交付的代码「克隆到本机」「在编辑器里打开」；凭证进钥匙串（见 `studio-forges.md`） | 只显示仓库地址 |
| 发现本机的 Beluga | 你 | 这台机器上跑着你的 Beluga 时：一键把本设备加进它的信任名单（免输配对码）、「在 Beluga 里打开」跳到对应计划 | 输配对码 |
| 离线草稿与自动更新 | 都 | 没网时需求先存本机，上线后发；应用自己更新 | 浏览器本地存储 |

两条边界：

- **本机文件只读、只在你点了之后上传**。壳不扫描磁盘，不给 agent 任何本机权限；agent 在节点上跑，不在客户机器上。
- **「发现本机的 Beluga」只用于配对和跳转**。壳通过本机回环地址请 Beluga 弹出它自己的确认框（在 Beluga 里点同意），
  不读 Beluga 的令牌文件，也不替 Beluga 做任何事。

Web 上的设备密钥较弱（清站点数据即丢、挡不住恶意扩展），所以节点页把每个可信设备列出来并可逐个撤销；批准建议
在桌面或手机上做。

主人身份比客户多出的屏：收件箱（等我批准 / 等我交付 / 没人接的需求单）、计划页的主人区、节点页、客户与项目管理
（取代 P1 的 `/v1/admin` 管理页）。

## 3. 从 Beluga 搬出来什么

| 东西 | P1 在哪 | 之后在哪 |
|---|---|---|
| 开工卡、交付卡、兜底的需求单卡 | Beluga 铃铛与 Beluga Link 手机 | **Studio 应用**（收件箱 + 推送） |
| 对客户说话（`studio.say`） | Beluga Mac | Studio 应用 |
| 加预览、选默认运行方式 | Beluga Mac 计划页 | Studio 应用 |
| 建工作室、邀请客户、项目映射 | 中台管理页 + 令牌 | Studio 应用（主人登录） |
| 连接、共享项目、状态 | Beluga Mac 对话框 / `beluga studio` CLI | **留在 Beluga**（这是节点自己的事） |
| 看代码、diff、终端 | Beluga | **留在 Beluga**；Studio 里只有一个「在 Beluga 里打开」的深链 |

过渡期两边都能批准（Beluga 铃铛的卡保留，先到先得，Gate 本来就只批一次）。Studio 应用稳定后，Beluga 里的卡降为
只读提示。

## 4. 集群

### 4.1 为什么每个节点各自连中台

Beluga 的「Your Computers」里，工作跑在哪台机器，状态就只在那台机器的 daemon 里（`machines.md`：只有你看到的
东西才跨机器）。连接器要读计划、发视图、执行动作，所以它必须在**计划所在的那台机器**上。因此不是「一台连中台、
替其他机器转发」，而是每台都带连接器、各自出站连中台。

注意 `studio.link` / `studio.setProject` 在跨机器调用里是 `refuse`（`src/machines/coverage.ts`），所以每台节点要在
它自己上面连一次：有窗口的用对话框，无窗口的用 `beluga studio link <code>` 与 `beluga studio share`。

### 4.2 要改的一条规则：节点池

中台已经允许一个工作室登记多台 daemon（`daemons` 表按 `studio_id`）。挡住集群的只有一条：**一个 Studio 项目只绑
一台 daemon**（`projects.daemon_id`，`studio-daemon.md` §2.3）。改成：

```sql
project_nodes (project_id, daemon_id, daemon_project_id, enabled,
               PRIMARY KEY (project_id, daemon_id), UNIQUE (daemon_id, daemon_project_id))
placements    (project_id, ref /* requestRef 或 planRef */, daemon_id, placed_at, PRIMARY KEY (project_id, ref))
```

「一个 daemon 的一个本地项目只映射一个 Studio 项目」保留。

### 4.3 放置

- **何时放**：`request.create` 入队时（`studio-loop.md` §2）。旧的 `plan.create` 同理。
- **节点报什么**：`hello` 之后每次变化上报 `load{ready, why?, room}`。`ready` 与 `why` 用 Beluga 的 Best Available
  已经在看的那些条件来算（`machines.md`「Run New Work On」）：agent 已登录、没到用量上限、项目在这台机器上、
  内存磁盘够；`room` 是还能同时接几个。只是一个布尔、一个原因码、一个数，没有模型名与路径。
- **放哪**：池里 `enabled`、在线、已 `synced`、`ready` 的节点中，你指定了就按指定，否则取 `room` 最大的；并列取
  上次接活最早的。没有可用节点就排队，你的收件箱里显示「没人接：<原因>」（例如「Mac mini 的用量上限 16:00 恢复」）。
- **粘住**：需求单变成计划后继承同一个节点；下一轮（`plan.follows`）也优先同节点，因为代码在那。之后这个计划的
  动作只投给它。
- 节点满了可以回 `busy`，中台换下一个。中台不替节点做主。

### 4.4 同一个计划，换了节点还认得

P1 的 `planRef` 由每台 daemon 自己的 `refKey` 算出，同一个计划搬到另一台，ref 就变了，客户页会当成新计划。

改法：**`refKey` 归工作室，不归单台 daemon**。第一台节点连上时生成；之后的节点在连接时从已有节点取得（经
「Your Computers」的端到端通道，不经中台；中台始终拿不到 `refKey`）。于是同一个需求单 / 计划在哪台节点上，ref
都一样。

### 4.5 节点掉线与搬家

| 这件活处于 | 做法 |
|---|---|
| 需求单还在分析，或计划还没批准开工，节点掉线 | 默认原地等（动作排队 7 天，P1 行为）。你可以点 **换一个节点**：中台把需求单原文重发给新节点，旧节点回来后收到 `withdrawn` 把自己那份关掉 |
| 计划已开工，两台都在线 | 在 Beluga 里用计划的 **⋯ › Move To ▸**（已有：暂停、提交未提交的改动、搬过去、在那边继续）。新节点发布同一个 `planRef`，中台据此更新 `placements`；旧节点对它发 `plan-gone` 时中台不撤客户视图 |
| 计划已开工，节点掉线 | **不自动搬**。代码在那台机器上，客户页显示「工作室离线」，等它回来 |

自动换节点做成开关，默认关：两台节点对同一个需求各写一份计划，比让客户多等一会儿更糟。

## 5. 身份与批准的签名

P1 的安全性质：客户确认只升起 Gate，**只有你在自己的 Mac / 手机上**才能批准，中台够不着这一步。把批准搬进
Studio 应用后要保住这条。

- **主人账号**：中台给工作室记一个主人邮箱，用魔法链接登录（同客户）。P1 的 `OPERATOR_TOKEN` 只留作首次开通。
  只有一个主人，不做角色与成员表。
- **设备密钥**：Studio 应用首次以主人身份登录时在本机生成一对密钥（存放见 §2.2 的表）。
- **哪些设备可信，由节点说了算，配一次就够**：在任意一台节点上执行 `beluga studio trust`（或 Beluga Mac 的
  Synon Studio 对话框）显示一个 6 位配对码，你在 Studio 应用里输入，那台节点记下这台设备的公钥。信任名单随
  「Your settings follow you」的通道同步到你的其他节点（`machines.md`）。中台只转发配对帧，不能替你加设备。撤销
  同理，在任意节点上做。
- **签什么**：`gate.answer{gateId, approve, draftRev, notes?, at}` 整帧签名。节点验签、查公钥在信任名单里、比对
  `draftRev`，才调用那一次 `plans.approve`（或放行交付）。`at` 严格递增，防重放。
- **不签的**：客户动作（本来就只在白名单里，权限低）、你的 `studio.say`、加预览。这些经中台会话鉴权就够；最坏
  情况是中台被攻破后冒充你对客户说话，条款里要写明。

## 6. 你在 Studio 里能看到什么

你要「检查计划后批准」「确认可以交付」，需要比客户多的信息，但中台仍然**不存代码**：

| 字段 | 客户 | 你 |
|---|---|---|
| 计划标题、里程碑、任务标题、验收标准、对话 | ✓ | ✓ |
| 任务 KEY、预估点数、当前在哪个节点 | | ✓ |
| checker 的结论全文、失败的检查名 | | ✓ |
| PR 的编号与链接、是否已合并 | | ✓ |
| 用了哪个 agent、跑了多少次 | | ✓ |
| 源代码、diff、文件路径、终端、密钥 | | **不经中台**；点「在 Beluga 里打开」或去 GitHub 看 |

实现：节点为每个计划发布两份视图，`customer`（现有白名单）与 `operator`（另一份更宽的白名单，仍过密钥净化）。
中台按会话身份给对应的那份；主人视图的缓存单独存，客户会话永远读不到。

## 7. 连接器：Beluga 这一侧

- 连接器仍是 daemon 进程内的模块（`src/studio/`）。客户回合的工具边界、净化视图、「只有 Gate 能批准」必须在
  核心里强制，做成外挂（外部 agent 的 MCP 接口）守不住。
- 所以**每个节点都跑带连接器的 Beluga 构建**（本仓库的 daemon）。Best Available 本来就要求各机器版本一致，这条
  不是新负担。
- 对 Beluga 核心的要求保持「只留钩子」。本文新增的钩子两处：算 `load` 时复用 Best Available 的判断（只读）；
  计划 Move To 落地后通知连接器重新发布。
- 连接器新增：主人视图的白名单、验签与信任名单（`studio-trust.json`，0600，随设置同步）、`refKey` 的取得、
  `busy` / `withdrawn` 两种应答。

## 8. 协议改动

都在 `STUDIO_PROTO.major = 1` 内做加法：

- 节点 → 中台：`load{ready, why?, room}`；`plan` / `patch` 帧多一个 `audience: 'customer' | 'operator'`（缺省是
  `customer`，旧中台忽略主人视图）；回执码加 `busy`。
- 中台 → 节点：`deliver` 可带主人动作 `gate.answer`（含签名与公钥指纹）、`studio.say`、`preview.add`；
  `withdrawn{ref}`；配对帧。
- 中台 → 应用：主人会话收到 `operator` 视图与收件箱帧。
- 旧节点（不报 `load`）按「空位未知」排在最后，仍可被指定。

## 9. 与 P1 的差异

| 项 | P1 | 本设计 | 理由 |
|---|---|---|---|
| 产品形态 | 客户 Web + Beluga 里的界面 | 独立的桌面、手机与 Web 应用，两种身份 | Studio 自成一个产品 |
| 你在哪批准 | Beluga 铃铛 / Beluga Link | Studio 应用（Beluga 里过渡期保留） | 不必开 Beluga |
| 批准的信任 | 只在本机，不经中台 | 经中台转发，设备密钥签名，节点验签 | 搬出来后保住原来的性质 |
| 你的身份 | 一个令牌 | 一个主人账号 + 设备密钥 | 应用要能登录 |
| 项目 ↔ daemon | 一对一 | 节点池，计划粘在一个节点 | 集群 |
| `refKey` | 每台 daemon 一把 | 每个工作室一把，只在你的机器之间传 | 计划搬家后 ref 不变 |
| 管理 | 中台管理页 | Studio 应用里 | 一个入口 |

## 10. 建议的里程碑

排在 `studio-loop.md` 的 M8–M12 之后或与之穿插；标了依赖。

| # | 内容 | 依赖 |
|---|---|---|
| S1 | 主人登录、主人视图（节点白名单 + 中台分身份缓存）、Studio 应用的主人收件箱（只读） | — |
| S2 | 设备密钥、配对、信任名单同步、签名的 `gate.answer`；Studio 应用里批准开工；Beluga 卡保留 | S1 |
| S3 | 节点池：`project_nodes` / `placements`、`load` 上报、放置与指定、`busy`、节点页；工作室级 `refKey` | S1 |
| S4 | 桌面壳 `packages/studio-desktop` 与 §2.2 的本机能力；原生 iOS / Android 包与推送；Web 同源托管 | S2 |
| S5 | 管理搬进应用（客户、项目、映射），停用令牌管理页；`studio.say` 与预览搬进应用 | S2, loop M11 |
| S6 | 换节点（未开工）、`withdrawn`、Move To 后的重新发布；全链路演练（两节点、一客户）与独立审计 | S3 |

## 11. 待你决定

1. **批准搬进 Studio 应用后，Beluga 里的卡最终是去掉还是长期并存。**
2. **未开工的活在节点掉线后是否自动换节点。** 本稿默认不自动。
