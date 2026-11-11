# M3 定稿：问题收敛、补充规则与上游改动（BLG-173）

- 输入：`chat.md`（CH-01…09）、`shell.md`（SH-01…10）、`work.md`（WK-01…04）、`data.md`（DA-01…05）、`rest.md`（RE-01…04），共 **32** 条。
- 输出：覆盖层补充规则（`overlay.md §12` 的 R3-01…R3-07）、本文件的上游文件清单与登记行成稿、以及 174/175 的实施与判定说明。
- 原则：**覆盖层 > 直接改上游（upstream-ok，登记 fork.md） > keep-decor 例外**。不属于沉稳问题（复制文案、已验证的稳定项、M2 已批准的取舍）不进问题表，写入各报告 §5/§7 由 BLG-175 改状态列时一并迁移。

## 1 ID 收敛表（32 条，逐条对账）

图例：**O** 覆盖层（已有规则或 R3）· **H** 挂钩（fork 接口 + 上游一行接入）· **U** 直接改上游文件（登记 fork.md）· **U-PR** 其中的上游 PR 候选 · **K** keep-decor（已批准例外）· **§5/§7** 不进问题表（迁移到报告的 CLS 归因/审计备注）· **=** 合并到另一条。

| ID | 处置 | 具体 | 备注 |
| --- | --- | --- | --- |
| CH-01 | O | S7/S8（已有） | 已用覆盖层修好 |
| CH-02 | O + H | R3-01（`.folding` 过渡归零）+ AgentSteps `useStill` 读 calm | 上游接入点，TOUCHPOINTS |
| CH-03 | U-PR | `ChatLog.tsx` 的 `shouldAdjustScrollPositionOnItemSizeChange` 一行 | 行为接入点，TOUCHPOINTS |
| CH-04 | §5 | 队列条插入的固有位移 | 理由已在 chat.md §5 |
| CH-05 | §5 | Working 行随内容移动 | 同上 |
| CH-06 | H | `flight.ts` 的 `calmOn()` 瞬时分支 | 行为接入点，TOUCHPOINTS |
| CH-07 | O | M1 已关 rise/twinkle/breathe/shimmer；R3-05 补侧问卡淡入 | 已用覆盖层修好 |
| CH-08 | O | M1/M3 已覆盖弹簧与弹簧过渡 | 已用覆盖层修好 |
| CH-09 | §7 | 监听呼吸环保留（声音反馈，不循环） | 不是问题；175 迁移 |
| SH-01 | O | S1（已有） | 已用覆盖层修好 |
| SH-02 | O + U | S2（已有）+ `e2e/unread.spec.ts` 断言改颜色（fork-only 测试） | 裁决：改 fork 侧 e2e，不提上游 |
| SH-03 | K | 外壳入场 `arrive` 1.6s | 已批准例外（overlay §7.1 锚点已有） |
| SH-04 | O | R3-04 面板内容淡入 | 已用覆盖层修好 |
| SH-05 | O | 已有 calm-surface-drop（role=dialog） | 已用覆盖层修好 |
| SH-06 | O | 已有 calm-surface-drop + one-toast | 已用覆盖层修好 |
| SH-07 | §5 | 面板首次取回 changes 后自动展开文件的分栏位移 | 固有 + 上游 PR 候选（不在 174 实施） |
| SH-08 | H | hold-order 只冻结顺序 | 挂钩，fork 文件 + 已有上游行 |
| SH-09 | H | hold-order 的菜单启发式扩到 dialog/listbox | 挂钩，fork 文件 |
| SH-10 | §7 | 被压制的撤销不响应 ⌘Z（M2 明示取舍） | 不是新问题；175 迁移 |
| WK-01 | H | TaskBoard 的 `reduce` 判据加 calm | 行为接入点，TOUCHPOINTS |
| WK-02 | O + U-PR | R3-06 节点/边同 clamp；R3-07 reduce 归零；上游把 520ms 接 `--dur` 为 PR | e2e/plans 必须重跑 |
| WK-03 | O | R3-02 `[data-opening]` 归零 | 与 DA-01 同一条 |
| WK-04 | = WK-01 | AnimatePresence 并入 WK-01 的判据 | 175 合并行 |
| DA-01 | = WK-03 | Ask 面板宽度动画 | 175 合并到 WK-03 |
| DA-02 | H | DashboardPage 的 `still()` 加 calm | 行为接入点，TOUCHPOINTS |
| DA-03 | O | 已有过渡 clamp（无内联样式） | 已用覆盖层修好（175 若有榜单数据再实测） |
| DA-04 | §7 | 数字 tabular 已稳定 | 不是问题；175 迁移 |
| DA-05 | §5 | 项目主页右栏 Inspector 异步内容 | 固有 + 上游 PR 候选 |
| RE-01 | K + U-PR | 引导页 keep-decor 保留；上游两条 reduce 媒体查询 | calm 侧已满足；上游 PR |
| RE-02 | K | 来电 ring/ripple/nudge | 已批准例外（overlay §7.0 锚点已有） |
| RE-03 | O | R3-03 对话框背板淡入 | 已用覆盖层修好 |
| RE-04 | §7 | 待加入/信任卡的选项后果文案 | 上游文案 PR 候选；不是沉稳问题 |

**对账**：覆盖层主处置 **13** 条（CH-01/02/07/08、SH-01/02/04/05/06、WK-02/03、DA-03、RE-03），挂钩/上游主处置 **10** 条（CH-02/03/06、SH-02/08/09、WK-01/02、DA-02、RE-01），keep-decor **3** 条（SH-03、RE-01、RE-02），迁移到 §5 的 **4** 条（CH-04/05、SH-07、DA-05），迁移到 §7 的 **4** 条（CH-09、SH-10、DA-04、RE-04），合并 **2** 条（WK-04→WK-01、DA-01→WK-03）。13+10+3+4+4+2 = 36；其中 CH-02、SH-02、WK-02、RE-01 各跨两层（覆盖层 + 上游/keep-decor），各被数了两次，36 − 4 = **32**，与输入的 32 条相等。

## 2 覆盖层补充规则

见 `overlay.md §12`。规则编号 R3-01…R3-07，分别关闭 CH-02（覆盖层半）、CH-07（淡入）、SH-04、WK-02（覆盖层半）、WK-03/DA-01、RE-03。

## 3 上游文件清单（BLG-174 实施）

每行一个文件；「登记行成稿」直接抄进 `docs/fork.md` 的「沉稳界面 › M3 逐页补改」。

| 文件 | 关闭的 ID | 改法（接入点式，≤3 行） | 为什么覆盖层做不到 | 提上游 | fork.md 登记行成稿 | TOUCHPOINTS |
| --- | --- | --- | --- | --- | --- | :---: |
| `packages/mac/src/chat/steps/AgentSteps.tsx` | CH-02 | `useStill()` 的返回值加 `useCalm()`；import 来自 `../fork/calm/index.js`（2 行） | framer-motion 的 `height:auto` 动画是 JS 驱动的，CSS 覆盖层管不到 | 否（沉稳专属判据；「步骤到达不做高度动画」可作上游 PR 卖点，但接口是 fork 自己的） | `AgentSteps.tsx`：步骤行的 `useStill()` 读沉稳开关，沉稳时 0 时长（M3 · CH-02） | 是 |
| `packages/mac/src/chat/flight.ts` | CH-06 | `land()`/`launchFlight()` 的 `reducedMotion()` 判据加 `calmOn()`（2 行 + import） | WAAPI 飞入由 JS 发起，CSS 覆盖层看不到 | 否（fork 的模式判据）；「飞入尊重 Reduce motion」上游已有 | `flight.ts`：沉稳时消息不飞入，走 `data-flown="instant"`（M3 · CH-06） | 是 |
| `packages/mac/src/chat/ChatLog.tsx` | CH-03 | `useVirtualizer` 选项加 `shouldAdjustScrollPositionOnItemSizeChange: () => !stick.current`（1 行） | 虚拟列表的补偿只能配在它的选项上 | 是（对所有人都是修位移 bug） | `ChatLog.tsx`：虚拟列表在「不贴底」时按行高变化补 scrollTop（M3 · CH-03） | 是 |
| `packages/mac/src/tasks/TaskBoard.tsx` | WK-01 / WK-04 | `const reduce = document.documentElement.dataset.motion === 'reduce' 或 calmOn()`（1 行 + import）；`reduce` 已用于 layout/抬起动画 | framer 的 layout 动画是 JS 驱动的 | 否（沉稳专属判据） | `TaskBoard.tsx`：沉稳时看板卡不做 framer layout 滑动（M3 · WK-01） | 是 |
| `packages/mac/src/sentinel/DashboardPage.tsx` | DA-02 | `still()` 加 `calmOn()`（1 行 + import） | 瓦片 glide 是 WAAPI | 否（沉稳专属判据） | `DashboardPage.tsx`：沉稳时瓦片换位不 glide（M3 · DA-02） | 是 |
| `packages/mac/src/onboarding/onboarding.module.css` | RE-01 | 文件末尾加 `@media (prefers-reduced-motion: reduce) { .sheen, .beam { animation: none } }`（3 行） | 覆盖层在 calm-on 已兜住；这里修的是「calm 关 + 系统 Reduce motion」的上游缺口 | 是（所有开 Reduce motion 的用户） | `onboarding/onboarding.module.css`：sheen/beam 在 Reduce motion 下停（M3 · RE-01） | 否（纯样式） |
| `packages/mac/src/call/NotesBox.tsx` | （overlay §8.1 遗留） | `goTo()` 的高亮 WAAPI `duration: 900` → `reducedMotion() ? 0 : 160`（2 行） | 900ms 的 WAAPI 背景闪是 JS 发起的 | 是（900ms 对所有人都是过长反馈） | `call/NotesBox.tsx`：跳到一条发言的高亮 900ms → 160ms，Reduce motion 下不做（M3 · overlay §8.1） | 否（行为小改，无需挂钩契约） |
| `packages/mac/e2e/unread.spec.ts` | SH-02 | 断言从 `font-weight: 650` 改为「颜色与 idle 不同、字重与 idle 相同」（1–3 行） | 测试不是界面，覆盖层无法让它通过 | 否（fork-only：沉稳有意只换颜色；提上游等于让上游改测试语义） | `e2e/unread.spec.ts`：未读断言改为颜色（沉稳 S2 的配套，fork-only，M3 · SH-02） | 否（测试） |

**合计 8 个上游文件**（含一个 e2e）；其中 ChatLog / onboarding / NotesBox 适合提上游，其余是沉稳专属的接入点。每个都保持接入点式最小 diff，可单独抽成提交。

## 4 fork 自己的改动（BLG-174，无需 fork.md 上游登记）

| 文件 | 关闭的 ID | 改法 |
| --- | --- | --- |
| `fork/calm/hold-order.ts` | SH-08 | `useHeldEntries` 改为「冻结 id 顺序、内容取 fresh」：冻结时按冻结顺序重排 `fresh`，新行按现规则插入或暂不显示（实现时选其一并写注释） |
| `fork/calm/hold-order.ts` | SH-09 | `release()` 的启发式从 `[role="menu"]` 扩到 `[role="menu"], [role="dialog"], [role="listbox"]`（仍只用于「从侧栏打开的浮层未关」） |
| `fork/calm/*.css` | R3-01…R3-07 | 见 overlay §12 |
| `docs/calm-ui.md §7.4` + `tests/fork-calm.test.ts KEEP_DECOR` | — | 如 174 决定把 `views/usage/Recap.tsx` 的 framer 播放列为 keep-decor，就双登记（本定稿：**列**，理由：用户点「Play Your Recap」才播的一次性成就回放，不在工作表面） |

## 5 不在本轮修、但必须在报告里落地的判定

- **max-fire**（`chat/max-fire.ts` 的 rAF 火焰）：用户显式开启的装饰效果，范围外；`overlay.md §8.4` 已写。不进问题表。
- **行内 `role='listbox'` 的 160ms 淡入**：`calm-overlays` 的统一出现方式，规格范围内；**不**收窄。overlay §10.5 的遗留项由此关闭。
- **面板/抽屉的瞬时开合**：沉稳下瞬时是接受的（`SH-04` 只补内容淡入）；overlay §10.5 的「抽屉/聚焦面板被关后瞬时出现」由此关闭。
- **hooks §9.2 冻结组内容、§9.6 菜单启发式**：改为上面的 SH-08/SH-09 两个 hook 修复；**被压制的撤销不响应 ⌘Z**（SH-10）维持 M2 设计，报告 §7 记录，175 迁移出问题表。

## 6 BLG-174 顺序与检查

1. 先写 `fork/calm/*.css` 的 R3-01…R3-07（只动 fork 文件），跑 `npx vitest run tests/fork-calm.test.ts` 与受影响场景。
2. 再改上游的 5 个行为接入点（AgentSteps、flight、ChatLog、TaskBoard、DashboardPage），每个补 TOUCHPOINTS 行；`CALM_UPDATE=1` 刷新快照。
3. 再改 3 个上游样式/脚本（onboarding CSS、NotesBox、unread e2e），登记 fork.md。
4. 最后改 hold-order 两处；重跑 `shellsidebar`/`shellpanel`/`chatsteps`/`plancanvas`/`sentineldash`/`sentinel`/`chatbtw`/`palette` 场景，把实测值回填 overlay §12 的验收列与本文的「提上游」列（不动五份报告）。
5. 收尾：`npm --prefix packages/mac run typecheck`、`npx vitest run tests/fork-calm.test.ts`、`npm run e2e -- fork-calm-sidebar fork-calm-toast`、`node scripts/sync-upstream.mjs --report` 无 `!`。

## 7 BLG-175 的改状态说明

- 问题表保留的行（迁移后）：CH-01/02/03/06/07/08、SH-01/02/03/04/05/06/08/09、WK-01/02/03、DA-02/03、RE-01/02/03（共 21 行）。
- 迁移：CH-04/05、SH-07、DA-05 → §5（固有 + 理由）；CH-09、SH-10、DA-04、RE-04 → §7（记录）；WK-04 并入 WK-01；DA-01 并入 WK-03。
- 状态终值映射：O →「已用覆盖层修好」；H/U/U-PR →「已改上游文件并登记」；K →「已批准的例外（keep-decor）」。
- 若 174 的 R3-06（React Flow clamp）在 plans e2e 下失败，改为：节点/边保持 520ms → 记为「已批准的例外（keep-decor）」并在 §7.4/KEEP_DECOR 双登记（图引擎自身动效，不在工作表面之外的例外）；此分支要先在 173 的验收列里注明，再由 175 落状态。
