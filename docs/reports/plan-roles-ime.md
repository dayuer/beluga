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
- 真实 Mac 应用里用简体中文输入法手测：待 BLG-120 审计补上（截图放这里）。

## 手测（BLG-120）

待补。
