# 里程碑 2：中文输入法 Enter 选词不再误发

计划：按角色分配模型：计划设置页、中文输入法与收尾验证。

## 问题

Mac 应用的 webview 是 WebKit。用中文输入法输英文、按 Enter 上屏时，WebKit 先结束组字再发 keydown，
所以这个 Enter 的 `isComposing` 已是 false，只有 `keyCode === 229` 还表明它属于输入法。
只查 `isComposing` 的输入框会把它当成发送。

## 修法

- 共用函数 `isImeComposing(e)`（`packages/mac/src/lib/ime.ts`）：`isComposing` 或 `keyCode === 229` 都算在组字。React 事件和原生 KeyboardEvent 都能传。
- 单元测试 `tests/ime.test.ts`：isComposing=true、keyCode=229（isComposing=false）、普通 Enter。
- e2e `packages/mac/e2e/plan-chat.spec.ts`：计划对话框里 keyCode 229 的 Enter 不发送，接着普通 Enter 发送。
- `grep -rn nativeEvent.isComposing packages/mac/src` 没有结果，判断只在 `lib/ime.ts` 里。

## 改了的输入框（BLG-118、BLG-119）

都是上游文件，ship-pr 时要补进 docs/fork.md 的通用修复清单。路径相对 `packages/mac/src/`。

**原来只查 isComposing（或已查 229）的，换成共用函数：**
plans/PlanChat.tsx（计划对话框）、chat/Composer.tsx（主聊天框）、chat/EditPrompt.tsx、chat/BoxSuggestions.tsx、
claude-code/AgentMonitor.tsx、tasks/NewTaskSheet.tsx、tasks/Activity.tsx、layout/workspace-row.tsx、
network/ConversationView.tsx、network/NetComposer.tsx、sentinel/SentinelHome.tsx、pr/PrConversation.tsx、
issues/IssueComposer.tsx、issues/IssueReply.tsx、plans/PlanPage.tsx（计划名）、views/ProjectHome.tsx、lib/dictation.ts。

**原来完全没查、按 Enter 会提交或跳转的文字输入框，加上共用判断：**
chat/FindBar.tsx、chat/WorktreeDraft.tsx、components/FormSheet.tsx、components/markdown/CodeEditor.tsx、
components/markdown/DocFind.tsx、plans/PlanOutline.tsx（任务改名）、agent-term/TermPane.tsx、call/NotesBox.tsx、
dialogs/MachinesSettings.tsx、dialogs/MenuSheet.tsx、dialogs/SettingsSearch.tsx、dialogs/native/PeerSheets.tsx、
dialogs/native/PersonCards.tsx、dialogs/native/ShareFolderSheet.tsx、gateway/AccessSettings.tsx、gateway/RequestsView.tsx、
issues/IssuesView.tsx、layout/ProjectGroups.tsx（分组改名）、layout/SidebarSearch.tsx、layout/panel/ContentSearch.tsx、
network/EmojiPicker.tsx、network/GroupInfo.tsx、network/NetworkSheets.tsx、network/NetworkSidebar.tsx、network/StatusMenu.tsx、
onboarding/SetupSteps.tsx、phone/PhoneView.tsx、sentinel/DashboardPage.tsx、sentinel/SentinelCards.tsx、sentinel/SentinelPage.tsx、
tasks/Brief.tsx、tasks/PickMenu.tsx、tasks/TaskPage.tsx、tasks/TaskSections.tsx、team/SharedPlans.tsx、views/DiffComment.tsx、
views/SearchView.tsx、views/TerminalTab.tsx、views/overview/FilterBar.tsx、views/reader/FileEditor.tsx。

**没改的 Enter 处理（不是文字输入）：** 行、按钮、列表上的 Enter / 空格（如 PlanOutline.tsx:130、ProjectGroups 分组行、
WorktreeItem、OverviewRows、FilesTab 列表、ci/parts、issues/parts）；PortsTab 只收数字；use-swipe-back、use-chip-caret 管的是 Esc / 删除键。

## 验证

- `packages/mac` 下 `tsc --noEmit` 通过。
- `npx vitest run tests/ime.test.ts`：3 个通过。
- e2e（plan-chat、issues、network）按计划在最后一步统一跑。
- 真实 Mac 应用里用简体中文输入法手测：用户决定不做真机手测（BLG-148），以 e2e 模拟 keyCode 229 的用例（`packages/mac/e2e/plan-chat.spec.ts`）为准。

## 审计（BLG-120）

由另一个 agent（Sonnet，只读）独立检查 packages/mac/src 里所有 keydown 处理，包括 Enter 的其他写法（e.code、keyCode 13、
快捷键辅助函数、建议列表的 onKeyDown）。

**发现的漏网，已修（同一提交）：**
- dialogs/native/parts.tsx:41：Sheet 外层的 Enter 冒泡后会直接 `onReturn`。它只排除 `input[type="text"]`，没写 type 的输入框会被漏掉，
  所以输入法选词的 Enter 会直接触发新建群（NetworkSheets）、运行命令（PeerSheets）、分享文件夹（ShareFolderSheet）。现在先判断 isImeComposing。
- onboarding/Onboarding.tsx:190：引导页全局 Enter 会直接跳下一步，中文输入名字时会误跳。已加判断。
- components/SelectMenu.tsx:137：带搜索框的下拉菜单，Enter 会选中当前项。搜索框里用中文选词时会误选，已加判断。

**检查过、没问题：** 建议列表（Suggestions.tsx、BoxSuggestions.tsx）的调用方都先判断了组字；守卫都在动作之前，运算优先级没有写错；
代码里没有 NumpadEnter、keyCode 13 或 onKeyPress 形式的 Enter 判断；call/NotesBox.tsx 的 window keydown 不处理 Enter。

**覆盖清单（审计要求手测的四处）：**

| 输入框 | 文件 | 代码覆盖 | 真机中文输入法手测 |
| --- | --- | --- | --- |
| 计划对话框 | plans/PlanChat.tsx | 已覆盖，并有 e2e 用例（keyCode 229） | 遗留 |
| 主聊天框 | chat/Composer.tsx | 已覆盖 | 遗留 |
| 新建任务 | tasks/NewTaskSheet.tsx | 已覆盖 | 遗留 |
| 计划改名 | plans/PlanPage.tsx | 已覆盖 | 遗留 |

**遗留：真机手测。** agent 驱动不了系统的简体中文输入法：切换输入法属于改系统设置，用 System Events 模拟按键也需要辅助功能权限。
所以手测要由用户在真实 Mac 应用里做：切到简体拼音，在上面四个框里各输入 hello 并按 Enter，应该只上屏、不发送；
再按一次 Enter 才发送。

**结论：用户决定不做真机手测（BLG-148），以 e2e 模拟 keyCode 229 的用例（`packages/mac/e2e/plan-chat.spec.ts`）为准。**
