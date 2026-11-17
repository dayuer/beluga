# Synon Studio P1（M7 / BLG-101）独立审计

日期：2026-11-11（初审 `bf23cbc1`；复核 `865802fd`）。审计对象：`beluga/blg-97-m7`。
依据：`docs/superpowers/specs/2026-11-10-beluga-studio-design.md` §1、§5、§10，以及 M7 的 P1 完成标准。
方式：**只读**。除本文件外没有修改任何文件，没有提交，没有跑格式化；`git status` 在审计前后均为 clean。

## 结论

**复核后判定：通过，但仍有 1 个缺口（passed with gaps）。** 2026-11-11 在提交 `865802fd`（HEAD）上复核：#2（手册不再自称真邮件）已在 `docs/studio.md:237,242` 修正；#3（客户/外部 agent 不能设 `autonomy`）已在 `src/core/plans/work.ts:660-674,697-710` 实现并有回归测试 `tests/studio-chat.test.ts:289-309`；#4（客户条款）已新增 `docs/studio-terms.md` 并在 `docs/studio.md:10,112` 链接，逐行覆盖 §5.6。我在 865802fd 上只读复跑了 31 个相关文件 / 562 个测试，全部通过。P1 完成标准的四步——客户在手机宽度 Web 上提需求、看着计划长出来、运营方在 Mac 上批准开工、跑到第一个里程碑并由客户验收——证据齐全；隐私白名单、opId 幂等、7/14 天保留、重连顺序、draftRev 失效、批准路径这几条硬边界在代码与测试里都成立。仍剩 **#1：真 Resend 发信与真邮箱登录没有做**（`packages/studio-hub/.dev.vars` 仍不存在，`MAIL_MODE=outbox`，运行报告 `docs/reports/studio-p1-run.md:9,76-80` 已如实说明）。因此 **M7 可以记为通过（有缺口）；P1 在 #1 完成前不能称为“客户可用”**，影响是验证与信任，不是主链路代码。

## 环境与证据

| 项 | 值 |
|---|---|
| worktree | `/Users/liyuqing/.beluga/workspaces/beluga-2afc/blg-97-m7` |
| 分支 / HEAD | `beluga/blg-97-m7` / `865802fdcf0fbe6d11e684dd510f52f4efc19132`（初审时为 `bf23cbc1`） |
| 仓库状态 | 初审时 clean；复核时工作区只有本报告一个未跟踪文件（`?? docs/reports/studio-p1-audit.md`） |
| 通读的实现 | `src/studio/{view,sanitize,protocol,actions,gates,inbox,link,publish,chat,decisions,service,keys}.ts`；`src/net/studio/{views,queue,handler,store}.ts`；`src/core/plans/{edit,work,plans}.ts`、`src/agent/{policy,plan-tools}.ts`；`packages/studio-hub/src/hub.ts`；`packages/studio-app` 的卡片/待办组件 |
| 通读的测试 | 设计 §10 点名的全部文件；`tests/team/studio-hub*.test.ts`；`tests/parity.test.ts`、`tests/boundaries.test.ts`、`tests/browser-safe.test.ts`；`tests/studio-soak.test.ts` |
| 独立运行（初审） | `npx vitest run` 11 个相关文件：**11 passed / 272 tests passed**（日志 `.beluga/scratch/agents/P5GgnS7853/studio-tests.log`） |
| 独立运行（复核 865802fd） | `npx vitest run` 31 个相关文件（`studio-*`、`team/studio-*`、`external-methods/state`、`plans`、`parity`、`boundaries`、`browser-safe`）：**31 passed / 562 tests passed**（日志 `.beluga/scratch/agents/P5GgnS7853/recheck-broad.log`）；另跑 studio-chat/gates/soak：**44 passed**（`recheck-tests.log`） |
| 全量证据 | `.beluga/scratch/m7/full/vitest.txt`：`Test Files 656 passed | 1 skipped`，`Tests 7929 passed | 7 skipped`（`vitest.txt:1304-1305`）；根与各包 typecheck 全部 `exit=0`（`root-typecheck.txt`、`pkg-typecheck.txt`）；`studio-app-e2e.txt`：`16 passed, 4 skipped`。该全量日志生成于初审 `bf23cbc1`；`865802fd` 的提交信息称全量 656/7929 通过，我未重跑全量，只复跑了 31 个相关文件 |
| 运行报告 | `docs/reports/studio-p1-run.md`；原始 PNG、脚本与各端日志在 `.beluga/scratch/m7/`；`wrangler.log:9` 显示 `MAIL_MODE ("(hidden)")`，运行报告自述 `--var MAIL_MODE:outbox` |
| 截图 | `docs/img/studio-p1/01..10` 共 10 张全部存在；逐张抽查 01/04/05/07/09/10，与报告文字一致（见“运行报告真实性”） |

## 复核记录（2026-11-11，865802fd）

- 提交 `865802fd` 改了 4 个文件：`docs/studio.md`（#2）、`src/core/plans/work.ts` + `tests/studio-chat.test.ts`（#3）、`docs/studio-terms.md`（#4）。
- #2：`docs/studio.md:237` 现在写“真中台 —— `MAIL_MODE=outbox`，真 Resend 邮件待补 —— + 真 AI 规划 + 真 daemon + Mac 前端”；`:242` 写“管理页 outbox 里的魔法链接（令牌已遮住；真邮箱收信待补）”。全文 `grep` 不再有“真邮箱收到的魔法链接”。
- #3：`src/core/plans/work.ts:660-674` 的 `refuseAutonomy`/`refuseBodyAutonomy` 在 `external`（客户回合与外部 agent）的 `write`/`update` 里拒绝 `update_milestone.autonomy`、`add_milestone.milestone.autonomy` 与整份 body 的 `milestones[].autonomy`（接线在 `:697-710`）；回归测试 `tests/studio-chat.test.ts:289-309` 同时断言非 autonomy 的草稿改动仍返回 `Saved the draft`。我在 865802fd 上跑过该文件（14 个用例）与 31 个相关文件（562 个用例），全过。
- #4：`docs/studio-terms.md`（54 行）逐行覆盖设计 §5.6 的 7 类数据/保留期/读者、子处理方（Cloudflare，跨境）、运营方可读对话、删除账号与 P2 预览带前端代码；`docs/studio.md:10` 顶部与 `:112` 邀请步骤都链接了它。
- #1 未变：`packages/studio-hub/.dev.vars` 仍不存在（`ls` 报 No such file），运行报告与 01 截图仍是 outbox；这是业主动作。

## 逐条对照

### 设计 §1 目标与边界

| 条目 | 判定 | 证据 |
|---|---|---|
| 客户独立 App，P1 只做手机优先 Web | CONFIRMED | `packages/studio-app` 是 Expo Web；运行在 390×844、`deviceScaleFactor: 2` 下驱动（`.beluga/scratch/m7/customer-login.mjs:30` 等）；没有原生构建 |
| 真人 + AI 代开发；客户机器不跑 agent，不用客户的 Claude 账号 | CONFIRMED | agent 跑在运营方 daemon；docs/studio.md:7-9 |
| 四处输入体验是产品中心 | CONFIRMED | 新需求/对话/决策/「还不行」对应 4 个动作，`src/studio/protocol.ts:115-130`；应用测试 `tests/team/studio-app-*` |
| 付费只在 Web（P3），移动端无价格/购买/外链 | NOT-A-PROBLEM | 应用内未找到订阅/价格/Stripe 入口 |
| AI 直接回复，关键节点人审；开工必须人批 | CONFIRMED | 客户「确认计划」只升起 Gate（`src/studio/actions.ts:134-137`），批准只从 `src/studio/gates.ts:199-212` 发生 |
| 不在范围：推送、自助建项目、端到端加密、按额度扣费 | CONFIRMED | 与 §5.5/§7 一致；P1 没有推送代码，hub 明文缓存（设计如此） |

### 设计 §5 连接与同步

| 条目 | 判定 | 证据 |
|---|---|---|
| 5.1 一次性绑定码 + Ed25519 签名、只出站 | CONFIRMED | `src/studio/keys.ts`；`tests/team/studio-hub.test.ts:124-236`（签名/时间戳/换绑） |
| 5.2 rev 缺口要全量；重连固定 hello → 全量 → synced | CONFIRMED | 见“可靠性与重放” |
| 5.3 opId 作用域（工作室、计划）；14 天回执 > 7 天队列 | CONFIRMED | `src/studio/actions.ts:16,27`；`src/net/studio/store.ts:22`；`src/net/studio/queue.ts:150-156,271-286` |
| 5.4 客户离线与 daemon 离线分开提示；动作可排队 | CONFIRMED | `tests/team/studio-hub-queue.test.ts:115-179`；应用 `SyncBanner`/`ProjectCard` |
| 5.5 P1 无推送、无邮件报警，只有应用内待办点 | CONFIRMED | `tests/team/studio-app-todo.test.ts`；`packages/studio-app/components/ProjectCard.tsx:7-34` |
| 5.6 中台可读计划文字与对话，永远不存源码/diff/密钥 | CONFIRMED | 见“隐私走读”；客户条款见 `docs/studio-terms.md`（865802fd 补，§5.6 逐行覆盖；`docs/studio.md:10,112` 链接） |
| 5.7 同一 major 只做加法；中台 strict、客户端容错；旧 daemon 标“需要更新” | CONFIRMED | `src/studio/protocol.ts:12,90-93`；`src/net/studio/views.ts:98-107`；`tests/team/studio-hub-views.test.ts:256-317` |

### 设计 §10 测试

| 文件 | 存在 | 断言与 §10 相符 | 说明 |
|---|---|---|---|
| `tests/studio-sanitize.test.ts` | 是 | 是 | 92 个用例，含完整对抗样例与干净文本原样保留 |
| `tests/studio-view.test.ts` | 是 | 是 | 路径/分支/agent/模型/KEY/行内代码/`~~~`、strict 多字段报错、audience、无 `conv:`/qid/内部方法名、纯函数；`FORBIDDEN` 见 `:89-111` |
| `tests/studio-actions.test.ts` | 是 | 是 | 遍历 `PLANS_API` 的 `plans.*` 表（`:34-49`），`thenApprove`、`plan.create` 额外字段、大小写、opId 第二次、`requestStart` 不产生 `plans.approve`、stale、`draft.discard` 未开工被拒、`questions.answer` 独立 |
| `tests/studio-protocol.test.ts` | 是 | 是 | 好/坏用例与长度上限 |
| `tests/studio-link.test.ts` | 是 | 是 | 签名；hello→快照→synced（`:464-535`）；离线排队/上线后补发 |
| `tests/studio-chat.test.ts` | 是 | **部分相符** | autonomy 边界已补（`tests/studio-chat.test.ts:289-309`）；仍有若干工具策略断言缺口，见下 |
| `tests/studio-gates.test.ts` | 是 | 是 | autopilot 设不上、分享前降级、pilot 不自动通过、Gate 唯一 approve 的源码守卫（`:438-464`） |
| `tests/team/studio-hub*.test.ts` | 是 | 是 | 权限、跨项目读/发被拒、未邀请邮箱、7 天过期、第 8 天重放、多字段整帧拒绝 |
| 端到端 soak | 是（`tests/studio-soak.test.ts`） | 是 | 假 hub + 假 agent，从提需求到验收，中途断 daemon；含漏帧重放与泄漏扫描 |

`tests/studio-chat.test.ts` 的缺口（不阻塞 M7，但 §10 的清单没被完整兑现）：

- §10 说客户回合调用 `plan_message_task`、`plan_stop_task`、`plan_pause` 都被拒；测试只直接断言了 `plan_start_task`、`plan_gate`、`Bash`、`Write`（`tests/studio-chat.test.ts:202-211`、`tests/studio-gates.test.ts:411-414`）。其余三个靠“只挂三个工具”的 allowlist 间接保证，没有逐项断言。
- §10 说 `plan_get` 可用；测试只断言 `plan_write` 可用与 `tools.only` 含 `plan_get`（`:270`），没有直接断言 `plan_get` 的 `decideTool` 结果。
- §10 说 `isSecretPath` 命中的路径被拒；测试只断言了 `.env`（`:210`），没有 `server.pem` 之类。
- §10 说“autopilot 的已开工计划上，客户回合的 `plan_update` 也只改草稿、不上板”；测试创建了 autopilot 计划但只检查 `tools.only`（`:266-270`），没有断言不 approve。
- §10 说“客户回合里带 `autonomy` 字段的里程碑操作被拒”；**已修（865802fd）**：`src/core/plans/work.ts:660-674` 对 external actor 的 `plan_write`/`plan_update` 拒绝 `update_milestone.autonomy`、`add_milestone.milestone.autonomy` 和整份 body 的 `milestones[].autonomy`，回归测试 `tests/studio-chat.test.ts:289-309`（含“非 autonomy 的草稿改动仍可用”）。
- §10 说“判断是否在本项目目录内用 `realOf`，符号链接指向外面被拒”；`src/agent/policy.ts:215-216` 确实用了 `realOf`，但 `tests/policy.test.ts:177-190` 的符号链接用例不是客户回合，客户回合没有对应断言。
- §10 说“运营方没标『发给客户』的发言不进 turns”；P1 其实没有“标/不标”的开关，`studio.say` 是唯一会把运营方文字放进 turns 的路径（`src/studio/chat.ts:124-155`；`docs/parity.md:530` 也写明开关留到以后）。这句在 P1 里是空条件，且没有测试。

### P1 完成标准

| 步骤 | 判定 | 证据 |
|---|---|---|
| 客户在手机宽度 Web 上提需求 | CONFIRMED | `03-new-request.jpg`；脚本 390×844 |
| 看着计划长出来 | CONFIRMED | `04/05-plan-growing-*.jpg`；soak 的增量发布；`plan2.json` 的 rev 2 |
| 运营方在 Mac 上批准开工 | CONFIRMED | `07-mac-start-card.jpg`；Mac 铃铛卡片走 `studio.answerGate`（`packages/mac/src/studio/StartGateCard.tsx`、`NotificationCenter.tsx:338`），服务端转到 `StudioGates.answer`（`src/studio/service.ts:312-315`） |
| 跑到第一个里程碑，客户验收 | CONFIRMED | `08/09/10`；`plans-latest.json` 中同一计划 `stage:"done"`、`progress 1/1` |
| “真实全流程”里的真邮件/真邮箱登录 | **未完成** | `MAIL_MODE=outbox`；`01-login-email.jpg` 是管理页 outbox；运行报告自述见 `docs/reports/studio-p1-run.md:9,76-80` |

## 隐私走读

结论：**CONFIRMED**。中台和客户端拿不到源码、diff、密钥、路径、分支、模型名或任务 KEY；能从 daemon 出去的字段是白名单，每个自由文本都过净化器，中台再 strict 校验一次。

- 白名单构造，不是黑名单删字段：`src/studio/view.ts:172-210` 逐字段构造 `out`，最后 `return StudioPlanView.parse(out)`；协议里每个对象 `.strict()`（`src/studio/protocol.ts:33-67,90-93`）。多一个字段就整帧失败，daemon 侧也不会发（`src/studio/publish.ts:432-435`）。
- 固定措辞的活动流，不带事件原文：`src/studio/view.ts:58-66`（`APPROVED/CHANGED/...` 全部是固定中文），`:205` 只按 kind 取文字。
- 净化器：`src/studio/sanitize.ts:2-12` 写明“路径、文件名、分支、worktree id、agent/模型名、任务 KEY、行内代码和代码块、密钥”都要拿掉；流水线在 `:268-293`：折叠同形字 → 丢代码围栏（`:150-170`）与行内代码（`:273-275`）→ 丢裸代码（`:175-192`）→ 反复跑替换直到稳定（`:280-288`）→ 大段技术内容整体变占位符（`:289-291`）→ 截断（`:292`）。
- 决策只给客户的：`src/studio/decisions.ts:19-32,54-71`；`SENSITIVE` 还会把带账号/密钥/付款/域名等词的“客户决策”降回运营方。
- 中台 strict 复核：`src/net/studio/views.ts:98-107`（`ingestPlan` 的 `StudioPlanView.safeParse(raw.view)`，失败整帧拒绝并告警），`ingestPatch` 的合并后再 strict（`:136-153`）。
- 中台的 planRef 是 HMAC，不是本地 id：`src/studio/keys.ts:178-179`（`HMAC-SHA256(refKey, "plan\0" + id)`），所以本地路径/项目 id 不会出去。
- 预览链接在 P1 永远拒绝：`src/net/studio/views.ts:214-217`（只有 `deliver` Gate 已批准才签，P1 没有该 kind）；路由也是 403（`tests/team/studio-hub-views.test.ts:319-344`）。
- soak 的泄漏扫描：`tests/studio-soak.test.ts:536-543` 把客户 socket 收到的每一帧、GET 回答、hub 缓存的 view/turn 拼成文本，断言不含 `/private/tmp/.../secret.ts`、`beluga/blg-77-soak`、`claude-sonnet-5-5`、`BLG-77`、`` `npm run build` ``、`ws:home-soak`、`SOAK-SECRET-9f3a`；每帧还被 `StudioPlanView.strict()` 再解析一遍。
- 唯一例外是客户自己打的字：动作队列保存 `chat.send` 原文 7 天（`tests/studio-soak.test.ts:546-553` 故意断言 `/Users/bob/shop/.env` 仍在 `frameJson` 里）。这是 §5.6 表格里写明的“动作队列（含客户消息原文）/ 7 天”，属于客户自己的输入，不是 daemon 漏出的源码或运营方密钥。
- 需要如实说明的边界：净化器是启发式（设计也这么说，`docs/studio.md:51-52` 与 §3.5），真正的边界是白名单字段 + 客户回合的受限工具集（`src/agent/policy.ts:194,211-218`）；不要把“净化器全拦”当成形式化保证。

## 可靠性与重放

结论：**CONFIRMED**。

- **opId 幂等（14 天 > 7 天队列）**：`OPID_KEEP_MS = 14 * 24 * 60 * 60 * 1000`（`src/studio/actions.ts:16`）；键是（工作室、项目、计划、opId 小写）（`:27`）；`OpLog.record` 只留第一次（`:231-233`），`prune` 永不早于 14 天（`:236-238`）。daemon 侧先查回执、再查“执行中”标记（`src/studio/inbox.ts:258-268`），执行前落盘 pending（`:320-323`），`finish` 落盘回执并回送（`:383-387`）。中台侧先查已有 op 再限流（`src/net/studio/queue.ts:150-156`），`prune` 用同一 14 天（`:283-286`）。测试：`tests/studio-actions.test.ts:215-235`（第 8 天仍答、第 14 天后清）、`tests/team/studio-hub-queue.test.ts:72-103`。
- **7 天队列**：`QUEUE_TTL_MS = 7 * 86_400_000`（`src/net/studio/store.ts:22`）；`expire` 把排队/已取走的超期行标 `expired` 并通知客户（`src/net/studio/queue.ts:271-281`），在入队与取件前都会先过期（`:151,215`）。测试 `tests/team/studio-hub-queue.test.ts:151-163,256-272`。
- **重连顺序**：daemon 收到 `welcome` 后 `pushSnapshot`（`src/studio/link.ts:464-477`），逐帧写完后才发 `synced`（`:510-530`），`deliver` 只在 `online` 阶段接受（`:494-506`）。中台只接受 `hello` 之后的其他帧（`src/net/studio/handler.ts:699-700`），`synced` 才 `delivery`（`:733-735`），`take()` 还要求连接 `synced`（`src/net/studio/queue.ts:211-213`）。daemon 断开时中台把已取走的行放回（`src/net/studio/handler.ts:746`），配合 op 回执做到“回执丢了也不重跑”。测试 `tests/studio-link.test.ts:464-535`、`tests/team/studio-hub.test.ts:238-260`、soak 的“回执丢失”用例（`tests/studio-soak.test.ts:561-603`）。
- **draftRev 失效**：动作侧对 `plan.requestStart`、`draft.apply`、`draft.discard`、`milestone.pass`、`milestone.sendBack` 都以当前 `plan.draftRev` 比对，不一致回 `stale`（`src/studio/actions.ts:127,134-155`）；Gate 在**回答时**再比一次 `plan.draftRev !== gate.draftRev`，不一致就拒并告诉客户刷新（`src/studio/gates.ts:183-190`）；状态变化时 `reconcile` 也会把过时 Gate 降为 declined（`:283-288`）。测试 `tests/studio-actions.test.ts:127-135`、`tests/studio-gates.test.ts:212-233`、`tests/team/studio-hub-queue.test.ts:136-148`。
- 小观察（不是缺陷）：daemon 的 `OpLog.prune()` 只在加载文件时调用（`src/studio/inbox.ts:211,216-220`），长期不重启的 daemon 会保留超过 14 天的回执；这满足“不短于 14 天”，只是内存会慢慢长。可留给 P2 做定期 prune。

## 批准路径

结论：**CONFIRMED**。

- `plans.approve` 在 `src/studio/` 里只有一处**调用**：`src/studio/gates.ts:202` 的 `this.approve(gate.planId)`，且只在 Gate 仍 pending、`plan.draftRev === gate.draftRev`、`plan.body` 为空（首次开工）时到达（`:183-212`）。
- 注入点只有一条：`src/studio/service.ts:341-355` 把 `this.approve` 交给 `StudioGates`；唯一的接线在 `src/studio/service.ts:466-475`（`approve: (id) => needPlans(d.session).approve(id)`）。
- 客户永远碰不到它：`callRefusal('plans.approve', …)` 一律返回“只从 start Gate 运行”（`src/studio/actions.ts:206-207`）；`callRefusal('host.answerApproval', …)` 一律拒绝（`:208-209`）。客户动作的 9 种 kind 里没有这两个（`src/studio/protocol.ts:115-130`）。
- 源码守卫测试会扫整个 `src/studio`：除 `gates.ts`、`service.ts`、`actions.ts`（只用于拒绝）外，任何 `plans.approve`/`.approve(` 都算失败，且 `gates.ts` 只能有一处（`tests/studio-gates.test.ts:438-464`）。
- `host.answerApproval` 仍是运营方自己手机/伴侣客户端的能力（`src/companion/client-scope.ts:11`、`src/companion/needs-you.ts:66-69`），它不是 Studio 客户动作；这条区分是对的。
- 外部 agent 的 `plans_approve` 工具存在（`src/external/adapters/tools/gated.ts:113`），但每次都要人批，且共享计划另有拒绝用例（`tests/studio-gates.test.ts:306-324`），不构成绕过。

## 测试清单核对

设计 §10 点名的文件**全部存在**；断言基本相符。客户回合的 `autonomy` 边界已在 865802fd 补上实现与回归测试（`tests/studio-chat.test.ts:289-309`）；其余缺口仍是 `tests/studio-chat.test.ts` 的少数工具策略断言（逐条列在“逐条对照 / §10”），不阻塞 M7。没有“文件缺失”的问题；soak 也真实存在并在初审与复核中通过（3 个用例）。

补充：`tests/parity.test.ts:47-48` 确有 `lists every Studio customer action`，用 `ACTION_KINDS` 对照 `docs/parity.md`；`tests/boundaries.test.ts`（5 个）与 `tests/browser-safe.test.ts`（3 个）在本次独立运行与全量日志中均通过。

## 文档与客户条款

- 中台能读什么、读不到什么，在两处写清楚了：
  - `docs/studio.md:53`：“**中台能读到计划文字和对话**（客户同意条款里要写明这一点），读不到代码、diff、密钥。”
  - 设计 §5.6 表格：`docs/superpowers/specs/2026-11-10-beluga-studio-design.md:463`“源代码、diff、密钥 | **永远不存**，daemon 不发”；`:466`“运营方（你和你授权的人）能读对话，条款里要写明。”
  - `docs/how-it-works.md:21` 也写了“it can read plan text and the conversation, never code, diffs or keys”。
- `docs/parity.md:743-763` 列出了 9 个客户动作及其对应内部调用；`:524-530` 列出了 7 个 `studio.*` 方法（link/unlink/status/setProject/reconnect/answerGate/say），与 `src/companion/coverage.ts:326-335` 一致。
- `docs/companion.md:360-370` 有 `studio-start` 卡片一节，并链接到 `[docs/studio.md](studio.md)`；`docs/how-it-works.md:21` 也指向同一页。
- 设计文档状态（`:3-6`）：`状态：**P1 已落地（M1–M7）**`，并链接运行报告与审计报告。
- **已补（865802fd）**：§5.6 要求这张表“必须写进客户条款，P1 给第一个真实客户用之前定稿”（设计 `:593-594`）。新增的 `docs/studio-terms.md`（54 行）逐行覆盖 §5.6 的 7 类数据/保留期/读者、子处理方（Cloudflare，跨境）、运营方可读对话、删除账号、P2 预览带前端代码；`docs/studio.md:10` 顶部与 `:112` 邀请步骤都链接了它。第一个真实客户开通时按手册附上即可。

## 运行报告真实性

结论：**报告本身属实；运营手册 §11 的矛盾已在 865802fd 消除。**

- 报告明确承认没做真邮件：`docs/reports/studio-p1-run.md:8-11`（“一处没有按设计做到：**邮件不是真发的**。`packages/studio-hub/.dev.vars` 不存在……`MAIL_MODE=outbox`……`01-login-email` 截的就是它（令牌已遮住）……没有用种好的草稿或 outbox 冒充真邮件”），`:33`（“管理页 outbox 里拿到魔法链接（**非真邮件**）”），`:76-80`（“真发信 / 真邮箱登录（步骤 1）没有做……**这不是真实邮件证据**”）。
- 截图存在且与报告一致：10 张全部在 `docs/img/studio-p1/`。我逐张看了 01、04、05、07、09、10：
  - `01-login-email.jpg` 确实是管理页的“待转发的登录链接 / outbox”，令牌显示为“令牌已遮住”；
  - `04` 是“计划在写”的里程碑视图（0/1、待开始），`05` 是展开后的任务 + 5 条验收标准；
  - `07` 是 Mac 通知里的“Approve start of「训练营报名落地页」?”（Approve/Decline）；
  - `09` 是“等你验收”卡（还有「还不行…」与「通过」），`10` 是“计划完成了 1/1”。
- 04/05 的二次提交说明写清楚了：`:44-46`“`04`/`05` 是在**同一条需求又提交了一次**之后补拍的（第一次的草稿期截图漏拍），所以两张图的计划实例与 `06`–`10` 不同……没有拿验收后的终态冒充草稿期。”这与现场证据吻合：`.beluga/scratch/m7/` 里 04/05 的原始 PNG 时间是 11:58，其余是 11:41–11:56；`plan2.json`（drafting，rev 2）与 `plans-latest.json` 里另一条 `done` 计划并存，确实是两个实例。
- **已消除（865802fd）**：`docs/studio.md:237` 现在写“真中台 —— `MAIL_MODE=outbox`，真 Resend 邮件待补 —— + 真 AI 规划 + 真 daemon + Mac 前端”，`:242` 写“管理页 outbox 里的魔法链接（令牌已遮住；真邮箱收信待补）”；全仓库不再有“真邮箱收到的魔法链接”。运行报告未改，仍与 01 截图一致。
- 关于 M7 的判定：P1 完成标准的四步本身满足，因此 **M7 可以记为“通过（有缺口）”**；但“真实全流程”在邮件这一步仍不是真的，P1 在 #1 完成之前不能称为“客户可用”；#2–#4 已修，缺口只剩邮件验证。影响仍是**验证与信任**，不是主链路代码。

## 必须修

复核后：**#2–#4 已修（865802fd），#1 等待业主**。按严重度排序。

| # | 严重度 | 状态 | 位置 | 问题 | 最小修法 |
|---|---|---|---|---|---|
| 1 | 高（验证缺口） | **等待业主** | `docs/reports/studio-p1-run.md:9,76-80`；`packages/studio-hub/.dev.vars` 不存在 | 真 Resend 发信与真邮箱登录没有做，`01` 是 outbox 截图；这是 P1 唯一没走真的一步 | 业主放入 `.dev.vars`（`OPERATOR_TOKEN`、`MAIL_MODE=resend`、`RESEND_API_KEY`、`MAIL_FROM`、`HUB_ORIGIN=http://localhost:8790`），重跑步骤 1，用真邮箱里那封信替换 `01-login-email.jpg`（用掉链接后截、遮令牌），并把报告 §5 改成已完成 |
| 2 | 中（文档失实） | **已修（865802fd）** | `docs/studio.md:237,242` | 原先把没做的步骤写成做了（“真 Resend 邮件”“真邮箱收到的魔法链接”）；现已改成“真中台 —— `MAIL_MODE=outbox`，真 Resend 邮件待补”与“管理页 outbox 里的魔法链接（令牌已遮住；真邮箱收信待补）”，与运行报告和 01 截图一致 | 已按最小修法改；等 #1 完成后再把“待补”改为已完成 |
| 3 | 中（边界） | **已修（865802fd）** | `src/core/plans/work.ts:660-674,697-710`；测试 `tests/studio-chat.test.ts:289-309`（用例名 `a customer turn cannot set how a milestone runs (autonomy)`） | §10 要求客户回合（及外部 agent）拒绝带 `autonomy` 的里程碑操作；现在 `refuseAutonomy`/`refuseBodyAutonomy` 在 external actor 的 `write`/`update` 里拒绝 `update_milestone.autonomy`、`add_milestone.milestone.autonomy` 与整份 body 的 `milestones[].autonomy`，回归测试同时断言非 autonomy 的草稿改动仍返回 `Saved the draft` | 已完成；我在 865802fd 上复跑该文件与 31 个相关文件（562 个用例）全过 |
| 4 | 中（合规前置） | **已修（865802fd）** | `docs/studio-terms.md`（54 行）；`docs/studio.md:10,112` | §5.6 要求给第一个真实客户前定稿客户条款；原先没有客户可见文档 | 已新增客户条款，逐行覆盖 §5.6 的 7 类数据/保留期/读者、子处理方与跨境、运营方可读对话、删除账号、P2 预览带前端代码；手册顶部与邀请步骤已链接。第一个真实客户开通时附上即可 |

## 留给 P2/P3

- **原生 App 与推送**（P2）：iOS/Android 构建、推送与“通知时机表”、客户设置屏的删除账号入口（iOS 5.1.1(v)）。
- **交付 Gate 与预览**（P2）：`previewLink` 目前永远拒绝是正确的 P1 行为；P2 接上 `deliver` 后必须把“预览产物带前端代码”写进条款。
- **付费与权益**（P3）：Stripe、档位、超权益 Gate 提示。
- **`send to customer` 开关**：`studio.say` 目前是运营方唯一的发言通道，`docs/parity.md:530` 已注明开关以后再加；加上“标/不标”后，§10 的那句断言才有意义。
- **补齐 §10 的客户回合工具测试**：`plan_message_task`/`plan_stop_task`/`plan_pause`、`plan_get` 允许、`isSecretPath` 命中、autopilot 计划上 `plan_update` 不上板、客户回合的 `realOf` 符号链接；autonomy 一条已在 865802fd 补上，其余不阻塞 M7，但应补上，避免以后 policy 改动时无声回归。
- **运维**：daemon 的 `OpLog` 可加定期 prune；运行报告 §7 提醒的 Resend key 轮换要执行；中台的监控/告警（设计 §11）仍待做。
- **多 daemon 总览、登录信模板、批量邀请**（docs/studio.md §12 已列）。
