# 模型编队与全自动驾驶（设计）

日期：2026-11-16 · 状态：**待评审**，未实现。

取代上游 PR [beluga-labs/beluga#546](https://github.com/beluga-labs/beluga/pull/546) 现在的做法（四个角色、
四张列表、一个 Auto Route 设置页）。起因是维护者的两条意见：

- 六层、四层都太细。收成**规划、执行、审查**三段；不关心的人看不到它，高级选项只在想要时出现。
- 在 Step by Step、Check-ins、Autopilot 之上再加一档**全自动**：agent 提问时由我们自己的 agent 代答，
  计划一路跑到底。

## 1. 目标与边界

**目标**

1. 普通用户开箱即用：一个选项，不用懂模型。
2. 按这台电脑上**现在能跑的模型**搭配，不写死任何人的 endpoint。
3. 高级用户能逐个角色指定模型和后备顺序。
4. 计划可以不停下来问人，一路跑完。
5. 什么都不选时，行为和今天完全一样。

**不做**

- 第四个及更多角色（架构、疑难修复不再是独立角色，见 §3）。
- 按任务难度分流（`hard` 标签、优先级、估点）。难的任务靠升级解决（§5），不靠事先猜。
- 费用统计、跨机器调度（后者见 `2026-11-15-federation-design.md`）。
- Studio 客户界面上的任何模型选项（§9）。

## 2. 三个方案

| 方案 | 做法 | 结论 |
|---|---|---|
| A | 保留 546 的四个角色，只把它们藏进"高级" | 改动最小，但概念仍是四层，"太细"没解决 |
| **B** | **Agent 选择器里加一项"自动"，背后三个角色，按已有模型搭配** | **采用** |
| C | 不加界面，把分工写进 planning.md，靠提示词执行 | 最灵活，但不能强制，也看不到谁做了什么 |

## 3. 三个角色

| 角色 | 做什么 | 默认用哪一档 |
|---|---|---|
| 规划 `plan` | 和你对话、写计划、拆任务；开工前给每个里程碑写设计；全自动时代答问题；升级的最后一级 | 强 |
| 执行 `build` | 做任务，写代码 | 快 |
| 审查 `review` | 里程碑检查；你要求时审查计划草稿 | 中 |

546 的四个角色这样并进来：

- **架构**（`archAgent`）并入规划。里程碑的设计步骤保留，由规划角色做，只在计划有编队时运行。
- **疑难修复**（`fixAgent`）取消。它做的事由升级完成（§5）。
- **失败阶梯**不再是一张单独的列表，顺序固定为执行 → 审查 → 规划。

你原来的六步对应：想法、架构、计划、任务拆分是规划；写代码是执行；代码审查和拆分审查是审查；
"Sonnet 审、Opus 修、Opus 修不了给 Fable"是升级。

## 4. 按已有模型搭配

### 4.1 能力表

新文件 `src/shared/model-tiers.ts`（浏览器安全，只依赖 zod）。按模型名把每个模型归到三档之一：

| 档 | 例子 |
|---|---|
| 强 `strong` | Fable、Opus、GPT-5 的最高档 |
| 中 `mid` | Sonnet、GPT-5、GLM、Kimi |
| 快 `fast` | Haiku、DeepSeek Flash、各家的 mini |

- 匹配的是**模型名**里的家族名，和 endpoint 的 id 无关。`local:bigmodel/glm-5.3[1m]` 和别人电脑上
  `local:zhipu/glm-5.3` 归到同一档。
- **认不出的模型**（Ollama 上的任意模型）不进任何一档：不会被自动选作规划或审查，只在没有"快"档模型时
  作为执行候选。高级设置里可以给它指定档（§7.3）。
- 表随版本更新，不需要用户配置。

### 4.2 搭配规则

输入是选择器已有的 `RuntimeChoice[]`，只取现在能跑的（`runsHere`，灰掉的跳过）。

1. 每个角色的候选 = 它那一档的所有模型，排序：你的默认 agent 所在的 runtime 在前，其余按能力表顺序。
2. 每个角色用候选里的第一个；其余是它的后备（§5.1）。
3. 审查尽量不和执行用同一个模型。
4. 档位不全时：

| 这台电脑上有 | 规划 | 执行 | 审查 |
|---|---|---|---|
| 强、中、快 | 强 | 快 | 中 |
| 强、快 | 强 | 快 | 强 |
| 强、中 | 强 | 中 | 强 |
| 中、快 | 中 | 快 | 中 |
| 只有一档，或只有一个模型 | 同一个 | 同一个 | 同一个 |

最后一行等于今天的行为，这时界面上不出现"自动"这一项。

只登录了 Claude 订阅的电脑有 Opus、Sonnet、Haiku 三档，所以大多数用户不配任何东西就能用编队。

### 4.3 什么时候算

和 546 一样：每次有 agent 开始工作时算，**不存到任务或计划上**。计划上只存"自动"或你指定的模型
（§6），所以队友的电脑永远看不到只有你才有的 endpoint，各自按自己有的模型搭配。

## 5. 后备与升级

### 5.1 同一角色内换模型

一个模型用不了时（额度用完、没有这个模型、key 被拒），换这个角色候选里的下一个。这就是"DeepSeek、
GLM、Kimi 轮着用"。登录或 key 失败不会换到同一个账号的另一个模型。失败的模型每分钟重试，恢复后换回来
（沿用 546 的 `failing-models.ts`）。

### 5.2 向上升级

| 发生了什么 | 怎么办 |
|---|---|
| 里程碑检查没过 | 修复任务先给执行。同一个里程碑第二次没过，修复任务给规划的模型 |
| 任务停了两次 | 换成审查的模型继续；再停两次，换成规划的模型 |
| 合并冲突 | 直接给规划的模型 |
| 规划的模型也没做成 | 停下等你 |

升级做完后，后面的任务回到执行的模型。没有编队的计划不升级，和今天一样。

## 6. 数据与 API

### 6.1 计划

```ts
type RoleChoice = 'auto' | AgentRef;
interface PlanTeam {
  readonly plan?: RoleChoice;
  readonly build?: RoleChoice;
  readonly review?: RoleChoice;
}
interface Plan {
  readonly agent?: AgentRef;   // 不变：一个模型做所有事
  readonly team?: PlanTeam;    // 新增：有它时按角色分工，agent 被忽略
}
```

- 选"自动" = `team: { plan: 'auto', build: 'auto', review: 'auto' }`。
- 一个 API 方法 `plans.setTeam(planId, team | null)`，取代 546 的 `setCheckAgent`、`setArchAgent`、
  `setFixAgent`。`plans.create` 多一个可选的 `team`。
- `src/companion/coverage.ts` 里归为 `phone`（只是选择，不是编辑）。

### 6.2 设置

`settings.json` 的 `team` 取代 `autoRoute`：

```ts
const Team = z.object({
  byDefault: z.boolean().optional(),           // 新计划默认用编队。未设：关
  plan: z.array(Choice).max(8).optional(),     // 未设：按能力表算
  build: z.array(Choice).max(8).optional(),
  review: z.array(Choice).max(8).optional(),
  tiers: z.record(z.string(), Tier).optional() // 你给某个模型指定的档
});
```

三张列表都不设，就是 §4 的自动搭配。设了哪张，哪个角色用你的顺序，本机没有的候选自动跳过。

### 6.3 本分叉的迁移

`main` 上已有 546 的实现，读设置和计划时一次性换算：

| 原来 | 现在 |
|---|---|
| `autoRoute.on` | `team.byDefault` |
| `autoRoute.hard` / `build` / `review` | `team.plan` / `build` / `review` |
| `autoRoute.ladder`、`hardLabel`、`urgentIsHard`、`hardEstimate` | 丢弃 |
| `Plan.archAgent` / `checkAgent` | `team.plan` / `team.review` |
| `Plan.fixAgent` | 丢弃 |
| 设了 `agent` 又设了角色的计划 | `agent` 成为 `team.build` |

不在计划里、没人指定 agent 的单个任务：`byDefault` 开着时用执行角色，否则用你的默认 agent。

## 7. 界面

原则：**一个地方多一项，其余都在"自定义…"后面。**

### 7.1 新建计划

- Agent 下拉框不变，最上面多一项 **自动**，下面一行小字写出当前搭配：
  "Opus 规划 · GLM 写代码 · Sonnet 审查"。只有能搭出至少两档时才有这一项。
- 最下面多一项 **自定义…**，打开一张小表：三行，每行一个模型下拉框。
- `team.byDefault` 关着时默认选中的仍是你的默认 agent。
- 546 的四个下拉框、Plan Settings 表单都去掉；计划的 ••• 菜单里现有的"Agent…"一项打开同一个下拉框。

### 7.2 计划页

- 有编队的计划在标题下显示同一行搭配。没有编队的计划什么都不多。
- 里程碑详情的"设计"和"谁做的"保留，折叠，**只在有编队时出现**（546 里它对所有人显示"未设置"，去掉）。
- 任务卡上的模型小标只在这个任务被升级或换了后备模型时出现。
- 升级和换模型记在计划动态里，一句话："检查两次没过，改由 Opus 修复"。

### 7.3 设置

- Settings › Agent 多一行开关 **新计划使用模型编队**，旁边是当前搭配和"自定义…"。
- "自定义…"里是三张有序列表（上移、删除、添加、恢复默认），以及"未识别的模型"一栏，可给每个指定档。
- 546 的 Auto Route 页连同"紧急和高也算疑难"、When a Model Fails 列表一起去掉。

### 7.4 手机

- 计划页 ••• › **模型**：自动，或单个模型；三个角色分别选放在同一张表的"高级"里。
- 里程碑的"设计"（代码照常剥掉）和"谁做的"只读，折叠。
- 协议只做增量：`SINCE.team`。老手机看到有编队的计划时，显示执行角色的模型。
- 外观按 `packages/companion/lib/theme.ts`：不加按钮，都在 ••• 表里。

## 8. 全自动驾驶

### 8.1 第四档

`AUTONOMIES = ['step', 'gated', 'autopilot', 'full']`。

| | 标签 | 一句话 |
|---|---|---|
| `full` | Full Autopilot | 一路跑到底，问题由你的 agent 代答 |

默认仍是 Check-ins。里程碑自己的自主程度（`PlanMilestone.autonomy`）也能选这一档。它和编队互不依赖：没有编队的计划也能选，代答的就是计划自己的 agent。

### 8.2 代答怎么走

1. 计划里某个任务的 agent 提问（`QuestionBroker` 收到 `question` 类的问题）。
2. 计划是 `full` 时，不在你屏幕上出卡片，而是把问题、选项和任务上下文发给**规划角色**（计划的主对话）。
3. 规划角色用两个新工具之一作答：
   - `plan_answer(qid, 选项或文字, 理由)`：答案回给提问的 agent，它继续。
   - `plan_defer(qid, 原因)`：这件事要你本人，照常出卡片并通知。
4. 两分钟没有作答：照常出卡片。计划不会因为代答失败而卡死或瞎答。

### 8.3 仍然会等你的

- 只有你能做的任务（`assignee: 'me'` 且不是选择题：账号、密钥、付款、对外发布）。
- 带选项的"你来决定"任务（`PlanDecision`）由规划角色代答，除非写计划时标了 `onlyYou`（新增字段）。
- 危险操作的授权：仍按这个 worktree 的权限模式，代答不碰它。
- 合并到 main、发 PR：仍按计划现有的设置。
- 升级到顶仍失败（§5.2）。
- 同一个任务被代答满 5 次，或同一个问题问了第二遍：出卡片，避免两个 agent 互相兜圈。

### 8.4 留痕

- 每次代答记在计划上：`autoAnswers: { at, task, question, answer, why }[]`。
- 计划页有一栏 **替你做的决定**，每条可以点"改…"，把你的答案发给那个任务的 agent。
- 代答不产生 `NeedsYou`，手机不响；`plan_defer` 的和今天的问题一样到手机并通知。
- 手机的自主程度选择里多这一档（`SINCE.fullAutopilot`）。发给老手机的视图里它仍写作 `autopilot`，
  另带 `full: true`，老手机的枚举不会解析失败。

## 9. Studio

- 客户界面不出现模型、角色、编队这些词，也没有任何选项。`src/studio/sanitize.ts` 已经会拿掉模型名，
  "谁做的"和"替你做的决定"不进客户视图的白名单。
- 客户建的计划仍是 `gated`，`plan.create` 仍然拒收 `autonomy`、`agent`，现在也拒收 `team`。
- 编队由运营方的 `team.byDefault` 决定：开着，客户的计划就用运营方电脑上的编队。
- 全自动不给客户。客户的问题仍然用人话问客户，Gate 不变。

Studio 这边只有一行改动（zod 多拒一个字段）和测试。

## 10. 代码落点

路径按上游 PR 写。本分叉里 546 的这几个文件在 `src/fork/` 下（`src/fork/plans/fixer.ts`、`ladder.ts`、
`roles.ts`，`src/fork/failing-models.ts`），新文件也放在那里。

| 文件 | 改什么 |
|---|---|
| `src/shared/model-tiers.ts`（新） | 能力表、归档、§4.2 的搭配，纯函数 |
| `src/shared/auto-route.ts` | 删掉；`runsHere`、`firstRunning` 搬进上面的文件 |
| `src/core/plans/model.ts` | `PlanTeam`、`full`、`autoAnswers`、`PlanDecision.onlyYou` |
| `src/core/plans/roles.ts` | 一个角色现在该用谁（指定的，或自动的） |
| `src/core/plans/escalate.ts`（新） | §5，取代 `fixer.ts` 和 `ladder.ts` |
| `src/core/plans/auto-answer.ts`（新） | §8.2 到 §8.4 |
| `src/core/questions.ts` | 出卡片前先问 auto-answer |
| `src/agent/plan-tools.ts` | `plan_answer`、`plan_defer`（只有规划角色有） |
| `src/ipc/plans-api.ts` | `plans.setTeam`，去掉三个 `set*Agent` |
| `src/companion/` | `coverage.ts`、`views.ts`、`protocol.ts`（增量） |
| `packages/mac`、`packages/companion` | §7 |
| `docs/` | `parity.md`、`tasks-and-plans.md`、`companion.md`；`auto-route.md` 改写为 `model-team.md` |

## 11. 测试

- **搭配**：对固定的 `RuntimeChoice[]` 断言 §4.2 表里的每一行；认不出的模型；灰掉的模型被跳过。
- **升级**：检查两次没过、任务停两次、冲突、到顶等你；做完后回到执行的模型。
- **代答**：答了继续；`plan_defer` 出卡片；超时出卡片（时钟传进去，不等真实时间）；满 5 次出卡片；
  `onlyYou` 不代答；权限授权不经过它。
- **迁移**：§6.3 表里的每一行。
- **手机**：`tests/companion-*`，新老协议各一遍；Studio 拒收 `team`。
- **界面**：Playwright 覆盖新建计划的"自动"、自定义表、计划页的搭配行和"替你做的决定"。
- 都按 CLAUDE.md"Tests that pass everywhere"：等条件，不等时间；不用固定端口。

## 12. 交付

三个 PR，各自独立：

1. **Full Autopilot**（§8）。不依赖编队，最小，先发。
2. **模型编队**（§3 到 §7、§9）。更新 #546：转回草稿，改完再标记可评审。
3. **保存 endpoint 前先检查**。从 #546 拆出去，和这件事无关。

每个 PR 的说明里放：每个新界面的截图（亮、暗），一段从新建计划到跑完的 GIF，手机的截图。546 没有构建
和运行手机端，这次要跑。维护者不逐行看代码，所以说明要让人只看图就明白改了什么。

本分叉里按同样的顺序落地，每件事一个 PR，合进 `main` 后再构建。
