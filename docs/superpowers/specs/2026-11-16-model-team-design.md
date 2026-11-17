# 模型编队（设计）

日期：2026-11-16，2026-11-17 按上游 3.6.0 重写，同日加上"删掉 Full Autopilot"（§8） · 状态：**待评审**，未实现。

## 0. 上游 3.6.0 之后，这份设计改了什么

写第一版时，上游 PR [beluga-labs/beluga#546](https://github.com/beluga-labs/beluga/pull/546) 还开着，
维护者提了两条意见：角色收成三段、加一档全自动。2026-11-16 维护者自己把这两件事做进了 3.6.0
（[#556](https://github.com/beluga-labs/beluga/pull/556)，BLG-981、BLG-982），并关闭了 #546，留言是
"用粒度更小的另一种方式加了这个功能"。3.6.0 已在 2026-11-17 合进本分叉的 `main`。

| 第一版要做的 | 上游 3.6.0 的做法 | 现在 |
|---|---|---|
| Full Autopilot：`Autonomy` 第四个值 `full`，规划角色用 `plan_answer` / `plan_defer` 代答 | `Plan.fullAuto` 开关（Autopilot 下的 *Never wait for me*），聊天里也能开；一个无工具的单轮替身（`src/core/autopilot/`）代答问题、计划审批、带选项的决定、工具和链路授权 | **不做，并且把上游的整个删掉**（负责人 2026-11-17 的决定，§8） |
| 三个角色 `plan` / `build` / `review`，`Plan.team`、`plans.setTeam` | `planner` / `builder` / `checker`，存在 `Plan.planner` / `agent` / `checker`，`plans.setRoleAgent`，New Plan 一句话加 Mix Agents，计划页的 agents 按钮 | **不做，用上游的** |
| "自定义…"里每个角色一个下拉框 | Mix Agents 就是它 | **不做** |
| 按本机已有的模型自动搭配 | 没有。什么都不选时三个部分都是你的默认 agent | **要做，这份设计只剩这一件事** |
| 后备和升级 | 没有 | 要做，沿用本分叉已有的机制 |
| 更新 #546 | 已关闭 | 不再有这个 PR |

第一版里为 Full Autopilot 设计的三样（同一任务代答满 5 次就交还给你、"替你做的决定"列表和"改…"、
`PlanDecision.onlyYou`）随它一起不做。

**Full Autopilot 不留在本分叉里。** 上游把它做成了 Autopilot 下面的一个勾选框 *Never wait for me*，
聊天的模式菜单里也有一项。负责人的决定是整个删掉：运行方式回到 Step by step、Check-ins、Autopilot 三档，
没有第四种状态，也没有替你回答的替身。删什么、留什么、以后同步上游时怎么办，见 §8。

本分叉自己还留着三样和上游重叠的东西，这次一并收掉：

- **四个角色的界面**：`packages/mac/src/fork/plans/NewPlanSheet.tsx` 整个替换了上游的 New Plan，
  所以分叉里的 New Plan 现在没有上游的那句话。
- **架构和疑难修复**（`Plan.archAgent`、`Plan.fixAgent`）：上游没有的两个角色。
- **自动路由**（`src/shared/auto-route.ts`）：四张手写的候选列表，按 `hard` 标签、优先级、估点分流。

## 1. 目标与边界

**目标**

1. 普通用户开箱即用：一个"自动"，不用懂模型。
2. 按这台电脑上**现在能跑的模型**搭配，不写死任何人的 endpoint。
3. 高级用户能逐个部分指定到**具体的模型**（新建时用上游的 Mix Agents，建好后在计划页的菜单里，§7.2），
   也能改自动搭配的候选顺序。
4. 角色和界面用上游的，分叉只加一层"没选的部分由谁来"。
5. 运行方式只有三档。上游的 Full Autopilot 删掉（§8）：这一处分叉和上游的差异是变大的，是有意的取舍。

**不做**

- 第四个及更多角色。架构并入 planner，疑难修复改成升级（§5）。
- 按任务难度分流（`hard` 标签、优先级、估点）。难的任务靠升级解决，不靠事先猜。
- 任何替你回答问题、替你批准的东西。问你的事情等你，Autopilot 也一样。
- 费用统计、跨机器调度（后者见 `2026-11-15-federation-design.md`）。
- Studio 客户界面上的任何模型选项（§9）。

## 2. 一句话的模型

上游的规则是：planner 和 checker 没选时跟 builder，builder 没选时是你的默认 agent（`roleAgent`）。

本分叉只在这条规则的最后加一步：

> 计划开着**自动**时，一个部分沿上游的规则找不到人，就用编队里这个部分的模型，而不是你的默认 agent。

所以你指定的永远优先。指定了 builder，planner 和 checker 没选时仍然跟 builder，和上游一样。
没开自动的计划，行为和上游完全一样。

## 3. 三个部分

| 部分 | 做什么 | 自动时用哪一档 |
|---|---|---|
| planner | 和你对话、写计划、拆任务；开工前给每个里程碑写设计；升级的最后一级 | 强 |
| builder | 做任务，写代码 | 快 |
| checker | 里程碑检查；你要求时审查计划草稿 | 中 |

分叉原来的两个角色这样并进来：

- **架构**（`archAgent`）并入 planner。里程碑的设计步骤保留，由 planner 的模型写，只在计划开着自动时运行。
- **疑难修复**（`fixAgent`）取消，它做的事由升级完成（§5）。
- **失败阶梯**不再是一张单独的列表，顺序固定为 builder → checker → planner。

上游的替身已经跑在 planner 上（`launch.ts` 里 `roleAgent(plan, 'planner')`）。接上编队后，自动的计划由强档模型
代答，这一处改一行。

## 4. 按已有模型搭配

### 4.1 能力表

新文件 `src/shared/model-tiers.ts`（浏览器安全，只依赖 zod 和 `shared/`）。按模型名把每个模型归到三档之一：

| 档 | 例子 |
|---|---|
| 强 `strong` | Fable、Opus、GPT-5 的最高档 |
| 中 `mid` | Sonnet、GPT-5、GLM、Kimi |
| 快 `fast` | Haiku、DeepSeek Flash、各家的 mini |

- 匹配的是**模型名**里的家族名，和 endpoint 的 id 无关。`local:bigmodel/glm-5.3[1m]` 和别人电脑上的
  `local:zhipu/glm-5.3` 归到同一档。
- **认不出的模型**（Ollama 上的任意模型）不进任何一档：不会被自动选作 planner 或 checker，只在没有快档模型时
  作为 builder 候选。设置里可以给它指定档（§7.3）。
- 表随版本更新，不需要用户配置。

### 4.2 搭配规则

输入是选择器已有的 `RuntimeChoice[]`，只取现在能跑的（灰掉的跳过）。

1. 每个部分的候选 = 它那一档的所有模型，排序：你的默认 agent 所在的 runtime 在前，其余按能力表顺序。
2. 每个部分用候选里的第一个，其余是它的后备（§5.1）。
3. 档位不全时：

| 这台电脑上有 | planner | builder | checker |
|---|---|---|---|
| 强、中、快 | 强 | 快 | 中 |
| 强、快 | 强 | 快 | 强 |
| 强、中 | 强 | 中 | 强 |
| 中、快 | 中 | 快 | 中 |
| 只有一档，或只有一个模型 | 搭不出编队 | | |

最后一行时界面上不出现"自动"，一切和上游一样。只登录了 Claude 订阅的电脑有 Opus、Sonnet、Haiku 三档，
所以大多数用户不配任何东西就能选自动。

### 4.3 什么时候算

每次有 agent 开始工作时算，**不存到任务或计划上**。计划上只存一个开关（§6.1）和你指定的 agent，
所以队友的电脑永远看不到只有你才有的 endpoint，各自按自己有的模型搭配。

## 5. 后备与升级

只对开着自动的计划生效。机制沿用本分叉已有的 `src/fork/plans/fixer.ts`（怎么换人、做完怎么换回来）、
`ladder.ts`（一个模型算不算坏了）和 `src/fork/failing-models.ts`，只把"换给谁"换成下面的顺序。

### 5.1 同一部分内换模型

一个模型用不了时（额度用完、没有这个模型、key 被拒），换这个部分候选里的下一个。这就是"DeepSeek、GLM、
Kimi 轮着用"。登录或 key 失败不会换到同一个账号的另一个模型。失败的模型每分钟重试，恢复后换回来。

### 5.2 向上升级

| 发生了什么 | 怎么办 |
|---|---|
| 里程碑检查没过 | 修复任务先给 builder。同一个里程碑第二次没过，修复任务给 planner 的模型 |
| 任务停了两次 | 换成 checker 的模型继续；再停两次，换成 planner 的模型 |
| 合并冲突 | 直接给 planner 的模型 |
| planner 的模型也没做成 | 停下等你 |

升级用的是三个部分**实际解析出来的 agent**（你指定的，或编队的），同一个模型只算一级。升级做完后，
后面的任务回到 builder 的模型。

## 6. 数据与 API

### 6.1 计划

```ts
interface Plan {
  readonly agent?: AgentRef;     // 上游：builder
  readonly planner?: AgentRef;   // 上游
  readonly checker?: AgentRef;   // 上游
  readonly autoTeam?: boolean;   // 本分叉新增：没选的部分用编队
}
```

- 一个可选的布尔值，`plans.create` 多一个可选的 `autoTeam`，
  一个方法 `plans.setAutoTeam(planId, on)`。
- `Plan.archAgent`、`Plan.fixAgent` 删掉。`plans.setArchAgent`、`plans.setFixAgent` 再留一个版本：前者改成设
  planner，后者什么都不改，只回一句话。老手机还会调它们，下个版本再删。
- `roleAgent` 改回上游的原样（去掉分叉加的 `?? plan.archAgent`）。分叉的那一步放在
  `src/fork/plans/team.ts` 的 `teamAgent(plan, role, state)` 里，凡是开工取人的地方都调它。
- `src/companion/coverage.ts` 里 `plans.setAutoTeam` 归为 `phone`（只是开关，不是编辑）。

### 6.2 设置

`settings.json` 的 `team` 取代 `autoRoute`：

```ts
const Team = z.object({
  byDefault: z.boolean().optional(),              // 新计划默认开着自动
  planner: z.array(Choice).max(8).optional(),     // 未设：按能力表算
  builder: z.array(Choice).max(8).optional(),
  checker: z.array(Choice).max(8).optional(),
  tiers: z.record(z.string(), Tier).optional(),   // 你给某个模型指定的档
});
```

- 三张列表都不设，就是 §4 的自动搭配。设了哪张，哪个部分用你的顺序，本机没有的候选自动跳过。
- `byDefault` 没设过时沿用自动路由原来的规则：这台电脑上有 `local:` 模型能跑就算开。
  只有 Claude 订阅或只有 Ollama 的电脑默认关，新计划和上游一样，"自动"仍然在下拉框里可以选。
- 不在计划里、没人指定 agent 的单个任务：`byDefault` 开着时用 builder 的模型，否则用你的默认 agent。
  项目自己的 agent 仍然排在它前面。

### 6.3 迁移

读设置和计划时一次性换算：

| 原来 | 现在 |
|---|---|
| `autoRoute.on` | `team.byDefault` |
| `autoRoute.hard` / `build` / `review` | `team.planner` / `builder` / `checker` |
| `autoRoute.ladder`、`hardLabel`、`urgentIsHard`、`hardEstimate` | 丢弃 |
| `Plan.archAgent` | `Plan.planner`（已经选了 planner 的不动），并且 `autoTeam: true` |
| `Plan.fixAgent` | 丢弃，并且 `autoTeam: true` |
| 没有选 builder、还没做完、自动路由开着时建的计划 | `autoTeam: true`（启动时做一次，否则它们会突然改用默认 agent） |

`Plan.checkAgent` → `checker` 已经在 3.6.0 的合并里做了。

## 7. 界面

原则：**回到上游的界面，只多一项"自动"。**

### 7.1 新建计划

- 删掉分叉自己的 New Plan，用回上游的。上游那句话 "Planned, built and checked by [Your agent ▾]" 的下拉框
  最上面多一项 **Automatic**，下面一行小字是当前搭配："Opus plans · Haiku builds · Sonnet checks"。
  搭不出编队时没有这一项。
- Mix Agents 拆开后，每个部分的下拉框里也有 Automatic，意思是这个部分交给编队。
- `team.byDefault` 开着时默认选中 Automatic，否则默认仍是 Your agent。
- Build With ▸ 随着换回上游的表单自动有了。上游表单里 Autopilot 下面的 *Never wait for me* 勾选框删掉（§8）。

### 7.2 计划页

- 上游的 agents 按钮菜单最上面多一行 **Automatic**（勾选项），调 `plans.setAutoTeam`。开着时，
  每个部分没指定的那一行显示编队里的模型名，而不是 "Your Agent"。
- **每个部分能选具体的模型。** 上游这个菜单的子菜单只列 agent（Claude、Codex、OpenCode、Copilot、本地模型），
  选了之后跑那个 agent 的默认模型（`agentOnlyItems`，注释写着 "no models: each runs its default"）。结果是
  New Plan 的 Mix Agents 能选到模型，建好之后在计划页反而改不了；本地模型更是只有一行，选不到是哪一个。
  改成和 New Plan 同一张完整列表（`agentMenuItems`，已有）：每个 runtime 一段，下面是它的模型，当前的那个打勾，
  本机用不了的灰着并写明原因。第一行不变：builder 是 "Your Agent"，planner 和 checker 是 "Same as the Builder"。
  聊天里的 Build With ▸ 不动，仍然只列 agent。
- 分叉的 Plan Settings 表单里角色那一段删掉。
- 里程碑详情的"设计"和"谁做的"（BLG-198～201）保留，折叠，只在计划开着自动时出现。
  协议里 `roles` 的形状不变：原来的"架构"一栏是 planner 写的设计，"疑难修复"一栏是升级记录。
- 升级和换模型记在计划动态里，一句话："检查两次没过，改由 Opus 修复"。

### 7.3 设置

- Settings › Agent 多一行开关 **新计划自动搭配模型**，旁边是当前搭配和"自定义…"。
- "自定义…"里是三张有序列表（上移、删除、添加、恢复默认），以及"未识别的模型"一栏，可给每个指定档。
- Auto Route 页连同"紧急和高也算疑难"、When a Model Fails 列表一起去掉。

### 7.4 手机

- 计划页 ••• 表里上游已有 Plans with / Builds with / Checks with 三行。在它们上面多一行开关 **Automatic**，
  副标题是 Mac 发来的那行搭配。Mac 搭不出编队时没有这一行。
- "Agent for its architecture"、"Agent for hard fixes" 两行，连到新 Mac 时不再显示。
- "How it runs" 里的 Full Autopilot 一行、对话 ••• 表里的 Full Autopilot 一行删掉（§8）。
- 协议 1.64：新增 `PlanView.autoTeam`、`PlanView.team`（那行搭配的文字）、`SINCE.autoTeam`。
  老手机看不到开关，三行里显示的是 Mac 解析后的结果。
- 外观按 `packages/companion/lib/theme.ts`：不加按钮，都在 ••• 表里。

## 8. 删掉 Full Autopilot

上游 3.6.0（#556，BLG-981）加的 Full Autopilot 整个删掉。这是负责人 2026-11-17 的决定。

### 8.1 删掉之后是什么样

- 计划的运行方式三档：Step by step、Check-ins、Autopilot。Autopilot 仍然自己批准里程碑、自己合并；
  agent 问你的问题、要你批准的工具和计划，**等你**。
- 聊天的模式菜单里没有 Full Autopilot，输入框上没有它的标记。
- 没有替身：`src/core/autopilot/` 和 `src/agent/stand-in.ts` 不存在，没有任何代码替你回答。
- 计划做不下去时靠 §5 的换模型和升级，以及上游原有的"计划不会悄悄停住"（`rescue`）；到顶就等你。

### 8.2 删哪些

| 层 | 删什么 |
|---|---|
| 内核 | `src/core/autopilot/`（两个文件）、`src/agent/stand-in.ts`；`AgentBackend.standIn`（`types.ts`、`side-calls.ts`、`runtime/router.ts`、`mock.ts`）；`Session.standIn`、`Session.setAutopilot`；`CollabState.autopilot` 和它的 action；`board/launch.ts` 里装配 `AutopilotStandIn` 的那一段 |
| 计划 | `Plan.fullAuto`、`FULL_AUTOPILOT_INFO`、`Plans.setFullAuto`、`PlanWork.setFullAuto`、`create` 的 `fullAuto`；`planAutonomy` 和 `autonomyOf` 留着名字，去掉 `fullAuto` 那一支；`prompt.ts` 里 "runs on Full Autopilot" 那段话 |
| Mac | `chat/AutopilotChip.tsx`、`Composer.tsx` 模式菜单里的那一项；`PlanSheets.tsx` 的 *Never wait for me* 勾选框（网页表单和原生表单两处）和开关它的确认话术；`PlanPage.tsx` 的 "Runs on Full Autopilot"；`plans.module.css` 的 `.fullAuto` |
| 手机 | `plan/[id].tsx` 的 Full Autopilot 一行、`conv/[id].tsx` 的一行、`lib/link/calls.ts` 的两个调用、demo transport 的两个分支 |
| 测试 | `tests/autopilot.test.ts`、`packages/mac/e2e/autopilot.spec.ts` 删掉；`tests/plan-roles.test.ts` 里 "Full Autopilot on a plan" 一组和两处 `fullAuto` 断言删掉 |
| 文档 | `docs/tasks-and-plans.md` 的两段、`docs/parity.md` 的两行、`docs/companion.md`；`docs/fork.md` 记下这处差异 |

`src/machines/` 里的 stand-in（另一台 Mac 顶替常开的那台，BLG-799）和 `src/fork/plans/fixer.ts` 里的
`standIn` 是别的东西，只是同名，不动。

### 8.3 已有的数据

- 存档里带 `fullAuto: true` 的计划：读取时去掉这个标记。上游打开它时已经把 `autonomy` 写成了 `autopilot`，
  所以计划继续按 Autopilot 跑，只是问题重新等你。
- 聊天里开的 Full Autopilot 本来就不保存，没有要迁移的。

### 8.4 手机协议

- Mac 不再发 `PlanView.fullAuto` 和 `ConvView.autopilot`，两个字段从 schema 里拿掉。它们本来就是可选的，
  老手机读到的是"没开"。
- `SINCE.autopilot: 58` 这个编号留在表里，不再复用。
- `plans.setFullAuto`、`session.setAutopilot` **再留一个版本**：不做任何事，回一句
  "Full Autopilot isn’t part of this Beluga."。没更新的手机（1.58–1.63）连到新 Mac 时仍然会画出那一行，
  点了得到这句话，而不是一个看不懂的错误。下个版本连同四个 coverage 文件里的条目一起删。
- 这是删功能，不是改帧的形状，所以不升 `COMPANION_PROTO.major`；在 `docs/companion.md` 里写明。

### 8.5 以后同步上游

这是本分叉第一次删上游的功能，代价要说清楚：

- 上游以后每次改 Full Autopilot，同步时都会在上面这些文件里冲突，要手工再删一遍。
- 上游的新功能如果建在替身上（比如别的地方也调 `standIn`），本分叉要么不要那个功能，要么重新评估这个决定。
- 加一个守门测试 `tests/fork-no-full-autopilot.test.ts`：`src/core/autopilot/` 不存在；计划的 schema 不认
  `fullAuto`；`packages/mac/src` 和 `packages/companion/app` 里没有 "Never wait for me" 和 "Full Autopilot"
  这两个词。同步时如果把它带回来了，这个测试会失败，而不是悄悄多出一个勾选框。

## 9. Studio

- 客户界面不出现模型、角色、编队这些词，也没有任何选项。`src/studio/sanitize.ts` 已经会拿掉模型名。
- 客户建的计划拒收 `autoTeam`，和现在拒收 `autonomy`、`agent` 一样。
- 编队由运营方的 `team.byDefault` 决定：开着，客户的计划就用运营方电脑上的编队。

Studio 这边只有一行改动（zod 多拒一个字段）和测试。

## 10. 代码落点

| 文件 | 改什么 |
|---|---|
| `src/shared/model-tiers.ts`（新） | 能力表、归档、§4.2 的搭配、设置的 schema，纯函数 |
| `src/shared/team-migrate.ts`（新） | `autoRoute` → `team` |
| `src/fork/plans/team.ts`（新） | `teamAgent`、`taskAgent`、`teamByDefault`：一个部分现在该用谁 |
| `src/fork/plans/escalate.ts`（新） | §5 的顺序。`fixer.ts`、`ladder.ts` 只改"换给谁" |
| `src/shared/auto-route.ts` | 删掉 |
| `src/core/plans/model.ts`、`plans.ts` | `autoTeam`；删 `archAgent`、`fixAgent`；`roleAgent` 改回上游原样 |
| `src/core/plans/work.ts`、`pilot.ts`、`src/core/board/launch.ts`、`board/work.ts` | 取人的地方改调 `teamAgent` / `taskAgent`，每处一两行 |
| `src/ipc/plans-api.ts` | `plans.setAutoTeam`，`plans.create` 的 `autoTeam` |
| `src/companion/` | `coverage.ts`、`views.ts`、`protocol.ts`（1.64：加编队的字段，去掉 Full Autopilot 的两个字段） |
| Full Autopilot（删） | §8.2 整张表 |
| `packages/mac/src/fork/plans/auto-team.ts`（新） | "自动"这一项的纯逻辑；`AgentRoles.tsx` 里只留接入点 |
| `packages/mac`（删） | `fork/plans/NewPlanSheet.tsx`、`plans/PlanSettingsSheet.tsx`、`plans/PlanRoles.tsx`、`plans/plan-roles-model.ts`、`dialogs/AutoRouteSettings.tsx` |
| `packages/companion/app/plan/[id].tsx` | 一行开关，两行旧的按版本隐藏 |
| `docs/` | `parity.md`、`parity.fork.md`、`tasks-and-plans.fork.md`、`fork.md`、`companion.md`；`auto-route.md` 改写为 `model-team.md` |

角色这部分，上游文件里分叉的接入点比现在少：`model.ts` 少两个字段和一处改动，New Plan 不再整个替换。
Full Autopilot 这部分相反：删它要动上游的二十来个文件（§8.5）。

## 11. 测试

- **搭配**：对固定的 `RuntimeChoice[]` 断言 §4.2 表里的每一行；认不出的模型；灰掉的模型被跳过。
- **取人**：你选的优先；没选时跟 builder；开着自动且没选时用编队；没开自动时和上游的 `roleAgent` 结果一样。
- **升级**：检查两次没过、任务停两次、冲突、到顶等你；做完后回到 builder 的模型。
- **迁移**：§6.3 表里的每一行。
- **上游的测试**：`tests/plan-roles.test.ts` 里角色的部分原样通过，Full Autopilot 的一组删掉；
  `tests/autopilot.test.ts` 删掉。
- **Full Autopilot 确实没了**：§8.5 的守门测试；带 `fullAuto` 的旧存档读出来是 Autopilot、没有这个标记；
  `plans.setFullAuto`、`session.setAutopilot` 回那句话且什么都不改；Autopilot 的计划里，agent 的提问留在
  Needs You 里等你。
- **手机**：`tests/companion-*`，新老协议各一遍；Studio 拒收 `autoTeam`。
- **界面**：Playwright 覆盖新建计划的 Automatic、Mix Agents 里的 Automatic、计划页的勾选项、
  计划页给一个部分选具体模型、设置里的自定义表。
- 都按 CLAUDE.md "Tests that pass everywhere"：等条件，不等时间；不用固定端口。

## 12. 交付

本分叉里**一个 PR**（`fork/model-team`），合进 `main` 后再构建：先删 Full Autopilot，再做编队，这样编队不用
去接一个马上要删的东西。endpoint 检查早已在
`main` 上（`src/fork/endpoint-check.ts`），所以不再分三期。

上游：#546 已关闭，没有要更新的 PR。维护者刚选了更小的粒度（连模型都不列，只列 agent），现在把"自动搭配"
再提上去，大概率还是太细；本分叉又删了维护者刚做的 Full Autopilot，方向已经和上游分开。建议先在分叉里用一段时间，有了真实的截图和 GIF 再决定要不要提。
要不要提、要不要把 endpoint 检查单独提，都由你定，未经你同意不向上游推任何东西。
