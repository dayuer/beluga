# 沉稳界面：行为挂钩（M2）

- 状态：BLG-164 的设计稿。BLG-165–168 照此实施，BLG-169 按本页复核。
- 行号基准：`e8db48f4b`（plan/mac-fork 合入 M0 之后）。上游一改行号就会漂，所以每个接入点都配一条 canary（§5），以 canary 为准，行号只用来找位置。
- 相关文档：`docs/calm-ui.md`（六条规范、三层分工）、`docs/fork.md`（上游接入登记）、`docs/calm/baseline.md`（M0 基线）。

## 0. 总则

```txt
fork/calm/<行为>.ts        逻辑、状态机、组件（本 fork 自己的文件，上游不碰）
上游文件                   1–3 行接入（import + 一次调用 / 一个 prop）
关掉 data-calm             每个 fork 模块先查 calmOn()，为假时逐字回到上游行为
```

1. **接入点小、语义稳。** 不用类名和行号，用结构性属性（`data-current`、`data-arranging`、`role="status"`）和函数参数。上游重排样式不影响接入点。
2. **排序纯函数一个都不改。** `layout/attention-model.ts`、`layout/waiting-model.ts` 保持逐字相同；挂钩只控制「什么时候换上新顺序」。
3. **关掉沉稳 = 上游。** 每个挂钩的 calm-off 路径不是「尽量相同」，而是代码上走回原值：`useHeldEntries` 直接返回 fresh、`JumpLabel` 渲染上游的两个子节点、`useOneToast` 恒为 true、`calmLive` 恒为真。证据见 §8。
4. **接入点失效必须能被发现。** 每处上游接入登记进 `tests/fork-calm.test.ts` 的 `TOUCHPOINTS`（§5）：匹配不上一律测试失败，不随「上游报告只是报告」的规则豁免。

### 0.1 与 M1 的契约（并行里程碑，先立字据）

- **一种循环 = JS 时钟驱动 `[data-current]` 的 Shimmer**（`chat/steps/StepRow.tsx:47-58`）。`fork/calm/calm-motion.css` 的白名单选择器 `:root[data-calm] [data-current]`（含 `*`）**不得再填 CSS 关键帧循环**，保持 `animation: none !important`；否则 M1+M2 会出现两种循环。BLG-168 落地时若 M1 已填了 CSS 循环，删掉一个，把结论记到本页 §4.5。
- toast 的**位置与合并外观**归 `fork/calm/one-toast.css`（本里程碑）；toast 的**入场动画**归 `fork/calm/calm-overlays.css`（M1 的浮层规则）。`one-toast.css` 在 `fork/calm/calm.css` 的 `@import` 链里排在 `calm-overlays.css` 之后（现在是 — tokens、motion、overlays、state，加在最后一行之前）。

### 0.2 与 `docs/calm-ui.md` §0.2 的差异（本页为准）

| calm-ui.md 的设想 | 本页定案 | 原因 |
| --- | --- | --- |
| `order-gate.ts` 接 `CategorySections.tsx:28` | `hold-order.ts` 接 `EntryRow.tsx` 的 `useEntryList`，`Sidebar.tsx` 挂探针 | Unread 与 Categories 两种侧栏模式都走 `useEntryList`，一处覆盖两种；`CategorySections` 只被其中一种用到 |
| `toast-merge.ts`，`Toasts`/`UndoToast` 合流 | `one-toast.ts`，两套提示各自保留，只仲裁谁可见 | 合流要搬定时器、⌘Z、样式，接入面大；仲裁只加一个可见性判断 |
| `new-below.ts` | `new-below.tsx` | 有 JSX 组件 |
| 上游 4 个文件 | 6 个（多 `Sidebar.tsx`、`EntryRow.tsx`） | 探针和冻结缝分开：Sidebar 只回答「在不在操作」，EntryRow 只回答「顺序换不换」 |
| `live-gate` 只改 `wake()` 一处 | `live-motion.ts` 同一文件 5 处（各 1 行） | 只在 `wake()` 拦不住 `tick()` 的逐元素 paint：15fps 的 style 写入仍会被 calm-check 的 `jsMotion` 数成「在动」 |
| `waiting-model.ts:116` 在排序 | **不改也不包** | 它的排序喂「需要你」清单（NeedsYou），不是侧栏列表；侧栏的顺序全部来自 `attention-model.ts` |

## 1. 挂钩一：操作时冻结侧栏顺序（BLG-165）

### 1.1 上游现状

- 排序在纯函数里：`attention-model.ts:359`（`unreadEntries` 的 `.sort`）、`attention-model.ts:408-411`（`categoriesOf` 的四次 `.sort`）。**一行不动。**
- 排序结果真正被消费的缝：`layout/EntryRow.tsx:72` 的 `useEntryList`，返回对象的 `entries`（`:97`）。`UnreadSection.tsx:17` 与 `CategorySections.tsx:35` 都调它。
- 「打开的行原地停留」的 `kept` 逻辑在 `useEntryList` 内部（`:76`、`:83`、`:87-92`），本挂钩不碰。
- 拖拽排序时页面已有结构属性：`layout/arrange-drag.ts:141` 设 `document.documentElement.dataset.arranging = ''`，`:181` 删除。零上游改动可用。

### 1.2 上游改动

`layout/Sidebar.tsx`（2 行）：

```tsx
import { useSidebarHold } from '../fork/calm/hold-order.js';   // 文件头 import 区
// ……
const drop = useFolderDrop();                                   // :96
useSidebarHold(drop.ref);                                       // 新增一行
```

`layout/EntryRow.tsx`（3 行）：

```tsx
import { useHeldEntries } from '../fork/calm/hold-order.js';    // 文件头
// 在 useApp 之后（:85 之后）：
const held = useHeldEntries(entries);
const listed = stay && kept ? held.filter((e) => e.channel !== kept.entry.channel) : held;  // 见下：避免重复行
// return（:97）里的 entries 换成 listed；kept 仍在同一处插入：
return { here, entries: listed, ...(stay && kept ? { kept: { entry: stay, at: kept.at } } : {}), ownerName: (id) => owners[id] ?? 'Shared', open };
```

**`kept` 与冻结组的重叠（设计时发现，实施必须处理）**：悬停中点开一行时，`stay` 按 fresh 计算（该行已离开 fresh），但冻结组里还留着它；`CategorySections.tsx:40` / `UnreadSection.tsx:20` 又会把 `kept.entry` 插回 `at`，同一行会出现两次（重复 key）。修法在 `useEntryList` 里一行：冻结组若仍含 `kept` 的那条，先把它滤掉再返回——`kept.at` 正是它的原位置，插回后位置完全不变。

```tsx
const listed = stay && kept ? held.filter((e) => e.channel !== kept.entry.channel) : held;
```

（替换的是 `return` 里的 `entries`，不是 `kept` 的插入逻辑——`kept.at` 仍是那一行的原索引。）

### 1.3 fork 接口：`fork/calm/hold-order.ts`

```ts
export type HoldReason = 'pointer' | 'keys' | 'drag' | 'menu';
export const HOLD_MS = 600;

export function holdBegin(r: HoldReason): void;  // 计入原因，取消释放计时
export function holdEnd(r: HoldReason): void;    // 移除原因；全空后起 600ms 释放计时
export function holdHeld(): boolean;             // 有原因，或仍在 600ms 宽限内
export function useSidebarHold(ref: RefObject<HTMLElement | null>): void;
export function useHeldEntries<E>(fresh: readonly E[]): readonly E[];
```

状态机（模块级，`useSyncExternalStore` 订阅）：

- `reasons: Set<HoldReason>` + 一个 `grace` 计时器；任一在场即冻结。
- `holdBegin` 清计时器并加入原因；`holdEnd` 移除原因，全空后 `setTimeout(release, 600)`。
- `release`：查 `document.querySelector('[role="menu"]')`。菜单还开着就**续期 600ms**（不新增原因——见下）；关了就通知，下一次渲染换上新顺序。
- `menu` 原因位保留但不用：Radix 菜单在 portal 里，关菜单时没有人会调用 `holdEnd('menu')`，用它会让侧栏永久冻结。释放计时器自己续期就够了（**这是对设计稿的修正**）。
- 宽限期内 `holdBegin('keys')` 等会清掉计时器，继续冻结——即「松手后 600ms 内又操作」不会闪一次序。

`useSidebarHold(ref)`（`useCalm()` 为假时完全不挂）：

- `pointerenter`/`pointerleave` → `pointer`。
- `focusin` / `focusout`（冒泡即可）→ `keys`；`focusout` 在下一帧查 `el.contains(document.activeElement)`，焦点仍在侧栏就不释放。
- `MutationObserver` 看 `<html data-arranging>` → `drag`。
- effect 清理时移除自己加过的所有原因（StrictMode 双挂载、侧栏被隐藏时不留下悬空原因）。

`useHeldEntries(fresh)`（纯渲染，幂等）：

```ts
const on = useCalm();
const held = useSyncExternalStore(subscribe, holdHeld, holdHeld);
const frozen = useRef<readonly E[]>(undefined);
if (!on || !held) { frozen.current = undefined; return fresh; }  // calm 关或没在操作：原样
frozen.current ??= fresh;                                        // 冻结开始那一刻的整组
return frozen.current;
```

- **整组冻结**：行对象、分区归属、数量都不变，符合「只控制什么时候换上新顺序」。代价是冻结期间行内容也不更新（含「需要你」标记的出现会晚到释放后），按任务语境有意为之，M3 可复议。
- `??=` 写在渲染里也不产生副作用，StrictMode 双渲染安全；释放由 store 通知触发重渲染，拿到最新的 `fresh`。
- `kept` 的 selector 在 `useApp` 里跑，仍然用 fresh，不受冻结影响。

### 1.4 测试

- 单测 `tests/fork-calm-hold-order.test.ts`（照 `tests/fork-calm-mode.test.ts` 的 stub 环境：`vi.stubGlobal('document', …)` + `vi.useFakeTimers()`）：begin 即冻结；end 后 600ms 内仍冻结；到点释放；宽限期内再 begin 续冻；菜单未关（`querySelector` 返回元素）时释放计时器续期。hook 本身（`useSidebarHold`/`useHeldEntries`）不在单测里——仓库没有 React DOM 测试环境——由下面的 e2e 兜底。
- e2e `e2e/fork-calm-sidebar.spec.ts`（默认 calm 开）：照 `unread.spec.ts` 的路子，在 `add-auth` 发一条 mock prompt，切到 `landing`，指针停在侧栏上；等该会话 `data-signal-row` 变成 `unread`（即排序本会变），断言 Unread/Categories 区里现有各行的 `boundingBox().y` 与基线相同；`page.mouse.move(0, 0)` 后 600–700ms 内 `expect.poll` 到新行出现/顺序变化。calm-off 变体用 `addInitScript` 写 `beluga.fork.calm.v1 = {"calm":false}`（照 `calm-check.mjs:249`），断言同样的变化在指针仍停侧栏时发生（不冻结）。时序一律 `expect.poll`。

### 1.5 失效检测与已知弱点

- canary：`Sidebar.tsx` ↔ `useSidebarHold(drop.ref)`；`EntryRow.tsx` ↔ `useHeldEntries(`。上游改 `useFolderDrop` 的返回或 `useEntryList` 的返回形状时测试失败。
- 行为兜底：e2e 的 calm-off 变体若「也不冻结」，说明挂钩被绕过。
- 已知弱点：`[role="menu"]` 是启发式。非 `role=menu` 的浮层（`role=dialog` 的选择器等）从侧栏打开时，指针离开侧栏 600ms 后仍可能换序。失效上限是「菜单开着时 600ms 后换序」，不崩、不误伤别处；M3 验收时人查一次。

### 1.6 登记行（写进 `docs/fork.md` 的「沉稳界面」一节）

- `packages/mac/src/layout/Sidebar.tsx`：一行 `useSidebarHold(drop.ref)`——侧栏上「在操作」的探针，逻辑在 `fork/calm/hold-order.ts`。
- `packages/mac/src/layout/EntryRow.tsx`：`useEntryList` 里包一层 `useHeldEntries`——两种侧栏模式共同消费排序结果的唯一缝。

### 1.7 证据（BLG-165）

- 单测 `tests/fork-calm-hold-order.test.ts`：5 条状态机用例（悬停冻结、离开 600ms 后释放、键盘焦点仍冻结、宽限期内再操作续冻、拖动、菜单未关续期）。
- e2e `packages/mac/e2e/fork-calm-sidebar.spec.ts`：calm 开时指针停在侧栏、会话变成 needs 的期间 Unread 列表逐行不变，离开后才换；calm-off 变体断言同样的变化在指针仍在侧栏时发生。按计划在里程碑最终步骤统一跑 e2e。
- canary 已加进 `tests/fork-calm.test.ts` 的 `TOUCHPOINTS`（`useSidebarHold(drop.ref)`、`useHeldEntries(`）。

## 2. 挂钩二：对话滚动锚定与「有新内容」（BLG-166）

### 2.1 上游现状（已核对，不用重写滚动）

- `stick`/`atBottom`：`ChatLog.tsx:158-207`。不在底部时新行不跟滚；`onScroll` 只在真的到底时重新粘住（`:244-255`，还会区分「自己滚」和「列表自己动」）。
- 虚拟列表：`:161-180`，`directDomUpdates`，`onChange` 里粘底。
- 加载更早消息已有补偿：`:114-121`（`useEarlier` 的 `useLayoutEffect` 按 `scrollHeight` 差补 `scrollTop`）。
- 回到底部的按钮：`:326-339`，`Icon name="chevronDown"` + 文字 `Latest`。

### 2.2 要核实的挪位（BLG-166 用 calm-check 实测）

| 情形 | 现状 | 结论 |
| --- | --- | --- |
| 更早的消息从上面来 | 已补偿（`:114-121`） | 不动 |
| 上方行重测量（图片晚到、卡片长高） | TanStack 更新后续行位置，**上游没有补 scrollTop** | 可能挪位；实测后再决定 |
| 你自己在滚动 | `onScroll` 的 400ms 判定，列表自己动不算 | 不动 |

若实测 `anchor.offsetPx ≠ 0`：`@tanstack/react-virtual` 3.14 有 `shouldAdjustScrollPositionOnItemSizeChange`（已在 `node_modules/@tanstack/virtual-core/dist/esm/index.d.ts:135` 确认）。一行修法，**only when not sticking**：

```tsx
shouldAdjustScrollPositionOnItemSizeChange: () => !stick.current,
```

加进 `ChatLog.tsx:161-180` 的 `useVirtualizer` 选项。这是 upstream-ok 的直接修复，同时列为**上游 PR 候选**（§7）：对所有用户都是修一个位移 bug。修了要登记 `docs/fork.md`。

### 2.3 fork 接口：`fork/calm/new-below.tsx`

```tsx
export function JumpLabel({ rows }: { rows: number }): JSX.Element;
```

- calm 关：`<><Icon name="chevronDown" size={12} /> Latest</>`，与上游 `:336-337` 逐字等效。
- calm 开：组件挂载即「你离开底部」的时刻（按钮只在 `atBottom === false` 时挂载）。`useRef` 记挂载时的行数，之后每次渲染算 `n = rows - base`；`rows` 变小（换了会话、列表重置）则把 base 重置为当前。`n > 0` 显示 `{n} new`，否则 `Latest`。回到底部按钮卸载，计数自然清零。
- 外层带 `data-new={n}` 供 `one-toast.css` 做安静的数字样式（同一角落，不比 `Latest` 更响）。

`ChatLog.tsx` 只改按钮的 children（`:336-337`）：

```tsx
<JumpLabel rows={rows.length} />
```

按钮本体、`className`、`onClick`、`stick` 逻辑一行不动。

### 2.4 calm-check 的 chatrun 扩展（fork 自己的脚本，字段只增不改）

`packages/mac/scripts/calm-check.mjs` 的 `chatrun` 场景加一段 `anchor` 测量，写进每个 combo 的 JSON（旧字段不动，`baseline.md` 的对比照旧）：

1. 发 prompt，等行出现后 `mouse.wheel(0, -400)` 上滚（离开底部）。
2. 记第一个可见 `[data-index]` 行的 `index` 与 `clientY`。
3. 再发 2–3 条短 prompt（mock 每轮约 7 行，合计 ≥20 新行），等稳定。
4. 重测同一 `index` 元素的 `clientY` → `anchor.offsetPx`（验收 calm-on/full 为 0）；同时记按钮文案 `anchor.hint`（应含 `new`）与 `anchor.newRows`。

### 2.5 失效检测、登记行、PR

- canary：`ChatLog.tsx` ↔ `<JumpLabel rows={rows.length} />`。上游重写按钮内容或改 `rows` 的变量名时失败。
- 登记行：`packages/mac/src/chat/ChatLog.tsx`：「回到底部」按钮的文案换成 `fork/calm/new-below.tsx` 的 `JumpLabel`——上游不提供「下面来了几条」，计数要跨渲染保存，只能做成组件；按钮其余部分未动。
- PR 候选：若实测确有位移，`shouldAdjustScrollPositionOnItemSizeChange` 一行修法是通用修复（§7）；`JumpLabel` 的文案本身是沉稳界面的口味，不提。

### 2.6 证据（BLG-166）

- `fork/calm/new-below.tsx`：按钮挂载即离开底部，行数差就是新消息数；calm 关渲染与上游相同的 `Icon + Latest`；`{0} new` 的词条加在 `i18n/zh-CN.fork.json`（上游文件不碰）。
- `calm-check` 的 `chatrun` 已加 `anchor` 测量（`offsetPx`、`hint`、`newRows`，字段只增不改）；`plan`/`tasks` 等其它场景的 JSON 不变。按计划在里程碑最终步骤统一跑，calm-on/full 的 `offsetPx` 应为 0。若不为 0，先试 §2.2 的一行虚拟列表补偿（upstream-ok，PR 候选）。
- 现有 `chat-*.spec.ts` 的 e2e 同样在最终步骤统一跑。

## 3. 挂钩三：同一时间只有一条 toast（BLG-167）

### 3.1 上游现状

- 全局 toast：`App.tsx:51-71`，内容在 store（`st.toast`），`TOAST_MS = 3500`（`:49`）自清（`:56` dispatch `toast_clear`）。本身只有一条。
- 撤销 toast：`lib/undo-toast.tsx:16-27` 模块级 `current`，`:31-73` 渲染，6s 自清（`:41`），⌘Z 撤销（`:42-48`）。
- 两套独立；要解决的是**同时在场**。

### 3.2 fork 接口：`fork/calm/one-toast.ts`

```ts
export function useOneToast(kind: 'global' | 'undo', id: number | undefined): boolean;
```

规则：

- calm 关 → 恒 `true`（两套各走各的，逐字回到上游）。
- calm 开 → **后到的赢**：注册为「最新」时，先前的那条被判为 superseded，隐藏（不清除，各自的定时器照旧收尾，**永不复活**）。
- 自己消失时若自己是最新，清位；此后没有可见 toast，直到下一条注册。
- 实现：模块级 `latest: { kind, id } | undefined` + `seq`；`register`/`unregister` 通知 `useSyncExternalStore` 的订阅者。
- **注册用 `useLayoutEffect`**（设计稿写的是 effect）：两套 toast 的 effect 都在绘制后跑，会让两套 DOM 同时存在一帧。layout effect 在绘制前注册，React 在同一个提交里重渲染，屏幕上一次都没有两条。（对设计稿的修正，接口不变。）

### 3.3 上游改动

`App.tsx`（3 行）：

```tsx
import { useOneToast } from './fork/calm/one-toast.js';   // 文件头
// Toasts 内：
const show = useOneToast('global', toast?.id);
if (!toast || !show) return null;                         // :59
<div className={s.toasts} role="status" aria-live="polite" data-one-toast="global">  // :62
```

`lib/undo-toast.tsx`（4 行）：

```tsx
import { useOneToast } from '../fork/calm/one-toast.js';
// UndoToast 内，在任何 return 之前：
const show = useOneToast('undo', toast?.id);
if (!toast || !show) return null;                         // :54
<div className={s.wrap} role="status" aria-live="polite" data-one-toast="undo">  // :56
```

并在 ⌘Z 的 effect（`:39-53`）开头加 `if (!show) return;`——**被隐藏的撤销不响应 ⌘Z**（它已不可见，响应会让用户不知道发生了什么）。

### 3.4 样式：`fork/calm/one-toast.css`

- `:root[data-calm] [data-one-toast]`：两套钉到同一位置（取全局 toast 现位：水平居中、`bottom: 96px`，见 `layout/Shell.module.css:40-47`）、同一安静外观（同一底色/圆角/字号，Undo 是其中的一个文字按钮）。
- `[data-new]` 的计数样式也放这里（§2.3）。
- 只在 `:root[data-calm]` 下生效；不与 `ov-surfaces` 共文件。在 `fork/calm/calm.css` 里最后一个 `@import`。
- 入场动画不在这里：归 M1 的 `calm-overlays.css` 浮层规则（§0.1）。

### 3.5 测试

- e2e `e2e/fork-calm-toast.spec.ts`（默认 calm 开）：
  1. 触发一条全局 toast：打开 `add-auth`，点 `WorktreeInfo.tsx:250` 的路径按钮（→ `Copied the path`，一次点击，不用对话框）；备选是 `app.spec.ts:212` 的 Settings 改值 → `Saved`（3.5s 窗口更紧）。
  2. 3.5s 内右键项目 → `Hide Project`（`native-sheets.spec.ts:147` 的撤销路径，→ `Hidden landing`）。
  3. `expect.poll`：`page.getByRole('status')` 里可见的只有 1 个；它带 `[data-one-toast="undo"]`，文字是 `Hidden landing`。
  4. calm-off 变体（`addInitScript` 写 calm:false）：同一流程，两条 `[role=status]` 都在（`toHaveCount(2)`），位置是各自原来的。
- 现有撤销 e2e（`native-sheets.spec.ts` 的 Hide Project）默认在 calm 开下跑，没有第二条 toast 时撤销照常可见、`Undo` 按钮照常可用——必须原样通过。
- 时序一律 `expect.poll`（3.5s/6s 两个窗口）。

### 3.6 失效检测、已知取舍、登记行

- canary：`App.tsx` ↔ `useOneToast('global', toast?.id)`；`undo-toast.tsx` ↔ `useOneToast('undo', toast?.id)`。
- 已知取舍：被压制的撤销既不可见也不响应 ⌘Z（设计稿明确「永不复活」）。用户若在这几秒内想撤销，要等下一次操作——M3 验收时人查是否可接受；可复议的改法是「撤销并入后到的 toast 作为动作」，但要改两套的渲染，接入面变大。
- 登记行：`App.tsx`、`lib/undo-toast.tsx`——两套提示的**可见性仲裁**必须发生在渲染两套的地方；`one-toast.ts`/`.css` 放不下 toast 的定时器与 ⌘Z。

### 3.7 证据（BLG-167）

- `fork/calm/one-toast.ts`：模块级「最新一条」仲裁；注册用 `useLayoutEffect`（绘制前），被压制的返回 null（DOM 里不存在，所以 `[role=status]` 也只有一条）；最新的一条注销后不揭示旧的（永不复活）。`fork/calm/one-toast.css` 已进 `calm.css` 的 `@import` 链末位。
- `e2e/fork-calm-toast.spec.ts`：calm 开——Settings › Environment 存一条变量出全局 toast，随后 Hide Project 出撤销 toast，`[data-one-toast]` 只有 1 个且是撤销；隐藏的撤销对 ⌘Z 无反应。calm-off 变体——两条同时可见，撤销的 Undo 照常可用。按计划在里程碑最终步骤统一跑。
- 现有撤销 e2e（`native-sheets.spec.ts` 的 Hide Project）默认在 calm 开下跑，没有第二条 toast 时行为未变；同样在最终步骤跑。

## 4. 挂钩四：只放行一种循环（BLG-168）

### 4.1 上游现状（消费方已全查）

`lib/live-motion.ts` 的时钟被这些地方用：`chat/steps/StepRow.tsx:47-58`（Shimmer，唯一放行）、`components/DotMatrix.tsx`、`components/ui.tsx`（Working 三点）、`plans/PlanCanvas.tsx`、`plans/marks.tsx`、`dialogs/AddProjectSheet.tsx`、`layout/panel/ScratchSkeleton.tsx`。

**没有一个在 keep-decor 清单里**：`onboarding/**`、`call/call.module.css` 的响铃、`PixelBurst` 都不 import live-motion（已 grep 核实），所以它们不受这个门影响，自动维持原状。

### 4.2 fork 接口：`fork/calm/live-gate.ts`

```ts
export function calmLive(el: Element): boolean;   // !calmOn() || !!el.closest('[data-current]')
```

### 4.3 上游改动（`lib/live-motion.ts`，同一文件 5 处，各 1 行）

1. `import { calmLive } from '../fork/calm/live-gate.js';`
2. `tick()`：只给 `calmLive(el)` 的标记调 paint；**其余连 `paint(null)` 都不调**（否则 15fps 的 style 写入会被 calm-check 的 `jsMotion` 数成「仍在动」）。
3. `wake()`：`const live = [...seen].filter(calmLive); const run = live.length > 0 && windowActive() && !reducedMotion();`；静止帧涂刷保持 `if (reducedMotion() || !run) for (el of seen) marks.get(el)?.(null);`（只在 wake 时机各画一次）。
4. `watch()`：attributeFilter 改成 `['data-motion', 'data-calm']`，回调改为「先给非白名单标记涂静止帧，再 wake」——开关切换时，原来停在半途的标记会回到静止帧，而不是冻结在最后一帧（对设计稿的补充：设计稿只要求加 `data-calm` 到 filter，但那样切到沉稳后，已可见的 DotMatrix 会停在某一帧）。
5. `joinLive()`：初始帧 `paint(reducedMotion() || !calmLive(el) ? null : performance.now());`

calm 关时 `calmLive` 恒真，五处全部退化为上游原行为。

### 4.4 白名单的边界

`[data-current]` 还出现在 `chat/steps/AgentSteps.tsx:343`（等待行）与 `layout/ProjectTree.tsx:224`（当前项目行）。若它们里面也有走时钟的标记，会被一起放行。它们是**同一种指示**（当前正在发生的事），符合「一种循环」；calm-check 的验收词是「JS 动效只来自白名单里的指示」，不是「只允许 1 个元素」。

### 4.5 与 M1 的核对（BLG-168 落地时做）

- **核对结果（2026-11-11，本分支）**：`fork/calm/calm-motion.css` 仍是 M0 的空骨架（只有 `:root[data-calm] {}`），白名单里**没有** CSS 关键帧循环 → 眼下只有 JS 这一种循环，无需删。M1 合并后若在 `:root[data-calm] [data-current]` 里填了 CSS 循环，就删掉 CSS 的那一个（JS 的 Shimmer 是唯一放行位），并把结论补记在此。
- calm-check：`plan`、`tasks`、`dock` 的 `jsMotion` 元素数应降到 0 或只剩 `[data-current]`；`chatrun` 只剩 `[data-current]` 的 Shimmer；`onboarding`、`call` 与 calm-off 对比一致。

### 4.6 失效检测、证据与登记行

- canary：`live-motion.ts` ↔ `calmLive(`。
- 登记行：`packages/mac/src/lib/live-motion.ts`——时钟的分发在模块内部（`tick`/`wake`/`joinLive`），外部拿不到 `seen`/`marks`，无法在 fork 文件里过滤；每处 1 行。
- 证据（BLG-168）：单测 `tests/fork-calm-live-gate.test.ts`（沉稳开只放行 `[data-current]`、关则全放行、跟随设置开关）；calm-check 的 plan/tasks/dock/chatrun 的 `jsMotion` 与 onboarding/call 的对比按计划在里程碑最终步骤统一跑。

## 5. 接入点失效检测（`tests/fork-calm.test.ts` 的 `touchpoints` 段）

- 结构：`TOUCHPOINTS: { file, match, why }[]`，`file` 从仓库根起算（`packages/mac/src/...`），`match` 是一条正则。测试逐条读文件，**匹配不上就失败**——这是 fork 集成断裂，不是上游样式问题，不受「上游报告只是报告」的豁免。
- 每个实施任务（165/166/167/168）在自己那次提交里追加自己的行；BLG-169 清点合并。
- 现有行（BLG-164 先放骨架）：

| 文件 | canary | 含义 |
| --- | --- | --- |
| `packages/mac/src/main.tsx` | `import './fork/calm/index.js'` | 覆盖层入口（M0） |
| `packages/mac/src/dialogs/Settings.tsx` | `<CalmRow />` | 沉稳开关（M0） |
| `tests/mac-settings-search.test.ts` | `read('fork/calm/settings.tsx')` | 设置搜索读 fork 的行（M0） |
| `packages/mac/src/layout/Sidebar.tsx` | `useSidebarHold(drop.ref)` | BLG-165 |
| `packages/mac/src/layout/EntryRow.tsx` | `useHeldEntries(` | BLG-165 |
| `packages/mac/src/chat/ChatLog.tsx` | `<JumpLabel rows={rows.length} />` | BLG-166 |
| `packages/mac/src/App.tsx` | `useOneToast('global', toast?.id)` | BLG-167 |
| `packages/mac/src/lib/undo-toast.tsx` | `useOneToast('undo', toast?.id)` | BLG-167 |
| `packages/mac/src/lib/live-motion.ts` | `calmLive(` | BLG-168 |

- 上游重构后怎么办：测试红 → 按 `why` 找到本页对应节 → 在新位置重接同样的 1–3 行 → 更新 canary 与本页行号 → 重跑单测。**不要**为了让测试变绿而删 canary。
- 行为层兜底：`calm-check` 的 calm-on 组合会复现本应被压住的动效/位移；四个 e2e 的 calm-off 变体证明关掉后确实是上游行为。

## 6. 上游改动清单（BLG-165–168 开始登记 `docs/fork.md`）

| 文件 | 位置 | 改动 | 为什么不能放进 fork 文件 |
| --- | --- | --- | --- |
| `packages/mac/src/layout/Sidebar.tsx` | import 区、`:96` 后 | 一行 `useSidebarHold(drop.ref)` | 「指针/焦点是否在侧栏上」只有 nav 本身知道；`useFolderDrop` 已经拿着这个 ref |
| `packages/mac/src/layout/EntryRow.tsx` | `useEntryList` 的 `useApp` 后、`return` | `useHeldEntries` 包一层 | 排序结果在这里被两种侧栏模式共同消费，别处拦不住 |
| `packages/mac/src/chat/ChatLog.tsx` | `:336-337`（按钮 children） | `<JumpLabel rows={rows.length} />` | 行数只有 `ChatLog` 知道；按钮节点必须留在原处 |
| `packages/mac/src/chat/ChatLog.tsx`（仅在实测有位移时） | `useVirtualizer` 选项 | `shouldAdjustScrollPositionOnItemSizeChange: () => !stick.current` | 虚拟列表的补偿只能配在它的选项上（upstream-ok，PR 候选） |
| `packages/mac/src/App.tsx` | `Toasts` | `useOneToast('global', toast?.id)`、`!show` 时返回 null、`data-one-toast` | 全局 toast 的渲染与 store 定时器都在这里 |
| `packages/mac/src/lib/undo-toast.tsx` | `UndoToast`、⌘Z effect | `useOneToast('undo', toast?.id)`、`!show` 时返回 null、`data-one-toast`、隐藏时不响应 ⌘Z | 撤销 toast 是模块级状态，两套必须在一个判据下 |
| `packages/mac/src/lib/live-motion.ts` | `tick`/`wake`/`watch`/`joinLive` | `calmLive` 门（5 行） | 时钟的 `seen`/`marks` 是模块私有的，外部无法过滤 |

M0 已登记的 3 处（`main.tsx`、`Settings.tsx`、`tests/mac-settings-search.test.ts`）不变。

## 7. 适合直接提 PR 给上游的

只有两个候选，且都是「对所有人有用、与沉稳无关」的修法：

1. **滚动锚定**：若 calm-check 实测到上方行重测量会挪位，`shouldAdjustScrollPositionOnItemSizeChange: () => !stick.current` 一行修 `ChatLog.tsx`，提上游。
2. **toast 合流**：两套独立提示（`App.tsx` 的 Toasts 与 `lib/undo-toast.tsx`）本身是上游的重复；如果上游愿意把撤销做成全局 toast 的一个动作，这个 fork 差异就可以撤掉。我们这里只做仲裁、不主动搬上游代码。

不提：冻结侧栏顺序（hold-order）与只放行一种循环（live-gate）是沉稳模式的行为，上游没有这个模式。

## 8. 验收对照（本里程碑的判定标准 → 证据）

| 判定标准 | 证据 |
| --- | --- |
| 指针停在侧栏上时会话变「需要你」，顺序不变；离开 600ms 后才重排 | `e2e/fork-calm-sidebar.spec.ts`（calm 开 + calm-off 变体） |
| 不在底部时来 20 条新消息，第一条可见消息偏移 0px，并出现「有新内容」提示 | `calm-check` chatrun 的 `anchor.offsetPx === 0`、`anchor.hint`/`anchor.newRows`；`chat-*.spec.ts` 全过 |
| 同时触发全局 toast 和撤销 toast，屏幕上只有一条 | `e2e/fork-calm-toast.spec.ts`（calm 开 + calm-off 变体）；现有撤销 e2e 原样通过 |
| 多任务并行时 calm-check 的 JS 动效 + CSS 循环只有一种 | `calm-check` plan/tasks/dock/chatrun 的 `jsMotion` 只剩 `[data-current]`；`animations` 里没有额外 CSS 循环；onboarding/call 与 calm-off 一致 |
| 每个改动的上游文件登记 `docs/fork.md` 并写原因；关掉 data-calm 与上游一致 | §6 的表 → `docs/fork.md`；§5 的 canary；四个 e2e 的 calm-off 变体与 calm-check 的 calm-off 组合 |

## 9. 风险与已知弱点

1. **M1/M2 白名单双重循环**：靠 §0.1 的契约与 BLG-168 落地时的核对（§4.5）；两边都在白名单里加循环就会出现两种。
2. **冻结期间行内容整体不更新**（「需要你」标记晚到释放后）：有意为之（整组冻结），M3 可复议；若改成「只冻结顺序」，`useHeldEntries` 的返回值要按冻结的 id 顺序重排 fresh，接口不变。
3. **虚拟化行重测量挪位**：calm-check 的 anchor 步实测兜底；修在 `ChatLog.tsx` 属 upstream-ok，已列 PR 候选。
4. **e2e 时序**（600ms 宽限、3.5s toast 窗口）：一律 `expect.poll`；toast 用例若在负载下偶发，优先换更快触发全局 toast 的路径，不加长 `TOAST_MS`。
5. **chatrun 新增字段**：只增不改，`baseline.md` 的旧字段对比照旧。
6. **菜单启发式**（§1.5）与**被压制的撤销不可达**（§3.6）：都是行为上的已知上限，M3 验收时人工确认。
