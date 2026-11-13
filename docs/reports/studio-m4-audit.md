# Studio M4 安全审计：开工 Gate、动作重放与客户回合

日期：2026-11-11。分支 `beluga/blg-72-m4-gate`（从 `plan/synon-studio-p1-web` 开）。审计对象：M4 的
`src/studio/{actions,inbox,gates,chat,decisions,draft,view,service}.ts`、`src/agent/policy.ts` 的
`customerTurn`、`src/core/plans/{work,customer-turns,progress,plans}.ts` 的相关路径、`src/ipc/studio-*.ts`、
三份 `coverage.ts`，以及 `tests/studio-*.test.ts`。设计见 `docs/studio-gates.md` 与
`docs/superpowers/specs/2026-11-10-beluga-studio-design.md` §3、§5.2–5.4、§8。

做法：

1. 沿设计 §3 的四个边界逐条读实现：**谁能开工**（`plans.approve` 的每个调用点）、**一条动作会不会做两次**
   （opId、重连、重启）、**客户文字能不能越权**（工具集与策略）、**哪些决策到客户**（audience 与兜底）。
2. 每个可疑路径写成可执行的反例（`tests/studio-*` 里的对应用例），再看它是否被挡住；另用只读扫描确认
   `src/studio/` 里没有第二条 `plans.approve` 的路。
3. 另一个只读复核代理用**不同模型（Fable）**独立读同一组文件、构造攻击，见 §4；它的发现逐条核实、修复并写进
   §1，和本代理自己的发现不分先后。
4. 全量测试与三个 typecheck（根、`packages/mac`、`packages/companion`）在修复后各跑一次；全量测试暴露的
   M3 遗留（与本里程碑的安全边界无关）也一并修掉，见 §1.2。

## 0. 结论

- **客户无法调用 `plans.approve`**：客户动作只有 9 种 `StudioAction`，`checkAction` 只把它们变成白名单里的
  调用或一张 Gate；`InboxExec` 结构上没有 `approve`；`src/studio/` 里唯一的 `this.approve(...)` 在
  `gates.ts`，注入点在 `service.ts` 的一行（测试用源码扫描钉住）。外部 agent 在共享计划上也不能批准或
  “先复核再批准”（`PlansWork.approve/verify` 的守卫）。
- **Gate 批准绑定客户确认的 `draftRev`**，在同一个同步段里比对并调用一次；草稿移动后拒绝（`stale`），
  已处理的 Gate 再批回 `settled`，计划没了回 `gone`。重命名也移动 `draftRev`。
- **同一条动作用一个 opId 至多做一次**：回执与 pending 标记落在 `~/.beluga/studio-inbox.json`，重启后仍在；
  第 13 天重放答第一次的结果，第 15 天才被 prune（中台队列只留 7 天）。Gate 分支同样先写 pending。
- **客户文字进不了权限系统**：客户回合只有 `plan_get/plan_write/plan_update` 与项目内的 `Read/Grep/Glob`；
  其余（Bash、写文件、其他计划工具、`ask`/`secret`）一律 `deny`。**客户消息、客户“还不行”的原因、客户对
  决策的回答**这三条入口都会在提交前 `customerTurns.begin`（本轮修掉的 F1）；回复过净化器才成为 turns。
- **决策只有 `audience === 'customer'` 且不命中敏感词的到客户**；视图和回答路径共用同一份过滤与编号；英文的
  account/domain/key 也命中（F4）。
- 本轮复核**发现 1 条高危、3 条中、6 条低**：1 条高（F1，客户文字经 sendBack/decision.answer 进入完整权限
  回合）、3 条中（F2 Gate id 撞车、F3 原生批准路径、F4 英文敏感词缺失）、6 条低；**9 条已修**，F3 的手机/
  Mac 原生批准按设计 §3.3 保留并记录（§3），外部 agent 的部分已封。全量测试另外暴露并修掉 3 条 M3 遗留
  （§1.2）。

## 1. 发现与修复

### 1.1 安全发现

| # | 严重度 | 类别 | 一句话 | 状态 |
|---|---|---|---|---|
| F1 | **高** | 工具边界绕过 | `milestone.sendBack` 与客户对决策的自由回答把不可信文字交给 `plan.home` 的 head Claude，但两处 `askClaude` 都没有 `customerTurns.begin`：这一轮拿到完整计划工具集（`plan_start_task` 能起工作树、`plan_pause`、`plan_message_task`、`plan_gate`）与完整文件权限，客户可借文字让 agent 开工或读项目外文件 | **已修**：`PlansWork.sendBack(..., {customerTurn:true})`（inbox 的唯一调用点传 true）与 `plansExec.answer` 在 `questions.answer` 前 `begin`；run 结束由 chat 的监听收尾，没起跑则 `askClaude` 返回空时当场 `end`，决策回答这种“可能不起 run”的入口另有 30 秒宽限（`customer-turns.ts`）。边界对**所有运行时**成立：Claude、Codex、Copilot、OpenCode 的 runner 都把 `customerTurn` 放进 policy（BLG-110）。测试：`studio-chat` 的 sendBack/decision answer，`studio-gates` 的 gateTool 与四个 runner 的源码检查 |
| F2 | 中 | 同意的对象错位 | Gate id 只是 `g-<opId 前 8 位>`；opId 的作用域含计划，所以同一个 opId 用在两个计划上是合法的，两张卡会撞 id，`answer` 只找第一条：点 B 的卡却启动 A（可在不同项目） | **已修**：`gates.request` 循环到全局唯一（`g-…`、`g-…-1`）；测试 `gives two plans’ Gates different ids…` |
| F3 | 中（部分按设计） | Gate 完整性 | `plans.approve` / `plans.verify {thenApprove}` 仍可从 Gate 之外调用：外部 agent 的 `gated` 卡、手机/Mac 的原生批准。外部 agent 的 `plans.update` 无卡片，可把草稿改到 N+1 后请主人批一张不含客户 rev 的卡；“先复核再批准”在复核后自动开工，中间不再比对客户的 rev | **外部 agent 部分已修**：`PlansWork.approve` 在 `actingVia()` 且计划属于共享项目时抛错；`verify(id, thenApprove)` 对共享计划一律拒绝 `thenApprove`（复核本身仍可）；已开工且无草稿的计划上 `PlansWork.edit`（direct 路径）在写草稿**之前**就拒（BLG-113，不再留下半成功状态）。手机/Mac/`machines` 的原生批准是运营方自己的答案，设计 §3.3 接受并回收 Gate，见 §3。测试：`studio-gates` 的 external approve/verify/edit |
| F4 | 中 | 敏感词缺口 | `SENSITIVE` 的英文只有 api key/password/payment 等，没有 account/domain/console/key：英文问“Which App Store Connect account…”“Which domain…” 的分给客户决策会进客户视图且可答 | **已修**：补 `account`、`domain`、`console`、`payout`、`invoice`、`app store connect`、`\bkeys?\b`；测试 `the sensitive fallback knows English accounts…` |
| F5 | 低 | 共享配置/跨工作室 | 取消共享后 pending Gate 仍在卡片上且仍可批准；key 文件损坏时 `start()` 只删文件、不调 `inbox.unlink()`，换绑新工作室后旧 pending Gate 会被恢复；Gate/对话记录本身不带 studio id | **已修**：`gates.needs/answer/request` 按当前 `config.projects` 与 `gate.studio` 检查；Gate 记录加 `studio`，`restore` 丢掉别的工作室的；`chat.dump/restore` 带 studio，`unlink` 清空 pending/sent/said（换工作室不带走上一家客户的对话）。测试：`drops the cards of a project that is no longer shared`、`never shows or answers a Gate left by another studio`、`unlink drops the conversation…” |
| F6 | 低 | 至多一次 | Gate 请求分支先 `gates.request` 后写回执，没有 pending 标记：进程在两者之间崩溃、且卡已被批/驳时，重投会再抬一张 | **已修**：gate 分支同样先 `pending.set` + `persist`；测试 `answers already-done for a start request a restart interrupted…` |
| F7 | 低 | 状态校验 | `draft.apply` 不要求草稿存在：已开工但无草稿的计划也能挂一张 changes 卡，批准时 `applyDraft` 抛错，卡永远 pending | **已修**：`gates.request` 对 changes 要求 `plan.draft`，否则 `not-open`（`actions.ts` 的客户回执即 not-open）；测试 `refuses an “apply the changes” Gate when there is no draft` |
| F8 | 低 | 验收提前 | 客户可以在里程碑的自动检查还没跑时 `milestone.pass`（`awaitingReview` 只用 `state === 'gate'`，与运营方 UI 的 `yoursToPass` 不同） | **已修**：把 `yoursToPass` 提成 `progress.passable`，`nextStep` 与 inbox 的 `PlanFacts` 共用；测试 `a milestone is passable…` |
| F9 | 低 | draftRev 缺口 | `plans.retitle` 改草稿标题但不 bump `draftRev`：客户确认 rev N 后，外部 agent（`plans.edit` 是 `covered`）可改名而 Gate 仍批 | **已修**：有草稿时 retitle 也 bump `draftRev`（无草稿的正文改名不涉及 Gate）；测试 `a rename moves the draft revision…` |
| F10 | 低 | 决策错位 | 决策过滤不看任务是否 `assignee:'me'`：手写/旧数据里 agent 任务上的 customer 决策会显示、客户回答后 qid 不存在，`questions.answer` 静默丢弃而回执 `done` | **已修**：`decisions.eligible` 要求 `assignee === 'me'`；测试 `a decision on an agent task is never the customer’s` |

### 1.2 全量测试暴露的遗留（与 Gate 安全无关，但阻塞“全量通过”）

| # | 严重度 | 类别 | 一句话 | 状态 |
|---|---|---|---|---|
| T1 | 中（环境） | 测试确定性 | 这台 Mac 的 git 说中文，`tests/main-sync.test.ts` 与 `tests/plan-branch.test.ts` 解析 git 的英文报错而失败（单独跑也失败） | 已修：`tests/setup.ts` 固定 `LC_ALL=C` / `LANG=C`（测试进程，不影响产品） |
| T2 | 低 | 设置索引残留 | `dialogs/settings-index.ts` 的 Advanced 还索引 “Connect to Studio / Synon Studio”，BLG-70 已把它们移到独立对话框，`mac-settings-search` 因此失败 | 已修：删掉那一条索引 |
| T3 | 低 | 后台时钟 | `studio/ConnectDialog.tsx` 用 `setInterval` 每 2 秒问状态，`polish-leftovers` 要求新时钟用 `useClock`（窗口不在前台时停） | 已修：改用 `useClock(true, 2000)`，对话框只在打开时挂载 |

## 2. 逐条攻击与证据

| 攻击 | 结果 | 挡住它的地方 |
|---|---|---|
| 客户动作里写 `kind: 'plans.approve'` / 内部方法名 | `not-allowed` 回执 | `StudioAction` 只认 9 种 kind；`checkAction` 的 `known` 判断；`callRefusal('plans.approve')` 恒拒（`actions.ts`） |
| 客户发 `plan.verify` 带 `thenApprove`（true 或 false） | `not-allowed` | `callRefusal('plans.verify', args)` 拒绝任何第二参数键；收件箱的 `exec.verify` 永远传 `false` |
| 客户借 `milestone.sendBack` 的原因 / 决策自由回答拿到完整工具集（F1） | 受限：那一轮只有 `plan_get/plan_write/plan_update` + 项目内读；Bash/写/其他计划工具 deny | `customerTurns.begin` 在 sendBack 与 decision answer 前；`forRun` 的 customer 分支；`policy.decideCustomerTurn` |
| 客户反复请求开工 | 同一 `draftRev` 只沿用一张 pending Gate；`draftRev` 变了旧的作废、新的待批；批准过的再批 `settled` | `gates.request` 的 pending 复用与 `answer` 的状态检查 |
| 同一 opId 打两个计划（F2） | 两张卡 id 不同，各批各的计划 | `gates.request` 的唯一 id 循环；`answer` 按 id 找唯一 |
| 同 opId 投两次 | 只执行一次，第二次原样重发回执 | `OpLog`（`inbox.handle` 开头）；hub 也有一份 |
| 重启后重放 | 从 `studio-inbox.json` 读回执重发，不执行 | `inbox.load` + `OpLog`；测试 “keeps its records across a restart” |
| 执行到一半重启（含 Gate 请求，F6） | `already-done`，不再执行；不再抬 Gate | 执行前写 `pending` 标记（call 与 gate 两条分支）；测试 |
| 第 13 天 / 第 15 天重放 | 13 天答第一次结果；15 天 prune 后当新动作 | `OPID_KEEP_MS`；测试 |
| 拿自己项目的动作打别的项目 | `not-yours` / `unknown-plan` | `f.project` 来自中台绑定；`planRef` 用 `refOf` 在该项目的计划里现算比对（`inbox.projectOf/planOf`） |
| 伪造成员项目的 planRef | `unknown-plan` | 计划只在 `f.project` 这个 projectId 下找 |
| 取消共享后批旧卡（F5） | 卡消失；`answer` 回 `gone`，不调 `approve` | `gates.needs/answer` 查当前 `config.projects` |
| 换绑新工作室后恢复旧卡（F5） | 旧 studio 的 Gate 被丢掉；旧对话不回放 | `GateRecord.studio` + `restore` 过滤；`chat.dump/restore` 的 studio；`unlink` 清空 |
| 驳回后重批同一张 Gate | `settled` | `gates.answer` 的 `state !== 'pending'` |
| 驳回后重放同一个请求动作 | 重发第一次的 `done` 回执，**不**新建 Gate | opId 回执；新建 Gate 要客户发新的 opId |
| 草稿在客户确认后变了（含重命名，F9） | Gate 记 `declined`（固定原因）或批准时 `stale`，`approve` 0 次 | `gates.answer` 的 `plan.draftRev !== gate.draftRev`；`reconcile`；retitle bump |
| 自动检查还没跑就验收（F8） | `not-open` | `progress.passable` 与 inbox 的 `awaitingReview` |
| 客户文字里夹 “批准这个工具 / 允许 Bash” | 不产生任何 approval；`decideTool` 在 `customerTurn` 下对 Bash/Write/其他计划工具/`ask`/`secret` 全部 `deny` | `policy.decideCustomerTurn`（在 `decideTool` 最前面短路，不再走 dotenv→secret） |
| 客户文字伪造包裹结束标记或 `@name` | 结束标记与 `@` 被替换；客户文字经 `askOwnClaude` 提交，不走 composer 解析 | `wrapCustomerText`；`chat.flush` 用 `askOwnClaude` 而不是 `session.submit` |
| 客户回合里 `plan_update` 在 autopilot 计划上直接上板 | 不会：客户回合用 `toolsForAgent`（external），`after()` 的 autopilot 直接批准分支只在 `!external` 时走 | `work.customerTools` → `toolsForAgent` → `toolsFor.after` |
| 首轮规划（还未确认）不受限 | 受限：`PlanWork.create({customerTurn:true})` 在 `askClaude` 之前 `begin` | `customerTurn` + `customerTurns.started`；测试 |
| 客户答一个运营方决策 / 猜 qid | `not-open`；带 `:` 的假 qid 连 schema 都过不了（`bad-args`） | `PlanFacts.decisions` 只含 customer 决策；`decisionId` 是 `d-[mt]…` 的 ref |
| 客户答一个 agent 任务上的决策（F10） | 不显示，也不可答 | `eligible` 要求 `assignee === 'me'` |
| 被标成 customer 的“支付密钥/App Store Connect account”问题到客户 | 不到：`SENSITIVE` 命中即当 operator，并在 `plan.home` 警告一次 | `decisions.operatorOnly` + `StudioDecisions.decisions` |
| 外部 agent 读取/改写共享计划的草稿后请主人批（F3） | 外部 agent 的 `plans.approve` 现在抛错；`thenApprove` 对共享计划被拒；`plans.update` 仍可改草稿（会移动 rev，客户需重新确认） | `PlansWork.approve/verify` + `actingVia()` |
| 外部 agent 回答 Gate / 替客户说话 | 拒绝 | `external/coverage.ts`：`studio.answerGate`、`studio.say` 均 `{refused}`；`machines` 均 `refuse` |
| 手机批准 Gate | 允许（`phone`）：手机是运营方自己的设备，答案与 Mac 相同并绑定 `draftRev` | `companion/coverage.ts` |

## 3. 残余风险与已知边界

1. **运营方原生 `plans.approve` 的入口**（F3 的手机/Mac/`machines` 部分）：Mac 计划页、手机计划页、
   `machines` 的 `drive`。它们都是运营方自己的答案，设计 §3.3 选择“回收 Gate 为 approved”而不是阻止。客户侧
   的动作路径到不了这里（§2 第一行），所以不是客户绕过；但它意味着**客户确认的与最终上板的可能是不同的
   `draftRev`**。M6 应让这些入口在共享计划上也显示/校验客户的 `draftRev`。
2. **客户回合的 `plan_get`**：计划原文进 agent 上下文（含运营方自己的任务标题与 `plan.decisions`）；回复净化器
   去路径/模型/代码，但不会去掉这些标题。运营方的对策与设计 §3.3 一致：不要把不想给客户看的内容放进计划。
   M6 可让客户回合的 `plan_get` 返回客户视图过滤后的计划。
3. **opId 的作用域不含客户身份**：同一项目里的两个客户共用一个（工作室、项目、计划）命名空间。要重放别人的
   opId 需要猜到 128 位 UUID；P1 每个项目通常一个客户，P3 多成员时再评估是否把 customer id 加进 key。
4. **daemon 的聊天限流是内存计数**，重启后归零；中台的限流（20 条/分、300 条/天、50 000 字/天，按项目/计划）
   仍在。这是设计的两层限流，不是绕过。`plan.verify` 没有 daemon 自己的频率限制（中台有），客户可反复触发
   评审 agent（成本型 DoS，中台限流兜底）。
5. **`plan.create` 没有 daemon 自己的限流**：中台按项目限（上面那组数），daemon 只校验与执行。中台是工作室
   自己的服务，若它被攻破，daemon 仍会为每条 create 起一轮规划。属于“中台可信”的既有假设（设计 §2）。
6. **`deliver.by` 是展示字段**：卡片上的“来自谁”取自中台给的 `by`（目前中台还没带，退回项目名）。没有任何
   授权判断依赖它；中台将来加它时必须保证它不可伪造。
7. **中台在 7 天队列内重投旧动作**：daemon 的回执去重覆盖 14 天；队列过期后中台不再投。超出 14 天的重投
   不在协议内。
8. **客户自己的消息也被净化**：`view.ts` 对所有 turn（含 customer）跑 `sanitizeText`，与 §5.1“客户看到自己写的
   原话”略有出入（功能/文案问题，非安全），P1 接受。
9. **`Glob`/`Grep` 的 pattern 可含 `..`**：客户回合只解析 `path` 参数，文件名可能被枚举到项目外（内容仍需
   `Read` 的路径检查，只泄露文件名）。这是 `decideToolPlain` 的既有形态，M6 可对客户回合额外拒绝含 `..` 的
   pattern/glob。

## 4. 独立复核（不同模型）

只读代理（`general-purpose`，模型 **Fable**，不共享实施上下文）独立读了同一组文件，按“让 approve 在 Gate 之前
发生、重放/伪造、客户文字越权、决策越界”四组目标构造，基线跑了 9 个 studio 测试文件（221 项全绿）。它报告 1 条
高危（F1）、3 条中（F2/F3/F4）、6 条低（F5–F10），并复现了其中两条：

- F2：用真实 `StudioGates` 让同一 opId 打两个计划，得到两张同 id 卡，回答第二张却批准了第一个
  （`.beluga/scratch/agents/*/collision.test.ts`）。
- F4：用真实 `SENSITIVE` 验证英文 “App Store Connect account” / “domain” 不被命中
  （`.../sensitive-probe.test.ts`）。

这些发现均已逐条核实：9 条已修（F1、F2、F4、F5–F10），F3 的外部 agent 部分已封，手机/Mac 的原生批准按设计
§3.3 保留并写进 §3。它同时确认了 §2 的多数“已挡住”项（客户拿不到 approve、thenApprove 路径、跨项目 planRef、
opId 重放、包裹标记、autopilot 降级、视图白名单），与实施代理结论一致。

另外，BLG-111 在本地中台上真跑链路时又抓到 4 个静态审计没看到的实现问题（Gate 插件缺 `view`、`studio.shared`
被异步项目列表冲空、铃铛的 `sameDeep` 深度导致白屏、daemon 关机时 `plans_off` 把 pending Gate 作废），
均已修复并有回归测试，详见 `docs/reports/studio-m4-run.md` §4。它们不改变 §0 的结论：没有客户可用的绕过，
F1 的边界在修复后覆盖了全部四条客户文字入口与四个运行时。

## 5. 复现与验证

```
npx vitest run tests/studio-actions-run.test.ts tests/studio-gates.test.ts \
  tests/studio-chat.test.ts tests/studio-decisions.test.ts tests/studio-draft.test.ts
# 5 files, 63 tests passed（审计修复后的计数；审计开始时为 50）

npm run typecheck
npm run typecheck --prefix packages/mac
npm run typecheck --prefix packages/companion

npx vitest run
# 646 files passed, 1 skipped; 7 864 tests passed, 7 skipped
Tested-on: macOS 44cb03f247a3bccb05d91f24494cff47f13e5690
```

源码扫描（`tests/studio-gates.test.ts` 内的用例）：

```
no file under src/studio can reach approve except gates.ts
(and the service’s one injection line)
```

## 6. 复核记录

- 独立代理：`general-purpose`，模型 Fable，只读；其 F1–F10 与本代理自己的 F5（跨工作室）、F6（gate pending）等
  合并进 §1。分歧处理：F3 的手机/Mac/`machines` 原生批准按设计 §3.3 保留（§3 第 1 条），其余全部修复。
- 全量测试在修复后重跑一次；结果与 `Tested-on` 行以提交时脚本的输出为准。
