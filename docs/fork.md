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

### 沉稳界面（docs/calm-ui.md）

界面气质（布局稳定、动效克制、状态安静、反馈分级、一致可预期、逐页验收）由 `packages/mac/src/fork/calm/` 的覆盖层实现，规则只在 `:root[data-calm]` 下生效。上游文件只留这几处接入点：

- `packages/mac/src/main.tsx`：在 `tokens.css`、`base.css` 之后加一行 `import './fork/calm/index.js'`；它在首帧前设置 `data-calm`，并引入 `fork/calm/calm.css`。
- `packages/mac/src/dialogs/Settings.tsx`：Appearance 的 Layout 组、Reduce motion 行后加一行 `<CalmRow />`；开关本体在 `packages/mac/src/fork/calm/settings.tsx`。
- `tests/mac-settings-search.test.ts`：appearance 的 `PANE_SOURCES` 加 `read('fork/calm/settings.tsx')`，让「索引的标签必须在面板源码里」这条校验读得到 fork 自己的行。
- `CLAUDE.md`：原来的《The Mac app's look: calm, not lively》一节搬进 `docs/calm-ui.md`，原处只留一行指向；规则本体的改动都在 fork 文件里，不碰上游。
- `packages/mac/src/layout/Sidebar.tsx`：一行 `useSidebarHold(drop.ref)`——「指针/焦点/拖拽是否在侧栏上」只有 nav 自己知道，探针逻辑在 `fork/calm/hold-order.ts`。操作侧栏时不重排、离开 600ms 后换上新顺序（`docs/calm/hooks.md` §1）。
- `packages/mac/src/layout/EntryRow.tsx`：`useEntryList` 的返回值经过 `useHeldEntries`——Unread 与 Categories 两种侧栏模式都从这里拿排序结果，改这一处覆盖两种；冻结的取舍与实现见 `docs/calm/hooks.md` §1。M3 起只冻结顺序、内容取最新（「需要你」标记在操作期间也能到达），新增行等释放后出现（`docs/calm/overlay.md` §12 · SH-08）。
- `packages/mac/src/chat/ChatLog.tsx`：回到底部按钮的 children 换成 `fork/calm/new-below.tsx` 的 `<JumpLabel rows={rows.length} />`——上游不提供「下面来了几条」，计数要跨渲染保存，只能做成组件；按钮本体、`stick` 滚动逻辑一行未动（`docs/calm/hooks.md` §2）。
- `packages/mac/src/App.tsx`：`Toasts` 里加 `useOneToast('global', toast?.id)`，被后到的 toast 压制时不渲染，外层加 `data-one-toast="global"`——全局 toast 的渲染和 store 定时器都在这里（`docs/calm/hooks.md` §3）。
- `packages/mac/src/lib/undo-toast.tsx`：`UndoToast` 里加 `useOneToast('undo', toast?.id)`，被压制时不渲染、不响应 ⌘Z（定时器照旧收尾），外层加 `data-one-toast="undo"`——撤销 toast 是模块级状态，两套必须在同一个判据下；样式在 `fork/calm/one-toast.css`（`docs/calm/hooks.md` §3）。
- `packages/mac/src/lib/live-motion.ts`：`tick`/`wake`/`watch`/`joinLive` 里加 `calmLive` 门（同一文件 5 行）——时钟的 `seen`/`marks` 是模块私有的，外部拿不到，无法在 fork 文件里过滤；沉稳模式下只放行 `[data-current]` 里的标记，其余停在静止帧（`docs/calm/hooks.md` §4）。
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
- `packages/mac/e2e/selection-bar.spec.ts`：拖选前把那一行滚进视野并立刻拖，没选中任何字就重来（最多 5 次）；另加 `CALM_OFF=1` 开关用于沉稳关复现。回答还在画时日志仍在跟最新一行，量好的文字会被带走，拖到的是空处（选区长度 0，`mouseup` 后 `readSelection` 为空，工具栏自然不存在）。沉稳开关各连跑 3 次通过。不是沉稳的锚定在改滚动：沉稳关下同一时序也失败。
- `packages/mac/e2e/steps.spec.ts`：三条以沉稳关运行的用例（折叠、飞入、飞进队列）在设置 `beluga.fork.calm.v1` 之后 `page.reload()`——文件的 `beforeEach` 已经 `goto('/')`，init script 只在下一次加载才跑，之前沉稳其实一直是开的（BLG-196 的改法没生效）。
- `packages/mac/e2e/fork-calm-toast.spec.ts`（沉稳关那条）：先撤销 toast、后 App toast，并在页面里按帧轮询「两条同时在」。两条 toast 都会自己消失，先后和判定时刻对不上就测不到重叠。
- `packages/mac/e2e/sidebar-categories.spec.ts`：新建聊天发送后把指针移出侧栏再等行出现（SH-08，同 `unread.spec.ts`）。
- `packages/mac/e2e/send-no-blank.spec.ts`：消息飞行动画的上游用例以沉稳关运行；沉稳模式让消息直接落位、没有飞行（CH-06），这条测的是上游的飞行实现。
- `packages/mac/e2e/steps.spec.ts`：步骤滑入折叠、消息飞行/飞入队列的上游用例以沉稳关运行；沉稳模式下步骤与 reduced-motion 一样瞬时进折叠（CH-02）、消息直接落位（CH-06），同文件后面的 reduced-motion 用例覆盖了那一档。
- `packages/mac/e2e/threads-panel.spec.ts`：“threads 关时无标记”与“子线程折在父行下”两条在等新行前把指针移出侧栏（SH-08：指针在侧栏时新出现的行要等它离开）。

### 版本号（脚本自动处理）

- `packages/mac/package.json`、`packages/mac/src-tauri/tauri.conf.json`

### 计划按档位分工（架构 / 编码 / 审核 / 疑难修复）：第二阶段要抽出来

- 核心：`src/core/plans/pilot.ts`、`src/core/plans/work.ts`、`src/core/plans/plans.ts`、`src/core/plans/prompt.ts`、`src/core/plans/model.ts`、`src/core/plans/watchdog.ts`、`src/core/plans/progress.ts`、`src/core/plans/owner.ts`、`src/core/plans/move.ts`、`src/core/plans/move-work.ts`、`src/core/notify.ts`、`src/core/board/launch.ts`
- Agent：`src/agent/plan-tools.ts`、`src/agent/policy.ts`、`src/agent/types.ts`
- API：`src/ipc/plans-api.ts`、`src/ipc/plans-handlers.ts`、`src/external/domain/tools.ts`、`src/external/adapters/tools/state-rows.ts`
- 手机：`src/companion/protocol.ts`、`src/companion/views.ts`、`src/companion/calls.ts`、`packages/companion/app/plan/[id].tsx`、`packages/companion/lib/link/calls.ts`、`packages/companion/components/AgentPicker.tsx`
- Mac：`packages/mac/src/plans/PlanPage.tsx`、`packages/mac/src/plans/PlanSheets.tsx`、`packages/mac/src/plans/PlanChat.tsx`、`packages/mac/src/plans/PlanDetails.tsx`、`packages/mac/src/plans/PlanOutline.tsx`、`packages/mac/src/plans/plan-ask-model.ts`、`packages/mac/src/plans/plans-model.ts`、`packages/mac/src/plans/plans.module.css`；计划设置的接入：`packages/mac/src/dialogs/native/WorkSheets.tsx`（一个 case）、`packages/mac/src/lib/sheets.ts`（一行）
- 文档与测试：`docs/tasks-and-plans.md`、`tests/plans.test.ts`、`tests/agent-change.test.ts`、`tests/mac-plans.test.ts`（计划动态里角色变化的中文行）

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

原因：Mac 应用的 WebKit 里用输入法组字时，按 Enter 选词也会触发 keydown，输入框把它当成发送或提交（见 `docs/reports/plan-roles-ime.md`）。判断放在 fork 自己的 `packages/mac/src/lib/ime.ts`（`isImeComposing`），每个输入框只加一次调用。

- `packages/mac/e2e/plan-chat.spec.ts`、`packages/mac/src/agent-term/TermPane.tsx`、`packages/mac/src/call/NotesBox.tsx`、`packages/mac/src/chat/BoxSuggestions.tsx`、`packages/mac/src/chat/Composer.tsx`、`packages/mac/src/chat/EditPrompt.tsx`、`packages/mac/src/chat/FindBar.tsx`、`packages/mac/src/chat/WorktreeDraft.tsx`、`packages/mac/src/claude-code/AgentMonitor.tsx`、`packages/mac/src/components/FormSheet.tsx`、`packages/mac/src/components/SelectMenu.tsx`、`packages/mac/src/components/markdown/CodeEditor.tsx`、`packages/mac/src/components/markdown/DocFind.tsx`、`packages/mac/src/dialogs/MachinesSettings.tsx`、`packages/mac/src/dialogs/MenuSheet.tsx`、`packages/mac/src/dialogs/SettingsSearch.tsx`、`packages/mac/src/dialogs/native/PeerSheets.tsx`、`packages/mac/src/dialogs/native/ShareFolderSheet.tsx`、`packages/mac/src/dialogs/native/parts.tsx`、`packages/mac/src/gateway/AccessSettings.tsx`、`packages/mac/src/gateway/RequestsView.tsx`、`packages/mac/src/issues/IssueComposer.tsx`、`packages/mac/src/issues/IssueReply.tsx`、`packages/mac/src/issues/IssuesView.tsx`、`packages/mac/src/layout/ProjectGroups.tsx`、`packages/mac/src/layout/SidebarSearch.tsx`、`packages/mac/src/layout/panel/ContentSearch.tsx`、`packages/mac/src/layout/workspace-row.tsx`、`packages/mac/src/lib/dictation.ts`、`packages/mac/src/network/ConversationView.tsx`、`packages/mac/src/network/EmojiPicker.tsx`、`packages/mac/src/network/GroupInfo.tsx`、`packages/mac/src/network/NetComposer.tsx`、`packages/mac/src/network/NetworkSheets.tsx`、`packages/mac/src/network/NetworkSidebar.tsx`、`packages/mac/src/network/StatusMenu.tsx`、`packages/mac/src/onboarding/Onboarding.tsx`、`packages/mac/src/onboarding/SetupSteps.tsx`、`packages/mac/src/phone/PhoneView.tsx`、`packages/mac/src/pr/PrConversation.tsx`、`packages/mac/src/sentinel/DashboardPage.tsx`、`packages/mac/src/sentinel/SentinelCards.tsx`、`packages/mac/src/sentinel/SentinelHome.tsx`、`packages/mac/src/sentinel/SentinelPage.tsx`、`packages/mac/src/tasks/Activity.tsx`、`packages/mac/src/tasks/Brief.tsx`、`packages/mac/src/tasks/NewTaskSheet.tsx`、`packages/mac/src/tasks/TaskPage.tsx`、`packages/mac/src/tasks/TaskSections.tsx`、`packages/mac/src/team/SharedPlans.tsx`、`packages/mac/src/views/DiffComment.tsx`、`packages/mac/src/views/SearchView.tsx`、`packages/mac/src/views/reader/FileEditor.tsx`

### 适合提回上游的通用修复

- 设置窗口标题和搜索框固定、只有列表滚动：`packages/mac/src/dialogs/Settings.tsx`、`packages/mac/src/dialogs/settings.module.css`
- 路径上不存在的图片显示为“缺失”：`packages/mac/src/chat/images.ts`、`src/agent/prompt.ts`、`src/agent/run-instructions.ts`、`tests/mac-chat-images-cache.test.ts`
- 本地模型在自己的文件夹里运行 Claude Code：`src/agent/runtime/local.ts`、`tests/local-endpoints.test.ts`
- `/` 列表跟随链接的技能和命令：`src/core/claude-code/skills.ts`、`tests/skills.test.ts`
- 哨兵保留数据的测试不再用固定日期（过了 14 天保留期就失败，上游也一样）：`tests/sentinel-kept-data.test.ts`
- 任务需要你出手时用卡片提问，停下时显示它最后说的话：`src/core/plans/prompt.ts`、`src/core/plans/watchdog.ts`、`src/core/plans/model.ts`、`src/core/notify.ts`、`src/companion/needs-you.ts`、`packages/mac/src/plans/plans-model.ts`、`tests/plans-watchdog.test.ts`、`tests/notify.test.ts`、`tests/plan-milestone-agent.test.ts`
