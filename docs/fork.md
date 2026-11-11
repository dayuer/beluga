# 这个 fork 怎么和上游一起走

`dayuer/beluga` 是 `beluga-labs/beluga`（上游）的 fork。目标：随时能合进上游的更新，同时保留自己的功能，合并时只在少数几个已知的地方冲突。

## 原则：加自己的文件，不改上游的文件

合并时只有一种地方会冲突：**上游和这个 fork 改了同一个文件的相邻几行**。fork 自己新建的文件，上游不会去碰，所以永远不冲突。因此：

1. **新功能放进新文件。** 上游文件里只留一行接入点（一次调用、一次展开、一个 import）。上游以后改这个文件，基本碰不到这一行。
2. **登记表不在原表里加条目。** fork 的条目写在 fork 自己的文件里，原表用一行展开进去：
   - API 方法归类（`src/companion/coverage.ts`、`src/external/coverage.ts`、`src/machines/coverage.ts`）→ `src/fork/coverage.ts`
   - 设置搜索索引（`packages/mac/src/dialogs/settings-index.ts`）→ `packages/mac/src/fork/settings-index.ts`，每块写明“排在上游哪个分组后面”
   - 中文翻译（`zh-CN.json`）→ `packages/mac/src/i18n/zh-CN.fork.json`，网页（`packages/mac/src/i18n/index.ts`）和菜单栏（`packages/mac/src-tauri/src/i18n.rs`）加载时合并，fork 的词条优先
   - parity 表（`docs/parity.md`）→ `docs/parity.fork.md`，`tests/parity.test.ts` 读完上游的表接着读这个
3. **首页说明：** 根目录的 `README.md` 保持上游原样。fork 的中文首页在 `.github/README.md`，GitHub 会优先显示它；英文版是 `README.en.md`。
4. **通用的修复提回上游。** 对所有人都有用的改动（测试修复、界面小问题）给上游提 PR。上游合并之后，这个差异就消失了。
5. **改上游文件之前先问自己**：能不能放进新文件？不能的话，就在下面的清单里写一行原因。

### min-conflict 的四条规矩（里程碑 6，见 `docs/reports/plan-roles-min-conflict.md`）

1. **每个上游文件最多 3 行。** 只放接入点：一个 import、一次调用、一个展开或一个导出。改动行 = 增加行与删除行里较多的一边，`--report` 会列出每个文件的行数和超过 3 行的个数。
2. **一处集中，不处处改。** 同一种判断要加进很多文件时，在一个公共入口拦下（例：输入法组字时的 Enter 由 `packages/mac/src/fork/ime-guard.ts` 在 window 捕获阶段统一拦，各输入框不动）。
3. **不删上游代码行。** 要换掉上游的一个组件，就在 `fork/` 里放自己的版本，用钩子打开它，上游的版本原样留着（例：`packages/mac/src/fork/sheets.tsx` 的 `forkSheet` 先于上游的 switch 接管“新建计划”和“计划设置”）。上游以后改了被替换的组件，同步时要把改动带进 fork 的版本。
4. **不往上游测试文件里加用例。** fork 的用例放 fork 自己的文件：`tests/fork-*.test.ts`、`packages/mac/e2e/fork-*.spec.ts`。上游测试只在上游自己也坏了的时候改（并提回上游）。

## 同步上游

```bash
node scripts/sync-upstream.mjs
```

这个脚本会：

- 打开 `git rerere`：同一处冲突解决过一次，以后会自动按同样的方式解决。
- 拉取上游，从当前分支切出 `sync/upstream-<版本>-<日期>`，用 merge 合进 `upstream/main`。不用 rebase，因为 main 已经公开。
- 自动处理版本号：`packages/mac/package.json` 和 `packages/mac/src-tauri/tauri.conf.json` 如果冲突，并且 fork 在这两个文件里只改了版本号，就取两边中较高的版本。
- 列出还没解决的冲突，以及下面这份“改了上游的文件”清单。没写原因的文件会标 `!`。

解决完冲突后：`git add`、`git commit --no-edit`，跑 `npm run typecheck` 和 `npx vitest run`，然后从同步分支向 main 开 PR。

只想看差异：

```bash
node scripts/sync-upstream.mjs --report
```

**同步节奏：上游每发一个版本就同步一次。** 攒的提交越少，冲突越小。

## 改了上游的文件（touch points）

下面每个文件都可能在同步时冲突。目标是让这份清单越来越短：第二阶段会把大块改动抽成 fork 文件，再只留一行接入点。

### 只有一行接入点（已隔离，几乎不会冲突）

- `src/companion/coverage.ts`、`src/external/coverage.ts`、`src/machines/coverage.ts`：展开 `src/fork/coverage.ts`
- `packages/mac/src/dialogs/settings-index.ts`：外面包一层 `withForkSettings`
- `packages/mac/src/i18n/index.ts`、`packages/mac/src-tauri/src/i18n.rs`、`scripts/i18n-extract.mjs`、`tests/i18n.test.ts`：同时读 `zh-CN.fork.json`
- `tests/parity.test.ts`：同时读 `docs/parity.fork.md`
- `packages/mac/src/main.tsx`：一行 `import './fork/boot.js'`（fork 随页面启动的东西，现在是输入法拦截）
- `packages/mac/src/dialogs/native/WorkSheets.tsx`：两行，`forkSheet`（`packages/mac/src/fork/sheets.tsx`）先接管 fork 的对话框（新建计划、计划设置）
- `packages/mac/src/plans/PlanSheets.tsx`：末尾一行导出 `AutonomyCards`、`GoalBox`，给 fork 的 `packages/mac/src/fork/plans/NewPlanSheet.tsx` 用（上游的 `NewPlanSheet` 原样留着；上游改它时，把改动带进 fork 版）
- `packages/mac/src/lib/sheets.ts`：一行，`plan_settings` 对话框的类型（联合类型只能在原处加）
- `docs/tasks-and-plans.md`：一行，指向 `docs/tasks-and-plans.fork.md`（fork 的计划说明都在那里）

### 版本号（脚本自动处理）

- `packages/mac/package.json`、`packages/mac/src-tauri/tauri.conf.json`

### 计划按档位分工（架构 / 编码 / 审核 / 疑难修复）：第二阶段要抽出来

已抽出来的：疑难修复的切换（`src/fork/plans/fixer.ts`，`pilot.ts` 只留调用）、新建计划的角色选择（`packages/mac/src/fork/plans/NewPlanSheet.tsx`）、设计稿折叠的样式（`packages/mac/src/fork/plans/plans-fork.module.css`）、计划说明（`docs/tasks-and-plans.fork.md`）、测试（`tests/fork-plans.test.ts`）。下面的还在上游文件里，下一步先抽 `pilot.ts` 里的建筑师（architect）那块。

- 核心：`src/core/plans/pilot.ts`、`src/core/plans/work.ts`、`src/core/plans/plans.ts`、`src/core/plans/prompt.ts`、`src/core/plans/model.ts`、`src/core/plans/watchdog.ts`、`src/core/plans/progress.ts`、`src/core/plans/owner.ts`、`src/core/plans/move.ts`、`src/core/plans/move-work.ts`、`src/core/notify.ts`、`src/core/board/launch.ts`
- Agent：`src/agent/plan-tools.ts`、`src/agent/policy.ts`、`src/agent/types.ts`
- API：`src/ipc/plans-api.ts`、`src/ipc/plans-handlers.ts`、`src/external/domain/tools.ts`、`src/external/adapters/tools/state-rows.ts`
- 手机：`src/companion/protocol.ts`、`src/companion/views.ts`、`src/companion/calls.ts`、`packages/companion/app/plan/[id].tsx`、`packages/companion/lib/link/calls.ts`、`packages/companion/components/AgentPicker.tsx`
- Mac：`packages/mac/src/plans/PlanPage.tsx`（••• 里“计划设置…”一行，其余是“任务需要你出手”的 decide）、`packages/mac/src/plans/PlanChat.tsx`、`packages/mac/src/plans/PlanDetails.tsx`、`packages/mac/src/plans/PlanOutline.tsx`、`packages/mac/src/plans/plan-ask-model.ts`、`packages/mac/src/plans/plans-model.ts`、`packages/mac/src/plans/plans.module.css`（末尾三行：窄屏时操作换到名字下面；CSS module 的类名带哈希，fork 自己的 module 改不到 `.pageHead`）
- 测试：`tests/plans.test.ts`、`tests/agent-change.test.ts`

### 自动路由（没指定 agent 的任务交给合适的模型）

- `src/core/board/work.ts`、`src/core/store.ts`、`src/shared/settings-schema.ts`、`src/ipc/api.ts`、`src/machines/sync.ts`
- `packages/mac/src/tasks/use-task-start.ts`、`packages/mac/src/tasks/parts.tsx`、`packages/mac/src/views/ProjectHome.tsx`、`packages/companion/app/task/[id].tsx`

### 客户邀请与客户端（BLG-14 至 BLG-17、BLG-34、BLG-36）

- `src/companion/pair.ts`、`src/companion/devices.ts`、`src/companion/host.ts`、`src/ipc/companion-api.ts`、`src/ipc/companion-handlers.ts`
- `packages/mac/src/phone/Phone.tsx`、`packages/mac/src/phone/phone-model.ts`
- `packages/companion/app/_layout.tsx`、`packages/companion/app/(tabs)/_layout.tsx`、`packages/companion/app/index.tsx`、`packages/companion/lib/store.ts`
- `tests/companion-coverage.test.ts`、`tests/companion-views.test.ts`、`tests/mac-settings-search.test.ts`

### 菜单完整显示、中文不带结尾的“…”

- `packages/mac/src/components/SpecMenu.tsx`、`packages/mac/src/components/SpecMenu.module.css`、`packages/mac/src/chat/RunsOn.tsx`、`packages/mac/src/dialogs/native/PersonCards.tsx`、`packages/mac/src/dialogs/native/PersonMenu.tsx`、`packages/mac/src/tasks/PickMenu.tsx`、`packages/mac/src/views/TerminalTab.tsx`、`packages/mac/src/views/overview/FilterBar.tsx`

### git 输出固定用英文（BLG-133：留在 fork，不提回上游）

原因：中文系统下 git 的提示是中文，Beluga 按英文原话判断 git 的结果（冲突、没有改动、分支不存在等）会判断错，全量测试也因此拿不到 Tested-on（见 `docs/reports/plan-roles-git-locale.md`）。每处只加一行 `LC_MESSAGES=C LANGUAGE=C`。

- `src/workspaces/git.ts`、`src/workspaces/pr.ts`、`src/machines/ready.ts`、`tests/machines-ready.test.ts`

### 中文输入法组字时 Enter 只选词（BLG-133：留在 fork，不提回上游）

原因：Mac 应用的 WebKit 里用输入法组字时，按 Enter 选词也会触发 keydown（keyCode 229，`isComposing` 已是 false），输入框把它当成发送或提交（见 `docs/reports/plan-roles-ime.md`）。判断在 fork 自己的 `packages/mac/src/lib/ime.ts`（`isImeComposing`），只有一处用它：`packages/mac/src/fork/ime-guard.ts` 在 window 的捕获阶段拦下组字中的 Enter（`stopImmediatePropagation`，从不 `preventDefault`，否则会吃掉上屏的字），终端（`.xterm` 里）放行。各输入框与上游一致。测试：`tests/ime.test.ts`、`tests/ime-guard.test.ts`、`packages/mac/e2e/fork-ime.spec.ts`。

- 上游文件只有 `packages/mac/src/main.tsx` 一行（见上面“只有一行接入点”）。

以前（PR #20）每个输入框各改两行，共 60 个文件；已全部恢复上游原样（逐文件列表见 `docs/reports/plan-roles-min-conflict.md`）。

### 适合提回上游的通用修复

- 设置窗口标题和搜索框固定、只有列表滚动：`packages/mac/src/dialogs/Settings.tsx`、`packages/mac/src/dialogs/settings.module.css`
- 路径上不存在的图片显示为“缺失”：`packages/mac/src/chat/images.ts`、`src/agent/prompt.ts`、`src/agent/run-instructions.ts`、`tests/mac-chat-images-cache.test.ts`
- 本地模型在自己的文件夹里运行 Claude Code：`src/agent/runtime/local.ts`、`tests/local-endpoints.test.ts`
- `/` 列表跟随链接的技能和命令：`src/core/claude-code/skills.ts`、`tests/skills.test.ts`
- 哨兵保留数据的测试不再用固定日期（过了 14 天保留期就失败，上游也一样；只改一行）：`tests/sentinel-kept-data.test.ts`
- 任务需要你出手时用卡片提问，停下时显示它最后说的话：`src/core/plans/prompt.ts`、`src/core/plans/watchdog.ts`、`src/core/plans/model.ts`、`src/core/notify.ts`、`src/companion/needs-you.ts`、`packages/mac/src/plans/plans-model.ts`、`tests/plans-watchdog.test.ts`、`tests/notify.test.ts`、`tests/plan-milestone-agent.test.ts`
