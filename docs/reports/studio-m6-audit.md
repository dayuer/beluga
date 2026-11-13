# Synon Studio M6 审计：计划页、对话、主按钮、差异与待办

- 日期：2026-11-11
- 范围：`packages/studio-app` 的计划页 `/plan/[id]`、对话、决策、验收、退回原因、草稿差异、待办 `/todo`，以及客户视图在计划图详情、动态、对话中的泄露；390×844 与 1440×900。
- 对照：`docs/studio-plan-page.md` 的 PP-01…PP-12 / PT-01…PT-05，`docs/studio-mobile-ux.md` 的 UX-29/30/31 与本轮仍适用的 UX-01…UX-28，`src/studio/protocol.ts`、`src/net/studio/views.ts`、`src/studio/sanitize.ts`。
- 方法：用 `packages/studio-app/e2e` 的真中台（wrangler dev）+ fake daemon 跑完整流程；在 `.beluga/scratch/m6/` 留下每个阶段 390×844 与 1440×900 的截图；逐条量 boundingBox、核对 DOM 文本；对客户端源码 grep 内部字段；对新增小字重新计算对比度。实现与审计在同一工作区完成，本工作区只提供一个模型，没法真正换模型复审；为降低“自己审自己”的偏差，审计重新走了一遍每个状态、重新量了尺寸、并从协议与渲染路径反查，不沿用实施时的结论。
- 最后运行：`packages/studio-app` 的 `npm run e2e`，日志 `.beluga/scratch/m6-e2e-final.log`。20 个用例（phone/desktop 各 5 个 plan 用例 + M5 流程）中 **16 passed, 4 skipped, 0 failed**（2.6m）；4 skipped 是 M5 的桌面 phone-only 用例（串行跳过 3）与 M6 的手机键盘代理用例（桌面跳过 1），不是失败。

## 0. 结论

- **计划页可用**：390×844 与 1440×900 都能看到 headline、进度条、图/大纲/动态三个页签、节点详情；daemon 推来的视图在 1–2 秒内更新；daemon 离线保留最后一版并显示「工作室离线 · 上次同步 …」；客户自己断网出现「你已离线 · 上次同步 …」。
- **一个主按钮**：确认/回答/通过/应用随阶段切换；确认后按钮消失、状态变为「在等工作室批准开工」；`approve` 后变运行中；等待工作室或 AI 时没有主按钮。一次操作最多一条动作（opId 幂等），连点不会产生第二条。
- **对话**：手机是底部抽屉，55%/80% 两档，输入条贴键盘；桌面在右侧 360 常驻；乐观气泡、失败重试、AI typing、未读点、同 opId 去重都工作。
- **待办**：跨项目汇总决策/验收/改动/确认；项目卡有点；卡片动作后条目消失；桌面用分段控件、手机用底部栏。
- **泄露**：客户端只渲染 `StudioPlanView` 字段；页面可见文本里没有 planRef、opId、任务 KEY、文件路径、模型名或代码围栏；中台 error 字符串不上屏。计划图详情、动态、对话、决策、验收说明、gate 原因、草稿差异逐屏检查通过。
- **审计中修复**：工作室离线状态不显示、首次进入的假未读点、页面底上的小字对比度（text3 4.36:1）、程序性无障碍名称、抽屉的 dialog 语义、桌面标题栏与主列的对齐；e2e 还暴露并修正了测试 harness 的陈旧视图与串页定位问题（见 §2）。
- **未修的 6 条**都是 should-fix，不阻塞 M6：桌面节点详情仍是贴底 sheet（不是居中层）、节点 sheet 只能点关闭按钮收起、抽屉没有把焦点移进标题（只有 `role=dialog` + `accessibilityViewIsModal`）、计划页离线行用的是计划视图的 `fetchedAt` 而非工作室的 `lastSyncAt`、待办加载器逐个拉每个项目的 plans（P1 项目数少，可接受）、真实 daemon 的含代码/路径/KEY 计划复看（P1 验收时做）。

## 1. 证据

### 1.1 真中台 + fake daemon 的 e2e

- 命令：`cd packages/studio-app && npm run e2e`（真 wrangler hub、同源代理、fake daemon；fake daemon 的控制口 `/view`、`/approve`、`/reset`）。
- 最后结果：**16 passed, 4 skipped, 0 failed（2.6m）**；运行日志 `.beluga/scratch/m6-e2e-final.log`。跳过项见上方 §0/§1.1。
- 覆盖：计划页每个 phase（running、confirm、awaiting-start、decide、review、changes、done、drafting-ai、awaiting-changes）、三种宽度/键盘代理、计划页离线、客户断网、对话抽屉/停靠、乐观发送/重试/typing/未读/焦点、10 秒决策撤销、10 秒验收撤销、退回、应用/放弃差异、待办卡动作、项目圆点、分段/底部栏。
- 运行记录：
  - 第 1–2 次：测试夹具状态串页、确认视图的 activity 文案写错、`primary` 定位命中上一屏 → 修测试。
  - 第 3 次：计划页在 daemon 停止后没显示工作室离线 → 修 `usePlanView`（计划响应不含 studio 状态，改为每 5 秒查一次项目 plans 的 `studio.online`）。
  - 第 4 次：客户断网横幅命中了栈里上一屏的同名 testID → 测试收窄到 `plan-screen`。
  - 第 5 次：fake daemon 的周期快照把动作后的本地补丁冲掉（真实 daemon 会改视图）→ fake daemon 在 `deliver` 时应用动作（pass/sendBack/requestStart/decision/apply/discard/chat.send）再推视图。
  - 第 6 次：phone 10 个用例全部通过；desktop 首个计划用例通过；desktop 其余用例被 phone-only 的串行跳过/未执行。
  - 第 7 次：在 T0/加载代数/role 等修复上重跑 → 16 passed, 4 skipped；桌面标题栏与主列仍错开 180pt（截图 `plan-chat-desktop.png`）→ 修 `Header.rightPanel`。
  - 第 8 次（最终）：含标题栏对齐重跑 → 16 passed, 4 skipped, 0 failed（2.6m）；截图与日志 `m6-e2e-final.log`。

### 1.2 截图（`.beluga/scratch/m6/`）

| 页面/阶段 | 390×844 | 1440×900 |
|---|---|---|
| 计划图（running） | `plan-map-phone.png` | `plan-map-desktop.png` |
| 确认计划 | `plan-confirm-phone.png` | `plan-confirm-desktop.png` |
| 大纲 / 动态 | `plan-outline-phone.png` / `plan-activity-phone.png` | 同名 `-desktop` |
| 等待批准开工 | `plan-awaiting-start-phone.png` | 同名 `-desktop` |
| 决策 | `plan-decide-phone.png` | 同名 `-desktop` |
| 验收 | `plan-review-phone.png` | 同名 `-desktop` |
| 改需求 | `plan-changes-phone.png` | 同名 `-desktop` |
| 已完成 | `plan-done-phone.png` | 同名 `-desktop` |
| 规划中 / 等待批准改动 | `plan-drafting-phone.png` / `plan-awaiting-changes-phone.png` | 同名 `-desktop` |
| 工作室离线 / 你离线 | `plan-studio-offline-phone.png` / `plan-you-offline-phone.png` | 同名 `-desktop` |
| 对话 / 差异 / 待办 | `plan-chat-*.png` / `plan-diff-*.png` / `todo-*.png` | 同名 `-desktop` |

### 1.3 单测

- `tests/team/studio-app-phase.test.ts`：11 个（每个 phase、优先级、本地补丁、discard）。
- `tests/team/studio-app-turns.test.ts`：5 个（去重、older+server、opId 替换、未读）。
- `tests/team/studio-app-todo.test.ts`：6 个（每个 phase、决策优先）。
- `tests/team/studio-app-live.test.ts`：4 个（每 pid 一个 socket、引用计数、晚订阅者拿状态、项目隔离）。
- `tests/team/ui-plan-levels.test.ts`：5 个。
- 既有 `studio-app-hub.test.ts` / `studio-app-submit.test.ts` 照旧通过（9 / 6）。

### 1.4 对比度复核（token 值，WCAG AA 4.5:1）

| 前景/背景 | 值 | 结论 |
|---|---|---|
| `text2` / `bg` | 6.05:1 | 通过 |
| `text3` / `card` | 4.71:1 | 通过 |
| `text3` / `bg` | 4.36:1 | **不过**；页面上已改用 `text2`（见 §2） |
| `warn` / `card` | 4.94:1 | 通过 |
| `error` / `bg` | 5.61:1 | 通过 |
| `ok` / `card` | 4.24:1 | 只用于大号「+」符号（≥3:1 大字标准）；组标题改用 `text` |
| `onPrimary` / `primary` | 16.83:1 | 通过 |

## 2. 问题与修法

### 2.1 必须修（已修并复核）

1. **daemon 离线时计划页不提示工作室离线（高）**
   - 现象：`StudioPlanView` 没有 studio 状态，app 到中台的 WS 在 daemon 停止时不会关闭，页面只剩客户自己的在线状态，看不出「工作室离线」。
   - 修法：`usePlanView` 每 5 秒查一次该项目的 plans 列表（响应含 `studio.online`），只更新 `studioOnline`；计划帧到达时仍视为工作室在线。
   - 复核：e2e `plan-studio-offline`（停止 fake daemon → 出现行，重启 → 消失）；`plan-status` 仍按阶段显示。

2. **首次进入计划页出现假未读点（中）**
   - 现象：没有 `seen` 历史时按 0 计算，所有 AI 旧消息都算未读；工作室时钟略快时，打开抽屉后仍可能留点。
   - 修法：首次视图到达时把 seen 设为 `max(now, 最新 turn.at)` 并落盘；打开抽屉/桌面停靠时同样取这两者的最大值；在 ready 之前不显示未读点。
   - 复核：`plan-confirm-phone.png` 无点；e2e 在关闭抽屉后推一条新消息 → 出现点，打开再关闭 → 点消失。

3. **页面底上的小字对比度（中）**
   - 现象：`text3 #737379` 在 `bg #F6F6F7` 上 4.36:1；计划页同步行、动态时间、聊天「已排队」、桌面分段计数、共享大纲的 n/total 等用了它。草稿差异「新增」组标题用了 `ok` 4.24:1 的小字。
   - 修法：这些页面底上的小字改用 `text2`；`planUiTheme` 在客户端的 `text3` 映射为 `text2`（共享组件也用在页面上）；「新增」组标题改用 `text`，保留绿色 `+` 符号（大字号）；`before` 文案改 `text2`。
   - 复核：§1.4；截图重新生成。

4. **项目卡片的待办圆点没有可读含义（中）**
   - 修法：`ProjectCard` 的 `accessibilityLabel` 在 `todoDot` 时追加「有待办 / To-dos waiting」；圆点仍是 8pt 颜色标记，不单独可点。
   - 复核：DOM 断言。

5. **抽屉没有对话框语义（低）**
   - 修法：sheet 与桌面 modal 加 `role="dialog"`，保留 `accessibilityViewIsModal`、44pt 关闭、Escape。
   - 未做：把焦点移进标题/焦点圈禁；见 §2.2。

6. **桌面标题栏与主列不对齐（中）**
   - 现象：桌面计划页的主列在「页面 − 360 对话面板」里居中（x≈180–900），而 `Header` 的 720 内容列在整页居中（x≈360–1080）；返回、标题、••• 与主列错开 180pt。
   - 修法：`Header` 新增 `rightPanel`，桌面时给标题栏右侧留出对话面板宽度；计划页传 360，标题行与主列同一条左线。••• 菜单的右缘也随之对齐主列，而不是贴页面右缘。
   - 复核：`plan-chat-desktop.png` / `plan-map-desktop.png`；主列与标题行的左边缘对齐；桌面差异用例仍能点到 ••• → 放弃改动。

### 2.2 Should-fix（不阻塞 M6）

1. **桌面节点详情是贴底卡片，不是居中层**：设计 §5 写居中弹层；`MilestoneSheet` 现在在桌面仍贴底（宽 480），底边在 dock 上方，主按钮可见；版式与设计有差异。改法：桌面用 `variant` 渲染居中层；需要重排 `MilestoneSheet` 的定位容器。
2. **节点 sheet 只能点关闭收起**：设计说点内容区空白也收起；现在没有 scrim，空白不响应。加一个透明外层的关闭区域或 `Pressable` 背景。
3. **抽屉焦点管理**：`role=dialog` + `accessibilityViewIsModal` 已有，但打开时没有把焦点送到标题/关闭按钮，也没有焦点环禁；键盘用户要 Tab 才进入。改法：打开时 `focus()` 关闭按钮，关闭后回触发元素。
4. **真实 daemon 的含代码/路径/KEY 计划没有单独跑一遍**：本轮 e2e 用的是 fake daemon 的视图夹具；客户端只渲染 view 字段，daemon 的净化由 `src/studio/sanitize.ts` 与其测试（`tests/studio-chat.test.ts`、`tests/studio-hub-views.test.ts`）保证。改法：在 P1 验收时用真实 daemon 加一份含代码块、`/Users/...` 与 `sk-...` 的计划，按 §6 的屏幕再看一遍。
5. **工作室离线行的「上次同步」用的是计划视图的 `fetchedAt`**，不是 `plans` 响应的 `studio.lastSyncAt`；分钟数偏差通常很小。改法：`usePlanView` 把 plans 的 `lastSyncAt` 一并返回。
6. **待办加载器逐个项目拉 plans**：项目多时首屏慢；已加 generation，强制刷新不会被早先的 in-flight 结果覆盖；P2 可以在项目列表响应里带计划摘要。

### 2.3 测试 harness 修正（不是产品问题）

- fake daemon 的默认标题曾带 planRef（`客户 App · plan1`），改为 `客户 App`。
- e2e 的 `primary` / `offline-banner` 会命中栈里上一屏（项目首页也还在 DOM），改为在 `plan-screen` 内定位；这是「每屏一个主按钮」的屏幕口径，不是全局 DOM 计数。
- 每个 plan 用例开头 `POST /daemon/reset`，避免上一个用例的夹具串到下一屏。
- fake daemon 的周期快照会把动作后的本地补丁冲掉；现在 fake daemon 在 `deliver` 时应用动作（pass/sendBack/requestStart/decision/apply/discard/chat.send）再推视图，模拟真实 daemon。

## 3. 可检查项 PP-01…PP-12

| ID | 结果 | 证据/备注 |
|---|---|---|
| PP-01 路由/整行可点 | 通过 | e2e 点 `plan-row-plan1` → `/plan/plan1?project=…`；返回回项目 |
| PP-02 每阶段主按钮/唯一 | 通过 | phase 单测 11 个；e2e confirm/review/decide/changes；`plan-screen` 内 `primary` ≤1 |
| PP-03 状态行/等谁 | 通过 | `plan-status` 每阶段文本；等待工作室/AI 时无 primary |
| PP-04 主按钮位置 | 通过 | 390 下 `primary.y≥422`、`y+h≤844`；安全区 34 时 dock 加 padding，换算 bottom≤810；不随内容滚 |
| PP-05 键盘态 | 通过 | 390×500 对话输入 bottom≤501；抽屉打开时 primary 不渲染 |
| PP-06 抽屉 55/80 | 通过 | `.beluga/scratch/m6-e2e-6.log` 的 drawer 高度断言；把手点击切换 |
| PP-07 桌面对话停靠 | 通过 | `chat-panel` 宽 360、右缘 1440；`chat-open` 数量 0 |
| PP-08 节点 sheet 不挡主按钮 | 通过 | `milestone-sheet` 底 ≤ primary 顶−4；e2e |
| PP-09 图缩放/节点 | 通过 | 236 → 189 → 295；`map-node-1` 可点 |
| PP-10 大纲 | 通过 | 截图 + 文本；状态词与图同映射 |
| PP-11 实时/离线/重连 | 通过 | 推 view 后 ≤2s；daemon 停/启；客户断网横幅；`plan-gone` 空态 |
| PP-12 不泄露 | 通过 | `innerText` 无 `/Users/`、`planRef`、`opId`、`plan1`、代码围栏、任务 KEY；URL/testID 不计 |

## 4. 可检查项 PT-01…PT-05

| ID | 结果 | 证据/备注 |
|---|---|---|
| PT-01 汇总 | 通过 | `todosOf` 6 个单测；一计划一种卡（决策除外）；等待/AI/完成不出卡 |
| PT-02 圆点/计数 | 通过 | e2e `project-dot` 与 `tab-todo-count` 一致；加载前不显示 |
| PT-03 卡片动作/消失 | 通过 | review 通过后回执隐藏；`milestone.pass` 只一条；决策卡跳 `?open=decide` |
| PT-04 布局 | 通过 | 卡片按钮 ≥44；`primary` 0；手机底部栏 y>700、桌面分段 y<150 |
| PT-05 离线 | 通过 | 断网后缓存卡片仍在 + `offline-banner` |

## 5. UX-29 / UX-30 / UX-31

| ID | 结果 | 证据/备注 |
|---|---|---|
| UX-29 聊天乐观/重试/typing/去重 | 通过（去重为单测） | e2e 双发只 1 条 `chat.send`、断网重试、`chat-typing`；`mergeTurns` 单测覆盖同 opId 替换 |
| UX-30 决策 10 秒撤销 | 通过 | e2e 点选项后 5 秒内撤销 → 无动作；第二次等 10 秒 → 恰好 1 条 `decision.answer` |
| UX-31 抽屉键盘 | 通过 | 390×500 下 `chat-input` bottom≤501；抽屉打开时 primary 不渲染 |

## 6. 泄露审计

- **源码**：`packages/studio-app` 里 `planRef`/`opId` 只出现在路由、`data-testid`、pending key 与协议调用中；没有拼进可见文案。`HubError.error` 只用于分支判断/日志，不上屏；计划页的错误一律走 `common.error` / `plan.needsRefresh`。
- **渲染面**：计划页只画 `view.title/headline/progress/milestones/decisions/turns/activity/review/draftDiff/gate`；节点 sheet、动态、对话、验收说明、gate 原因、差异都来自这些字段；没有文件、命令、模型、内部 ID 字段。
- **中台/daemon 净化**：`src/net/studio/views.ts` 与 `src/studio/sanitize.ts` 负责客户视图的文本与字段白名单；既有测试 `tests/studio-chat.test.ts`、`tests/studio-hub-views.test.ts` 覆盖代码块、路径与敏感词的剥离。客户端不做第二套净化，也不绕过。
- **e2e**：每个 phase、节点 sheet、大纲、动态、对话、决策、验收 notes、gate reason、草稿差异后取 `innerText`，无 `/Users/`、`planRef`、`opId`、`plan1`、` ``` `、`BLG-123` 形态的 KEY。
- **未覆盖**：真实 daemon + 含密钥计划（§2.2 第 4 条）。

## 7. 与设计的差异

1. 计划页路由 `/plan/[id]?project=<pid>`（详见 `docs/studio-plan-page.md` §9）。
2. 计划的 studio 状态用 5 秒一次的 plans 查询补齐（响应本身没有 studio 字段）；这是 M6 的实现选择，不改协议。
3. 桌面节点详情仍是贴底卡片（§2.2）。
4. e2e 用 fake daemon 的动作回写模拟真实 daemon 的视图更新；这是测试 harness 的补强，不是客户端逻辑。
5. 抽屉没有焦点移入标题（§2.2）。

## 8. 交接

- 计划页、对话、待办的可检查项按 §3–§5 通过；剩余 should-fix 在 §2.2，不阻塞 M6。
- 真实 daemon + 含代码/路径/KEY 计划的复看留给 P1 验收（§2.2 第 4 条）。
- 最终 e2e 日志：`.beluga/scratch/m6-e2e-final.log`；截图目录 `.beluga/scratch/m6/`。
