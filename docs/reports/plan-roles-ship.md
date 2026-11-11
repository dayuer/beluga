# 里程碑 5：核心逻辑审计、全量测试与提交

计划：按角色分配模型：计划设置页、中文输入法与收尾验证。交接见 `plan-roles-handoff.md`。

## 一、疑难修复升级逻辑审计（BLG-130）

范围：`src/core/plans/pilot.ts` 的 `toFixer` / `fixupIn` / `escalate`、`src/core/plans/watchdog.ts`
里“又停了”的升级分支、`src/core/plans/work.ts` 的 `followHome`。先读代码下判断，没参考交接结论。

| # | 风险点 | 结论 | 说明 |
|---|---|---|---|
| R1 | 两个冲突同时存在时的切换 | **要修** | 计划对话一次可能同时有两个冲突（例如两个任务的合并底座都冲突，或一个合进计划、一个合 main）。其中一个解决时 `fixupIn(plan, undefined)` 会立刻把计划对话切回规划模型、并清掉 `allowFixup`，而另一个冲突还没解决：它下次重试再切回修复模型，来回交接，中间那段时间对话也不能改那个冲突目录。修法：记下计划还开着的冲突目录，解决一个时如果还有别的，留在修复模型上并把 `allowFixup` 指向剩下那个。 |
| R2 | `onFixer` 只在内存 | **要修** | 切换本身是持久的（工作区记录里的 agent），但“是谁切过去的”只在内存。守护进程在冲突期间重启后，冲突解决时 `fixupIn(undefined)` 看 `onFixer` 为空直接返回，计划对话就一直留在修复模型（Opus）上，直到有人改计划的编码/架构角色。修法：切回时除了看内存，也看对话当前的 agent 是不是修复模型；`toFixer` 在对话已经是修复模型时不再重复切换和记一行。 |
| R3 | 整个工作树被升级后，剩下的任务都用高级模型 | 接受 | `hand()` 在验收不过时把里程碑工作树交给修复模型，“又停了”的升级也是按对话（工作树）切；之后这个工作树里剩下的任务都在高级模型上跑完。这是设计如此（注释写明 “it stays there”）：同一个工作树一个会话，中途切回会丢上下文或要交接；花费只限这个里程碑，切换时活动里有一行“handed … to …”。 |
| R4 | 没设修复模型时与以前一致 | 没问题（有一处行为变化） | `fixer = plan.fixAgent ?? autoFixer(state)`。没设 `fixAgent` 且自动路由关：`toFixer` 直接返回，`escalate` 返回 undefined，看门狗走原来的“等你处理”，`fixupIn(undefined)` 因 `onFixer` 为空不切换——与以前完全一致（`tests/plan-fix-agent.test.ts` 的 “without a fix agent” 用例）。自动路由开着时，没设修复模型的计划会交给自动路由“疑难”列表的第一个：这是 PR #17 有意的变化，写进 PR 描述。 |
| R5 | 计划对话改用 `archAgent`，会不会被动切换已有计划 | 接受 | `homeAgentOf = archAgent ?? agent`。已有计划在升级后不会自动搬家：只在改编码/架构角色（`followHome`）或冲突解决后切回（`fixupIn(undefined)` → `homeAgent`）时才落到架构模型上。后一种是“被动”的，但它只发生在对话本来就被切到修复模型之后，切回到按新规则该在的模型上，合理。写进 PR 描述：设了架构模型的计划，计划对话改用架构模型。 |
| R6 | 看门狗升级只给一次 | 没问题 | `escalated` 存在 watch 记录里（持久），升级过一次后再停就等你处理；对话已经在修复模型上时 `escalate` 返回 undefined，也直接等你处理，不会空转。 |

要修的 R1、R2 在 BLG-131 修，测试加在 `tests/plan-fix-agent.test.ts`。
