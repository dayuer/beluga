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

## 改前改后对照（BLG-190）

量法：`git diff --numstat 4b54e83c8 <提交> -- <文件>`；“改前”是合进 #21、#22 后、动手前（`78ccc5013^`），“改后”是本分支。`node scripts/sync-upstream.mjs --report` 现在给出每个上游文件的 `+/-`、改动行和合计。

| | 改前 | 改后 |
|---|---|---|
| PR #20 涉及的 74 个上游文件里还和上游不同的 | 74 个，+529/-139 | 20 个，+266/-54 |
| 其中 PR #20 自己还有改动的 | 74 个，+220/-151 | 14 个（见下表“PR #20 剩下的”），pilot.ts 以外每个 ≤3 行 |
| 超过 3 行的 | 15 个 | 6 个（都不是 PR #20 的改动，见下） |
| fork 改到的全部上游文件（`--report`） | 152 个，1728 改动行，64 个超 3 行 | 99 个，1468 改动行，55 个超 3 行 |

还和上游不同的 20 个（加上新的接入点 `main.tsx` 和动到的 `PlanDetails.tsx`）：

| 文件 | 改前 | PR #20 自己 | 改后 | 剩下的是什么 |
|---|---|---|---|---|
| `docs/tasks-and-plans.md` | +5/-1 | +4/-4 | +1/-0 | 指向 `docs/tasks-and-plans.fork.md` 的一行 |
| `packages/mac/src/main.tsx` | 0 | — | +1/-0 | `import './fork/boot.js'`（输入法拦截） |
| `packages/mac/src/dialogs/native/WorkSheets.tsx` | +3/-0 | +3/-0 | +2/-0 | `forkSheet` 的 import 和调用 |
| `packages/mac/src/lib/sheets.ts` | +1/-0 | +1/-0 | +1/-0 | `plan_settings` 类型 |
| `packages/mac/src/plans/PlanSheets.tsx` | +20/-15 | +5/-27 | +1/-0 | 末尾导出 `AutonomyCards`、`GoalBox` |
| `packages/mac/src/plans/plans.module.css` | +29/-2 | +4/-2 | +3/-0 | 末尾三行窄屏换行（CSS module 的类名带哈希，fork 的 module 改不到） |
| `packages/mac/src/plans/plans-model.ts` | +13/-6 | +2/-1 | +13/-6 | PR #20 的 2 行（`roleNote`，计划动态里角色变化的行）；其余 11 行是 PR #22（任务需要你出手） |
| `packages/mac/src/plans/PlanPage.tsx` | +24/-7 | +3/-31 | +22/-6 | PR #20 只剩“计划设置…”一行；其余是 PR #22 的 decide。PR #20 删的 31 行是 PR #17 自己加的角色子菜单，不是上游的行：上游从来没有这些子菜单 |
| `src/core/plans/pilot.ts` | +250/-17 | +40/-14 | +191/-17 | PR #20 的 `fixing`、`fixedIn`、`agentOn` 和 PR #17 的 `toFixer`、`onFixer` 搬进 `src/fork/plans/fixer.ts`（-59 行）；剩下的是 PR #17 的建筑师（约 100 行）、角色依赖、#21 的 `followWork`，和各处一行的调用。超过 3 行的原因：建筑师和调度深度交织，本里程碑只搬不改，留作下一步 |
| `src/workspaces/git.ts`、`pr.ts`、`src/machines/ready.ts` | 各 +1/-1 | 同左 | 各 +1/-1 | git 输出固定英文，一行 |
| `tests/machines-ready.test.ts` | +2/-2 | 同左 | +2/-2 | 跟着上面的 git 语言变量，必须改 |
| `tests/sentinel-kept-data.test.ts` | +3/-1 | 同左 | +1/-1 | 固定日期过期的修复（上游一样坏，适合提回上游） |
| `packages/mac/src/plans/PlanDetails.tsx` | +18/-5 | — | +19/-5 | PR #17 的文件；`designFold` 改用 fork 的 CSS module（+1 import，改 1 行），换来 plans.module.css 少 27 行 |
| `PersonCards.tsx`、`PickMenu.tsx`、`TerminalTab.tsx`、`FilterBar.tsx` | 见左 | 各 +2/-1 输入法 | 与 PR #20 之前（`f66c38b0^1`）逐字相同 | 菜单完整显示（更早的 fork 改动，不属本计划） |
| `ProjectHome.tsx` | +7/-5 | +3/-2 输入法 | 与 `f66c38b0^1` 相同 | 自动路由（更早的 fork 改动） |
| `PlanChat.tsx`、`PlanOutline.tsx` | +12/-5、+4/-3 | 各 +2/-1 输入法 | 与 `f66c38b0^1` 相同 | PR #17 的计划分工 |

其余 54 个文件与上游逐字相同。超过 3 行的 6 个（PlanChat、PlanPage、plans-model、ProjectHome、pilot.ts，以及菜单的 PickMenu）全是 PR #20 之前或之后别的 fork 功能，PR #20 在它们里面要么已经是 0，要么 ≤2 行。

## 试合上游与审计（BLG-191）

### 试合 upstream/main

在临时工作树（`/tmp/blg191-before`、`/tmp/blg191-after`，`git worktree add --detach`，`rerere` 关掉）里各合一次 `upstream/main`（`29014be78`，fork 落后 5 个提交），合完即删。输出在 `.beluga/scratch/trial-merge-{before,after}.txt`。

| | 改前（`78ccc5013^`） | 改后（本分支） |
|---|---|---|
| 合并结果 | `Merge made by the 'ort' strategy.`，0 个冲突 | `Merge made by the 'ort' strategy.`，0 个冲突 |
| fork 改到的上游文件里，上游这 5 个提交也改了的 | 3 个：`chat/Composer.tsx`、`layout/workspace-row.tsx`、`sentinel/SentinelCards.tsx`（都是输入法那两行；这次没冲突只因为改的不是相邻行） | 0 个 |
| fork 改到的上游文件里，上游最近 300 个提交改过的 | 146 个 | 95 个 |

### 独立审计（Sonnet 子 agent，只读）

- fixer 搬运（`53a0a5932`）：纯搬运。函数体、动态文字、副作用顺序逐字相同；`this.fix` 在 `TaskWatchdog` 之前创建，`escalate` 是惰性调用；`followWork` 里改成 `this.fix.forget(channel)` 等价。
- 新建计划与 forkSheet（`84571b740`）：fork 版 `NewPlanSheet` 函数体与原来逐字相同；`forkSheet` 在 `NativeSheets` 的所有 hook 之后调用，本身不含 hook。上游的 `case 'new_plan'` 成了死分支，有意留着以便合并。
- 输入法拦截：Enter 路径全覆盖（旧的判断都在 keydown 的 Enter 上，都用 `e.key`；没有比拦截更早注册的 window 捕获监听；没有承载输入框的 iframe 或新窗口）。`.xterm` 例外成立（xterm.js 给根元素加 `xterm` 类，helper textarea 在里面）。
- 审计指出一处小回归，已修：以前有 5 处（`BoxSuggestions`、`workspace-row`、`PlanChat`、`NewTaskSheet`/`Activity` 的标签）对组字中的 Tab、方向键、Esc 也提前返回。拦截现在也挡组字中的这几个键（`IME_KEYS`），字母不挡，单字母快捷键照常；有单测。
- 记一笔的行为变化（更安全的方向，不修）：组字时的 ⌘↩ 以前会触发全局快捷键（`App.tsx` 不看输入法），现在不会；录快捷键时组字中的 Enter 也不再被录进去。

### 测试

- 单测：`tests/ime.test.ts`、`tests/ime-guard.test.ts`、`tests/plan-fix-agent.test.ts`、`tests/plans.test.ts`、`tests/plans-watchdog.test.ts`、`tests/plan-*-agent.test.ts`、`tests/plan-roles*.test.ts`、`tests/fork-plans.test.ts`、`tests/mac-plans.test.ts`、`tests/sentinel-kept-data.test.ts`、`tests/upstream-sync.test.ts`、`tests/i18n.test.ts`、`tests/boundaries.test.ts` 全过；`npm run typecheck`、`packages/mac` 的 `tsc --noEmit` 通过。
- 全量 `npx vitest run`（负载 29–46，10 核）：652 个文件里 648 过、3 个失败（7758 个用例过）。单独重跑：`tests/test-lock.test.ts` 过；`tests/machines/linux-computer.test.ts`（真的起一个无头 Beluga 配对，37 秒后 waitFor 超时）和 `tests/friend-share/handoff.test.ts`（网络交接，60 秒超时，重跑时换了一个用例超时）还是超时。两个都是 P2P/真实进程的长测试，不碰本里程碑改的任何文件。没有拿到 Tested-on，见遗留。
- e2e（`fork-ime`、`plan-chat`、`plan-settings`、`plan-roles`、`plan-roles-walk`、`plan-zh` 一起跑一次）：9 过、3 失败、4 跳过。失败的：`fork-ime` 的新建任务（用例自己漏了 `page.goto('/')`，已改）；`plan-roles`、`plan-zh` 是 “The demo daemon did not start”（负载 3.6 倍）。重跑这 3 个时 e2e 锁一直被别的工作树占着（m7-v5、BLG-159），见遗留。

### 类型声明与全量测试（BLG-193）

- BLG-190 给 `scripts/sync-upstream.mjs` 加了 `parseNumstat`、`reportLines`、`stale` 三个导出，`scripts/sync-upstream.d.mts` 没跟上，根目录 `tsc --noEmit` 在 `tests/upstream-sync.test.ts` 报 3 个 TS2305（BLG-188 时说的“typecheck 通过”是在这之前）。补了声明（`NumstatRow` 和三个函数），`.mjs` 没改；根目录 `npm run typecheck` 和 `packages/mac` 的 `tsc --noEmit` 退出码都是 0。
- 全量 `npx vitest run`（负载 20–37，10 核）：7758 过，5 个超时，都在真实 P2P/进程的长测试里：`friend-share/fork.test.ts`（2 个）、`friend-share/handoff.test.ts`、`friend-share/projects.test.ts`、`machines/linux-computer.test.ts`。单独重跑：handoff、projects 过；fork 的“someone who only follows along can’t fork”（30 秒超时）和 linux-computer（终端里的 `echo` 20 秒没回来）在负载约 30 时仍超时。同样两个文件在 `origin/main` 的临时工作树里也超时（fork.test.ts 还多 2 个），所以是机器忙，不是本分支的改动。等了 10 分钟负载仍在 20–34；之后整套又跑一次（负载约 34），11 个超时，全在 `friend-share/`（fork、handoff、projects）和 `project-invites`，其余全过。所以还没拿到 Tested-on：要在 Mac 空闲时（负载低于 10 左右）再跑整套。

### 低负载下的 e2e 与全量（BLG-194）

- 等负载：03:55 起每 30 秒查一次（`.beluga/scratch/load-wait.txt`），1 分钟 load 先在 12–420 之间，07:10 前后降到 10–17。
- e2e：07:11:47 开跑，load 19.4 / 17.0 / 33.9（1/5/15 分钟）。`npm run e2e -- e2e/fork-ime.spec.ts e2e/plan-chat.spec.ts e2e/plan-settings.spec.ts e2e/plan-roles.spec.ts e2e/plan-roles-walk.spec.ts e2e/plan-zh.spec.ts e2e/issues.spec.ts e2e/network.spec.ts`：28 过、4 跳过、0 失败，用时 2.1 分钟。跳过的 4 个是 `plan-roles-walk.spec.ts`，它只在 `WALK=1` 时跑（截图走查）。BLG-191 里没跑完的 `fork-ime`（新建任务）、`plan-roles`、`plan-zh` 这次都过了。
- 全量 `npx vitest run`，在本分支（页面写好后的 tree）上跑了两次：07:17:34（load 14.9 / 21.9 / 31.5）和 07:24:13（load 26.5 / 33.6 / 34.9）。两次都是 7762 过、1 失败、16 跳过，失败的都是 `tests/machines/linux-computer.test.ts`：起一个真实的无头 Beluga，在它的终端里打 `echo from-the-$((40+2))-box`，20 秒内没等到回显（`waitFor timed out`，`linux-computer.test.ts:158`）。
- 对照：同一时段单独跑这一个文件，本分支和 main（`307d1e1b`）都通过。07:31:03（load 38.5）在 main 的临时工作树里跑全量，结果一样：7752 过、1 失败，失败的也是 `linux-computer.test.ts` 的同一步。所以这是早就有的问题：整套并行跑时那个终端回显来得太慢，不是本分支的改动。按要求不改这个测试去迁就。
- 因此本分支还没有 Tested-on：整套没有一次全过（只差这一个）。开跑时的 load 也没能低于 10，最低是 14.9。


### 遗留

- `tests/machines/linux-computer.test.ts` 在整套里超时，main 上也一样：要先在 main 上修好（或给它留出空闲的终端），本分支才能拿到 Tested-on。
- `packages/mac/e2e/git.spec.ts:126` 在 main 上也失败，不是本里程碑的问题，这里不修。
- `pilot.ts` 里 PR #17 的建筑师（约 100 行）还在上游文件里，下一步抽到 `src/fork/plans/architect.ts`。
