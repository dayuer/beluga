# Beluga Studio — 把 Plans 做成客户订阅的远程 App（设计）

日期：2026-11-10 · 状态：设计已确认，待写 P1 实施计划

## 1. 目标与边界

Beluga Studio 是一个给**客户**用的独立 App（iOS / Android / Web）：客户订阅后，在 App 里把需求变成一个
Beluga **Plan**，和规划 agent 对话、看计划长出来、回答决策、验收里程碑、试用预览。干活的是运营方（你）的
Beluga daemon 和它的 AI 团队；你在关键节点把关。

- 模式：**真人 + AI 代开发**。客户机器上不跑 agent，不用客户的 Claude 账号。
- 客户要做的 app 可以是 iOS、Android、微信小程序或 Web。
- **付费只在 Web**（Stripe）。移动端只读订阅状态，没有价格、购买按钮或外链。
- **AI 直接回复客户，关键节点人审**：开工、交付、超出权益。
- 不在范围内（第一版）：App Store 提审进度、客户自助建项目、端到端加密、按额度扣费。

不变的规则：中台和客户端**永远拿不到源代码、diff、密钥**。过滤沿用 companion 已有的
`stripCode` / `isArtifact` / `isSecretPath`，再加一层客户过滤（§4）。

## 2. 架构

```
客户端 packages/studio-app (Expo: iOS / Android / Web)        Web /billing (Stripe Checkout + Portal)
        │ HTTPS + WebSocket                                          │ webhook
        ▼                                                            ▼
┌──────────────── Studio 中台 packages/studio-hub (Cloudflare) ────────────────┐
│ 每个工作室一个 Durable Object (StudioHub) · D1: 账号/组织/档位/权益/用量       │
│ 客户视图缓存 · 客户动作队列 (opId, 7 天) · 推送 APNs/FCM/Web Push · R2 文件    │
└──────────────────────────────────▲──────────────────────────────────────────┘
                                   │ 出站 WSS，daemon 设备密钥签名
                     ┌─────────────┴─────────────┐
                     │ Beluga daemon  src/studio/ │  客户项目 = Beluga 项目
                     │ link · publish · inbox ·   │  Gate 走 NeedsYou（Mac + companion）
                     │ gates                       │
                     └────────────────────────────┘
```

| 单元 | 位置 | 职责 | 依赖 |
|---|---|---|---|
| 协议 | `src/studio/protocol.ts` | `StudioPlanView`、动作、帧的 zod schema；`STUDIO_PROTO.major` | 只有 zod（browser-safe） |
| daemon 连接器 | `src/studio/` | 绑定、出站连接、发布客户视图、执行白名单动作、两个 Gate | `core/plans`、`companion/views.ts`、`companion/strip.ts` |
| 中台规则 | `src/net/studio/handler.ts` | 认证、权限、权益校验、队列、签发预览链接；纯函数 | 协议 |
| 中台壳 | `packages/studio-hub` | Worker + DO + D1 + R2，只做存储和转发，规则调 handler | 中台规则 |
| 客户端 | `packages/studio-app` | 八屏（§6）；Web 多 `/billing` 和运营后台 | 协议、共用的计划图/大纲组件 |

这套结构参照 `packages/mailbox`：规则放在 `src/net/...`，可以单独测试；包里只放部署壳。

## 3. Plan 能力到客户端的映射

一个需求就是一个 Plan。

| 阶段 | 客户能做 | 运营方把关 | 复用 |
|---|---|---|---|
| ① 新建 | 选项目，写目标，附图或文件，勾选本次涉及的平台 | — | `plans.create` |
| ② 规划 | 和规划 agent 对话；看计划图和大纲实时长出来；看 decisions | — | 计划自己的对话、`beluga-graph`、`PlanView` |
| ③ 提交 | "确认计划"，可选"先复核" | **Gate：开工**（`studio-start`）。你看到估算和权益占用，批准后才调用 `plans.approve` | `plans.verify` / `plans.approve` |
| ④ 运行 | 看 headline、进度条、计划图上的任务状态、动态 | 运行模式、并发数、用哪个 agent 都由你在 Mac 上定 | pilot、`progress.ts` |
| ⑤ 决策 | 回答分配给"me"的任务和 agent 的问题 | 涉及账号、密钥、付款的任务只给你，不给客户 | NeedsYou `question` / `decision` |
| ⑥ 验收 | checker 跑完后看结果和预览；**通过** / **还不行…** | **Gate：交付**（`studio-deliver`）。你放行之后客户才看得到预览 | `plans.pass` / `plans.sendBack` |
| ⑦ 改需求 | 在对话里提修改，看草稿差异（新增 / 修改 / 移除）并应用 | 超出权益时出现开工 Gate | 草稿与正文机制 |
| ⑧ 完成 | 看总结，拿最终版本 | 合并、发布、提审只在你这边做 | `plans.openPr` / `mergePr` 保持 `mac` |

**客户动作白名单**（中台和 daemon 各校验一次）：`plans.create`、在计划对话里发消息、
`plans.verify`、请求批准（产生开工 Gate）、回答决策、`plans.pass`、`plans.sendBack`、
应用或放弃草稿改动。除此之外的 `plans.*` 一律拒绝。

## 4. 客户视图（`StudioPlanView`）

在 companion 的 `planPageView` 之上生成，然后去掉：任务的 `touches` 和一切文件路径、worktree 和分支名、
agent 和模型名、任务 `KEY`（换成标题）、代码块（`stripCode`）。

保留：标题、目标、里程碑和任务（标题、目标、验收标准、状态）、decisions、headline、进度、动态、
待客户处理的事，以及已放行的预览。

AI 角色名（Product / Design / Engineering…）由运营方在 Studio 里配置；你本人的发言标成"名字 · Studio"。

## 5. 连接与同步

- **绑定**：在 Studio Web 上建好工作室，拿到一次性绑定码，在 daemon 上运行 `beluga studio link <code>`
  （Mac 设置里也有入口）。daemon 生成 Ed25519 密钥并登记，之后每次连接都签名认证。只有出站连接，
  不开端口，也不用隧道。
- **项目绑定**：一个 Studio 项目只绑一台 daemon，也就是 repo 所在的那台。一个工作室可以挂多台
  daemon。推荐把客户项目放在常开的 headless daemon 上（`docs/headless.md`）。Mac 上在项目的 ⋯ 菜单里
  选 **连接到 Studio…**。
- **视图**：Plan 一变，daemon 就推增量；重连时推全量快照。中台缓存最新视图，客户端只从中台读，
  所以 daemon 离线时客户照样能看。
- **动作**：每个动作带 `opId`，保证幂等。中台先校验白名单、权益和项目权限，再入队；daemon 再校验一遍，
  执行后回传结果。daemon 离线时，客户端在这条动作上显示"已排队，工作室上线后处理"。队列保留 7 天，
  过期的动作告诉客户"未处理"。
- **文件**：客户附件上传到 R2，daemon 再拉进计划。预览由 daemon 上传到 R2，**只有交付 Gate 放行后**，
  中台才签发有时效的访问链接。TestFlight 邀请、APK、小程序体验码、Web 预览都作为"预览卡片"发出。
- **推送**：由中台发送 APNs / FCM / Web Push。推送的情况：有决策要客户回答、有新预览、
  里程碑完成、计划完成。运营方的 Gate 走 Beluga 的 NeedsYou，Mac 和 companion 手机都会通知。
- **隐私**：中台能读到对话、计划文字和预览（Web 端和推送需要），读不到代码和密钥。传输用 TLS，
  不做端到端加密。这一点要写进客户条款。
- **版本**：同一个 `STUDIO_PROTO.major` 内只做加法。daemon 版本太旧时，中台标"工作室需要更新"。
- **出错时**：
  - daemon 拒绝动作时，原因原样回给客户端。
  - 断线时客户端显示"工作室离线 · 上次同步 x 分钟前"。
  - 中台故障不影响 Beluga 本地。

## 6. 客户端

`packages/studio-app` 用 Expo 一套代码出三端。外观沿用 companion 的规则（`packages/companion/lib/theme.ts`）：
柔和粉彩加图标，标题栏用实色、滚动后加细线，每屏一个主按钮，高级选项收进 •••。计划图和大纲的组件
从 companion 抽出来共用。

| 屏 | 内容 | 主按钮 |
|---|---|---|
| 登录 | 邮箱魔法链接、Apple、Google（iOS 必须有 Sign in with Apple） | 继续 |
| 项目 | 卡片：名称、平台图标、当前计划一句话进度，有事要处理时带圆点 | — |
| 项目首页 | 计划列表（进度环、状态、在等谁），往期预览 | 新需求 |
| 新需求 | 目标输入框、附件、勾选平台 | 开始规划 |
| 计划页 | headline、进度条；图 / 大纲 / 动态；对话在手机上是底部抽屉，在 Web 上停靠在右侧 | 随阶段变化：确认计划 / 回答 / 验收 / 应用改动；轮到运营方或 AI 时不显示 |
| 待办 | 跨项目汇总要客户处理的事：决策、验收、草稿改动 | 卡片自带按钮 |
| 预览 | 按里程碑分组的预览卡片、截图和录屏 | 打开 / 安装 |
| 设置 | 个人资料、成员、通知、订阅状态（只读） | — |

## 7. 订阅与权益

- Web `/billing`：Stripe Checkout + Customer Portal；webhook 写入 Entitlement。
- 移动端只显示"当前档位 · 到期时间"；过期时只显示"订阅已过期"，没有链接。
- 档位表放在 D1，由运营方编辑：`maxProjects`、`maxActivePlans`、`monthlyUnits`（null 表示不限）、`features`。
- 第一版只**强制**项目数和并发计划数，超额时在开工 Gate 上提示，由运营方决定。
- **记录**用量：任务估算点数、agent 运行时长、里程碑数，留给以后定价。
- 运营后台（Web，只有运营者角色可见）：客户和组织、建项目并绑定 daemon 项目、分配档位、AI 角色名、已连接的 daemon。

## 8. 和 Beluga 现有规则的衔接

- 新的 `studio.*` API 在 `src/companion/coverage.ts` 里归类：绑定和设置是 `mac`；回答 Gate 是 `phone`，
  因为 Gate 是 NeedsYou。
- 新的 NeedsYou kind `studio-start` 和 `studio-deliver` 要加进 companion 手机的卡片；
  `docs/companion.md` 和 `docs/parity.md` 要同步更新。
- `src/studio/protocol.ts` 加入 `tests/browser-safe.test.ts`；core 里不写 UI 代码（`tests/boundaries.test.ts`）。

## 9. 分期

| 期 | 交付 | 完成标准 |
|---|---|---|
| P1 内核 | `src/studio/`、`src/net/studio/handler.ts`、`packages/studio-hub`、Mac 上的"连接到 Studio…"、开工 Gate；客户端只做 Web（登录、项目、计划页、对话、确认计划、决策、验收） | 客户在 Web 上提需求，看着计划长出来；你在 Mac 上批准开工；跑到第一个里程碑，客户验收 |
| P2 移动与预览 | iOS 和 Android 构建、推送、R2 附件和预览、交付 Gate、预览卡片 | 客户在手机上收到推送，打开预览就能试；商店审核材料准备好 |
| P3 订阅与运营 | `/billing`、档位和权益执行、用量记录、运营后台、成员邀请 | 订阅后 App 立刻显示对应档位；超额时开工 Gate 会提示 |

## 10. 测试

- `tests/studio-view.test.ts`：客户视图里没有路径、分支、模型、`KEY` 和代码块。
- `tests/studio-actions.test.ts`：整个 `plans.*` 方法表里，白名单外的全部拒绝；同一个 opId 只执行一次；
  开工 Gate 没批准前绝不调用 `plans.approve`。
- `tests/studio-link.test.ts`：签名认证；断线重连后推全量快照；daemon 离线时动作排队、上线后执行。
- `tests/team/studio-hub.test.ts`（参照 mailbox）：权限、权益、队列过期、交付前不签发预览链接。
- 端到端 soak：用假的 hub 加假的 agent，把一个计划从提需求跑到验收，中途断一次 daemon。

## 11. 风险

- **Claude 账号条款**：用个人 Claude Code 订阅给付费客户做代开发，可能不在允许范围内。
  P3 定价前要确认；以后可能改用 API 按量计费，这会影响成本和定价。
- **商店审核**：iOS 上"在其他地方购买"可能被质疑。App 里绝不能出现价格和购买入口，审核说明要事先准备好。
- **运维**：中台是一个要长期维护的服务，需要监控和告警（Cloudflare 本身成本很低）。
- **可用性**：客户的体验取决于 daemon 是否在线，所以客户项目要放在常开的机器上。
