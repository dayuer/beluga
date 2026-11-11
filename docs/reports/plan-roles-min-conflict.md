# 计划按角色分配：把改动收成最小冲突的形状（里程碑 6）

PR #20（`f66c38b0`）改了 74 个上游文件。本页记录逐文件的收缩方案、实验、改前改后的对照和试合上游的结果。

基线：本分支先合进了 `origin/main`（含 PR #20、#21、#22），上游基点 `4b54e83c8`（`git merge-base HEAD upstream/main`）。行数用 `git diff --numstat <上游基点> HEAD -- <文件>` 量，记作 `+增/-删`。

## 改前

- PR #20 自己在这 74 个文件里的改动：+220 / -151。
- 这 74 个文件和上游的差异（含 PR #17 等更早的 fork 改动）：在 `f66c38b0` 是 +486 / -137；合进 #21、#22 之后是 +529 / -139。

## 怎么算“改动行”

一个文件的改动行 = 增加行与删除行中较多的一边（改一行记 1，加一行 import 记 1）。“≤3 行”按这个算；`--report` 同时给出 `+/-` 原值。

## 逐文件方案（BLG-186）

| 文件 | 现在（vs 上游） | PR #20 自己 | 改后（预计） | 做法 | 风险 |
|---|---|---|---|---|---|
| 约 57 个输入框文件（`chat/`、`dialogs/`、`network/`、`sentinel/`、`tasks/`… 见 docs/fork.md 旧清单） | 各 +2/-1（少数 +3/-2、+4/-3） | 同左 | 0（与上游一致） | 撤掉 `isImeComposing` 的 import 和条件，改由 `packages/mac/src/fork/ime-guard.ts` 在 window 捕获阶段统一拦下组字中的 Enter | 漏网：拦截在 window 上，任何输入框都先经过它，不会漏；误拦：只拦 `key === 'Enter'` 且组字（`isComposing` 或 keyCode 229），终端放行 |
| `packages/mac/src/main.tsx` | 0 | — | +1 | 一行 `import './fork/boot.js'`，在其他模块注册监听之前装上拦截 | 无 |
| `chat/Composer.tsx` | +2/-2 | +2/-1 | 0 | 恢复上游自己的 `isComposing \|\| keyCode === 229` 判断（上游原样） | 无 |
| `lib/dictation.ts`（非 React 的 window 捕获监听） | +2/-1 | 同左 | 0 | 拦截先注册、用 `stopImmediatePropagation`，同在 window 捕获阶段的听写 ↩ 也收不到组字 Enter | 拦截必须先于它注册：在 main.tsx 顶部安装 |
| `components/markdown/CodeEditor.tsx`（textarea） | +2/-1 | 同左 | 0 | 是普通 textarea，由拦截统一处理，不排除 | 无 |
| 终端（xterm 的 `.xterm-helper-textarea`） | — | — | — | 排除：目标在 `.xterm` 内就放行，xterm 自己读 keyCode 229 来取输入法打出的字 | 终端里的组字 Enter 行为与上游一致 |
| `agent-term/TermPane.tsx`、`views/TerminalTab.tsx` 的查找/改名框 | +2/-1、+3/-2 | +2/-1 | 0（TerminalTab 仍有菜单省略号的 fork 改动） | 是 React 输入框，不在 `.xterm` 里，照常拦 | 无 |
| `plans/PlanChat.tsx`、`PlanOutline.tsx`、`plans-model.ts`、`dialogs/native/PersonCards.tsx`、`tasks/PickMenu.tsx`、`views/ProjectHome.tsx`、`views/overview/FilterBar.tsx` | 见下方对照 | 各 +2/-1 输入法 | 只撤输入法两行；文件仍有更早的 fork 改动（计划分工、菜单省略号、自动路由），不属于 PR #20 | 逐行撤，不 `git checkout` | 不碰其他 fork 改动 |
| `packages/mac/e2e/plan-chat.spec.ts` | +19 | +19 | 0 | 229 用例搬进新文件 `packages/mac/e2e/fork-ime.spec.ts`，并扩到主聊天框、新建任务、计划改名 | 无 |
| `src/core/plans/pilot.ts` | +250/-17 | +40/-14 | PR #20 部分 → 0；整体预计约 +200/-17 | `fixing`、`fixedIn`、`agentOn`，连同 PR #17 的 `onFixer`、`toFixer`、`fixupIn`、`escalate`、`agentKey`，原样搬到 `src/fork/plans/fixer.ts`（一个 `PlanFixer` 类，构造时传 deps 和 plans）；pilot.ts 留一个字段和调用。建筑师（architect）那块 ~100 行是 PR #17 的，本里程碑不动 | 纯搬运；`tests/plan-fix-agent.test.ts` 守行为，不改断言 |
| `packages/mac/src/plans/PlanPage.tsx` | +24/-7 | +3/-31（删的是 PR #17 自己加的角色子菜单，不是上游行） | PR #20 部分 +1（“计划设置…”菜单项）；其余是 PR #22 的 decide | 撤输入法；角色子菜单已不在（与上游一致）；菜单项保持一行 | 无 |
| `packages/mac/src/plans/PlanSheets.tsx` | +20/-15 | +5/-27 | +1 | fork 版 `NewPlanSheet`（角色选择）整个搬到 `packages/mac/src/fork/plans/NewPlanSheet.tsx`；PlanSheets.tsx 恢复上游，只在文件末尾加 `export { AutonomyCards, GoalBox }` 给 fork 用 | 上游以后改 NewPlanSheet 不会自动进 fork 版：docs/fork.md 记下，同步时对照 |
| `packages/mac/src/dialogs/native/WorkSheets.tsx` | +3 | +3 | +2 | 一个 `forkSheet(sheet, close)` 钩子（`packages/mac/src/fork/sheets.tsx`）接管 `new_plan` 和 `plan_settings`，原 switch 不动 | 钩子必须在所有 hook 之后、switch 之前（就在 `const close` 下面） |
| `packages/mac/src/lib/sheets.ts` | +1 | +1 | +1 | 保留（类型联合只能在原处加） | 无 |
| `packages/mac/src/plans/plans.module.css` | +29/-2 | +4/-2 | 窄屏换行 +3（文件末尾追加，不改上游行）；`designFold` → fork 自己的 CSS module | CSS module 的类名带哈希，fork 的 module 改不到 `.pageHead`，只能在原文件里覆盖；放在末尾不碰上游行 | 上游也往末尾加时会冲突，冲突也只有这三行 |
| `docs/tasks-and-plans.md` | +5/-1 | +4/-4（改的是 PR #17 加的段落） | +1 | fork 的段落搬到 `docs/tasks-and-plans.fork.md`，原文恢复上游，只留一行指过去 | 无 |
| `src/workspaces/git.ts`、`pr.ts`、`src/machines/ready.ts` | 各 +1/-1 | 同左 | 不变（各 1 行） | 保留 | 无 |
| `tests/machines-ready.test.ts` | +2/-2 | 同左 | 不变（2 行） | 跟着 git 语言变量，必须留 | 无 |
| `tests/mac-plans.test.ts` | +6 | +6 | 0 | 用例搬进 `tests/fork-plans.test.ts` | 无 |
| `tests/sentinel-kept-data.test.ts` | +3/-1 | +3/-1 | +1/-1 | 必须留：上游的固定日期过了 14 天保留期就失败（上游一样坏，适合提回上游）；去掉注释行，只改一行 | 无 |

预计改后：PR #20 自己在上游文件里的改动只剩 13 个文件（main.tsx、sheets.ts、WorkSheets.tsx、PlanPage.tsx、PlanSheets.tsx、plans.module.css、docs/tasks-and-plans.md、git.ts、pr.ts、ready.ts、machines-ready.test.ts、sentinel-kept-data.test.ts、pilot.ts 的调用），pilot.ts 以外每个 ≤3 行。

## 输入法集中拦截的实验（BLG-186）

e2e 锁当时被另一个工作树的整套 e2e 占着（`waiting for m7-v5's e2e`，等了 10 分钟），所以先用真实的 React 19.3.1 + Chromium 做了一个独立实验（`.beluga/scratch/ime-exp/`）：esbuild 打包 `fork/ime-guard.ts` 和一个有 `onKeyDown`、`onKeyDownCapture` 的 React 页面，再加一个后注册的 window 捕获监听（模拟听写），用 Playwright 派发 keydown。

| 情形 | 到达的监听 | defaultPrevented |
|---|---|---|
| textarea，Enter，keyCode 229（WebKit 选词） | 无 | false |
| textarea，Enter，isComposing | 无 | false |
| textarea，普通 Enter | window 监听、React onKeyDown | false |
| input 的 React 捕获处理（onKeyDownCapture），keyCode 229 | 无 | false |
| input，普通 Enter | window 监听、React 捕获 | false |
| `.xterm` 里的 textarea，keyCode 229 | window 监听、React onKeyDown（放行） | false |
| 真实键入“你好” | 文字进框 | — |

结论：window 捕获先于 React 19 挂在 root 上的监听（冒泡和捕获都是），`stopImmediatePropagation` 也挡住同在 window 捕获阶段、后注册的监听；从不 preventDefault，上屏不受影响；终端按规则放行。应用里的 e2e 在 BLG-187 的 `fork-ime.spec.ts` 里跑。
