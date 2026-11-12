# 里程碑 7：让角色分工看得见

计划“按角色分配模型：计划设置页、中文输入法与收尾验证”的第 7 个里程碑。用户在计划设置里配了架构 Opus、编码 DeepSeek、审计 glm-5.3、疑难修复 Sonnet，但看任务执行时确认不了实际是不是这样分的。

## BLG-198 核对：四个角色实际走哪条路

证据：`tests/fork-plan-roles-visible.test.ts`。它模拟一个守护进程，工作区像 `manager.setAgent` 一样记下自己的 agent，按截图里的配置跑一个只有一个里程碑的计划。前 3 个用例通过；后 2 个用 `it.fails` 标着，就是下面发现的两个生效问题（BLG-199 修好后改成 `it`）。

| 角色 | 代码路径 | 落在哪个工作区 | 是否生效 |
|---|---|---|---|
| 架构 | `pilot.ts` 的 `askDesign`（约 867/892 行，只在 `plan.archAgent` 有值时进入）→ `work.ts:131` 的 `architectChat` → 新建 `Design: …` 对话，`manager.setAgent(ws, plan.archAgent)`；记在 `run.architect` | 一个独立对话（chat） | ✅ 生效（用例 1 显示是 Opus）。没设架构时不建这个对话（用例 2），界面显示“不设” |
| 编码 | `pilot.ts` 的 `launch()`（1022 行）：`agent = pick ?? fixer ?? plan.agent` → `board.startShared(…, { agent })`；记在 `run.agent.worktree` | 每个里程碑一个工作树（默认 `workers: 'milestone'`） | ✅ 明确选了模型时生效（用例 1 是 DeepSeek）；❌ 编码选“自动”时**不生效**（问题 1）；❌ 任务自己指定的 agent 被忽略（问题 2） |
| 审计 | `work.ts:82` `checker = checkerAgentOf(plan) ?? autoChecker(state)`；`checkerChat`（123 行）新建 `Check: …` 对话并 `setAgent`；记在 `run.checker` | 一个独立对话 | ✅ 生效（用例 1 是 GLM）；没设审计时由编码的 agent 来审（用例 3，和设置页“同编码”的说法一致） |
| 疑难修复 | `work.ts:139` `fixer = plan.fixAgent ?? autoFixer(state)`；`src/fork/plans/fixer.ts` 的 `toFixer` 把会话切到它，并在计划动态里记 “handed … to …”。三处入口：检查没过后的修复任务（`pilot.ts:1003`）、合并冲突（`fixupIn`，计划自己的会话）、停了两次的任务（看门狗 `escalate`） | 不另开工作区：把已有的编码工作树或计划会话切过去 | ✅ 生效（用例 1：修复任务把工作树切到 Sonnet，动态里有 “handed the fix tasks for “Safe payments” to Claude (Sonnet)”）；⚠ 记录不全（问题 3、4） |

### 发现的问题（BLG-199 修）

1. **编码为“自动”时，里程碑工作树不走自动路由。** 设置页写的是“自动路由：每个任务一个普通档模型”，但 `launch()` 在 `plan.agent` 为空时什么 agent 都不传，`startShared` 也不像 `board.start` 那样调用 `routedAgent`，所以工作树用的是“你的默认 Agent”（这台 Mac 上通常是 Opus）。只有旧的 `workers: 'task'` 模式会路由。证据：`it.fails('work on auto route …')`，实际收到 `undefined`。
2. **任务自己的 agent 被忽略。** 任务卡（`PlanOutline.tsx:110`，`own = t.issue?.agent ?? plan.agent`）和 `setWorkAgent` 的注释都说“任务自己的 agent 优先”，但 `launch()` 只看 `pick ?? fixer ?? plan.agent`。证据：`it.fails('a task with its own agent …')`，收到的是 DeepSeek，不是任务指定的 Sonnet。
3. **“停了两次的任务”交接没写是哪个里程碑。** `escalate` 记的是 “handed a task that stopped twice to X”，没法挂到具体里程碑上。修法：在 fork 的 `fixer.ts` 里从 `plan.runs` 按工作树找到里程碑，写成 “handed a task that stopped twice in “标题” to X”。
4. **检查没过后重开工作树时直接用疑难修复 agent，但不记交接。** `launch()` 的 `fixer` 分支（旧工作树已经没了的时候）不写动态，界面就说不清为什么编码是 Sonnet。修法同问题 1：启动时记下用了谁、为什么。

## 显示方案

**数据从哪里来**
- 新增 fork 文件 `src/fork/plans/roles.ts`，浏览器安全（只引入类型、`shared/auto-route`、`shared/agent-label`）。`milestoneRoles(plan, m, state)` 返回 `{ arch, work, check, fix }`，每个角色包含：`state`（`off` 不设、`waiting` 还没开始、`on` 在做或做过）、`agent`（实际用的）、`set`（计划设置的：某个 agent、`auto` 自动或 `default` 默认）、`why`（实际和设置不一样的原因代码），疑难修复另有 `handoffs`（交接记录）。
- 实际 agent 的来源：架构取 `run.architect` 对应工作区的 `Workspace.agent`，审计取 `run.checker` 对应工作区的 `Workspace.agent`。工作区归档后仍留在 state 里（`archived: true`），所以里程碑通过后也能读到。编码取 `run.agent` 启动时记下的 agent，这是 `MilestoneAgent` 新增的可选字段 `agent` 和 `via`，因为疑难修复接手后工作区上的 agent 会变。没有记录的旧数据回退到工作区当前的 agent。值为空表示“你的默认 Agent”。
- 交接记录来自 `plan.activity` 里的 `note`，按 `handed (…) to (…)` 拆开，再按里程碑标题“…”归到对应里程碑；冲突交接归到计划本身。
- `via` 的取值有 `pick`（用“用…启动”另选）、`task`（任务自己的 agent）、`fix`（检查没过，交给疑难修复）、`auto`（自动路由选的）、`plan`（计划设置）、`default`（没有可用的，用默认）。

**放在界面哪里**
- Mac 里程碑详情（`GateDetails`）：在“设计”和“检查结论”之间加一节“谁做的”，四行：架构 / 编码 / 审计 / 疑难修复，每行是 `runtimeMark` 图标加模型名（`autoAgentName`）。组件放在 `packages/mac/src/fork/plans/MilestoneRoles.tsx`。
- Mac 任务卡（`TaskRow` 的 meta）：一个小标签，显示实际做它的模型（任务所在工作树的 agent），还没开始时显示计划默认，并加“将由”前缀。组件放在 `packages/mac/src/fork/plans/TaskAgentChip.tsx`。
- 手机计划页（`packages/companion/app/plan/[id].tsx`）：在里程碑下面只读显示同样四行；协议用 `SINCE.rolesSeen` 判断，旧版守护进程不显示。

**中文文案**（英文作 key，放进 `zh-CN.fork.json`）

| 英文 | 中文 |
|---|---|
| Who did it | 谁做的 |
| Not started yet | 还没开始 |
| Not set | 不设 |
| Your default agent | 你的默认 Agent |
| Set to {0} | 设置为 {0} |
| Handed {0} to {1} | 把{0}交给了 {1} |
| the fix tasks | 修复任务 |
| the conflict | 合并冲突 |
| a task that stopped twice | 停了两次的任务 |
| No handoffs | 没有交接 |

**实际和设置不一样时怎么说**：在那一行加一个提示标记，写成“设置为 X · 实际 Y：原因”。各原因的说法：

| 原因代码 | 中文 |
|---|---|
| `fix` | 检查没通过，交给疑难修复 |
| `task` | 任务自己指定了 Agent |
| `pick` | 启动时另选了 |
| `auto` | 自动路由按任务选的 |
| `default` | 列表里的模型这台电脑都用不了，用了默认 Agent |
| `changed` | 开始后计划设置改过 |

审计还有一种情况：没设审计时由编码的 agent 来审，这算设置里的“同编码”，不算不一致。

**动哪些上游文件**（每个 ≤3 行）
- `src/core/plans/model.ts`：`MilestoneAgent` 加 `agent?`、`via?`（2 行）
- `src/core/plans/pilot.ts`：`launch()` 选 agent 改为调用 fork 的 `workAgentFor(…)`，`setAgent` 带上 `agent`、`via`（2 行）
- `src/companion/protocol.ts`：里程碑加可选 `roles`，`SINCE` 加 `rolesSeen`，minor 改为 55（3 行）
- `src/companion/views.ts`：里程碑视图加 `roles: rolesView(…)`（1 行加 import）
- `packages/mac/src/plans/PlanDetails.tsx`：一行 `<MilestoneRoles>` 加 import
- `packages/mac/src/plans/PlanOutline.tsx`：一行 `<TaskAgentChip>` 加 import
- `packages/companion/app/plan/[id].tsx`：一行组件加 import

问题 3 的修复放在 `src/fork/plans/fixer.ts`（fork 文件）。

## 实施结果（BLG-199～202）

**修掉的生效问题**（`tests/fork-plan-roles-visible.test.ts`，修之前失败，修之后通过）
- 问题 1、2、4：里程碑工作树用哪个 agent，改由 `src/fork/plans/roles.ts` 的 `workAgentFor` 决定。顺序是：“用…启动”另选的 → 第一个任务自己的 agent → 检查没过时的疑难修复 agent → 计划设置的 agent → 自动路由按这个任务选的 → 你的默认 Agent。启动时用了谁、为什么，记在 `MilestoneAgent.agent` 和 `via` 里；直接交给疑难修复的那次也会写进计划动态。
- 问题 3：“停了两次的任务”交接现在写成 “handed a task that stopped twice in “里程碑” to …”。BLG-200 的 e2e 实跑时真的触发了一次，界面上挂在对应里程碑下面。
- 新发现的问题 5：工作区的模型单独存在 `Workspace.model` 里（`manager.ts` 的 `agentFields`），`Workspace.agent` 上没有 model。一开始界面把 Opus 显示成“Claude”并标成不一致，e2e 抓到了这个问题。同样的问题也会让 `fixer.ts` 判断“已经在疑难修复 agent 上了”时不比较模型。现在两处都用 `workspaceAgent()` 把模型拼回去，测试里的模拟管理器也改成按真实方式分开存。

**在哪里看**
- Mac：计划页 → 点里程碑的“通过标准”卡（列表视图点里程碑）→ 详情里的“谁做的”。四行依次是架构、编码、审计、疑难修复。实际和设置不一样时，那一行会出现提示：设置为 X，以及原因。疑难修复下面列出每次交接。
- Mac 任务卡：画布和列表里，任务旁边的小标签显示正在做它的工作树用的模型。列表里还没开始的任务显示“将由”谁做（半透明）。
- 手机：计划页每个里程碑在 Design 下面有 “Who did it” 卡片，只读，文字按 phone-zh-later 保持英文。守护进程低于 1.55 时不显示。
- 说明文档：`docs/tasks-and-plans.fork.md` 的 “Who did it” 和 “Task titles don't pick models” 两段。任务标题里的【设计】【审计】不会换模型，同一个里程碑的任务都由编码模型做。

截图：`.beluga/scratch/roles-visible-en.png`、`roles-visible-section-zh.png`（BLG-200 的附件里也有）。

## BLG-203 审计（独立核对）

**我跑了什么**
- 负载偏高（load 约 11），一次就过：`cd packages/mac && npm run e2e -- e2e/fork-roles-visible.spec.ts --reporter=line`，结果 1 passed（37 秒）。日志 `.beluga/scratch/audit-e2e.log`，数据 `.beluga/scratch/roles-audit.json`（副本在 `.beluga/scratch/agents/x5tgvJBSUR/`）。
- 对照三份数据：设置（settings）、守护进程自己的工作区记录（recorded）、界面文字（shown）；再看三张截图；再读 `src/fork/plans/roles.ts`。

**逐角色对照**

| 角色 | 设置 | 实际记录 | 界面显示 | 结论 |
|---|---|---|---|---|
| 架构 | Claude opus | 设计聊天 `chat-4f6525c6`：runtime claude，`model` 字段 opus | Opus | 一致 |
| 编码 | 本地 deepseek/deepseek-flash[1m] | 里程碑启动时记录 `startedOn.agent` 为 deepseek-flash（via plan）；但该工作树现在是 claude + sonnet（交接后） | Deepseek flash | 一致（显示的是启动时用的模型，交接后由疑难修复接手，Sonnet 在“疑难修复”行体现） |
| 审计 | 本地 bigmodel/glm-5.3[1m] | 检查聊天还没创建（没有 checker 记录） | Glm 5.3 + “Not started yet” | 一致（未开始，显示的是设置的模型，和设置相符） |
| 疑难修复 | Claude sonnet | 计划动态里 2 条交接：Groundwork 和 Ship 各一条“a task that stopped twice → Claude (Sonnet)” | Sonnet，并列出“A task that stopped twice → Claude (Sonnet)”一条 | 一致（只显示本里程碑 Groundwork 的那条，Ship 那条属于另一个里程碑，过滤正确） |

**观察到的交接**：“handed a task that stopped twice in “Groundwork” to Claude (Sonnet)”，在“疑难修复”下出现。任务卡：3 张都显示 Sonnet，和工作树当前的 claude + sonnet 一致（卡片跟随工作树现在的模型，而不是启动时的 deepseek）。

**截图**
- `.beluga/scratch/roles-visible-en.png`
- `.beluga/scratch/roles-visible-section-en.png`
- `.beluga/scratch/roles-visible-section-zh.png`

中文截图：标题“谁做的”、四个角色名、“还没开始”、交接行“停了两次的任务 → Claude (Sonnet)”都已翻译，除模型名外没有英文残留。

**发现的问题**
1. 编码行在交接后仍显示 Deepseek flash，没有提示“现已交给 Sonnet”。只能从下一行“疑难修复”推断。**已修**（审计之后）：交接后编码行会多一句“交接后现在是 Sonnet”（`RoleSeen.now`，Mac 和手机都有）。e2e 复跑时显示为 `Coding / Deepseek flash / Handed over, now on / Sonnet`。审计原来的建议是：交接后在编码行加一句“后来交给疑难修复”。
2. “疑难修复”行的 `agent` 取的是当前设置（`fixSet`），不是交接记录里真正接手的 agent（`Handoff.to` 只是字符串）。设置在交接之后改过，这一行的模型名会和当时实际接手的不同（交接行文字仍是对的）。**已修**（审计之后）：有交接时，这一行以最后一条交接的 `to` 为准；和当前设置不一样时，标出“开始后计划设置改过”。测试见 `tests/fork-plan-roles-visible.test.ts`（交接后把疑难修复改成 Opus 的那一段）和 `tests/fork-companion-roles.test.ts`。审计原来的建议是：交接时把 agent 以结构化形式写进活动，或界面以最后一条 `to` 为准。
3. `roles.ts` 的 `ran(seen(...))`：架构/审计的聊天工作区若已被删除，`seen` 返回空，会显示成“你的默认 Agent”，而不是“记录已不在”。遗留，低风险。建议：找不到工作区时单独标出。
4. 本次 e2e 的审计聊天没创建，所以“审计实际用 GLM”这一项只核对了设置，没有核对实际运行。遗留（e2e 的覆盖缺口）。审计实际用 GLM 已在单元测试里覆盖：`tests/fork-plan-roles-visible.test.ts` 第一个用例里，检查对话的工作区是 GLM，视图也显示 GLM。演示环境没有本地模型运行时，审计对话跑不完，所以 e2e 不等它。

未发现界面显示与记录矛盾的情况。

## 收尾验证（BLG-203）

- 审计之后修了一处：`protocol.ts` 必须只依赖 zod、并且不引用别的文件（手机在 Bare 里加载它，见 `tests/companion-coverage.test.ts`）。所以 `roles` 的 schema 放回 `protocol.ts`，多了 4 行。`src/fork/companion/plan-roles-view.ts` 改成只做转导出。
- 已通过：`npm run typecheck`、`packages/mac` 的 `tsc --noEmit`、`packages/companion` 的 `npm run typecheck`、本里程碑的 vitest（fork-plan-roles-visible、fork-companion-roles、plan-fix-agent、plan-arch-agent、companion-coverage、parity、i18n、upstream-sync）、e2e `fork-roles-visible.spec.ts`。`sync-upstream.mjs --report` 里没有标 ! 的文件。
- 全量 `npx vitest run` 跑了三次。第一次失败的是上面的 companion-coverage，已修。第二、三次都是 652 个文件通过，只有 `tests/machines/linux-computer.test.ts:158`（终端那一步的 waitFor 超时）失败，当时机器负载在 12～15。单独跑这个文件能通过。BLG-194 记过同样的情况：它在 main 上的同一行也会这样失败。所以这次没有拿到 `Tested-on` 行，属于**遗留**，和本里程碑的改动无关。
