# 这个 fork 怎么和上游一起走

`dayuer/beluga` 是 `beluga-labs/beluga`（上游）的 fork。目标：随时能合进上游的更新，同时保留自己的功能，合并时只在少数几个已知的地方冲突。

## 分支（2026-11-17 起）

`main` 只跟上游：永远等于 `upstream/main`，只快进（`git fetch upstream && git push origin upstream/main:main`），不在上面提交任何 fork 的东西。上游已经合并的改动不单独建分支。

fork 自己的改动是一条链，后一个建在前一个上面：

| 分支 | 内容 | 基于 |
|---|---|---|
| `topic/chinese` | 中文对照：fork 的中文接在上游的中文表上，对上游文案的改译，直接写在上游的 `zh-CN.json` 里 | `upstream/main` |
| `fork/base` | fork 结构、登记表、fork 功能的中文、输入法 Enter、git 英文输出、构建号、新旧版本混用的容错 | `topic/chinese` |
| `topic/native` | Mac 原生的控件、菜单、sheet、警告框，侧栏，沉稳界面 | `fork/base` |
| `topic/plans` | Antigravity、本地模型端点保存前校验、计划里“Decide…”直接打开那张卡片、技能包、用量统计（计划的规划者 / 建造者 / 检查者以上游为准） | `topic/native` |
| `topic/fixes` | 准备提回上游的小修复 | `upstream/main` |

为什么是链而不是并列：上层的界面建在下层的原生控件和中文上，这些依赖是真实的，硬拆只会多出一份份手写的“没有对方时”的版本。所以取用时取链上的一段前缀：只要中文就用 `topic/chinese`，加上基础就用 `fork/base`，要原生界面就用 `topic/native`，全部就是 `topic/plans`；需要时再合进 `topic/fixes`。

Synon Studio（客户邀请与模板、联邦制自动接单、我的共享）原来是链上最后的 `topic/studio`，2026-11-18 起迁成独立的仓库 `~/sproot/synon-studio`（带着完整历史，建在 `topic/plans` 上，远端 `beluga` 指回这个 fork，用来合进链上的更新）。下面讲 Studio 的几节是迁出前的记录。

**作废：手机的自定义地址通道**（`plan/custom-route`，BLG-259–261、BLG-264，Beluga 计划 `pl_06cbeaec655c`）。让手机经 GNB、ZeroTier、WireGuard、Nebula、Tailscale 等组网连 Mac：中继另外监听一个用户给的 `host:port`，手机把它当第三条路竞速。2026-11-18 放弃，代码已从 `topic/native`、`topic/plans` 撤出（`revert:` 提交），分支归档为 `archive/abandoned-custom-route-2026-11-18`，不再合进链上任何分支。没有发出去的版本带过它用的协议号（native 上 1.59、plans 上 1.64）。

- **新改动**放在它所属的、链上最靠前的那个分支：从它开 worktree 和 PR，合进去之后，再把这个分支依次合进链上后面的每个分支（merge，不 rebase，分支都已推送）。
- **同步上游**从链头进：把 `upstream/main` 合进 `topic/chinese`（它和上游只差 `zh-CN.json`：fork 的中文直接写在上游的文件里），再顺着链往下合。下面「同步上游」一节的脚本（`scripts/sync-upstream.mjs`，在 `topic/native` 及之后）照旧用。
- **构建**临时拼：在干净的 worktree 里切到要的那个链上分支（全部就是 `topic/plans`），需要时 `git merge topic/fixes`，再 `npm run app:build`。同一份代码只出一个构建号。
- 拆分前的历史在 `archive/main-2026-11-17` 和 `archive/native-upstream-3.6-2026-11-17`：每个分支现在是一个快照提交，逐条的来历去那里找（`git log archive/main-2026-11-17 -- <文件>`）。

## 原则：加自己的文件，不改上游的文件

合并时只有一种地方会冲突：**上游和这个 fork 改了同一个文件的相邻几行**。fork 自己新建的文件，上游不会去碰，所以永远不冲突。因此：

1. **新功能放进新文件。** 上游文件里只留一行接入点（一次调用、一次展开、一个 import）。上游以后改这个文件，基本碰不到这一行。
2. **登记表不在原表里加条目。** fork 的条目写在 fork 自己的文件里，原表用一行展开进去：
   - API 方法归类（`src/companion/coverage.ts`、`src/external/coverage.ts`、`src/machines/coverage.ts`）→ `src/fork/coverage.ts`
   - 设置搜索索引（`packages/mac/src/dialogs/settings-index.ts`）→ `packages/mac/src/fork/settings-index.ts`，每块写明“排在上游哪个分组后面”
   - 中文翻译：直接写进上游的 `packages/mac/src/i18n/zh-CN.json`（2026-11-18 起，原来的 `zh-CN.fork.json` 覆盖层已并入并删除）
   - parity 表（`docs/parity.md`）→ `docs/parity.fork.md`，`tests/parity.test.ts` 读完上游的表接着读这个
3. **首页说明：** 根目录的 `README.md` 保持上游原样。fork 的中文首页在 `.github/README.md`，GitHub 会优先显示它；英文版是 `README.en.md`。
4. **通用的修复提回上游。** 对所有人都有用的改动（测试修复、界面小问题）给上游提 PR。上游合并之后，这个差异就消失了。
5. **改上游文件之前先问自己**：能不能放进新文件？不能的话，就在下面的清单里写一行原因。

### min-conflict 的四条规矩（里程碑 6，见 `docs/reports/plan-roles-min-conflict.md`）

1. **每个上游文件最多 3 行。** 只放接入点：一个 import、一次调用、一个展开或一个导出。改动行 = 增加行与删除行里较多的一边，`--report` 会列出每个文件的行数和超过 3 行的个数。
2. **一处集中，不处处改。** 同一种判断要加进很多文件时，在一个公共入口拦下（例：输入法组字时的 Enter 在 window 捕获阶段统一拦，各输入框不动；这套做法后来被上游采纳为 `packages/mac/src/lib/ime-guard.ts`）。
3. **不删上游代码行。** 要换掉上游的一个组件，就在 `fork/` 里放自己的版本，用钩子打开它，上游的版本原样留着。上游以后改了被替换的组件，同步时要把改动带进 fork 的版本。
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

   然后跑 `npm run typecheck` 和 `npx vitest run`，从同步分支向 `fork/base` 开 PR，合进去之后顺着分支链往下合（见上面「分支」一节）。

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

> 这个分支上写成普通字、不加反引号的上游文件，现在没有改它们（上游已合并，或这个分支撤回了 fork 原来的改动，如 2026-11-18 起计划角色以上游为准）：`sync-upstream --report` 只数加反引号的路径。以后又改它们时，把反引号加回来。

下面每个文件都可能在同步时冲突。目标是让这份清单越来越短：第二阶段会把大块改动抽成 fork 文件，再只留一行接入点。

### 只有一行接入点（已隔离，几乎不会冲突）

- `src/companion/coverage.ts`、`src/external/coverage.ts`、`src/machines/coverage.ts`：展开 `src/fork/coverage.ts`
- `packages/mac/src/dialogs/settings-index.ts`：外面包一层 `withForkSettings`
- `tests/parity.test.ts`：同时读 `docs/parity.fork.md`
- `docs/tasks-and-plans.md`：一行，指向 `docs/tasks-and-plans.fork.md`（fork 的计划说明都在那里）

### 侧边栏

- `packages/mac/src/layout/Sidebar.tsx`：四行——一个 import（`packages/mac/src/fork/sidebar/index.ts`）、`useOneSelected(drop.ref)` 和 `useSidebarKeys(drop.ref)` 两个钩子、标题栏里隐藏侧栏按钮后一个 `<NewTaskButton />`（`fork/sidebar/new-task.tsx`，铅笔图标，侧栏唯一的主操作，打开和 Tasks 页同一个新建任务对话框；没开任务板时不显示；无障碍名是「New Task…」，和 Tasks 页的「New Task」按钮分开，上游用例按名字点它），以及顶部入口后的 `<SidebarEdge />`。标题栏的三个图标（用量、隐藏侧栏、新建任务）包在 Sidebar.module.css 的 `.titleTools` 里。Mac 原生调性（Claude Design「Mac原生侧边栏设计稿」2a）：选中行是中性灰（`--sb-selected`，侧栏有焦点时 10%，点到别处后 5.5%），图标仍是强调色；没有图标的项目用同一种中性灰的字母块（`components/ProjectIcon.module.css`，自己给项目设了颜色才上色）；分组标题的 + 和折叠箭头只在悬停时出现；`fork/sidebar/keys.ts` 的 `useSidebarKeys`：焦点在某一行上时 ↑ ↓ 在行间移动，Home、End 到首尾，→ 展开 ← 收起带折叠按钮的行（项目），回车和空格仍是上游的打开；输入框里的方向键不受影响，用例 `tests/fork-sidebar-keys.test.ts`。上游每一行自己判断是否选中，同一个计划会在「工作」、Unread 和项目下同时亮，「工作」也会压在打开的计划上一起亮；这里每次渲染后把自认选中的行放在一起看，只留一行（你点的那行，否则缩进最深的第一行），其余标 `data-fork-dup` 画成普通行，留下的那行加 `aria-current="page"`。同一个钩子给 nav 打上 `data-fork-sidebar`，打开 `fork/sidebar/sidebar-look.css`：搜索框改成柔和的凹槽；图标与文字间距 9px，列表行比上游高 2px，顶层入口再高 4px、图标 16px，子行从父行名字下方起；选中行名字加粗；分组标题用 `--text-2`、右侧 + 常显；「需要你」去掉琥珀底、描边、发光左边和扫光，只留行尾的标记。颜色只用现有 token，主题、强调色、密度照旧。Shift 多选的聊天本来就是多行选中，不参与这条规则；「出问题」的行和「需要你」一样只留行尾标记。依赖的上游类名和属性由 `tests/fork-sidebar-anchors.test.ts` 检查（`sync-upstream.mjs` 的失效扫描只看 `fork/calm`），同步后它失败就按报出的名字重接。用例：`tests/fork-sidebar-one-selected.test.ts`、`packages/mac/e2e/fork-sidebar-one-selected.spec.ts`。同一行的 `<SidebarEdge />`（`fork/sidebar/resize.tsx`）是侧栏右边可拖的边：复用上游右侧面板的 `ResizeHandle`，平时看不见，指针移上去才亮、光标变 col-resize；拖动时只改 `--sidebar-w`，松手才存进上游已有的 `sidebarWidth` 偏好（和设置里的滑块同一项，所以范围也一样：200–360），双击回到默认 248，键盘焦点在上面时 →/← 每次加减 8。减弱动态效果或沉稳界面下不做高亮过渡。范围与保存的用例：`tests/fork-sidebar-resize.test.ts`。

### 计划设置

计划页 ••• › 计划设置…（`packages/mac/src/fork/plans/PlanSettingsSheet.tsx`，测试 `tests/fork-plan-settings.test.ts`）。2026-11-18 换回上游的规划者/构建者/检查者时，旧的“计划设置”连同 fork 的角色一起删了；这一版只用上游的东西：项目、三张运行方式卡片、何时运行测试，保存走上游已有的 `plans.setAutonomy`、`plans.setTestsAt`，守护进程没有改动。接入点：

- `packages/mac/src/plans/PlanPage.tsx`：一行，••• 菜单里的“计划设置…”
- `packages/mac/src/lib/sheets.ts`：一行，`plan_settings` 对话框的类型（联合类型只能在原处加）
- `packages/mac/src/dialogs/native/WorkSheets.tsx`：三行，一个 import 和一个 `case`
- `packages/mac/src/plans/PlanSheets.tsx`：一行，导出 `AutonomyCards`

### 原生控件（待提回上游）

控件规范（`docs/mac-controls.md`）直接改在上游自己的文件里，因为它本来就要提回上游：分支 `feat/mac-native-controls`（基于 `upstream/main`）就是给 beluga-labs/beluga 的 PR。上游合并之后，下面这些差异在同步时消失；合并之前，同步上游时这些文件可能冲突，按上游的新写法重新套用 `--control-*` token 即可。之前的 fork 覆盖层 `fork/native/` 已删掉。

- `packages/mac/src/styles/tokens.css`：控件 token（三档尺寸、按 AppKit 语义色命名的颜色、焦点环、窗口不在前台时去掉强调色）、`zh-CN` 的苹方字体。
- `packages/mac/src/components/`：`ui.tsx`（`ControlSize`，`Button`/`IconButton`/`Segmented` 的 `size`）、`Select.tsx`、`SelectMenu.tsx`，以及 `ui`、`alert`、`form`、`select` 四个 CSS module。
- 标题栏与面板（大号 / 小号）：`layout/Toolbar.tsx`、`Toolbar.module.css`、`BranchControl.tsx`、`BranchControl.module.css`、`Sidebar.tsx`、`SidebarSearch.module.css`、`AppMenu.tsx`、`NotificationCenter.tsx`、`RightPanel.tsx`、`panel/*Tab.tsx`、`panel/TerminalPane.tsx`、`panel/panel.module.css`、`agent-term/ConvoSwitch.tsx`。
- sheet（常规）：`dialogs/settings.module.css`、`dialogs/sheet.module.css`、`dialogs/env-settings.module.css`、`dialogs/add-project.module.css`、`dialogs/native/sharing.module.css`、`dialogs/native/menus.module.css`、`tasks/NewTaskSheet.module.css`，以及 `EnvironmentSettings.tsx`、`AddProjectSheet.tsx`、`native/MergeReview.tsx`、`native/WorkConfirm.tsx`、`native/ShareFolderSheet.tsx` 里按钮的 `size`。
- 列表、卡片、对话（小号，规范第 4 步）：约 105 个上游文件里的 `Button`、`IconButton`、`Select`、`Segmented` 加了 `size="small"`（空的 Work 页主按钮是 `size="large"`），目录是 `views/`、`sentinel/`、`tasks/`、`components/`（graph、views、preview、code、markdown）、`plans/`、`network/`、`layout/`（行内操作、面板外的列表）、`issues/`、`chat/`、`claude-code/`、`ci/`、`work/`、`team/`、`pr/`、`gateway/`、`agent-term/`。每处只是给已有的标签加一个属性；同步时冲突就按上游的新标签重新加 `size`，取哪一档看 `docs/mac-controls.md` 的“Which size where”。另有自带样式的几处：`views/overview/filter-bar.module.css`、`views/overview.module.css`（行尾 ▾）、`sentinel/home.module.css`、`sentinel/numbers.module.css`、`sentinel/sentinel.module.css`。
- 修正（审查 PR #39）：`layout/BranchControl.module.css`、`layout/Toolbar.module.css` 的出错/已合并按钮整个边框、按下、焦点都用自己的颜色；按下的样子一律是渐变，不再从透明淡入；窗口不在前台时 ui 的主按钮和 sheet 的默认按钮一样画成普通按钮。
- fork 自己的侧栏样式 `fork/sidebar/sidebar-look.css` 的搜索框也跟着用大号 `--control-h-large`（原来写死 30px），由 `tests/fork-sidebar-anchors.test.ts` 检查。
- 用例：`tests/mac-controls.test.ts`（上游的新测试文件，随 PR 一起提回）。

### 原生菜单与按下指针（待提回上游）

同样直接改在上游文件里、准备提回上游：分支 `upstream-pr/native-menus`（基于 `upstream/main`，未推送），在 fork 里是 cherry-pick 过来的。

- `packages/mac/src/components/SpecMenu.tsx`：右键菜单和 ⋯ 下拉（`ActionsContext`、`ActionsDropdown`、`SpecContext`、`SpecDropdown`）在 Mac 的 app 里先交给 `lib/native-menu.ts` 弹 NSMenu；选项下有说明文字或自带标记的菜单仍用网页菜单（和 fork 的 `FitContent` 摆放一起用）。
- `packages/mac/src/lib/native-menu.ts`、`native-menu-model.ts`（新文件）：一次调用建好整个菜单，文字过 `t()`，快捷键、勾选、子菜单、分组，图标和色点按菜单文字颜色画成图片。
- `packages/mac/src/components/Icon.tsx`：导出 `iconShape`，给原生菜单画图标用。
- 按下指针：`styles/base.css` 的 `--press-cursor`（app 里是箭头，浏览器里是手形）；约 45 个 CSS 文件里控件上的 `cursor: pointer` 换成 `var(--press-cursor)`，链接保留手形。fork 自己的 `fork/sharing/sharing.module.css` 的 `.nameButton` 也一样。
- 用例：`tests/mac-native-menu.test.ts`（快捷键转换、原生菜单的行怎么建、控件上不再有手形）。
- 第二轮（`fork/native-2`）：
  - 菜单改由 `src-tauri/src/native_menu.rs` 自己建 NSMenu（不再走 Tauri 的菜单 API）：说明行（subtitle）、分组标题、模板图标、弹出按钮把选中项盖在按钮上。不再有退回网页菜单的情况。
  - 新接入原生菜单的上游文件：`components/Select.tsx`（短列表；带搜索的长列表仍是网页）、`tasks/PickMenu.tsx`（单选、无搜索）、`chat/RunsOn.tsx`、`views/overview/FilterBar.tsx`、`views/TerminalTab.tsx`、`dialogs/native/PersonMenu.tsx`（菜单项抽成 `usePersonMenu`，网页和原生共用）、`dialogs/native/PersonCards.tsx`。
  - 警告框：`components/Alert.tsx`、`dialogs/native/parts.tsx` 的 `Alert` 在 Mac app 里是 NSAlert（`src-tauri/src/native_alert.rs`、`lib/native-alert.ts`）；带表格或复选框的仍是网页。
  - 跟随系统辅助显示：`src-tauri/src/native_menu.rs` 的 `display_options`，`lib/prefs.ts`（`data-glass`、`data-contrast`），`styles/base.css`（关掉窗口内模糊），`styles/tokens.css`（增强对比度）。
  - 文件：`src-tauri/src/native_files.rs`（Quick Look、系统分享菜单），`lib/files.ts`（`quickLook`、`shareFiles`），`layout/panel/FilesTab.tsx`（右键菜单 + 空格键）、`chat/PathLink.tsx`（右键菜单）。
  - 拖出文件：`src-tauri/src/native_files.rs` 的 `drag_files`（NSDraggingSession），`layout/panel/FilesTab.tsx` 的行 `draggable` + `onDragStart`。
  - 打字跳转：`lib/list-typeahead.ts`（新文件），接在 `layout/panel/FilesTab.tsx`、`ChangesTab.tsx`、`ScratchTab.tsx` 的 `onKey`。
  - 原生表单 sheet：`src-tauri/src/native_sheet.rs`（通用的 NSPanel 表单：多行文本带 @ 补全与高亮、文本框、弹出按钮、分段控件、展开三角、底部复选框），`lib/native-sheet.ts`（`useNativeSheet`，React 仍是状态来源）。第一个用它的是 `tasks/NewTaskSheet.tsx`（提交逻辑抽成 `create`，网页版不变）。
  - 也用原生 sheet 的：`fork/plans/NewPlanSheet.tsx`（新建计划，提交逻辑抽成 `create`）、`dialogs/native/WorkSheets.tsx` 的 Fork 与在朋友电脑上运行命令。弹出按钮的选项支持说明行、分组和禁用（`choicesOf` 把 `Select` 的选项原样转过去），另有行内复选框。新建标签（带删除按钮的标签列表）仍是网页。
  - 第三批原生 sheet：`tasks/boards.tsx`（看板）、`tasks/ProjectContextSheet.tsx`、`dialogs/native/ForkToMacSheet.tsx`、`dialogs/native/ImportConversationSheet.tsx`、`dialogs/native/ContinueSheet.tsx`、`plans/PlanSheets.tsx` 的 `PlanModeSheet`（如何运行：三张卡片，下面是改变了什么的提示框）、`dialogs/native/TemplatesSheet.tsx` 的新建模板、`sentinel/NewSentinelSheet.tsx`。原生 sheet 另加按钮行和按钮行左侧的次要按钮。仍是网页的：添加到仪表盘（双栏预览）、拉取请求、项目设置（环境变量编辑器）、收入、Studio 连接、同步的连接表单、模板列表、新建标签，以及没有输入控件的说明类 sheet。
  - 拖出文件也接在 `layout/panel/ScratchTab.tsx`（自己的草稿）和 `claude-code/AgentOutputs.tsx`（这台 Mac 上的输出）。
  - 审计（2026-11-15，PR 39 / 41 / 44）后的修正：原生 sheet 的回调在更新中被系统回调时不再 panic（`peek`/`try_borrow`），正在输入的文本框不被页面回传覆盖，每个 sheet 有编号（更新、关闭只作用于自己），输入规则（`maxLength`/`upper`/`keep`）在原生框里即时生效，复选框可禁用，单选行去掉（已由卡片取代）；原生菜单的标题、分隔线 tag 为 -1；窗口指针改在主线程里取；空路径不拖；警告框随页面卸载收起、内容变了重新弹出；`useNativeSheet` 卸载后不再打开或更新，每次改动后重发让控件显示页面认可的值。修复智能体只在仍在它身上、且最近一次交还之后又有交接时才交还。对比度规则压过自定义配色；几处图标按钮补成常规尺寸。留着的：Quick Look 没按面板控制者协议接入（能用，会打警告）。
  - `src-tauri/Cargo.toml`：直接依赖 `objc2-app-kit`、`objc2-foundation`（版本与依赖树里已有的一致）；`src-tauri/src/lib.rs` 注册这些命令。
  - 原生 sheet 用页面的配色（2026-11-18，`6484483ed`）：`lib/native-sheet.ts` 打开时从 `:root` 读 `--accent`、`--bg`、`--bg-raised` 和深浅色，作为 `palette` 发给 sheet（主题缺某个变量时不发，sheet 用系统自己的颜色）；`<html>` 的主题、强调色变化时重发。颜色解析在 `fork/native/hex-colour.ts`（不带依赖，根目录测试 `tests/fork-native-sheet-palette.test.ts` 直接引它）。`src-tauri/src/native_sheet.rs` 的 `SheetPalette`、`apply_chrome` 按它设外观、卡片和主按钮的颜色；`src-tauri/Cargo.toml` 为此给 `objc2-app-kit` 加了 `NSAppearance`、`NSColorList` 两个 feature。

### 原生 Mac 控件与外壳的逐文件登记（BLG-257 补登记）

BLG-257 查清了 `sync-upstream --report` 的 208 个未登记文件：**没有一个是 M8 改的**（M8 的上游改动只有 `packages/mac/vite.config.ts` 两行，已登记）。其中 206 个来自 `topic/native` 的那一个快照提交 `da1993452`（「Native Mac: controls, menus, sheets, alerts, the sidebar and the calm UI」，从 `archive/main-2026-11-17` 拆出来的），1 个来自 `fork/base`（`CLAUDE.md`），1 个来自 `topic/chinese`/`fork/base`（`zh-CN.json`）。上面「原生控件」「原生菜单与按下指针」两节只用简写路径描述了这些改动（比如 `layout/Toolbar.tsx`），脚本按完整路径找，所以一直显示未登记。下面按改动的性质逐个列出完整路径；原因同上面两节：控件规范 `docs/mac-controls.md` 直接改在上游自己的文件里，因为它本来就要提回上游，所以不能搬进 fork 文件。

- 样式：控件、菜单、侧栏、对话的 CSS（尺寸、边框、按下态、颜色，`docs/mac-controls.md`）（56 个）：`packages/mac/src/agent-term/agent-term.module.css`、`packages/mac/src/call/call.module.css`、`packages/mac/src/call/notes.module.css`、`packages/mac/src/chat/chat.module.css`、`packages/mac/src/chat/mcp-app/mcp-app.module.css`、`packages/mac/src/chat/pr-strip.module.css`、`packages/mac/src/components/ProjectIcon.module.css`、`packages/mac/src/components/alert.module.css`、`packages/mac/src/components/code/code.module.css`、`packages/mac/src/components/form.module.css`、`packages/mac/src/components/graph/graph.module.css`、`packages/mac/src/components/preview/preview.module.css`、`packages/mac/src/components/select.module.css`、`packages/mac/src/components/telemetry-levels.module.css`、`packages/mac/src/components/ui.module.css`、`packages/mac/src/components/views/views.module.css`、`packages/mac/src/dialogs/add-project.module.css`、`packages/mac/src/dialogs/env-settings.module.css`、`packages/mac/src/dialogs/fire-settings.module.css`、`packages/mac/src/dialogs/native/menus.module.css`、`packages/mac/src/dialogs/native/person.module.css`、`packages/mac/src/dialogs/native/sharing.module.css`、`packages/mac/src/dialogs/terminal-settings.module.css`、`packages/mac/src/dialogs/themes.module.css`、`packages/mac/src/gateway/access.module.css`、`packages/mac/src/gateway/gateway.module.css`、`packages/mac/src/issues/issues.module.css`、`packages/mac/src/layout/BranchControl.module.css`、`packages/mac/src/layout/Sidebar.module.css`、`packages/mac/src/layout/SidebarSearch.module.css`、`packages/mac/src/layout/Toolbar.module.css`、`packages/mac/src/layout/panel/panel.module.css`、`packages/mac/src/network/network.module.css`、`packages/mac/src/onboarding/scenes/scenes.module.css`、`packages/mac/src/onboarding/scenes/tour-scenes.module.css`、`packages/mac/src/phone/phone-view.module.css`、`packages/mac/src/plans/PlanCanvas.module.css`、`packages/mac/src/popup/popup.module.css`、`packages/mac/src/pr/pr-conversation.module.css`、`packages/mac/src/sentinel/data.module.css`、`packages/mac/src/sentinel/home.module.css`、`packages/mac/src/sentinel/numbers.module.css`、`packages/mac/src/sentinel/sentinel.module.css`、`packages/mac/src/styles/base.css`、`packages/mac/src/tasks/NewTaskSheet.module.css`、`packages/mac/src/tasks/board-people.module.css`、`packages/mac/src/tasks/tasks.module.css`、`packages/mac/src/team/team.module.css`、`packages/mac/src/threads/threads.module.css`、`packages/mac/src/views/lists.module.css`、`packages/mac/src/views/overview.module.css`、`packages/mac/src/views/overview/filter-bar.module.css`、`packages/mac/src/views/project/main-sync.module.css`、`packages/mac/src/views/usage/recap.module.css`、`packages/mac/src/views/usage/usage.module.css`、`packages/mac/src/views/usage/your-card.module.css`
- TSX/TS：`Button`/`IconButton`/`Select`/`Segmented` 的 `size`、原生菜单与 sheet 的接入、侧栏与对话的结构（`docs/mac-controls.md`，「原生控件」「原生菜单与按下指针」两节）（144 个）：`packages/mac/src/agent-term/ConvoSwitch.tsx`、`packages/mac/src/agent-term/TermPane.tsx`、`packages/mac/src/agent-term/VisualsPanel.tsx`、`packages/mac/src/chat/AskBanner.tsx`、`packages/mac/src/chat/AssistantTabs.tsx`、`packages/mac/src/chat/Attention.tsx`、`packages/mac/src/chat/EditPrompt.tsx`、`packages/mac/src/chat/FindBar.tsx`、`packages/mac/src/chat/PathLink.tsx`、`packages/mac/src/ci/ActionsView.tsx`、`packages/mac/src/ci/RunPage.tsx`、`packages/mac/src/ci/parts.tsx`、`packages/mac/src/claude-code/ActivityView.tsx`、`packages/mac/src/claude-code/AgentMonitor.tsx`、`packages/mac/src/claude-code/AgentOutputs.tsx`、`packages/mac/src/claude-code/BackgroundTasks.tsx`、`packages/mac/src/components/Alert.tsx`、`packages/mac/src/components/ProjectIcon.tsx`、`packages/mac/src/components/Select.tsx`、`packages/mac/src/components/SelectMenu.tsx`、`packages/mac/src/components/code/CodeRefBlock.tsx`、`packages/mac/src/components/graph/FlowGraph.tsx`、`packages/mac/src/components/graph/GraphBlock.tsx`、`packages/mac/src/components/graph/Inspector.tsx`、`packages/mac/src/components/graph/Walkthrough.tsx`、`packages/mac/src/components/markdown/DocFind.tsx`、`packages/mac/src/components/preview/PreviewBlock.tsx`、`packages/mac/src/components/preview/PreviewParts.tsx`、`packages/mac/src/components/ui.tsx`、`packages/mac/src/components/views/Chart.tsx`、`packages/mac/src/components/views/ViewBlock.tsx`、`packages/mac/src/dialogs/AddProjectSheet.tsx`、`packages/mac/src/dialogs/EnvEditor.tsx`、`packages/mac/src/dialogs/EnvRows.tsx`、`packages/mac/src/dialogs/EnvironmentSettings.tsx`、`packages/mac/src/dialogs/FireSettings.tsx`、`packages/mac/src/dialogs/KeyboardSettings.tsx`、`packages/mac/src/dialogs/LocalModelsSettings.tsx`、`packages/mac/src/dialogs/MachinesSettings.tsx`、`packages/mac/src/dialogs/ReportProblemRow.tsx`、`packages/mac/src/dialogs/TerminalThemes.tsx`、`packages/mac/src/dialogs/UpdateSettings.tsx`、`packages/mac/src/dialogs/UsageLimitSettings.tsx`、`packages/mac/src/dialogs/native/ContinueSheet.tsx`、`packages/mac/src/dialogs/native/ForkToMacSheet.tsx`、`packages/mac/src/dialogs/native/ImportConversationSheet.tsx`、`packages/mac/src/dialogs/native/MergeReview.tsx`、`packages/mac/src/dialogs/native/ShareFolderSheet.tsx`、`packages/mac/src/dialogs/native/TemplatesSheet.tsx`、`packages/mac/src/dialogs/native/WorkConfirm.tsx`、`packages/mac/src/dialogs/native/parts.tsx`、`packages/mac/src/gateway/RequestsView.tsx`、`packages/mac/src/gateway/TaskCard.tsx`、`packages/mac/src/issues/IssueComposer.tsx`、`packages/mac/src/issues/IssuePage.tsx`、`packages/mac/src/issues/IssuesView.tsx`、`packages/mac/src/issues/PullsView.tsx`、`packages/mac/src/issues/parts.tsx`、`packages/mac/src/layout/AppMenu.tsx`、`packages/mac/src/layout/BranchControl.tsx`、`packages/mac/src/layout/CategorySections.tsx`、`packages/mac/src/layout/ChatsMenu.tsx`、`packages/mac/src/layout/RightPanel.tsx`、`packages/mac/src/layout/SharedProjects.tsx`、`packages/mac/src/layout/Toolbar.tsx`、`packages/mac/src/layout/panel/ChangesTab.tsx`、`packages/mac/src/layout/panel/FilesTab.tsx`、`packages/mac/src/layout/panel/ScratchSkeleton.tsx`、`packages/mac/src/layout/panel/ScratchTab.tsx`、`packages/mac/src/layout/panel/TerminalPane.tsx`、`packages/mac/src/layout/row-triage-actions.tsx`、`packages/mac/src/lib/files.ts`、`packages/mac/src/lib/prefs.ts`、`packages/mac/src/machines/GettingReady.tsx`、`packages/mac/src/machines/MachinePane.tsx`、`packages/mac/src/machines/StartingThere.tsx`、`packages/mac/src/network/ConversationHeader.tsx`、`packages/mac/src/network/ConversationView.tsx`、`packages/mac/src/network/GroupInfo.tsx`、`packages/mac/src/network/NetComposer.tsx`、`packages/mac/src/network/NetworkSidebar.tsx`、`packages/mac/src/phone/PhoneView.tsx`、`packages/mac/src/plans/PlansView.tsx`、`packages/mac/src/plans/marks.tsx`、`packages/mac/src/popup/RequestPopup.tsx`、`packages/mac/src/pr/PrConversation.tsx`、`packages/mac/src/pr/PrPage.tsx`、`packages/mac/src/sentinel/DataCard.tsx`、`packages/mac/src/sentinel/DataSheet.tsx`、`packages/mac/src/sentinel/DocumentSheet.tsx`、`packages/mac/src/sentinel/MeasureFields.tsx`、`packages/mac/src/sentinel/NewSentinelSheet.tsx`、`packages/mac/src/sentinel/NumberParts.tsx`、`packages/mac/src/sentinel/NumbersCard.tsx`、`packages/mac/src/sentinel/RunPage.tsx`、`packages/mac/src/sentinel/SentinelCards.tsx`、`packages/mac/src/sentinel/SentinelChat.tsx`、`packages/mac/src/sentinel/SentinelHome.tsx`、`packages/mac/src/sentinel/SentinelPage.tsx`、`packages/mac/src/tasks/Brief.tsx`、`packages/mac/src/tasks/NewTaskSheet.tsx`、`packages/mac/src/tasks/ProjectContextSheet.tsx`、`packages/mac/src/tasks/ProofPreview.tsx`、`packages/mac/src/tasks/TaskList.tsx`、`packages/mac/src/tasks/TaskPage.tsx`、`packages/mac/src/tasks/TaskSections.tsx`、`packages/mac/src/tasks/TasksView.tsx`、`packages/mac/src/tasks/boards.tsx`、`packages/mac/src/team/SharedPlans.tsx`、`packages/mac/src/team/Team.tsx`、`packages/mac/src/views/ChatView.tsx`、`packages/mac/src/views/DiffView.tsx`、`packages/mac/src/views/EarningsCard.tsx`、`packages/mac/src/views/FilesView.tsx`、`packages/mac/src/views/Overview.tsx`、`packages/mac/src/views/TerminalView.tsx`、`packages/mac/src/views/UsageView.tsx`、`packages/mac/src/views/WorktreeInfo.tsx`、`packages/mac/src/views/history/CommitDetail.tsx`、`packages/mac/src/views/history/HistoryFilters.tsx`、`packages/mac/src/views/overview/OverviewRows.tsx`、`packages/mac/src/views/project/EarningsSection.tsx`、`packages/mac/src/views/project/EnvAsks.tsx`、`packages/mac/src/views/project/GitHubRow.tsx`、`packages/mac/src/views/project/PullRow.tsx`、`packages/mac/src/views/reader/EditTools.tsx`、`packages/mac/src/views/reader/FileFocus.tsx`、`packages/mac/src/views/reader/FileReader.tsx`、`packages/mac/src/views/reader/PdfView.tsx`、`packages/mac/src/views/reader/component-preview.tsx`、`packages/mac/src/views/room/ConnectionStatus.tsx`、`packages/mac/src/views/usage/Breakdown.tsx`、`packages/mac/src/views/usage/CleanupCard.tsx`、`packages/mac/src/views/usage/EarningsSummaryCard.tsx`、`packages/mac/src/views/usage/Leaderboard.tsx`、`packages/mac/src/views/usage/PlanCard.tsx`、`packages/mac/src/views/usage/Recap.tsx`、`packages/mac/src/views/usage/SessionsCard.tsx`、`packages/mac/src/views/usage/StatsSection.tsx`、`packages/mac/src/views/usage/StorageCard.tsx`、`packages/mac/src/views/usage/YourCard.tsx`、`packages/mac/src/views/worktrees/WorktreeItem.tsx`、`packages/mac/src/views/worktrees/WorktreesView.tsx`、`packages/mac/src/work/NoProjects.tsx`
- 只加了 `size` 的 TSX（规范第 4 步）（2 个）：`packages/mac/src/dialogs/MenuBarSettings.tsx`、`packages/mac/src/dialogs/WebAccessSettings.tsx`
- Tauri 外壳：objc2 依赖、`native_menu`、`native_alert`、`native_files`、`native_sheet` 命令的注册和权限（NSMenu、NSAlert、Quick Look、拖拽、NSSheet）（4 个）：`packages/mac/src-tauri/Cargo.lock`、`packages/mac/src-tauri/Cargo.toml`、`packages/mac/src-tauri/capabilities/default.json`、`packages/mac/src-tauri/src/lib.rs`
- `fork/base`：「Working in this fork」一节，写分支链和规矩（1 个）：`CLAUDE.md`
- `topic/chinese`/`fork/base`：Mac 端的简体中文翻译（`docs/chinese.md`）（1 个）：`packages/mac/src/i18n/zh-CN.json`

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
- `packages/mac/src/i18n/zh-CN.json`：fork 自己的 `{0} new` 词条。

### M3 逐页补改（docs/calm/overlay.md §12；每处一行接入点）

逐页验收（BLG-170–172）后，覆盖层管不到的行为动效改成接入点；全部是「沉稳开时才改变」，关掉开关与上游一致。每个文件都在 `tests/fork-calm.test.ts` 的 `TOUCHPOINTS` 有 canary（标 ✓）。

- `packages/mac/src/chat/steps/AgentSteps.tsx` ✓：`useStill()` 读 `useCalm()`，沉稳时步骤行的 framer 进场/退场为 0 时长（CH-02）。
- `packages/mac/src/chat/flight.ts` ✓：`land()`/`launchFlight()` 在沉稳时走「瞬时」分支，消息不再从输入框飞入（CH-06）。
- `packages/mac/src/tasks/TaskBoard.tsx` ✓：`reduce` 判据加 `calmOn()`，沉稳时卡片重排/落位不做 framer layout 动画（WK-01）；`Fold` 的 layout effect 在展开时也调 `onMove()`（BLG-208）——立即展开没有动画帧，拖拽的「展开后重读列位置」窗口（`foldMoved`）开不起来，`tasks.spec.ts:495` 的 Ready 列放置间隙在沉稳开时不出现。
- `packages/mac/src/sentinel/DashboardPage.tsx` ✓：`still()` 加 `calmOn()`，沉稳时仪表盘瓦片不做 220/260ms 的 glide（DA-02）。
- `packages/mac/src/onboarding/onboarding.module.css`：`@media (prefers-reduced-motion: reduce)` 停掉 `heroSoft` 的 sheen 与 `beam`（RE-01，上游缺口；沉稳模式 M5 已停）。
- `packages/mac/src/call/NotesBox.tsx`：跳到一条发言的高亮 900ms → 160ms，Reduce motion 下不做（overlay §8.1 遗留）。
- `packages/mac/src/call/PointerMark.tsx` ✓：点击指针标记的 1.16 弹跳在沉稳模式下不做（`calmOn()` 加进 `paintTag` 的守卫；reduced-motion 上游本来就停）。上游 3.2.0 新增，M4 同步跟进（`docs/calm/overlay.md` §12.2）。
- `packages/mac/src/chat/KeyPasteCard.tsx` ✓：粘贴 API key 的卡片（上游 3.5.0）用 `element.animate()` 做的两处高度缓动（300/380ms，为了让上面的聊天不跳），沉稳模式下走 `calmMs()`（`fork/calm/calm-state.ts`：最多 160ms，减弱动效时为 0）；它的 CSS 动画由 `calm-motion.css` 的总规则关掉。
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

### 手机协议的 minor 编号（3.3.0、3.4.0 及之后同步时顺延）

fork 的手机协议新增在 `src/companion/protocol.ts` 里接在上游后面编号。上游 3.3.0 用掉了 1.51–1.54，和 fork 当时的 1.51–1.55 撞号，同步时 fork 的顺延为 1.55–1.59；“谁做的”（`rolesSeen`）在它的分支上编的是 1.55，合进 main 时顺延为 1.60。上游 3.4.0 又用掉了 1.55（`sharedMark`，BLG-940：共享出去的工作树在侧栏显示绿点），fork 的几条整体再往后挪一位：`checkAgent` 56、`autoAgent` 57、`archAgent` 58、`fixAgent` 59、Synon Studio Gate 60、`rolesSeen` 61，`COMPANION_PROTO.minor` 为 61。3.4.0 之后上游又用掉 1.56（BLG-952：任务因验收条件未完成被留在评审中，`TaskSummary.needsChecks`），fork 再顺延一位：`checkAgent` 57、`autoAgent` 58、`archAgent` 59、`fixAgent` 60、Synon Studio Gate 61、`rolesSeen` 62，`COMPANION_PROTO.minor` 为 62。以后上游再加 minor，fork 的这几条继续顺延到上游最大值之后，并同步改 `tests/plan-*-agent.test.ts`、`tests/companion-supports-fix-agent.test.ts`、`tests/fork-companion-roles.test.ts`、`docs/parity.fork.md`、docs/companion.md（Studio Gate 一段）、`docs/tasks-and-plans.fork.md`，以及 src/companion/calls.ts、src/companion/views.ts、`src/fork/companion/`、`packages/companion/`（`lib/link/calls.ts`、`lib/fork/roles-words.ts`、`components/fork/MilestoneRoles.tsx`、`app/plan/[id].tsx`、`app/task/[id].tsx`）注释里的编号。

### 版本号（脚本自动处理）

- `packages/mac/package.json`、`packages/mac/src-tauri/tauri.conf.json`

### 计划的角色：以上游为准（2026-11-18）

计划谁规划、谁建造、谁检查，用上游 BLG-982 的那一套（`planner` / `agent` / `checker`，`plans.setRoleAgent`，新建计划里的一句话和计划页头部的 agents 按钮，手机协议 1.58）。fork 原来的那一套在 2026-11-18 整个删了：按档位分工（架构师每个里程碑先写设计稿、疑难修复智能体、计划设置表）、自动路由（`autoRoute`，没指定 agent 的任务按难度挑模型）、模型失效的升级梯子和失效模型记录、“谁做的”、任务卡片上的模型标签。上游文件里它们的改动都恢复成上游原样；手机协议里它们占过的 1.59–1.61、1.63 不再使用。旧的 plans.json 里留下的 `archAgent`、`fixAgent`、`checkAgent` 读进来不起作用。

留下的、不属于角色的两处修复：

- `src/core/plans/pilot.ts`、`src/core/plans/plan-git.ts`（`hasBranch`）、`tests/plans.test.ts`、`tests/plan-milestone-agent.test.ts`：任务的分支已经随前一个里程碑合并、删掉时，里程碑照样通过，不再去合并它
- `packages/mac/src/plans/PlanPage.tsx`、`PlanChat.tsx`、`PlanOutline.tsx`、`PlanDetails.tsx`、`plan-ask-model.ts`（`tests/mac-plan-decide.test.ts`）：你要做的任务点 Decide…，计划的对话打开并滚到这个任务的卡片
- `packages/mac/src/plans/plans.module.css`：末尾三行，窄屏时操作换到计划名下面（BLG-124）

任务卡片上的模型（2026-11-18 从原来的角色代码里挪出来，改成只读上游的数据）：数据在 `src/fork/plans/task-agent.ts`（`taskAgentSeen`），界面在 `packages/mac/src/fork/plans/TaskAgentChip.tsx` 和 `task-agent.module.css`，测试 `tests/fork-task-agent.test.ts`。开工后显示任务所在工作树当前的 agent 和模型；没开工时显示将来做它的：任务自己的 agent，否则计划的建造者（`Plan.agent`），否则项目的 agent，都没有就不显示（用你的默认 agent）；你自己做的任务不显示。名字按上游计划页的写法，agent 加模型（“Claude (Haiku)”）。大纲没开工也显示，画布只在开工后显示（画布的任务节点拿不到计划，补上要改上游文件三行以上）。上游文件的接入点：`packages/mac/src/plans/PlanCanvas.tsx`、`PlanOutline.tsx` 各两行（import 和一行组件）。只在 Mac 上，手机的计划页没有任务卡片上的模型。

### 联邦制：自动接单（队友派给本机的任务自己开工）

设置形状在 `src/fork/federation/settings.ts`，字段经 `src/fork/settings-fields.ts` 进到上游的 Settings 和 PrefsPatch。

- src/machines/sync.ts：`federation` 在 `LOCAL_SETTINGS` 里，自动接单是这台电脑的容量和信任，不随设置同步（一行）
- src/core/store.ts：`Prefs` 的 `autoRoute`、`federation` 两个字段，`prefsFrom` 数组里多一个 `'federation'`（只改 fork 旧行，行数不涨）
- src/ipc/api.ts：`PrefsPatch` 里 `...forkPrefsPatch`，替换原来的 autoRoute import 和字段（行数不涨）
- src/core/board/launch.ts：把 `federationParts` 装进看板部件（BLG-225）

### 计划图与大纲共用（`packages/ui-plan`，BLG-90）

计划图与大綱抽成 `packages/ui-plan`，Mac、客户 web 应用和手机读同一份；上游文件里只有「换成共用组件」的接入点。

- packages/companion/components/PlanParts.tsx：`MilestoneMap` 换成共用包（手机保留自己的按压、触感与淡入，状态词和颜色仍是手机自己的）
- packages/companion/metro.config.js、packages/companion/tsconfig.json：把 `packages/ui-plan` 加进手机端的共享路径

### Synon Studio（客户写需求、看计划；开工前由你确认）

客户 web 应用（`packages/studio-app`）、中台（`packages/studio-hub`）与 daemon 的 `src/studio/` 都是 fork 自己的文件；下面这些上游文件里只有接入点。

- src/cli/args.ts、src/cli/main.ts：`beluga studio link/status/unlink/share/unshare` 命令
- src/core/agent-host.ts：`plans` 的返回值把 `customerTurn` 透传给 agent
- src/core/plans/edit.ts：计划任务的 `audience`（客户可见 / 仅你可见，`src/studio/decisions.ts`）
- `src/daemon/core.ts`：起停 `launchStudio`（没连接时什么都不做）
- src/daemon/server.ts：浏览器 cookie 不能 `studio.link` / `studio.unlink` / `studio.setProject`
- `src/ipc/handlers.ts`：展开 `FORK_HANDLERS`（`src/ipc/fork-handlers.ts`：Synon Studio 的 `STUDIO_HANDLERS`，加上保存前先校验的 `env.saveEndpoint`。它排在上游自己的那一项后面，所以覆盖了上游的处理器；上游那一项原样留着，同步上游时如果上游改了 `env.saveEndpoint` 的保存逻辑，要把改动带进 `checkedSave`）
- src/agent/runtime/copilot/runner.ts、src/agent/runtime/opencode/runner.ts：客户回合的 policy 带 `customerTurn`
- `packages/mac/src/layout/NotificationCenter.tsx`、`packages/mac/src/layout/ProjectTree.tsx`、packages/mac/src/layout/waiting-model.ts：开工确认卡片（计划、里程碑、点数、带上理由的拒绝）与项目菜单里的「连接 Studio」；三处都只有这些新增，没有新动效
- packages/companion/app/need/[id].tsx、packages/companion/components/Needs.tsx：手机上的 `studio-start` 卡片（Approve 开工，Decline 写一句客户会看到的话）
- docs/companion.md、docs/how-it-works.md：Synon Studio 的手机卡片与整体说明（详见 `docs/studio.md`）
- tests/boundaries.test.ts：`src/studio` 算核心（不含 UI）
- tests/browser-safe.test.ts：`src/studio/protocol.ts`、`actions.ts`、`sanitize.ts`、`view.ts` 必须浏览器安全
- tests/machine-coverage.test.ts：studio 的管理与 Gate 方法不从「你的电脑」放行
- tests/web-security.test.ts：浏览器 cookie 做不了 studio 管理
- tsconfig.json：`tests/team/studio-app-*.test.ts` 三个用 Expo/React Native 类型，交给 `packages/studio-app/tsconfig.json` 检查，根 typecheck 排除

### Over SSH：Beluga 退出时 ssh 配对一并结束（886b0ec13：留在 fork，不提回上游）

上游 3.5.0 起 src/machines/machines.ts、tests/machines-ssh.test.ts 与上游一致（上游有了同样的结束处理），这里的差异已经没有了。

原因：「Over SSH」添加电脑时起的 `ssh … beluga pair --computer` 要随 Beluga 退出一起结束，不能等配对在那边过期；停止中的 `sshPairStart` 也要拒绝新配对。这是 fork 的功能，上游没有。

- src/machines/machines.ts：关闭时停掉 `this.ssh`；停止中不再接受新的 SSH 配对
- tests/machines-ssh.test.ts：对应的用例

### 设置里打开的表单盖在设置窗口之上（BLG-213：留在 fork，不提回上游）

原因：上游的设置窗口是 `z-index` 44/45，`FormSheet`（表单弹窗）是 40/41，所以从设置里打开的表单（Studio 的「连接到 Studio…」、项目的 worktree 环境等）会被设置窗口盖住、无法输入。上游自己的做法是原生 sheet，不受影响；fork 的 Studio 入口在设置里，需要抬高。`FormSheet` 渲染时若页面上有设置窗口（`[data-settings]`），就加 `data-over-settings`，层级 48/49（仍低于 alert 50）。从项目 ⋯ 菜单等处打开时属性不出现，表现不变。

- packages/mac/src/components/FormSheet.tsx：渲染时判断设置是否打开，两处加 `data-over-settings`
- `packages/mac/src/dialogs/sheet.module.css`：`[data-over-settings]` 的 48/49
- `packages/mac/src/dialogs/Settings.tsx`：设置窗口的 `data-settings` 标记（判断用）

已知限制：设置叠在引导页上时（`[data-over-welcome]`，`settings.module.css` 的 86/87），48/49 仍不够，从设置里打开的 FormSheet 会被盖住；BLG-213 没有加更高的 `'welcome'` 档。这条窄路径（引导页上开设置再进 Studio）留着将来一起处理。

### 客户邀请与客户端（BLG-14 至 BLG-17、BLG-34、BLG-36）

- src/companion/pair.ts、src/companion/devices.ts、src/companion/host.ts、src/ipc/companion-api.ts、src/ipc/companion-handlers.ts
- `packages/mac/src/phone/Phone.tsx`、packages/mac/src/phone/phone-model.ts
- packages/companion/app/_layout.tsx、packages/companion/app/(tabs)/_layout.tsx、packages/companion/app/index.tsx、packages/companion/lib/store.ts
- tests/companion-coverage.test.ts、`tests/companion-views.test.ts`、`tests/mac-settings-search.test.ts`

### 菜单完整显示、中文不带结尾的“…”

- `packages/mac/src/components/SpecMenu.tsx`、`packages/mac/src/components/SpecMenu.module.css`、`packages/mac/src/chat/RunsOn.tsx`、`packages/mac/src/dialogs/native/PersonCards.tsx`、`packages/mac/src/dialogs/native/PersonMenu.tsx`、`packages/mac/src/tasks/PickMenu.tsx`、`packages/mac/src/views/TerminalTab.tsx`、`packages/mac/src/views/overview/FilterBar.tsx`

### git 输出固定用英文（上游已采纳：beluga-labs/beluga#566）

原因：中文系统下 git 的提示是中文，Beluga 按英文原话判断 git 的结果（冲突、没有改动、分支不存在等）会判断错（见 `docs/reports/plan-roles-git-locale.md`）。上游 #566 收下了 `git.ts`、`pr.ts`、`archive-git.ts` 的部分（`GIT_IN_ENGLISH`），这几处以上游为准。fork 只剩上游没覆盖的一处：

- `src/machines/ready.ts`、`tests/machines-ready.test.ts`：在另一台电脑上 clone 时也加 `LC_MESSAGES=C LANGUAGE=C`
- fork 自己的测试 `tests/git-locale.test.ts`：中文环境下真跑 git，验证上游的 `GIT_IN_ENGLISH`

### 中文输入法组字时 Enter 只选词（上游已采纳：beluga-labs/beluga#573）

上游收下了整套做法（packages/mac/src/lib/ime.ts、`lib/ime-guard.ts`、`lib/install-ime-guard.ts`，`main.tsx` 一行），fork 不再改任何文件：原来的 `packages/mac/src/fork/boot.ts`、`fork/ime-guard.ts`、`e2e/fork-ime.spec.ts` 已删，测试用上游的 tests/ime.test.ts、tests/ime-guard.test.ts、packages/mac/e2e/ime.spec.ts。原因和经过见 `docs/reports/plan-roles-ime.md`。

### 适合提回上游的通用修复

- 设置窗口标题和搜索框固定、只有列表滚动：`packages/mac/src/dialogs/Settings.tsx`、`packages/mac/src/dialogs/settings.module.css`
- 路径上不存在的图片显示为“缺失”：`packages/mac/src/chat/images.ts`、`src/agent/prompt.ts`、`src/agent/run-instructions.ts`、`tests/mac-chat-images-cache.test.ts`
- 本地模型在自己的文件夹里运行 Claude Code：src/agent/runtime/local.ts、tests/local-endpoints.test.ts（上游 3.4.0 合并了 #500 的最终版：设置文件改为清理过的副本；同步时 `endpoint-home.ts` 以上游为准）
- `/` 列表跟随链接的技能和命令：`src/core/claude-code/skills.ts`、`tests/skills.test.ts`
- 用量时间轴的「Now」线不挡悬停（`pointer-events: none`，标记不是点击目标）：`packages/mac/src/views/usage/stats.module.css`
- e2e 夹具：预热太久的 demo daemon 不复用（它的时钟已经走过 demo 的定时事件），超过 45 秒就另起一个：packages/mac/e2e/fixtures.ts
- Linux 机器测试先探测 UDP/TCP/子进程，被沙箱挡住就跳过并说明原因，而不是等配对超时：tests/machines/linux-computer.test.ts
- 任务需要你出手时用卡片提问，停下时显示它最后说的话：src/core/plans/prompt.ts、src/core/plans/watchdog.ts、src/core/plans/model.ts、src/core/notify.ts、src/companion/needs-you.ts、packages/mac/src/plans/plans-model.ts、tests/plans-watchdog.test.ts、tests/notify.test.ts、`tests/plan-milestone-agent.test.ts`（上游 3.4.0 合并了 #511 的最终版：按钮仍叫 Resume，原话放在说明里；同步时这几处文案以上游为准，`passable` 也加上了合并失败后可再次通过）

### 从其他 fork 移植的修复（2026-11-12）

都是对所有人有用的修复，原样（或按本 fork 调整后）cherry-pick 进来，提交说明里有 `cherry picked from` 原提交。上游合并同样的改动后，这里的差异就消失；上游合并的是改过的版本时，同步时以上游为准。

- 目录搜索打不开凭据文件、朋友的 Claude 不继承 daemon 的环境变量、损坏的 identity.json 不被覆盖（faufderhar/beluga `fcc78b30`，未提上游）：src/agent/policy.ts、src/agent/runtime/claude/runner.ts、src/net/crypto.ts、tests/policy.test.ts、tests/identity.test.ts。上游 3.4.0 合并了最终版（#490），同步时 `policy.ts` 的目录搜索、`identity-load.ts` 以上游为准，只留 fork 的 `decideCustomerTurn`
- macOS 上 `ps` 卡住会让归档一直挂着；测试用独立的系统 HOME（gardinermichael/beluga `f97b40a9`，未提上游）：src/workspaces/test-procs.ts、tests/setup.ts、tests/background-tasks.test.ts、tests/delete-unpushed.test.ts、tests/friend-share/fork.test.ts、tests/friend-share/projects.test.ts、tests/other-worktrees.test.ts、tests/smart-archive.test.ts。上游 3.4.0 合并了最终版（#491），同步时以上游为准
- Codex 把 Beluga 自己工具的调用交给 Beluga 的权限检查（`default_tools_approval_mode: 'approve'`；JoeHosman/beluga `1816d986`，未提上游）：src/agent/runtime/codex/runner.ts、tests/codex-parity.test.ts
- ~~MCP 服务需要登录时，会话里直接点 Sign in~~：上游 3.3.0 合并了 #427 的最终版（agent 调 `mcp__beluga_mcp__mcp_sign_in` 登录，没有会话里的提示条），同步时撤掉了这里移植的早期版本，以上游为准。
- Autopilot 不再放过合并失败的里程碑（voshond/beluga `5accb683`）：`src/core/plans/pilot.ts`、`tests/plans.test.ts`。上游 3.4.0 合并了最终版（#493），同步时以上游为准
- 回答 agent 提问时附的图片（voshond/beluga `a577f13f`）：src/core/attachments.ts、src/agent/runtime/claude/runner.ts、packages/mac/src/chat/use-attachments.tsx、packages/mac/src/plans/PlanAsk.tsx、`packages/mac/src/plans/plan-ask.module.css`、tests/attachments.test.ts
- zsh 接受 agent 写的 bash（voshond/beluga `2563a35f`；上游没有 `INSTRUCTION_PIECES`，改成接进 `runInstructions` 的字符串）：`src/agent/prompt.ts`、`src/agent/run-instructions.ts`、src/agent/runtime/claude/runner.ts、src/agent/runtime/claude/terminal.ts
- 审计 PR 24 后的修正（2026-11-13，提交 `554152d3f`）：目录搜索带自己的 glob 时不再被换掉；`~/.beluga/attachments` 可读（回答里的图片才读得到）；`identity.json` 损坏时 daemon 照常启动（一次性身份，文件不动）；朋友的运行保留 Claude Code 自己的设置变量；zsh-compat 在 Windows 上不设、文件整写。src/agent/policy.ts、src/core/shares.ts、src/machines/identity-load.ts、src/net/crypto.ts、src/agent/runtime/claude/runner.ts、src/agent/runtime/claude/zsh-compat.ts，以及对应测试。
- Studio 客户回合的目录搜索也查打开的凭据文件（`a663330e3`，fork 自己的，留在 fork）：src/agent/policy.ts 的 `decideCustomerTurn`、tests/policy.test.ts。
- 以上通用修复提回上游的 6 个 PR（beluga-labs/beluga #490–#495）已于 2026-11-13 全部合并，3.4.0 / 3.5.0 起这些文件与上游一致（src/agent/policy.ts 里 Studio 客户回合那部分是 fork 自己的，仍留着），同步 3.5.0 时从「改了上游的文件」清单里消失。

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
- `packages/mac/src/i18n/zh-CN.json`：中文文案
- `tests/sharing-defaults.test.ts`、`packages/mac/e2e/sharing-defaults.spec.ts`、`tests/fork-calm.test.ts`（Settings.tsx 的 canary）、`tests/mac-settings-search.test.ts`（people 页的来源加上 `fork/sharing/MySharing.tsx`）、`packages/mac/scripts/calm-check.mjs`（`sharing` 场景，200 圈演示源）

### topic/plans 的逐文件登记（M9 补登记，2026-11-18）

M9 合并后 `sync-upstream --report` 在这个分支上查出的未登记文件。全部是这个分支自己的改动（快照提交 `1556b0730` 以及之后改用上游计划角色的几个提交），按用途登记：

- Antigravity（Google 的编码 agent，经 `agy acp` 运行；运行时在 fork 自己的 `src/agent/runtime/antigravity/`）：上游文件只加它的名字、标记、登录与清理的接入点。`src/protocol.ts`、`src/shared/agent-label.ts`、`src/shared/agent-marks.ts`、`src/shared/agent-runtimes.ts`、`src/shared/run-failure.ts`、`src/shared/runtime-fallbacks.ts`、`src/agent/runtime/registry.ts`、`src/agent/runtime/router.ts`、`src/agent/runtime/drop-session.ts`、`src/agent/runtime/opencode/acp.ts`（工具的原名）、`src/core/dialogues/launch.ts`、`src/core/sentinel/tool-draft.ts`、`src/machines/words.ts`、`src/telemetry/turn.ts`、`src/workspaces/manager.ts`（清理 Antigravity 的会话与文件夹，另加 `hasBranch`）、`packages/mac/src/chat/Items.tsx`、`packages/mac/src/chat/model-words.ts`、`packages/mac/src/onboarding/Steps.tsx`、`packages/mac/src/onboarding/agent-setup.ts`、`packages/mac/src/views/usage/stats-model.ts`、`packages/mac/e2e/onboarding-agents.spec.ts`、`docs/security.md`、`docs/sentinel.md`、`docs/telemetry.md`、`docs/terminal-view.md`；测试 `tests/agent-marks.test.ts`、`tests/agent-picker.test.ts`、`tests/runtime-conformance.test.ts`、`tests/side-call-protocol-errors.test.ts`、`tests/work-ui.test.ts`、`tests/__snapshots__/companion-views.test.ts.snap`
- 计划里“Decide…”直接打开那张卡片（并滚到它）：`packages/mac/src/plans/plan-ask-model.ts`、`packages/mac/src/plans/PlanChat.tsx`、`packages/mac/src/plans/PlanDetails.tsx`、`packages/mac/src/plans/PlanOutline.tsx`（另加任务卡上的 `TaskAgentChip`，在 fork 自己的 `fork/plans/` 里）
- 计划与 worktree 的原生 sheet（`lib/native-sheet.ts`）：`packages/mac/src/plans/PlanSheets.tsx`（如何运行，`AUTONOMY_ICON` 导出给新建计划用）、`packages/mac/src/dialogs/native/WorkSheets.tsx`（Fork）
- 原生控件的 `size`（`docs/mac-controls.md`，与「原生控件」一节同一规范，这几个文件只有这个分支还在改）：`packages/mac/src/tasks/parts.tsx`、`packages/mac/src/views/ProjectHome.tsx`

### 沉稳收尾（M8）

M8 和 M9 的规则放在 fork 自己的文件里（`fork/calm/calm-accent.css`、`calm-glow.css`、`calm-type.css`、`calm-tabs.css`、`type-scale.ts`、`type-plugin.ts`；`fork/sidebar/one-mark.ts`、`sidebar-look.css`，由已有的 `useOneSelected` 调用 `useOneMark`）。锚点在 `tests/fork-sidebar-anchors.test.ts`、`tests/fork-sidebar-one-mark.test.ts`、`tests/fork-calm-accent.test.ts`、`tests/fork-calm-tabs.test.ts` 里检查，同步上游后失效会失败并指出名字。改上游文件只登记下面这些：

| 文件 | 改了几行 | 原因 |
| --- | ---: | --- |
| `packages/mac/vite.config.ts` | 2 | 接入构建时字号改写插件 `calmType()`（BLG-244）；沉稳关时变量未定义，改写后的值与原值一致 |
| `packages/mac/e2e/chat-drag.spec.ts` | 2 | Unread 行的用例在点了「Your Mac」之后把指针移出侧栏：沉稳界面在指针停在侧栏里时不重排（BLG-165），Unread 行要等指针离开才出现。沉稳关时用例原样通过，是 fork 既定行为与上游用例的冲突，不是缺陷（BLG-255） |
| `packages/mac/e2e/chat-paths.spec.ts` | 6 | 房间里点一个不在任何 worktree、也不在任何共享里的文件夹路径，上游自己的 `actions.ts`（BLG-958 的 `openLocalFolder`）现在交给 Finder，不再打开 Files；用例原来断言聊天消失、能看到 `notes.md`，改为断言聊天留在原处。这是上游的用例落后于上游的行为，与 fork 无关（BLG-255），可以提回上游 |
| `packages/mac/e2e/network.spec.ts` | 8 | 推广卡在沉稳界面下被隐藏（BLG-250），第一条和最后一条用例测的就是那张卡，所以以沉稳关运行。 |
| `packages/mac/e2e/network-chats.spec.ts` | 4 | 同上：测推广卡的用例以沉稳关运行。 |
| `packages/mac/e2e/unread.spec.ts` | 4 | 指针停在侧栏里时沉稳冻结顺序（BLG-165），Unread 行要等；这条测行本身，所以以沉稳关运行。 |
| `packages/mac/e2e/project-home-narrow.spec.ts` | 2 | 沉稳给布局变化 120–200ms 过渡，量宽度前等到没有 CSS 过渡在跑（等条件，不等时间）。「长分支名」一例原来标 `test.fixme`，M9 修好后去掉了。 |
| `packages/mac/src/views/project-home.module.css` | 2 | 上游 #527 的缺陷（适合提回上游）：名字缩到最短后只剩分支一项在让，它的收缩系数 0.25 小于 1，按 Flexbox §9.7 只分到剩余溢出的四分之一，长分支名时 Create Worktree 出框。改为名字 4、分支 1：名字照旧先让，分支能让完。 |
| `packages/mac/e2e/pr-next-step.spec.ts` | 3 | 基线已有：同一行在侧栏里出现两次（项目与 Work），严格模式断言改取 `.first()`。 |
| `packages/mac/e2e/live-preview.spec.ts` | 10 | 基线已有：对比度辅助函数把原生控件的渐变按钮当作透明底；改用渐变最后一个色标，并识别 `color(srgb …)` 的 0–1 取值。 |

`fork/calm/calm-glow.css` 只定义令牌，且只在 `:root[data-calm]` 下；上游 CSS 里的光晕在构建时改写成带原值回退的令牌引用（`glow-scan.ts`），沉稳关时变量未定义，画面与上游一致，不动上游文件。`onboarding/scenes`、`Wormhole`、`reactbits`、`PixelBurst`、`star-scene`、`call`、`YourCard` 是 keep-decor，不做字号改写，也不动光晕（`type-scale.ts` 的 `skipFile`、`glow-scan.ts` 的 `skipGlowFile`）。


### Mac 原生走查（2026-11-18）

对照 macOS 自带应用做的走查，改稿在 Claude Design 的「Beluga topic/native · Mac 原生走查」（1a 总览、1b 工作树、1c 设置）。外观规则都在 `packages/mac/src/fork/native/native-look.css`，由 `fork/calm/index.ts` 一并引入，每条都只在 `:root[data-os='mac']` 下生效（Windows、Linux 保持上游的样子）；总览的列头是 fork 自己的组件 `fork/native/OverviewHeader.tsx`。锚点在 `tests/fork-native-look.test.ts` 里检查。

- 工具栏的分支步骤（Create PR 和 ▾）画成普通的有边框按钮，不用强调色；失败、已合并和 Merge 保留各自的颜色。规则前加了 `:root`，压过 `calm-accent.css` 把主按钮刷成强调色的那条。
- 底部终端标签：当前标签用粗体，不加下划线。检查器只有一个标签时（总览的 Info）画成标题。
- 空聊天的建议按钮只留文字。
- 总览：在分组上方加一行列头（名称、分支、状态、详情、更新于/大小），名称和最后一列可以点击排序，和 Recent ▾ 菜单改的是同一个偏好；行高 28pt。
- 工作树：名字旁的分支状态从胶囊改成一行彩色文字；Changes / History 这层视图切换改成一排文字，当前项加粗，检查器里只剩一层分段控件。
- 设置：看起来像独立窗口：背后的窗口不变暗，左上角是红色关闭按钮（最小化和缩放画成灰色），窗格名居中作标题。真正拆成 Tauri 的独立窗口还没做。

改上游文件只有一处：

| 文件 | 改了几行 | 原因 |
| --- | ---: | --- |
| `packages/mac/src/views/Overview.tsx` | 2 | 引入并放置 `OverviewHeader`（列头），排序仍用总览自己的偏好 |

#### Liquid Glass（macOS 26 的外观）

`packages/mac/src/fork/native/liquid-glass.css`，同样由 `fork/calm/index.ts` 引入，只在 `:root[data-os='mac'][data-glass='on']` 下生效（`lib/prefs.ts` 设置这两个属性）：Windows、Linux，以及打开了系统或应用的「减少透明度」时，窗口保持原样。侧栏和检查器离开窗口边缘 8px，变成圆角 16px 的玻璃面板（半透明、模糊加饱和、一圈高光描边和投影）；按钮和分段控件变成胶囊形；工具栏的图标按钮放在玻璃胶囊上。参考过 `rdev/liquid-glass-react`（MIT），但它的折射靠 SVG 置换滤镜，Mac 应用的 WKWebView 画不出来，还会跟着指针形变，和沉稳模式冲突，所以只用 CSS、静止不动。不改上游文件；锚点在 `tests/fork-native-look.test.ts` 里检查。

在打包的应用里看过之后补的三处：胶囊形的搜索框和输入框改用真正的 0.5px 边框（原来的 0.5px 内阴影在胶囊两端被 WebKit 画断）；多行文本框（规划风格、计划目标）不做胶囊，保持 8px 圆角；检查器的视图标签（改动 · 文件 · 草稿 · 信息）在 `native-look.css` 里改成居中、等宽的分段，宽度取最宽的名字，面板窄到折起名字或正在拖标签时照上游排。

下拉框（`components/Select.tsx`）在 Liquid Glass 下照 macOS 26 设置页的样子：不画边框，只有值和一个 ⌄，悬停和打开时底下一块浅灰胶囊，宽度跟着当前值；原来的 0.5px 边框在胶囊两端发虚。网页菜单（选项多、带搜索框的那种）是 12px 圆角卡片，当前行浅灰底，勾选放在行尾；选项少的在应用里打开的是 macOS 自己的菜单，不归 CSS 管。
