# 交接：新建计划按角色分配模型

日期：2026-11-11 · 分支：`main`（改动未提交）

## 要做的事

用户要求：新建计划对话框的“更多选项 › 智能体”遵循这条规则——

> 高级模型做架构，普通模型堆代码，中级模型做审计，疑难问题高级模型做修复。

和用户确认过的两点：

- **“疑难问题”包括三种**：里程碑检查没过后的修复任务、合并冲突、卡住两次的任务。
- **三档默认模型**：高级 = Opus，中级 = Sonnet（新增的一档），普通 = 现有便宜档（GLM → DeepSeek → Haiku）。

## 现状：做完了什么

### 1. 自动路由加了第三档（`src/shared/auto-route.ts`）

- 新增 `REVIEW_DEFAULT = ['local:anthropic/claude-sonnet-5-5', 'claude:sonnet']`，`AutoRoute.review` 可在设置里改。
- 新类型 `RouteList = AutoTier | 'review'`，`tierList` 支持三档。`AutoTier`（任务用的两档）没动。
- `autoChecker` 从 `hard` 档改成 `review` 档：**没指定审计模型的计划，审计从 Opus 变成 Sonnet**。这是对已有行为的改变。
- 新增 `autoFixer`（`hard` 档）和 `planRoleDefaults(route, runtimes)`。后者给出四个角色的推荐，不管自动路由开没开都按档位算。编码在自动路由开着时返回 `'auto'`，意思是交给每个任务自己去路由。
- `firstRunning` 改成导出。

### 2. 计划多了“疑难修复”角色（`src/core/plans/`）

- `model.ts`：`Plan.fixAgent`；`TaskWatch.escalated`；`homeAgentOf(plan) = archAgent ?? agent`。
- `plans.ts`：`setFixAgent`；`create` 一次接受四个角色（新的 `PlanRoles` 接口），持久化 schema 加了 `fixAgent`。
- `work.ts`：
  - `create` 接受四个角色。计划自己的对话**改为用架构模型**（拆里程碑也算架构），没设架构才用编码模型。
  - `setWorkAgent` / `setArchAgent` 都通过 `followHome` 让计划对话跟着 `homeAgentOf` 走。
  - 新增 `setFixAgent`。给 pilot 注入 `fixer`（`plan.fixAgent ?? autoFixer`）、`homeAgent`、`switchAgent`（即 `followAgent`，安静切换）。
- `pilot.ts`：
  - `toFixer(plan, channel, what)`：把某个对话切到疑难修复模型。每个对话只切一次（内存里的 `onFixer` 表，重启后会清空，再切一次也没影响），并在计划动态里记一笔。
  - **修复任务**：`hand()` 发现里程碑检查结果是 `fail` 时，先切工作树再交任务。`launch()` 和 `start()`（每个任务一个工作树的模式）在检查失败时直接用疑难修复模型开新工作树。
  - **合并冲突**：所有 `allowFixup(plan.home, …)` 都换成了 `fixupIn(plan, dir)`。有 `dir` 时把计划对话切到疑难修复模型；冲突消失（`dir` 为 undefined）时切回 `homeAgent`。
  - **卡住两次**：给看门狗注入 `escalate`。
- `watchdog.ts`：第二次卡住（30 分钟内）时，如果还没升级过，先 `escalate` 再唤醒一次，并标记 `escalated: true`；第三次才 `needsYou`。没有疑难修复模型（没设、自动路由也关着）时，行为和以前完全一样。

### 3. API 与各端覆盖

- `src/ipc/plans-api.ts`：`plans.create` 多了 `checkAgent` / `archAgent` / `fixAgent` 三个可选字段；新增 `plans.setFixAgent`。
- 对应更新：`plans-handlers.ts`，以及 `companion/coverage.ts`、`machines/coverage.ts`、`external/coverage.ts` 三份覆盖表；外部工具 `plan_set_fix_agent` 加在 `external/adapters/tools/state-rows.ts` 和 `external/domain/tools.ts`。
- 手机协议升到 **1.54**（只增不改），`SINCE.fixAgent = 54`，`PlanView.fixAgent`，`views.ts` / `calls.ts` 同步。

### 4. 界面

- **Mac 新建计划**（`packages/mac/src/plans/PlanSheets.tsx`，纯逻辑在 `plan-roles-model.ts`）：“更多选项”里有四个下拉框：架构 / 编码 / 审计 / 疑难修复。
  - 每个默认选“按档位”那一项，文字如“高级：Claude (Opus)”。
  - 其后是“以前的做法”（不设架构 / 你的智能体 / 与编码相同 / 由当前在做的智能体处理），再往后是所有智能体。
  - 下面一行说明这条规则。
- **Mac 计划页** ••• 菜单：新增“疑难修复智能体 ▸”（`PlanPage.tsx`）。
- **Mac 设置 › 自动路由**：新增“审计”这一组候选列表（`AutoRouteSettings.tsx`）。
- **中文词表**（`packages/mac/src/i18n/zh-CN.json`）：新增 20 条。“Code”“Checks”早已分别译成“代码”“检查”，所以角色名用的是 `Coding` / `Audit`，对应“编码”“审计”。
- **手机计划页** ⋯ 菜单：新增“Agent for hard fixes”（`packages/companion/app/plan/[id].tsx`、`lib/link/calls.ts`），通过 `store.supports('fixAgent')` 判断显示与否。

### 5. 文档与测试

- 文档：`docs/parity.md` 更新 `plans.create` 行、新增 `plans.setFixAgent` 行；`docs/tasks-and-plans.md` 加了“按档位分配角色”和“疑难问题交给修复模型”两段。
- 新测试：
  - `tests/plan-fix-agent.test.ts`（7 个）：设置与持久化、创建时带四个角色、修复任务切换（以及没有修复模型时不切）、冲突切过去再切回、卡住两次升级、API 和各端覆盖。
  - `tests/plan-roles.test.ts`（4 个）：对话框的取值逻辑。
- 改过的测试：`tests/auto-route-plans.test.ts`（审计改为 Sonnet，新增 `autoFixer` 和 `planRoleDefaults` 的用例）。

## 验证情况

| 检查 | 结果 |
|---|---|
| `npm run typecheck`（根目录） | ✅ 通过 |
| `packages/mac` 的 `tsc --noEmit` | ✅ 通过 |
| `packages/companion` 的 `npm run typecheck` | ⚠️ 没跑成：本机 `node_modules` 缺 `expo` 等依赖，整个包都报找不到模块，和这次改动无关 |
| 相关测试（`plan-*`、`auto-route*`、`companion-*`、`parity`、`i18n`、`boundaries`、`browser-safe`） | ✅ 全过 |
| 全量 `npx vitest run` | ⚠️ 7557 过 / 3 败。失败的是 `tests/main-sync.test.ts`（2 个）和 `tests/plan-branch.test.ts`（1 个），都和 git 有关。暂存掉本次改动后在干净的 main 上**同样失败**，是本机 git 环境的老问题，所以也没有生成 `Tested-on` 行 |
| Mac 界面实际打开看 | ❌ 没做 |
| 手机端实机 | ❌ 没做 |

## 接手后要做的

1. **在 Mac 应用里打开“新建计划 › 更多选项”**，看四个下拉框的默认值、中文文案和窄宽度下的排版。
2. **装好手机端依赖后跑 `packages/companion` 的类型检查**，重点看 `app/plan/[id].tsx`。
3. **查 3 个 git 测试为什么在本机失败**（和本次无关，但不修就拿不到 `Tested-on` 行）。全量通过后，按 CLAUDE.md 把 `Tested-on: macOS <tree>` 放进提交信息。
4. 提交：本次的改动文件见 `git status`。**不要带上** `.DS_Store`、`packages/.DS_Store`、`docs/reports/studio-design-audit-opus.md`，这些不是本次的。

## 需要知道的取舍和风险

- **审计默认模型变了**：没单独设审计模型的计划，在自动路由开着时由 Sonnet 审计（以前是 Opus）。想换回去，在“设置 › 自动路由 › 审计”里把 Opus 放到第一位。
- **计划对话改用架构模型**：设了 `archAgent` 的计划，计划对话会切到架构模型（以前一直跟编码模型）。会影响已有计划吗？只在下一次 `setWorkAgent` / `setArchAgent` 时才切，已有计划不会被动切换。
- **新建对话框在自动路由关着时也按档位推荐**：例如只有 Claude 订阅时，编码默认是 Haiku、架构是 Opus（还会顺带开启“架构师”步骤）。这是按用户规则有意这么做的；不想要的话，在下拉框里选“以前的做法”。
- **升级是整个工作树一起换**：一个里程碑共用一个工作树，修复任务或卡住升级会把整个工作树切到高级模型，这个里程碑剩下的任务也都由它来做。
- **冲突切回的时机**：计划对话在冲突消失时才切回。如果同时有两个冲突，先解决的那个会把对话切回去；另一个冲突下一次再请求修复时会重新切过去。正确性没问题，只是可能多切一次。
- **`onFixer` 只在内存里**：守护进程重启后会清空，同一个对话可能再切一次（切到同一个模型，没有副作用），计划动态里会多一行。
- **手机端没有新建计划的角色选择**：手机的“问 › 计划”仍然只传 `agent`。其余角色不设：疑难修复在用到时由自动路由兜底（Opus）；审计在手机选了智能体时就用那个智能体，没选时由自动路由兜底（Sonnet）；架构不设，所以没有架构师步骤。
