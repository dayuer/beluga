# 沉稳界面（Calm UI）：规范、白名单与三层分工

本文是 `packages/mac` 界面气质的唯一规范：把「沉稳，不热闹」变成可执行的条款，并逐条说明由**覆盖层**、**行为挂钩**还是**上游 PR** 来实现。M0 只定规范、开关与检查工具；具体的 CSS 由 M1 填进已经建好的 `fork/calm/*.css` 骨架。

本文档取代 `CLAUDE.md` 的《The Mac app's look: calm, not lively》一节。那一节只保留一行指向本文，见文末「CLAUDE.md 的去处」。

## 原文（从 CLAUDE.md 搬来）

> ## The Mac app's look: calm, not lively
>
> Beluga should feel like Claude, Office or macOS Settings: steady and predictable. The screen changes
> only when the user acts, and when it does the change is short, light, expected, and moves nothing else.
> A change to `packages/mac` follows this (and the phone too, with `lib/theme.ts`):
>
> - **Nothing shifts.** Content that loads, arrives, opens or closes never pushes what the user is
>   reading. Reserve the final size first (a skeleton or a fixed height) and swap in place. Hover,
>   selection and focus change colour only, never size: no bolding, no thicker borders, no icon that
>   pushes text. Numbers and timers use `tabular-nums` with room to grow. A new message, step or row
>   keeps the view still unless the user is at the bottom (scroll anchoring, then a "new below" cue).
>   Lists and the sidebar don't reorder while the user is hovering, dragging or has a menu open.
> - **Motion explains, it doesn't decorate.** 120–200 ms, ease-out, no springs, no overshoot, never
>   scaled above 1. No pop, hop, bounce, ripple, sheen, shimmer, breathe, pulse, shake, blink or glow.
>   Only one thing loops at a time: a small, quiet progress indicator for work in progress. Respect
>   `prefers-reduced-motion` (fades only, or nothing).
> - **State changes quietly.** Dots, badges and counts swap in place or fade (150 ms), in one place and
>   one visual language. "Needs you" is a steady mark, not an animation that keeps nagging.
> - **Feedback by weight.** Done: an inline word or icon. Worth knowing: one toast at a time, always in
>   the same place, fading after a few seconds, never stacked or flying in. Must decide now: a dialog or
>   a fixed card that says what happens. Errors show where they happened.
> - **One way everywhere.** Menus, panels, drawers and dialogs open the same way in the same place;
>   spacing, type, radii and colours come from the tokens, never one-off values. Mostly neutral colour,
>   the accent only for the one main action and key states.
> - **Check it.** Walk each changed screen through load, arrival, hover, select and open/close, and look
>   for anything that moves or resizes. Every animation still playing must name the spatial change it
>   explains, or it goes. Look again with reduced motion on.

下面 §1–§6 把这段原文的六条规范落到本项目的文件、行号与检查手段上。

## 0. 三层分工总表

改动界面时按这个顺序决定放在哪一层：

1. **覆盖层**（默认）：能写成 CSS、且只作用于 `:root[data-calm]` 的，全部放进 `packages/mac/src/fork/calm/*.css`。上游文件一个字不改。
2. **行为挂钩**：CSS 管不住的行为（滚动锚定、冻结排序、toast 合流、只留一种循环），逻辑写进 `fork/calm/`，上游文件只加一行接入点，并登记 `docs/fork.md`。
3. **上游 PR**：对所有人都有用、又无法安全覆盖的改动（占位尺寸、就地错误、通用降级），进 §10 清单，提回上游。

### 0.1 覆盖层规则清单

全部规则只在 `:root[data-calm]` 下生效；`data-calm` 缺省为开（见 §7）。

**全局规则**（`calm-tokens.css`、`calm-motion.css`、`calm-overlays.css`、`calm-state.css`）

| 文件 | 规则 | 解决的规范 |
| --- | --- | --- |
| `calm-tokens.css` | 覆盖过渡时长与曲线：`--dur-fast: 120ms`、`--dur: 160ms`，`ease-out` 不得超调；reduced-motion 下为 `0ms`。只覆盖令牌，不改上游 `tokens.css`。 | §2、§5 |
| `calm-motion.css` | 全局关掉关键帧：`:root[data-calm] * { animation: none !important; }`；过渡统一为 120–200ms `ease-out`；reduced-motion 下只留淡入淡出或全无。 | §2 |
| `calm-overlays.css` | 菜单、对话框、弹出层统一出现方式：同一位置、同一曲线，淡入 + 2–4px 位移，120–160ms；不得缩放。 | §5 |
| `calm-state.css` | 状态标记原地切换：点/徽标/计数 150ms 淡入或直接换；`needs-you` 为稳定琥珀色标记，不再扫光。 | §3 |

**白名单**（唯一允许的循环）

```css
/* calm-motion.css；与全局 animation:none !important 同权重，特异性更高 */
:root[data-calm] [data-current] { /* 唯一允许的循环指示，M1 填：小、安静 */ }
:root[data-calm] [data-current] * { /* 同一锚点下的子元素 */ }
```

锚点是当前步骤行的结构性属性 `data-current`（`packages/mac/src/chat/steps/StepRow.tsx:138`），不是类名。M2 把视觉换成一枚小而安静的进度指示，锚点与位置不变。详见 §7。

**定点修正**（少数类名/结构选择器）

| 选择器 | 上游位置 | 改什么 |
| --- | --- | --- |
| `:root[data-calm] [class*="_needsRow_"]::after` | `packages/mac/src/layout/signal.module.css:22-39` | 停掉 `scan` 扫光，保留琥珀底色与左侧亮边。 |
| `:root[data-calm] [class*="_trigger_"]:hover` | `packages/mac/src/components/zoom-avatar.module.css:12-13` | `transform: none`，只改颜色/描边。 |
| `:root[data-calm] [class*="_avatarButton_"]:hover` | `packages/mac/src/dialogs/native/room.module.css:105-106` | 同上，去掉 `scale(1.08)`。 |
| `:root[data-calm] [class*="_stripCell_"]:hover` | `packages/mac/src/components/views/inline.module.css:46-47` | 去掉 `scaleY(1.12)`。 |
| `:root[data-calm] [class*="_outlineOn_"]:hover` | `packages/mac/src/components/markdown/markdown.module.css:539-542` | 去掉 `font-weight: 500`，只改颜色。 |
| `:root[data-calm] [class*="_chip_"]:hover` | `packages/mac/src/views/usage/your-card.module.css:120-122` | 去掉 `translateY(-1px)`，只改底色。 |

优先用结构属性（`role`、`aria-*`、`data-*`）；没有时才用 `[class*="_名_"]`，且两侧下划线必须保留。理由见 §8。

### 0.2 行为挂钩清单

每个挂钩都是 `fork/calm/` 下的新文件 + 上游文件里一行接入；接入点全部登记在 `docs/fork.md` 的「沉稳界面」一节。

| 挂钩 | 上游文件与接入点 | 做什么 |
| --- | --- | --- |
| `fork/calm/new-below.ts` | `packages/mac/src/chat/ChatLog.tsx`（保持 `stick` 逻辑 `:186-203`，替换 `:326-339` 的 `Latest` 按钮内容） | 你不在底部时不自动滚动；在「最新」处显示「下面有 N 条新内容」的安静提示。 |
| `fork/calm/order-gate.ts` | `packages/mac/src/layout/CategorySections.tsx:28`（`allEntries` 包一层）；排序源在 `packages/mac/src/layout/attention-model.ts:408-411` | 悬停、拖拽、菜单打开时冻结列表顺序；松手/关菜单后一次换到新顺序。 |
| `fork/calm/toast-merge.ts` | `packages/mac/src/App.tsx:51-71`（`Toasts`）、`:258`、`:262`；`packages/mac/src/lib/undo-toast.tsx:16-27` | 全局只有一条 toast、一个位置；`Toasts` 与 `UndoToast` 合流，后来的替换先来的，不堆叠。 |
| `fork/calm/live-gate.ts` | `packages/mac/src/lib/live-motion.ts:25-41`（`tick`/`wake` 一处） | 同一时刻只让一个标记循环：`[data-current]` 的 Shimmer 走时钟，`DotMatrix`、`LiveDot`、计划标记停在静止帧（`paint(null)`）。 |

### 0.3 上游 PR（不进覆盖层）

见 §10。

## 1. 规范一：布局稳定（Nothing shifts）

**规则**

1. 内容加载、到达、开合不推动正在阅读的内容：先占最终尺寸（骨架或固定高度）再原地替换。
2. 悬停、选中、焦点只改颜色，不改尺寸：不加粗、不加粗边框、不换图标宽度。
3. 数字与计时用 `font-variant-numeric: tabular-nums`，并预留增长空间。
4. 新消息、新步骤、新行在用户不在底部时保持视图不动；给出「下面有新内容」的提示。
5. 悬停、拖拽、菜单打开时列表不重排。

**由哪一层实现**

- 第 1、3 条：**上游 PR**（占位尺寸是组件结构，覆盖层无法凭空补出来）；能靠固定高度的（行、徽标槽位）由**覆盖层**兜底。
- 第 2 条：**覆盖层定点修正**（§0.1 表）。
- 第 4 条：**挂钩** `fork/calm/new-below.ts`，接入 `chat/ChatLog.tsx`。
- 第 5 条：**挂钩** `fork/calm/order-gate.ts`，接入 `layout/CategorySections.tsx:28`。

**真实违规示例**

- 步骤变成「当前」时行高从 22px 涨到 26px 并加内边距，下方所有行被推下：`packages/mac/src/chat/steps/steps.module.css:35-41` 对比 `:434-441`。
- 悬停时改变尺寸/字重：`packages/mac/src/components/zoom-avatar.module.css:12-13`（`scale(1.04)`）、`packages/mac/src/dialogs/native/room.module.css:105-106`（`scale(1.08)`）、`packages/mac/src/components/markdown/markdown.module.css:539-542`（`font-weight: 500`）。
- 有新消息时侧栏名字加粗到 650，行宽跟着变：`packages/mac/src/layout/signal.module.css:7-10`。
- 虚拟列表先按估算高度画、量到真高再改：`packages/mac/src/chat/ChatLog.tsx:161-180`，这是位移的来源，只能靠占位与滚动锚定抵消。
- 侧栏在数据变化时重排：`packages/mac/src/layout/attention-model.ts:408-411`。

**检查方式**

- `calm-check` 的 `cls` 与 `shifts[]`：同一场景在 `calm-on/full` 下，enter → loaded → hover → select 四个时刻累计的 CLS 不得高于 `calm-off/full`；`shifts[]` 里不应出现由 hover/select 触发的位移（`hadRecentInput` 之外的也要看）。
- `fork-calm` 的 `hover-size`、`long-duration`、`inline-motion` 类别。

## 2. 规范二：动效克制（Motion explains, it doesn't decorate）

**规则**

1. 过渡 120–200ms，`ease-out`；不得使用弹簧、回弹、超调曲线。
2. 任何元素不得放大超过 1（`scale(1.x)`、`scaleX/Y` 同此）。
3. 禁用装饰性循环与名字：`pop hop bounce ripple sheen shimmer breathe pulse shake blink glow`（以及它们的变体）。
4. 同一时刻只允许一个循环：进行中的工作指示（见 §7）。
5. `prefers-reduced-motion: reduce` 或设置里的 Reduce motion 打开时，只留淡入淡出，或全无。

**由哪一层实现**

- 第 1–3、5 条：**覆盖层** `calm-motion.css`（全局关关键帧、统一过渡、reduced-motion 降级）；个别无法全局覆盖的曲线由**上游 PR** 修。
- 第 4 条：**挂钩** `fork/calm/live-gate.ts`（JS 动效）+ §7 的 CSS 白名单（CSS 动效）。
- 例外：§11 的 keep-decor 一次性装饰。

**真实违规示例**

- 弹簧曲线：`packages/mac/src/call/call.module.css:372`（`cubic-bezier(0.34, 1.4, 0.64, 1)`，340ms）、`packages/mac/src/tasks/tasks.module.css:952`（`0.34, 1.45, …`，360ms）。
- 放大超过 1：`packages/mac/src/chat/steps/steps.module.css:544-555`（`ring` 到 `scale(1.3)`，无限循环）、`packages/mac/src/layout/Shell.module.css:7-13`（`arrive` 1.6s 从 `scale(1.08)` 落到 1）。
- 无限循环：`packages/mac/src/components/ui.module.css:318-329`（`blink` infinite）、`packages/mac/src/layout/signal.module.css:28`（`scan` infinite）、`packages/mac/src/views/usage/usage.module.css:637`（`sheen` infinite）、`packages/mac/src/components/views/views.module.css:152` 一类（`pulse` infinite）。
- 时长超标：`packages/mac/src/views/usage/leaderboard.module.css:119`（700ms）、`:235` 与 `:253`（800ms）。
- JS 动画绕过 CSS：`packages/mac/src/chat/flight.ts:141`、`packages/mac/src/sentinel/DashboardPage.tsx:480`、`packages/mac/src/call/NotesBox.tsx:157`（900ms）。

**检查方式**

- `calm-check` 的 `animations[]`（`duration`、`iterations`、`playState`）与 `jsMotion`；`calm-on/reduce` 组合下只允许淡入淡出，动画数应为 0 或极少。
- `fork-calm` 的 `spring`、`overscale`、`long-duration`、`infinite`、`element-animate`、`inline-motion` 类别。

## 3. 规范三：状态安静（State changes quietly）

**规则**

1. 点、徽标、计数在原地切换或 150ms 淡入，不位移、不逐个飞入。
2. 同一信息只用一套视觉语言、一个位置（侧栏右缘的 14px 槽位）。
3. 「需要你」是稳定标记（琥珀底色 + 左侧亮边），不是持续扫光或脉冲。
4. 忙碌指示的循环由 §7 统一，不同模块不得各起一个。

**由哪一层实现**

- 第 1–3 条：**覆盖层** `calm-state.css` + `signal.module.css` 定点修正。
- 第 4 条：**挂钩** `fork/calm/live-gate.ts`（`DotMatrix` 与计划标记走同一时钟，只留当前步骤）。
- 计数/徽标的取值逻辑本身：**上游 PR**（只改视觉，不碰数据）。

**真实违规示例**

- 「需要你」的行持续扫光：`packages/mac/src/layout/signal.module.css:22-39`（`scan` 4.2s infinite）。
- 有新消息时名字加粗：`packages/mac/src/layout/signal.module.css:7-10`。
- Claude 工作时三个点无限 blink：`packages/mac/src/components/ui.module.css:318-329`。
- 计划的呼吸点：`packages/mac/src/plans/marks.tsx:79-84`（`LiveDot` 用 `breath`）——JS 驱动，视觉上仍是循环。
- 当前步骤行的 shimmer 与加粗：`packages/mac/src/chat/steps/steps.module.css:443-445`、`:453-461`。

**检查方式**

- `calm-check` 在 `workspace`、`plan`、`tasks`、`sentinel` 场景下 `animations[]` 中的 infinite 数量与 `jsMotion.elements` 数量；`calm-on` 应明显低于 `calm-off`。
- `fork-calm` 的 `infinite` 类别与禁用动画名。

## 4. 规范四：反馈分级（Feedback by weight）

**规则**

1. 完成：就地一个词或图标，不弹 toast。
2. 值得知道：一次一条 toast，固定位置，几秒后淡出，不堆叠、不飞入。
3. 必须现在决定：对话框或固定卡片，说明会发生什么。
4. 错误：出现在发生的地方，不集中到角落。
5. 同一时刻全局最多一条轻提示（包含 Undo）。

**由哪一层实现**

- 第 2、5 条：**挂钩** `fork/calm/toast-merge.ts`，接入 `App.tsx` 与 `lib/undo-toast.tsx`。
- 第 3 条的出现方式：**覆盖层** `calm-overlays.css`。
- 第 1、4 条：**上游 PR**（反馈逻辑在组件里），M0 只登记。

**真实违规示例**

- 两套 toast 各自渲染、可能同时出现：`packages/mac/src/App.tsx:51-71`（`Toasts`）与 `packages/mac/src/App.tsx:258,262`（同时挂 `<Toasts />`、`<UndoToast />`）；`packages/mac/src/lib/undo-toast.tsx:16-27` 是独立单槽。
- 900ms 的背景闪一下：`packages/mac/src/call/NotesBox.tsx:157`。

**检查方式**

- `calm-check` 在 `chatrun`、`workspace` 的操作后截图：同一时刻只应看到一个轻提示；`shifts[]` 中不应有提示造成的位移。
- `fork-calm` 的 `long-duration`、`element-animate`；toast 合流是行为，靠 `fork/calm/toast-merge` 的纯函数单测与人工复核。

## 5. 规范五：一致可预期（One way everywhere）

**规则**

1. 菜单、面板、抽屉、对话框同一方式、同一位置、同一曲线打开。
2. 间距、字号、圆角、颜色只来自 `tokens.css`，不写一次性值。
3. 大部分中性色；强调色只给一个主操作与关键状态。
4. 同类动作的反馈强度一致，不因页面不同而变。

**由哪一层实现**

- 第 1 条：**覆盖层** `calm-overlays.css`。
- 第 2 条：**覆盖层** `calm-tokens.css` 覆盖令牌；仍在文件里硬编码的时长/曲线由**上游 PR** 逐批收拢（§10）。
- 第 3、4 条：**上游 PR**（颜色使用是设计决定）；覆盖层只做能安全全局化的部分。

**真实违规示例**

- 同类弹出层各自硬编码时长/曲线：`packages/mac/src/callfloat/callfloat.module.css:15`（420ms）、`packages/mac/src/call/call.module.css:372`（340ms）、`packages/mac/src/tasks/tasks.module.css:952`（360ms）、`packages/mac/src/views/usage/leaderboard.module.css:119`（700ms）。
- 令牌早已就位却大量未用：`packages/mac/src/styles/tokens.css:29-31`（`--dur-fast: 120ms`、`--dur: 180ms`、`--ease-out`），`:118-121`（reduce 时 0ms）。

**检查方式**

- `calm-check` 各场景 `animations[]` 的 `duration` 与名字分布：同类元素应落在同一档。
- `fork-calm` 的 `long-duration`、`spring`、`keyframes`；如需，M1 再加「硬编码时长」类别。

## 6. 规范六：逐页验收（Check it）

**规则**

1. 每个改过的页面按 load → arrival → hover → select → open/close 走一遍，找任何位移或尺寸变化。
2. 仍在播的动画必须能说出它解释的空间变化；说不出的删掉。
3. 打开 Reduce motion 再看一遍。
4. 新页面/新组件进入本规范，不得以「这个页面特殊」为由跳过。

**由哪一层实现**

- 这是**验收流程**，不是新代码：覆盖层与挂钩的产出都用它验收。
- 发现通用问题时，按 §10 提**上游 PR**；发现局部问题时，回到 §0 选择覆盖层或挂钩。

**真实违规示例**

- 只有逐页走才看得到的整块滑动：`packages/mac/src/views/usage/leaderboard.module.css:235,253`（800ms 的 `left` 过渡，榜单换位时滑动）。
- 悬停轻抬：`packages/mac/src/views/usage/your-card.module.css:120-122`、`packages/mac/src/sentinel/showcase.module.css:116`（`translateY(-2px) scale(1.02)`）。
- 引导的一次性动画：`packages/mac/src/onboarding/scenes/scenes.module.css:182`（`ping` infinite）——属于 §11 的例外，但仍要在 reduced-motion 下停。

**检查方式**

- `calm-check` 跑 §9.1 列出的全部代表场景 × 四组合（`calm-on/full`、`calm-on/reduce`、`calm-off/full`、`calm-off/reduce`），每场景在 enter/loaded/hover/select 截图；`firstFrame.calm` 必须为 `true`。
- `fork-calm` 的完整报告（§9.2）随每次同步上游更新。

## 7. 唯一循环与白名单

### 7.1 规范实例

进行中的工作只有一种循环指示，锚点是**当前步骤行**：

```tsx
// packages/mac/src/chat/steps/StepRow.tsx:138
<div … data-current={current || undefined} …>
```

选它的理由：

- `data-current` 是**结构性属性**，不是 CSS Modules 类名，上游改类名/重排样式不影响它。
- 它已经精确表示「现在在做的那一步」，一个时刻只有一行。
- 它的视觉（Shimmer）目前由 JS 时钟驱动，便于 M1 用挂钩收束。

### 7.2 CSS 白名单

M1 在 `calm-motion.css` 里：

```css
/* 全局关掉一切关键帧 */
:root[data-calm] * { animation: none !important; }
/* 唯一例外：当前步骤行（及其子元素）。M1 在这里填入唯一指示的具体 animation，
   与全局规则同为 !important，靠更高的特异性胜出；M2 只换视觉。 */
:root[data-calm] [data-step][data-current],
:root[data-calm] [data-step][data-current] * {
  animation: /* M1 填入 */ none !important;
}
```

白名单选择器固定为 `:root[data-calm] [data-step][data-current]`（不能只写 `[data-current]`：`WaitingRow` 与 `ProjectTree` 也会设它，前者头像环是 2.2s 无限动画）。M2 只替换这套动画的视觉（一枚小而安静、不前推布局的进度指示），**位置与锚点不变**。

### 7.3 JS 循环的收束

`Shimmer`（`StepRow.tsx:46-58`）、`DotMatrix`（`components/DotMatrix.tsx:55-84`）、计划标记（`plans/marks.tsx:79-84`）都由 `lib/live-motion.ts` 的同一个时钟驱动。挂钩 `fork/calm/live-gate.ts` 在 `wake()` 处只允许 `[data-current]` 内的标记加入，其余标记画即停（`paint(null)` 的静止帧）。因此：

- CSS 循环：全局关 + `[data-current]` 白名单。
- JS 循环：同一个 gate 只放行 `[data-current]`。
- 两者合计 = 「同一时刻只有一个东西在动」。

reduced-motion 下两者都停：CSS 走 `prefers-reduced-motion` / `:root[data-motion='reduce']`，JS 走 `lib/reduced-motion.ts:1-3`（已有逻辑）。

### 7.4 keep-decor 例外清单

以下装饰**允许保留**：一次性、不在工作表面、不随停留时间循环；reduced-motion 下仍必须停。`fork-calm` 扫描跳过这些路径。

- `packages/mac/src/onboarding/**`：欢迎/引导的一次性场景（`onboarding/scenes/scenes.module.css`、`onboarding/Wormhole.tsx`）。
- `packages/mac/src/dialogs/star-scene.module.css`：关于/支持页的星空装饰。
- `packages/mac/src/call/call.module.css` 的来电响铃（`ring*`）：必须提示的来电，不是工作表面。
- `packages/mac/src/components/PixelBurst.tsx` 与 `pixel-burst-model.ts`：一次性的庆祝粒子。
- `packages/mac/src/views/usage/Recap.tsx`：Usage Pass 的「Play Your Recap」回放（M3 · BLG-173 批准：用户点按才播的一次性成就回放，不在工作表面）。

### 7.5 范围外

- **独立窗口**：`popup`、`callfloat`、`overlay` 窗口不走 `packages/mac/src/main.tsx`，不会加载 `fork/calm/index.ts`，因此没有 `data-calm`。它们不在本覆盖层范围，修法沿用上游 PR 或后续里程碑单独接入。
- **第三方内容**：xterm 终端、pdf.js 阅读器里的内容由第三方渲染，不视为界面动效。
- **系统层**：macOS 窗口的 vibrancy、原生菜单动画不在 Web 层。

## 8. 选择器策略

**已查明**：`packages/mac/vite.config.ts` 没有自定义 `generateScopedName`；Vite 8.3.4 的 CSS Modules 在 dev 与生产构建里都生成 `_名_哈希_行号` 形式的类名（设计阶段已在 `dist` 实证 `_shimmer_zg6mi_95` 这一类）。因此被覆盖的上游类名是可知的，但**不稳定**：上游改一次类名或行号，类名就变。

规则：

1. **优先结构属性**：`[role=…]`、`[aria-*]`、`[data-*]`。它们表达语义，上游重排样式不会改。
2. **其次类名片段**：`[class*="_名_"]`，两侧下划线必须保留（防止 `_name_` 误配 `_fullname_`）。不要用 `[class^=…]` 或没有边界的最短子串。
3. **不用 `:global(.名)` 直接命中上游类名**：它会把哈希当成类名，必然失配。
4. **上游改类名时**：规则只是**静默失效**（选择器不再匹配），不会产生语法错误、不会误伤别的元素、也不会在合并时冲突——因为规则写在 fork 自己的文件里。
5. **失效要能被发现**：`calm-check` 的 `calm-on` 组合会复现本应被压住的动画；`fork-calm` 会把上游新增的 `@keyframes` 列为「新增」。两者一起兜底。

## 9. 检查方式（两个工具）

### 9.1 `packages/mac/scripts/calm-check.mjs`

```bash
node packages/mac/scripts/calm-check.mjs room workspace chatrun plan tasks sentinel usage onboarding
```

- 依赖本机 `vite`（默认 `BELUGA_URL=http://localhost:1420`）与演示 daemon；探活失败时打印两条启动命令并以 1 退出：
  ```bash
  cd packages/mac && npm run dev
  BELUGA_ALLOW_ORIGINS=http://localhost:1420 npm run dev
  ```
  `BELUGA_ALLOW_ORIGINS` 是必须的：普通 Chromium 的页面来源是 `http://localhost:1420`，不在 daemon 默认的 Tauri 来源里。想把演示数据关在临时目录里，给两条命令都加 `BELUGA_HOME=/tmp/calm-demo`。
- 参照 `packages/mac/scripts/shots.mjs`：Playwright Chromium、1440×900、`openWs`/`tab`/`side` 辅助函数复制（shots.mjs 是上游文件，只能复制不能 import）。
- 场景：`shots.mjs` 已有的全部场景（`room onboarding workspace chatrun diff files terminal overview usage search shared palette settings person dock picker`）+ 新增 `plan`、`tasks`、`sentinel`。
- 四组合，各自独立 context：
  - `calm-on/full`：`localStorage['beluga.fork.calm.v1'] = {"calm":true}`。
  - `calm-on/reduce`：再加 `beluga.prefs.v1` 的 `reduceMotion: true`，并 `page.emulateMedia({ reducedMotion: 'reduce' })`。
  - `calm-off/full`、`calm-off/reduce`：对应开关关闭。
  - 非 `onboarding` 场景用 `addInitScript` 跳过引导。
- 每场景 × 组合采集：
  - `cls`：`PerformanceObserver('layout-shift')`，排除 `hadRecentInput`。
  - `shifts[]`：每次位移的 `value`、`hadRecentInput`、`sources`（最多 4 层选择器）。
  - `animations[]`：`document.getAnimations()`，在 enter 与结束各取一次后合并，含选择器、类型（css/js）、名字或过渡属性、`duration`、`iterations`（无限为 `"infinite"`）、`playState`。
  - `jsMotion`：2 秒 `MutationObserver(style)`，按元素统计改写次数。
  - `firstFrame`：`DOMContentLoaded` 后的第一帧（应用模块已跑、真正能画第一帧的时刻）`data-calm` 是否已设。裸文档的首个 `rAF` 早于应用模块，永远看不到它。
  - `shots`：enter / loaded / hover / select（`chatrun` 另含新消息时刻）→ `.context/calm/img/<scene>-<combo>-<moment>.png`（`deviceScaleFactor: 1`）。
- 输出：

```json
{
  "scene": "workspace",
  "at": "2026-11-11T…",
  "git": "<sha>",
  "combos": {
    "calm-on/full": {
      "cls": 0.08,
      "shifts": [],
      "animations": [],
      "jsMotion": { "seconds": 2, "elements": [{ "selector": "…", "writes": 31 }] },
      "firstFrame": { "calm": true },
      "shots": ["img/workspace-calm-on-full-enter.png"]
    },
    "calm-on/reduce": {},
    "calm-off/full": {},
    "calm-off/reduce": {}
  }
}
```

- 每个场景写 `.context/calm/<scene>.json`，stdout 打印四组合摘要。`.context` 被 gitignore，基线截图拷进 `docs/calm/img/` 再提交（BLG-158）。

### 9.2 `tests/fork-calm.test.ts`

```bash
npx vitest run tests/fork-calm.test.ts                 # 检查
CALM_UPDATE=1 npx vitest run tests/fork-calm.test.ts   # 重写快照
```

- 纯 `fs` + 正则扫描 `packages/mac/src/**/*.{css,tsx,ts}`；跳过 `fork/` 与 §7.4 的 keep-decor 路径。
- 类别：
  - `keyframes`：新的 `@keyframes` 名。
  - `infinite`：`animation` 含 `infinite`。
  - `element-animate`：`.animate(`。
  - `inline-motion`：tsx 内联 `style` 里的 `animation`/`transition`。
  - `live-motion`：`import` `lib/live-motion` 的文件。
  - `hover-size`：`:hover`/`:focus`/`[aria-selected]`/`:active` 规则里改 `font-weight`、`border-width`、`width`、`height`、`padding`、`margin`、`transform`。
  - `spring`：`cubic-bezier` 的 `y1 < 0` 或 `y2 > 1`。
  - `overscale`：`scale()` 超过 1。
  - `long-duration`：时长超过 200ms。
- 快照 `tests/fork-calm.snapshot.json`：`{ "version": 1, "findings": ["类别|相对路径|名字"] }`。**不带行号**（行号只进打印报告），这样上游重排不会让快照整片失效。
- 断言：
  - 上游文件里的发现**只打印「新增/消失」**，不让测试失败。
  - `fork/calm/**` 自己出现 `spring`、`overscale`、`long-duration`，或使用禁用动画名（`pop hop bounce ripple sheen shimmer breathe pulse shake blink glow`）→ **失败**。
- 无计时、无端口、无浏览器，CI 三平台安全。

### 9.3 对应关系

| 规范 | `calm-check` 指标 | `fork-calm` 类别 |
| --- | --- | --- |
| §1 布局稳定 | `cls`、`shifts[]` | `hover-size`、`long-duration`、`inline-motion` |
| §2 动效克制 | `animations[]`、`jsMotion`、reduce 组合 | `spring`、`overscale`、`long-duration`、`infinite`、`keyframes` |
| §3 状态安静 | `animations[]` 的 infinite、`jsMotion` | `infinite`、禁用名 |
| §4 反馈分级 | 操作后截图、`shifts[]` | `element-animate`、`long-duration` |
| §5 一致可预期 | `animations[]` 的 duration 分布 | `keyframes`、`spring`、`long-duration` |
| §6 逐页验收 | 全部场景 × 四组合、`firstFrame.calm` | 完整报告 |

## 10. 建议提回上游的通用修复

这些对所有人都成立，提 PR 合入后 fork 的差异就消失：

1. **「需要你」改成稳定标记**：去掉 `packages/mac/src/layout/signal.module.css:22-39` 的 `scan` 扫光，只留琥珀底色与左侧亮边。对任何用户都更安静，也符合 macOS 的提醒语言。
2. **工作指示尊重 reduced motion**：`packages/mac/src/components/ui.module.css:318-329` 的 `blink` 在 `prefers-reduced-motion` 下停住；`views/usage/views.module.css:152` 的 `pulse` 同理。
3. **悬停只改颜色**：`components/zoom-avatar.module.css:12-13`、`dialogs/native/room.module.css:105-106`、`components/views/inline.module.css:46-47`、`components/markdown/markdown.module.css:539-542`、`views/usage/your-card.module.css:120-122`。收益是布局不抖，不依赖 fork。
4. **统一过渡令牌**：把 `callfloat/callfloat.module.css:15`、`call/call.module.css:372`、`tasks/tasks.module.css:952`、`views/usage/leaderboard.module.css:119,235,253` 里的一次性时长/曲线换成 `var(--dur-fast)`/`var(--dur)`/`var(--ease-out)`；`leaderboard` 的 700/800ms 直接降到 200ms 以内。
5. **状态行高固定**：`chat/steps/steps.module.css:434-441` 的 `.rowCurrent .head` 不再改 `min-height`/`padding`，当前状态只换底色与文字色。
6. **toast 合流**：`App.tsx` 的 `Toasts` 与 `lib/undo-toast.tsx` 共用一条队列（如果上游愿意接受这个行为变化）。

## 11. 例外与范围外

- **keep-decor**：§7.4 的清单。除此之外没有例外；新增例外必须写进本节并说明为什么不是装饰。
- **独立窗口**：`popup`、`callfloat`、`overlay` 不加载 `fork/calm`，在 M0 范围外。
- **第三方渲染**：xterm、pdf.js 的内容不是界面动效。
- **一次性引导**：`onboarding/**` 允许一次性入场动画，但 reduced-motion 下仍要停。

## 12. CLAUDE.md 的去处

- 本节原文已完整搬到本文档开头。`CLAUDE.md` 中《The Mac app's look: calm, not lively》整节删除，只留一行：
  `The Mac app's look is calm, not lively: the rules are in docs/calm-ui.md.`
- 这次编辑与 `main.tsx` 的一行 import、`dialogs/Settings.tsx` 的一行接入、`tests/mac-settings-search.test.ts` 的一行，一起登记在 `docs/fork.md` 新增的「沉稳界面」一节（BLG-155 完成）。
- 之后所有关于界面气质的讨论以本文档为准；`CLAUDE.md` 不再重复。

## 13. 开关与首帧（BLG-155 的接口）

- 偏好键：`beluga.fork.calm.v1`，值为 JSON `{ "calm": boolean }`，缺省 `true`。
- 接口（`packages/mac/src/fork/calm/index.ts`）：

```ts
export const CALM_KEY = 'beluga.fork.calm.v1';
export function calmOn(): boolean;
export function setCalm(on: boolean): void; // 写键、dataset、通知 listeners
export function useCalm(): boolean;         // useSyncExternalStore
```

- 首帧：`main.tsx` 在 `import './styles/base.css'` 之后加一行 `import './fork/calm/index.js'`；模块体同步设置 `document.documentElement.dataset.calm`，早于首次 render（`main.tsx:112-118` 的 `startI18n().then(render)`），因此上游动画不会先闪一下。
- 调用方只有两处：设置里的「沉稳模式」行，以及 `calm-check` 的 `addInitScript`。
