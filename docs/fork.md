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

脚本按五步走：

1. **合并前先看风险。** 打开 `git rerere`（同一处冲突解决过一次，以后自动按同样方式解决），拉取上游，先打印「合并时检查 (check while merging)」：这个 fork 改过、这次上游也改了的文件。标 `⚠ 沉稳界面` 的，是下面「沉稳界面」与「M3 逐页补改」两节登记过的接入点——它们最可能冲突，也最可能在自动合并后悄悄失效。然后从当前分支切出 `sync/upstream-<版本>-<日期>`，用 merge 合进 `upstream/main`。不用 rebase，因为 main 已经公开。
2. **版本号自动处理。** `packages/mac/package.json` 和 `packages/mac/src-tauri/tauri.conf.json` 如果冲突，并且 fork 在这两个文件里只改了版本号，就取两边中较高的版本。
3. **合并后自动跑沉稳检查。** 干净合并时脚本自己接着跑；有冲突时，解完 `git add`、`git commit --no-edit` 之后手动跑同一条命令：

   ```bash
   node scripts/sync-upstream.mjs --after-merge
   ```

   它做三件事：① 跑 `tests/fork-calm.test.ts`，`NEW` 段就是上游新增的动效；退出码非 0 说明某个接入点被搬走或删掉了（按 `TOUCHPOINTS` 的 `why` 重接）。② 扫描 `fork/calm/*.css` 的定点规则，列出已经失效的类名、data 属性与 aria 字面量。③ 提示重跑 calm-check。结果以 `## 沉稳检查（sync 自动附加）` 追加进合并提交的说明；说明里已有这一段就不再追加。`--after-merge` 可以重复跑，用 `git commit --amend -F -` 核对。
4. **逐条处置三段输出。** 新增动效 → 补一条覆盖层规则（`fork/calm/*.css`）或记为例外；失效选择器 → 改覆盖层的锚点；接入点断裂 → 按 `TOUCHPOINTS` 的 `why` 重接。快照只在逐条裁决之后更新：`CALM_UPDATE=1 npx vitest run tests/fork-calm.test.ts`。
5. **重跑 calm-check 主场景再开 PR。** 沉稳开与 reduced-motion 各走一遍：

   ```bash
   npm run dev
   cd packages/mac && npm run dev
   node packages/mac/scripts/calm-check.mjs room chatrun chatsteps tasks sentinel usage onboarding call
   ```

   然后跑 `npm run typecheck` 和 `npx vitest run`，从同步分支向 main 开 PR。

只想看不想合并：

```bash
node scripts/sync-upstream.mjs --report
```

打印同样的三段：合并时检查、fork-calm 的新增/消失动效、失效的覆盖层规则；再加下面这份「改了上游的文件」清单。没写原因的文件标 `!`（退出码 1）。

演练时用 `--remote` / `--ref` 指向一个本地镜像，真实的上游 remote 全程不动：

```bash
node scripts/sync-upstream.mjs --remote calm-rehearsal --ref main
```

自动追加提交说明有护栏：只改 HEAD 是双亲合并提交、标题以 `Merge upstream` 开头、且说明里还没有标记行的那一条；人写的说明不会被覆盖。

已知限度：类名失效检测按「这个名字还出现在任何上游 CSS 里吗」判定，抓的是整体改名或消失；同一个类名碰巧在别的模块里出现会被判为仍在。所以它只报告、不卡退出码，在同步 PR 里逐条裁决。

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

### 沉稳界面（docs/calm-ui.md）

界面气质（布局稳定、动效克制、状态安静、反馈分级、一致可预期、逐页验收）由 `packages/mac/src/fork/calm/` 的覆盖层实现，规则只在 `:root[data-calm]` 下生效。上游文件只留这几处接入点：

- `packages/mac/src/main.tsx`：在 `tokens.css`、`base.css` 之后加一行 `import './fork/calm/index.js'`；它在首帧前设置 `data-calm`，并引入 `fork/calm/calm.css`。
- `packages/mac/src/dialogs/Settings.tsx`：Appearance 的 Layout 组、Reduce motion 行后加一行 `<CalmRow />`；开关本体在 `packages/mac/src/fork/calm/settings.tsx`。
- `tests/mac-settings-search.test.ts`：appearance 的 `PANE_SOURCES` 加 `read('fork/calm/settings.tsx')`，让「索引的标签必须在面板源码里」这条校验读得到 fork 自己的行。
- `packages/mac/src/layout/Sidebar.tsx`：一行 `useSidebarHold(drop.ref)`——「指针/焦点/拖拽是否在侧栏上」只有 nav 自己知道，探针逻辑在 `fork/calm/hold-order.ts`。操作侧栏时不重排、离开 600ms 后换上新顺序（`docs/calm/hooks.md` §1）。
- `packages/mac/src/layout/EntryRow.tsx`：`useEntryList` 的返回值经过 `useHeldEntries`——Unread 与 Categories 两种侧栏模式都从这里拿排序结果，改这一处覆盖两种；冻结的取舍与实现见 `docs/calm/hooks.md` §1。M3 起只冻结顺序、内容取最新（「需要你」标记在操作期间也能到达），新增行等释放后出现（`docs/calm/overlay.md` §12 · SH-08）。
- `packages/mac/src/chat/ChatLog.tsx`：回到底部按钮的 children 换成 `fork/calm/new-below.tsx` 的 `<JumpLabel rows={rows.length} />`——上游不提供「下面来了几条」，计数要跨渲染保存，只能做成组件；按钮本体、`stick` 滚动逻辑一行未动（`docs/calm/hooks.md` §2）。
- `packages/mac/src/App.tsx`：`Toasts` 里加 `useOneToast('global', toast?.id)`，被后到的 toast 压制时不渲染，外层加 `data-one-toast="global"`——全局 toast 的渲染和 store 定时器都在这里（`docs/calm/hooks.md` §3）。
- `packages/mac/src/lib/undo-toast.tsx`：`UndoToast` 里加 `useOneToast('undo', toast?.id)`，被压制时不渲染、不响应 ⌘Z（定时器照旧收尾），外层加 `data-one-toast="undo"`——撤销 toast 是模块级状态，两套必须在同一个判据下；样式在 `fork/calm/one-toast.css`（`docs/calm/hooks.md` §3）。
- `packages/mac/src/lib/live-motion.ts`：`tick`/`wake`/`watch`/`joinLive` 里加 `calmLive` 门（同一文件 5 行）——时钟的 `seen`/`marks` 是模块私有的，外部拿不到，无法在 fork 文件里过滤；沉稳模式下只放行 `[data-current]` 里的标记，其余停在静止帧（`docs/calm/hooks.md` §4）。
- `packages/mac/src/components/Lifted.tsx`：`useLean` 与 `Lifted` 的 `reduce` 判据加 `useCalm()`（M5 · 同步 3.3.0）。上游把任务板卡片和侧栏对话行的「拖起」抽成这个文件后，只看 `useReducedMotion`——原来 `TaskBoard` 的 `reduce` 含沉稳，这次重构丢了，沉稳开时拖起的东西会弹簧倾斜并放大到 `LIFT_SCALE` 1.035。沉稳时 `lean` 恒为 0、`scale` 恒为 1、不挂 spring；沉稳关与上游逐行一致。
- `packages/mac/src/network/StatusMenu.tsx`：`StatusPanel` 读 `useCalm()`，沉稳开时把状态行右侧的说明（「Silences notifications」等）放进 `title`，说明由 `fork/calm/calm-status.css` 隐藏，行才等高；沉稳关时 `title` 为 `undefined`，与上游逐行一致。菜单的头部、宽度、圆点、行高、备注输入框全在 `calm-status.css`（BLG-216）。
- `packages/mac/src/i18n/zh-CN.fork.json`：fork 自己的 `{0} new` 词条；上游文件不碰。

### M3 逐页补改（docs/calm/overlay.md §12；每处一行接入点）

逐页验收（BLG-170–172）后，覆盖层管不到的行为动效改成接入点；全部是「沉稳开时才改变」，关掉开关与上游一致。每个文件都在 `tests/fork-calm.test.ts` 的 `TOUCHPOINTS` 有 canary（标 ✓）。

- `packages/mac/src/chat/steps/AgentSteps.tsx` ✓：`useStill()` 读 `useCalm()`，沉稳时步骤行的 framer 进场/退场为 0 时长（CH-02）。
- `packages/mac/src/chat/flight.ts` ✓：`land()`/`launchFlight()` 在沉稳时走「瞬时」分支，消息不再从输入框飞入（CH-06）。
- `packages/mac/src/tasks/TaskBoard.tsx` ✓：`reduce` 判据加 `calmOn()`，沉稳时卡片重排/落位不做 framer layout 动画（WK-01）；`Fold` 的 layout effect 在展开时也调 `onMove()`（BLG-208）——立即展开没有动画帧，拖拽的「展开后重读列位置」窗口（`foldMoved`）开不起来，`tasks.spec.ts:495` 的 Ready 列放置间隙在沉稳开时不出现。
- `packages/mac/src/sentinel/DashboardPage.tsx` ✓：`still()` 加 `calmOn()`，沉稳时仪表盘瓦片不做 220/260ms 的 glide（DA-02）。
- `packages/mac/src/onboarding/onboarding.module.css`：`@media (prefers-reduced-motion: reduce)` 停掉 `heroSoft` 的 sheen 与 `beam`（RE-01，上游缺口；沉稳模式 M5 已停）。
- `packages/mac/src/call/NotesBox.tsx`：跳到一条发言的高亮 900ms → 160ms，Reduce motion 下不做（overlay §8.1 遗留）。
- `packages/mac/src/call/PointerMark.tsx` ✓：点击指针标记的 1.16 弹跳在沉稳模式下不做（`calmOn()` 加进 `paintTag` 的守卫；reduced-motion 上游本来就停）。上游 3.2.0 新增，M4 同步跟进（`docs/calm/overlay.md` §12.2）。
- `packages/mac/e2e/unread.spec.ts`：未读断言从 `font-weight:650` 改为 400 + 计数徽标（沉稳 S2 的配套；fork-only 测试改动，见 `docs/calm/overlay.md` §12）；运行中出现的 Unread 行按 SH-08 等指针离开侧栏后再断言（先 `mouse.move` 出侧栏）。
- `packages/mac/e2e/cool-window.spec.ts`：KLD-40 的“Working 光带走动”用例以沉稳关运行（`beluga.fork.calm.v1 = { calm: false }`）；沉稳模式故意让当前步骤以外的 live 标记停在静止帧（`docs/calm/hooks.md` §4），这条上游测试测的是上游时钟。
- `packages/mac/e2e/plans.spec.ts`：「折叠里程碑时连线逐帧跟着」一条以沉稳关运行（`beluga.fork.calm.v1 = { calm: false }`）；它逐帧测上游的滑动，沉稳下这段滑动按 CH-06 是瞬时的，连线与盒子不会有中间帧可比。
- `packages/mac/e2e/plan-black-box.spec.ts`：等计划行进入 Unread 前先 `mouse.move` 出侧栏（SH-08：指针在侧栏里时沉稳冻结顺序，新行不插入），同 `unread.spec.ts`。
- `packages/mac/e2e/fork-calm-sidebar.spec.ts`：沉稳开那条结尾回答 new-hero 的提问。同一 worker 共用一个演示 daemon，不回答的话沉稳关那条打开 new-hero 看到的是「等你回答」的输入框，等不到 `new-hero` 占位符。
- `packages/mac/e2e/tasks.spec.ts`（BLG-679 那条）：「Backlog 从左展开后 Ready 列没被推走」的容差 2px → 4px。沉稳下展开是立即的，`scrollLeft` 取整丢掉的最后一个像素没有后续帧去补，Ready 列会留 1–2px（沿用的是 `Fold` 的 `hold`，源码里补了展开时的 `onMove()`，见上面 TaskBoard 一行）；推走的话是约 300px，断言意图不变。沉稳开连跑 6 次通过。
- `packages/mac/e2e/selection-bar.spec.ts`：拖选前把那一行滚进视野并立刻拖，没选中任何字就重来（最多 5 次）；另加 `CALM_OFF=1` 开关用于沉稳关复现。回答还在画时日志仍在跟最新一行，量好的文字会被带走，拖到的是空处（选区长度 0，`mouseup` 后 `readSelection` 为空，工具栏自然不存在）。沉稳开关各连跑 3 次通过。不是沉稳的锚定在改滚动：沉稳关下同一时序也失败。
- `packages/mac/e2e/steps.spec.ts`：三条以沉稳关运行的用例（折叠、飞入、飞进队列）在设置 `beluga.fork.calm.v1` 之后 `page.reload()`——文件的 `beforeEach` 已经 `goto('/')`，init script 只在下一次加载才跑，之前沉稳其实一直是开的（BLG-196 的改法没生效）。
- `packages/mac/e2e/fork-calm-toast.spec.ts`（沉稳关那条）：先撤销 toast、后 App toast，并在页面里按帧轮询「两条同时在」。两条 toast 都会自己消失，先后和判定时刻对不上就测不到重叠。
- `packages/mac/e2e/sidebar-categories.spec.ts`：新建聊天发送后把指针移出侧栏再等行出现（SH-08，同 `unread.spec.ts`）。
- `packages/mac/e2e/send-no-blank.spec.ts`：消息飞行动画的上游用例以沉稳关运行；沉稳模式让消息直接落位、没有飞行（CH-06），这条测的是上游的飞行实现。
- `packages/mac/e2e/steps.spec.ts`：步骤滑入折叠、消息飞行/飞入队列的上游用例以沉稳关运行；沉稳模式下步骤与 reduced-motion 一样瞬时进折叠（CH-02）、消息直接落位（CH-06），同文件后面的 reduced-motion 用例覆盖了那一档。
- `packages/mac/e2e/threads-panel.spec.ts`：“threads 关时无标记”与“子线程折在父行下”两条在等新行前把指针移出侧栏（SH-08：指针在侧栏时新出现的行要等它离开）。

### 手机协议的 minor 编号（3.3.0 同步时顺延）

fork 的手机协议新增在 `src/companion/protocol.ts` 里接在上游后面编号。上游 3.3.0 用掉了 1.51–1.54，和 fork 当时的 1.51–1.55 撞号，同步时 fork 的顺延为 1.55–1.59：`checkAgent` 55、`autoAgent` 56、`archAgent` 57、`fixAgent` 58、Synon Studio Gate 59；“谁做的”（`rolesSeen`）在它的分支上编的是 1.55，合进 main 时 1.55–1.59 已被上面几条占用，顺延为 1.60，`COMPANION_PROTO.minor` 为 60。以后上游再加 minor，fork 的这几条继续顺延到上游最大值之后，并同步改 `tests/plan-*-agent.test.ts`、`tests/companion-supports-fix-agent.test.ts`、`tests/fork-companion-roles.test.ts` 和 `docs/parity.fork.md` 里的数字。

### 版本号（脚本自动处理）

- `packages/mac/package.json`、`packages/mac/src-tauri/tauri.conf.json`

### 计划按档位分工（架构 / 编码 / 审核 / 疑难修复）：第二阶段要抽出来

已抽出来的：疑难修复的切换（`src/fork/plans/fixer.ts`，`pilot.ts` 只留调用）、“谁做的”（BLG-198～201：`src/fork/plans/roles.ts` 算出各角色实际用的模型，里程碑工作树用谁也由它的 `workAgentFor` 决定；手机协议 `src/fork/companion/plan-roles-view.ts`、`plan-roles-views.ts`；Mac `packages/mac/src/fork/plans/MilestoneRoles.tsx`；手机 `packages/companion/components/fork/MilestoneRoles.tsx`、`packages/companion/lib/fork/roles-words.ts`；上游文件各只留接入点：`model.ts` 的 `MilestoneAgent` 两个可选字段，`pilot.ts` 的 `launch()` 两行，`protocol.ts` 的 `roles` 字段和 `SINCE.rolesSeen`，`views.ts` 一行，`PlanDetails.tsx`、`PlanOutline.tsx`、`PlanCanvas.tsx`、`app/plan/[id].tsx` 各一行加一个 import）、新建计划的角色选择（`packages/mac/src/fork/plans/NewPlanSheet.tsx`）、设计稿折叠的样式（`packages/mac/src/fork/plans/plans-fork.module.css`）、计划说明（`docs/tasks-and-plans.fork.md`）、测试（`tests/fork-plans.test.ts`）。下面的还在上游文件里，下一步先抽 `pilot.ts` 里的建筑师（architect）那块。

- 核心：`src/core/plans/pilot.ts`、`src/core/plans/work.ts`、`src/core/plans/plans.ts`、`src/core/plans/prompt.ts`、`src/core/plans/model.ts`、`src/core/plans/watchdog.ts`、`src/core/plans/progress.ts`、`src/core/plans/owner.ts`、`src/core/plans/move.ts`、`src/core/plans/move-work.ts`、`src/core/notify.ts`、`src/core/board/launch.ts`
- Agent：`src/agent/plan-tools.ts`、`src/agent/policy.ts`、`src/agent/types.ts`
- API：`src/ipc/plans-api.ts`、`src/ipc/plans-handlers.ts`、`src/external/domain/tools.ts`、`src/external/adapters/tools/state-rows.ts`
- 手机：`src/companion/protocol.ts`、`src/companion/views.ts`、`src/companion/calls.ts`、`packages/companion/app/plan/[id].tsx`、`packages/companion/lib/link/calls.ts`、`packages/companion/components/AgentPicker.tsx`
- Mac：`packages/mac/src/plans/PlanPage.tsx`（••• 里“计划设置…”一行，其余是“任务需要你出手”的 decide）、`packages/mac/src/plans/PlanChat.tsx`、`packages/mac/src/plans/PlanDetails.tsx`、`packages/mac/src/plans/PlanOutline.tsx`、`packages/mac/src/plans/PlanCanvas.tsx`（任务卡上的模型，一行）、`packages/mac/src/plans/plan-ask-model.ts`、`packages/mac/src/plans/plans-model.ts`、`packages/mac/src/plans/plans.module.css`（末尾三行：窄屏时操作换到名字下面；CSS module 的类名带哈希，fork 自己的 module 改不到 `.pageHead`）
- 测试：`tests/plans.test.ts`、`tests/agent-change.test.ts`

### 自动路由（没指定 agent 的任务交给合适的模型）

- `src/core/board/work.ts`、`src/core/store.ts`、`src/shared/settings-schema.ts`、`src/ipc/api.ts`、`src/machines/sync.ts`
- `packages/mac/src/tasks/use-task-start.ts`、`packages/mac/src/tasks/parts.tsx`、`packages/mac/src/views/ProjectHome.tsx`、`packages/companion/app/task/[id].tsx`

### 计划图与大纲共用（`packages/ui-plan`，BLG-90）

计划图与大綱抽成 `packages/ui-plan`，Mac、客户 web 应用和手机读同一份；上游文件里只有「换成共用组件」的接入点。

- `packages/companion/components/PlanParts.tsx`：`MilestoneMap` 换成共用包（手机保留自己的按压、触感与淡入，状态词和颜色仍是手机自己的）
- `packages/companion/metro.config.js`、`packages/companion/tsconfig.json`：把 `packages/ui-plan` 加进手机端的共享路径

### Synon Studio（客户写需求、看计划；开工前由你确认）

客户 web 应用（`packages/studio-app`）、中台（`packages/studio-hub`）与 daemon 的 `src/studio/` 都是 fork 自己的文件；下面这些上游文件里只有接入点。

- `src/cli/args.ts`、`src/cli/main.ts`：`beluga studio link/status/unlink/share/unshare` 命令
- `src/core/agent-host.ts`：`plans` 的返回值把 `customerTurn` 透传给 agent
- `src/core/plans/edit.ts`：计划任务的 `audience`（客户可见 / 仅你可见，`src/studio/decisions.ts`）
- `src/daemon/core.ts`：起停 `launchStudio`（没连接时什么都不做）
- `src/daemon/server.ts`：浏览器 cookie 不能 `studio.link` / `studio.unlink` / `studio.setProject`
- `src/ipc/handlers.ts`：展开 `STUDIO_HANDLERS`
- `src/agent/runtime/copilot/runner.ts`、`src/agent/runtime/opencode/runner.ts`：客户回合的 policy 带 `customerTurn`
- `packages/mac/src/layout/NotificationCenter.tsx`、`packages/mac/src/layout/ProjectTree.tsx`、`packages/mac/src/layout/waiting-model.ts`：开工确认卡片（计划、里程碑、点数、带上理由的拒绝）与项目菜单里的「连接 Studio」；三处都只有这些新增，没有新动效
- `packages/companion/app/need/[id].tsx`、`packages/companion/components/Needs.tsx`：手机上的 `studio-start` 卡片（Approve 开工，Decline 写一句客户会看到的话）
- `docs/companion.md`、`docs/how-it-works.md`：Synon Studio 的手机卡片与整体说明（详见 `docs/studio.md`）
- `tests/boundaries.test.ts`：`src/studio` 算核心（不含 UI）
- `tests/browser-safe.test.ts`：`src/studio/protocol.ts`、`actions.ts`、`sanitize.ts`、`view.ts` 必须浏览器安全
- `tests/machine-coverage.test.ts`：studio 的管理与 Gate 方法不从「你的电脑」放行
- `tests/web-security.test.ts`：浏览器 cookie 做不了 studio 管理
- `tsconfig.json`：`tests/team/studio-app-*.test.ts` 三个用 Expo/React Native 类型，交给 `packages/studio-app/tsconfig.json` 检查，根 typecheck 排除

### Over SSH：Beluga 退出时 ssh 配对一并结束（886b0ec13：留在 fork，不提回上游）

原因：「Over SSH」添加电脑时起的 `ssh … beluga pair --computer` 要随 Beluga 退出一起结束，不能等配对在那边过期；停止中的 `sshPairStart` 也要拒绝新配对。这是 fork 的功能，上游没有。

- `src/machines/machines.ts`：关闭时停掉 `this.ssh`；停止中不再接受新的 SSH 配对
- `tests/machines-ssh.test.ts`：对应的用例

### 设置里打开的表单盖在设置窗口之上（BLG-213：留在 fork，不提回上游）

原因：上游的设置窗口是 `z-index` 44/45，`FormSheet`（表单弹窗）是 40/41，所以从设置里打开的表单（Studio 的「连接到 Studio…」、项目的 worktree 环境等）会被设置窗口盖住、无法输入。上游自己的做法是原生 sheet，不受影响；fork 的 Studio 入口在设置里，需要抬高。`FormSheet` 渲染时若页面上有设置窗口（`[data-settings]`），就加 `data-over-settings`，层级 48/49（仍低于 alert 50）。从项目 ⋯ 菜单等处打开时属性不出现，表现不变。

- `packages/mac/src/components/FormSheet.tsx`：渲染时判断设置是否打开，两处加 `data-over-settings`
- `packages/mac/src/dialogs/sheet.module.css`：`[data-over-settings]` 的 48/49
- `packages/mac/src/dialogs/Settings.tsx`：设置窗口的 `data-settings` 标记（判断用）

已知限制：设置叠在引导页上时（`[data-over-welcome]`，`settings.module.css` 的 86/87），48/49 仍不够，从设置里打开的 FormSheet 会被盖住；BLG-213 没有加更高的 `'welcome'` 档。这条窄路径（引导页上开设置再进 Studio）留着将来一起处理。

### 客户邀请与客户端（BLG-14 至 BLG-17、BLG-34、BLG-36）

- `src/companion/pair.ts`、`src/companion/devices.ts`、`src/companion/host.ts`、`src/ipc/companion-api.ts`、`src/ipc/companion-handlers.ts`
- `packages/mac/src/phone/Phone.tsx`、`packages/mac/src/phone/phone-model.ts`
- `packages/companion/app/_layout.tsx`、`packages/companion/app/(tabs)/_layout.tsx`、`packages/companion/app/index.tsx`、`packages/companion/lib/store.ts`
- `tests/companion-coverage.test.ts`、`tests/companion-views.test.ts`、`tests/mac-settings-search.test.ts`

### 菜单完整显示、中文不带结尾的“…”

- `packages/mac/src/components/SpecMenu.tsx`、`packages/mac/src/components/SpecMenu.module.css`、`packages/mac/src/chat/RunsOn.tsx`、`packages/mac/src/dialogs/native/PersonCards.tsx`、`packages/mac/src/dialogs/native/PersonMenu.tsx`、`packages/mac/src/tasks/PickMenu.tsx`、`packages/mac/src/views/TerminalTab.tsx`、`packages/mac/src/views/overview/FilterBar.tsx`

### git 输出固定用英文（BLG-133：留在 fork，不提回上游）

原因：中文系统下 git 的提示是中文，Beluga 按英文原话判断 git 的结果（冲突、没有改动、分支不存在等）会判断错，全量测试也因此拿不到 Tested-on（见 `docs/reports/plan-roles-git-locale.md`）。每处只加一行 `LC_MESSAGES=C LANGUAGE=C`。

- `src/workspaces/git.ts`、`src/workspaces/pr.ts`、`src/machines/ready.ts`、`tests/machines-ready.test.ts`、`tests/git-env.test.ts`（BLG-144：`gitEnv` 固定 `LC_MESSAGES=C` 并保留 `LC_CTYPE`）

### 中文输入法组字时 Enter 只选词（BLG-133：留在 fork，不提回上游）

原因：Mac 应用的 WebKit 里用输入法组字时，按 Enter 选词也会触发 keydown（keyCode 229，`isComposing` 已是 false），输入框把它当成发送或提交（见 `docs/reports/plan-roles-ime.md`）。判断在 fork 自己的 `packages/mac/src/lib/ime.ts`（`isImeComposing`），只有一处用它：`packages/mac/src/fork/ime-guard.ts` 在 window 的捕获阶段拦下组字中的 Enter，以及组字时的 Tab、Esc 和方向键（各输入框以前自己的判断也挡这些；字母不拦，快捷键照常）（`stopImmediatePropagation`，从不 `preventDefault`，否则会吃掉上屏的字），终端（`.xterm` 里）放行。各输入框与上游一致。测试：`tests/ime.test.ts`、`tests/ime-guard.test.ts`、`packages/mac/e2e/fork-ime.spec.ts`。

- 上游文件只有 `packages/mac/src/main.tsx` 一行（见上面“只有一行接入点”）。

以前（PR #20）每个输入框各改两行，共 60 个文件；已全部恢复上游原样（逐文件列表见 `docs/reports/plan-roles-min-conflict.md`）。

### 适合提回上游的通用修复

- 设置窗口标题和搜索框固定、只有列表滚动：`packages/mac/src/dialogs/Settings.tsx`、`packages/mac/src/dialogs/settings.module.css`
- 路径上不存在的图片显示为“缺失”：`packages/mac/src/chat/images.ts`、`src/agent/prompt.ts`、`src/agent/run-instructions.ts`、`tests/mac-chat-images-cache.test.ts`
- 本地模型在自己的文件夹里运行 Claude Code：`src/agent/runtime/local.ts`、`tests/local-endpoints.test.ts`
- `/` 列表跟随链接的技能和命令：`src/core/claude-code/skills.ts`、`tests/skills.test.ts`
- 用量时间轴的「Now」线不挡悬停（`pointer-events: none`，标记不是点击目标）：`packages/mac/src/views/usage/stats.module.css`
- e2e 夹具：预热太久的 demo daemon 不复用（它的时钟已经走过 demo 的定时事件），超过 45 秒就另起一个：`packages/mac/e2e/fixtures.ts`
- Linux 机器测试先探测 UDP/TCP/子进程，被沙箱挡住就跳过并说明原因，而不是等配对超时：`tests/machines/linux-computer.test.ts`
- 任务需要你出手时用卡片提问，停下时显示它最后说的话：`src/core/plans/prompt.ts`、`src/core/plans/watchdog.ts`、`src/core/plans/model.ts`、`src/core/notify.ts`、`src/companion/needs-you.ts`、`packages/mac/src/plans/plans-model.ts`、`tests/plans-watchdog.test.ts`、`tests/notify.test.ts`、`tests/plan-milestone-agent.test.ts`

### 从其他 fork 移植的修复（2026-11-12）

都是对所有人有用的修复，原样（或按本 fork 调整后）cherry-pick 进来，提交说明里有 `cherry picked from` 原提交。上游合并同样的改动后，这里的差异就消失；上游合并的是改过的版本时，同步时以上游为准。

- 目录搜索打不开凭据文件、朋友的 Claude 不继承 daemon 的环境变量、损坏的 identity.json 不被覆盖（faufderhar/beluga `fcc78b30`，未提上游）：`src/agent/policy.ts`、`src/agent/runtime/claude/runner.ts`、`src/net/crypto.ts`、`tests/policy.test.ts`、`tests/identity.test.ts`
- macOS 上 `ps` 卡住会让归档一直挂着；测试用独立的系统 HOME（gardinermichael/beluga `f97b40a9`，未提上游）：`src/workspaces/test-procs.ts`、`tests/setup.ts`、`tests/background-tasks.test.ts`、`tests/delete-unpushed.test.ts`、`tests/friend-share/fork.test.ts`、`tests/friend-share/projects.test.ts`、`tests/other-worktrees.test.ts`、`tests/smart-archive.test.ts`
- Codex 把 Beluga 自己工具的调用交给 Beluga 的权限检查（`default_tools_approval_mode: 'approve'`；JoeHosman/beluga `1816d986`，未提上游）：`src/agent/runtime/codex/runner.ts`、`tests/codex-parity.test.ts`
- ~~MCP 服务需要登录时，会话里直接点 Sign in~~：上游 3.3.0 合并了 #427 的最终版（agent 调 `mcp__beluga_mcp__mcp_sign_in` 登录，没有会话里的提示条），同步时撤掉了这里移植的早期版本，以上游为准。
- Autopilot 不再放过合并失败的里程碑（voshond/beluga `5accb683`）：`src/core/plans/pilot.ts`、`tests/plans.test.ts`
- 回答 agent 提问时附的图片（voshond/beluga `a577f13f`）：`src/core/attachments.ts`、`src/agent/runtime/claude/runner.ts`、`packages/mac/src/chat/use-attachments.tsx`、`packages/mac/src/plans/PlanAsk.tsx`、`packages/mac/src/plans/plan-ask.module.css`、`tests/attachments.test.ts`
- zsh 接受 agent 写的 bash（voshond/beluga `2563a35f`；上游没有 `INSTRUCTION_PIECES`，改成接进 `runInstructions` 的字符串）：`src/agent/prompt.ts`、`src/agent/run-instructions.ts`、`src/agent/runtime/claude/runner.ts`、`src/agent/runtime/claude/terminal.ts`
- 审计 PR 24 后的修正（2026-11-13，提交 `554152d3f`）：目录搜索带自己的 glob 时不再被换掉；`~/.beluga/attachments` 可读（回答里的图片才读得到）；`identity.json` 损坏时 daemon 照常启动（一次性身份，文件不动）；朋友的运行保留 Claude Code 自己的设置变量；zsh-compat 在 Windows 上不设、文件整写。`src/agent/policy.ts`、`src/core/shares.ts`、`src/machines/identity-load.ts`、`src/net/crypto.ts`、`src/agent/runtime/claude/runner.ts`、`src/agent/runtime/claude/zsh-compat.ts`，以及对应测试。
- Studio 客户回合的目录搜索也查打开的凭据文件（`a663330e3`，fork 自己的，留在 fork）：`src/agent/policy.ts` 的 `decideCustomerTurn`、`tests/policy.test.ts`。
- 以上通用修复已整理成 6 个基于上游 `main` 的分支（`upstream-pr/*`），准备提回上游；上游合并后这里的差异就消失。

### 我的共享（M7 · BLG-217 / BLG-218，2026-11-13）

沉稳模式开时，设置 › 成员与访问里「在房间中」「之前记住的」两组换成一个「我的共享」页（`docs/calm/sharing.md`）：顶部一个对所有圈生效的默认，下面只列与该默认不同的圈（例外），带搜索、筛选、多选批量与虚拟列表。数据仍是 `policy` / `levels` / `remembered`，写仍走已有的 `people.setTrust`、`people.forget` 与 `session.setClaudeSharing`，所以每个圈的实际共享结果与迁移前一致；沉稳关时 `People()` 与上游逐字相同。

上游文件只有一处改动（一行接入点）：

- `packages/mac/src/dialogs/Settings.tsx`：`People()` 里 `calm ? <MySharing /> : (原来的两组)`

fork 自己的新增文件（上游没有）：

- `packages/mac/src/fork/sharing/model.ts`（纯模型：合并三个来源、迁移、搜索、批量计划）
- `packages/mac/src/fork/sharing/MySharing.tsx`、`sharing.module.css`（页面）
- `packages/mac/src/fork/sharing/demo.ts`（DEV + `beluga.fork.sharing.demo.v1` 的 200 圈演示源）
- `packages/mac/src/fork/sharing/quiet.ts`（批量改动期间不显示逐条成功 toast）
- `packages/mac/src/fork/calm/one-toast.ts`：global 门加 `suppressed`（quiet 窗口里到达的 toast 永不显示）

fork 的其他文件与测试：

- `packages/mac/src/fork/settings-index.ts`：`people` 下加「我的共享」（All circles）的搜索行
- `packages/mac/src/i18n/zh-CN.fork.json`：中文文案
- `tests/sharing-defaults.test.ts`、`packages/mac/e2e/sharing-defaults.spec.ts`、`tests/fork-calm.test.ts`（Settings.tsx 的 canary）、`tests/mac-settings-search.test.ts`（people 页的来源加上 `fork/sharing/MySharing.tsx`）、`packages/mac/scripts/calm-check.mjs`（`sharing` 场景，200 圈演示源）
