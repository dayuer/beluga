# Synon Studio 手机交互规范（M5）

> 适用范围：`packages/studio-app` 的 P1 Web 客户端（手机优先，390×844 为基准），以及 M6 接上的计划页、对话、决策与验收。本文是设计与实施的契约：屏幕可以改版式，但第 12 节的 `UX-*` 可检查项不能悄悄失效；要改先改这里。
>
> 来源：`docs/superpowers/specs/2026-11-10-beluga-studio-design.md` §6（客户端、手机交互规则 `mobile-first`）、决策 `look-follows-theme` / `plan-input-core`、`packages/companion/lib/theme.ts`（token 的唯一来源）、`docs/studio-hub.md` §3.4 / §6.2 / §7（登录、客户路由、队列与回执）、`docs/studio-protocol.md`（动作与回执码）。原型：`docs/studio-mobile-ux.html`（390 宽，可点一遍）。

## 0. 基准与原则

- **尺寸基准**：390×844（iPhone 14/15 的逻辑尺寸）。375×667 与 320×568 作为窄屏下限；1440×900 作为桌面。单位一律写 `pt`，Web 上 1pt = 1 CSS px。
- **一句话**：客户是站在电梯里、单手拿着手机，用 30 秒讲清一件事。所有规则都从这句话推出来。
- **三条硬原则**：
  1. **输入优先**。输入框是屏幕的主角，不是附属品；任何状态下都不许让它被键盘、按钮或安全区挡住。
  2. **拇指优先**。主操作、主输入、列表行在下半屏；屏幕上半部只放说明和返回，不放需要频繁点按的东西。
  3. **不丢字**。草稿、发送失败的文字、断网时的文字，永远留在本机，直到中台确认收下（`queued` 或 `done`）。
- **外观**：跟 `packages/companion/lib/theme.ts` 的 token 走（中性灰、实色标题栏、每屏一个主按钮、颜色只用于含义）。不新增颜色，不新增字号。

### 0.1 两种「离线」必须分开

| 情况 | 判定 | 客户看到的 |
|---|---|---|
| 客户自己断网 / 请求失败 | `navigator.onLine === false`，或 fetch 抛错 | 顶部 `SyncBanner`：**你已离线 · 上次同步 x 分钟前** |
| 工作室的 daemon 不在线 | 中台 `plans` 响应里 `studio.online === false`（M5 新增字段） | 项目卡片 / 项目首页一行：**工作室离线 · 上次同步 x 分钟前** |

两者可以同时出现，各说各的，不许合并成一句「离线中」。时间都取缓存里的毫秒时间戳（`fetchedAt` / `lastSyncAt`），每 30 秒重算一次；设备时钟比中台快导致负数时显示「刚刚」。

## 1. 导航结构

### 1.1 M5：顶部导航，没有底部 tab

```
/login  登录
  └─ /                         项目列表（根）
       └─ /project/:id         项目首页（计划列表）
            └─ /new?project=:id 新需求
```

- **为什么没有底部 tab**：M5 只有「项目」一个根。一个 tab 的底栏白占 64pt 拇指空间，还会和「每屏一个主按钮」抢位置。M6 出现第二个根（待办）时再加底部栏，规则见 §1.4。
- **标题栏（Header）**：左边返回（44×44，图标 `color.text2`，`accessibilityLabel`「返回」），中间标题（`type.heading`，单行省略），右边可选一个 44×44 的刷新按钮（见 §8.2）。根屏没有返回，标题「项目」。
- **返回**：优先用浏览器返回（`router.back()` 落到历史里的上一屏）；没有历史时返回 `/`。从登录带 `next` 进来的，登录后回到 `next`，再按返回回到 `/`，不回到登录。
- **主按钮只出现在 ActionDock**（§2），不在标题栏里。
- **新需求是独立路由**（不是弹层）：URL 可分享、可刷新、浏览器返回天然可用，草稿按项目存。

### 1.2 登录守卫

- `_layout` 读会话（`lib/session.ts`）；没有有效会话时，除 `/login` 外的任何路径都 `Redirect` 到 `/login?next=<当前 path + query>`。
- 任何请求拿到 `signed-out`（401）也清会话并走同一条跳转，并把当前路径放进 `next`。
- 有会话访问 `/login` → `/`。

### 1.3 M6 的计划页与抽屉

- `/project/:id` 的每一行计划 M5 不画箭头、不可点；M6 接上 `/project/:id/plan/:ref`。
- 计划页上：**对话是底部抽屉**，不是独立屏幕。抽屉默认占 55% 高，最大 80%；打开时 ActionDock 的主按钮收起，抽屉的输入框占据拇指区，两者不争位。
- 决策与「还不行…」也走底部抽屉（单题一屏，见 §10.3 / §10.4）。
- 待办在 M6 作为第二个根出现，底部栏为两个 tab（项目 / 待办），高 56 + 底部安全区；主按钮仍然只在 ActionDock，不放进 tab bar。

### 1.4 桌面（≥900 宽）

- 导航结构不变（顶部栏 + 返回）。内容列最大宽 **720** 并水平居中；项目卡片**两列**；计划列表仍单列。
- ActionDock 的内容随内容列（最宽 720）居中，主按钮宽度不超过内容列；页面背景通栏，不把按钮拉成整屏宽。
- 桌面上的次要刷新入口放标题栏（44×44 图标按钮）；下拉刷新只在触屏出现（§8）。

## 2. 拇指区与布局

### 2.1 390×844 的分区

```
y=0     ┌──────────────────────────────┐
        │ 标题栏 44 + 顶部安全区(47)     │  ← 只放返回、标题、刷新
y=91    ├──────────────────────────────┤
        │ 说明 / 项目名 / 当前状态       │  ← 只读信息，不频繁点
y=422   ├──────────────────────────────┤  ← 下半屏（拇指区）开始
        │ 主输入框（新需求/对话）        │
        │ 平台选择 / 选项                │
        │ 回执行 ReceiptLine             │
        │ ┌──────────────────────────┐ │
        │ │ 主按钮  52                │ │
        │ └──────────────────────────┘ │
y=844   └──────────────────────────────┘  ← 底部安全区(34) 在按钮下面
```

- **定量规则**（对应 `UX-03`）：390×844、静止（无键盘、空输入）时，主按钮的 `top ≥ 422`，主输入框的 `top ≥ 422`，两者都完整在视口内。
- **拇指区放什么**：主输入框、平台/选项、主按钮、ReceiptLine、列表行（整行可点，M6）、抽屉把手。
- **上半屏放什么**：标题、项目名、状态行、说明文字、返回。返回是唯一允许的、需要点按的顶部元素；它也有浏览器手势作为退路。
- **破坏性操作**（退出登录、放弃草稿、丢弃改动）：不进 ActionDock，放标题栏右侧「•••」二级菜单，并二次确认；M6 才有。

### 2.2 ActionDock

- 固定在视口底部：`position: fixed; left: 0; right: 0; bottom: <keyboardInset>`。
- 内边距：左右 `max(16, env(safe-area-inset-left/right))`，上 12，下 `env(safe-area-inset-bottom) + 16`。
- 背景 `color.bg`，顶部 1px `color.hairline`；不使用半透明毛玻璃（低端机与暗色下都发灰）。
- 主按钮：高 52（≥48），圆角 `radius.m`（12），`color.primary` 底、`color.onPrimary` 字，`type.heading`，占满内容列宽。
- 内容区底部留白 = dock 实际高度 + 16，保证滚动到底时最后一项不被挡住（`UX-17`）。
- 抽屉打开时（M6）：ActionDock 整体隐藏（不占位、不半透明），抽屉自己的输入条贴键盘。

### 2.3 单手路径

- 从任意屏到达「输入并发送」：最多 2 次点按（进项目 → 新需求 → 输入），且两次都落在下半屏或整行。
- 返回在左上，但绝不作为主要流程的一部分；主要流程永远有底部前进按钮。
- 刷新：下拉（触屏）或标题栏图标（桌面），都不需要跨屏。

## 3. 标题栏与安全区

- **实色**：背景 `color.bar`（浅色 `#FFFFFF`），任何时候都不透明、不渐变、不模糊；底部 1px `color.hairline`（滚动前后都在，简单一致）。
- **高度**：内容 44 + `env(safe-area-inset-top)`；左右内边距 `max(16, env(safe-area-inset-*))`。
- **标题**：`type.heading`（16/600），单行，超出省略；最大宽度 = 屏宽 − 2×44 − 2×16。
- **视口**：`app/+html.tsx` 输出
  `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content" />`
  不写 `user-scalable=no`（无障碍），不写固定 `height`。
- **安全区**：只用 CSS `env(safe-area-inset-*)`：标题栏 `padding-top`，ActionDock `padding-bottom`，横屏左右 `padding-left/right`。39×844 的模拟（`safe-top: 47px; safe-bottom: 34px`）下标题文字 top ≥ 47，主按钮 bottom ≤ 810（`UX-07`）。
- **状态栏颜色**：`app.json` 的 `userInterfaceStyle: "light"`；Web 用浅色主题的 `theme-color` = `color.bar`，不随滚动变色。

## 4. 输入框行为（通用）

### 4.1 所有输入框

- 字号 **16px 起**（iOS 聚焦不放大）；行高 1.4；光标颜色 `color.info`。
- 颜色：背景 `color.card`，1px `color.hairline`，聚焦时 1px `color.info`（不靠阴影）；文字 `color.text`，占位 `color.text3`。
- 圆角 `radius.m`（12）；内边距 12×14。
- 聚焦后执行 `scrollIntoView({ block: 'nearest' })`，300ms 内输入框完全进入可视区（`UX-06`）。**进入屏幕时不自动聚焦**——键盘不请自来是最常见的手机冒犯。
- 输入法组合（IME）期间不触发任何提交；计数器在 `compositionend` 后更新。
- Enter：手机回车换行；桌面 `Cmd/Ctrl+Enter` 提交（按钮永远存在，快捷键只是加速）。所有场景都不在回车时直接发送。
- 粘贴超长：截断到上限，并在输入框下方显示一行「已截到 4000 字」/“Trimmed to 4,000 characters”。

### 4.2 各场景的高度与上限

| 场景 | 控件 | 初始高度 | 最大高度 | 上限 | 计数 |
|---|---|---|---|---|---|
| 新需求 | 多行 goal | 120 | 可视高度的 40%（844 下约 337），超出后内部滚动 | `LIMITS.text` = 4000 | ≥3600 显示「还剩 N 字」 |
| 对话 | 多行输入条 | 44（一行） | 5 行（约 110），超出后内部滚动 | 4000 | ≥3600 显示剩余 |
| 回答决策（自由文字） | 1–3 行 | 44 | 3 行 | `LIMITS.answer` = 2000 | ≥1800 显示剩余 |
| 验收原因 | 多行 | 96 | 204（约 8 行） | 4000 | ≥3600 显示剩余 |

### 4.3 语音输入

- **P1 不做自己的麦克风按钮**：直接使用系统键盘的听写（iOS / Android 键盘自带的麦克风）。理由：系统听写不增加权限申请、不采音频、不挑语言；自建语音在 P1 是净负担。
- 文档与界面不出现「语音输入」按钮；设置页（P2）只在帮助文案里提一句「可以用键盘上的听写」。
- P2 若要原生语音，才加按住说话的按钮，并按 `voice` 的隐私规则处理。

### 4.4 焦点与可访问性

- 每个输入框有可见 `label`（不是只靠 placeholder）；`accessibilityLabel` 与 label 一致。
- 错误提示在输入框下方，`color.error`，不弹窗；`accessibilityLiveRegion="polite"`。
- 键盘导航（桌面）：Tab 顺序 = 标题栏返回 → 输入 → 选项 → 主按钮；焦点环 2px `color.info`，偏移 2。

## 5. 键盘弹起时的布局

### 5.1 计算方式

`lib/viewport.ts` 的 `useKeyboardInset()`：

```
inset = max(0, window.innerHeight - visualViewport.height - visualViewport.offsetTop)
```

- 监听 `visualViewport` 的 `resize` 与 `scroll`，以及 `window` 的 `resize`；`inset` 四舍五入到整数。
- ActionDock 的 `bottom = inset`；内容区 `padding-bottom += inset`。抽屉（M6）同理：抽屉底边 `bottom = inset`，抽屉高度按可视高度重算。
- 键盘弹起时 `safe-area-inset-bottom` 已经被键盘盖住，ActionDock 的 `padding-bottom` 降到 16，不再叠加安全区，避免双重留白。
- 键盘收起时 `inset === 0`，一切回到原位；不做过渡动画（避免「内容跳一下」）。
- `interactive-widget=resizes-content` 只在 Android Chrome 生效；iOS Safari 会忽略，靠 `visualViewport` 兜底。这是两个都要实现的原因。

### 5.2 弹起时的规则

- 输入框不被遮挡：聚焦后 300ms 内输入框与光标行完整可见（`UX-06`）。
- 主按钮随 docking 上移，仍在输入框下方 12pt 处；两者不重叠、不互相覆盖。
- 标题栏不缩、不隐藏；页面不横向滚动；滚动容器不被 `overflow: hidden` 锁死。
- 输入框上方只保留一行必要的上下文（项目名 / 在回复第几条消息），不保留大卡片。
- 键盘收起后，页面滚动位置夹回合法范围，底部不留空白。

### 5.3 如何验证

- Playwright 把视口降到 **390×500** 作为键盘的代理（844 − 344）；断言输入框和主按钮的 boundingBox 都在视口内且不相交，ActionDock 的底边等于 344（`UX-04`、`UX-05`）。
- 真机/模拟器（M5 审计与 M6 前）在 iOS Safari 与 Android Chrome 各看一次：聚焦、切换输入法、收起键盘、旋转。

## 6. 草稿、发送与重试

### 6.1 草稿

- 存储：`lib/kv.ts`（localStorage，前缀 `synon:`）。
- 键与形状：

| 键 | 值 | 何时删 |
|---|---|---|
| `synon:draft:new:<pid>` | `{ goal, platforms, updatedAt }` | 该新需求回执 `queued` 或 `done` |
| `synon:draft:chat:<pid>:<planRef>` | `{ text, updatedAt }` | 该消息回执 `queued` 或 `done` |
| `synon:draft:decision:<pid>:<planRef>:<decisionId>` | `{ picks, text, updatedAt }` | 提交倒计时结束且回执 `queued`/`done`，或撤销 |
| `synon:draft:sendback:<pid>:<planRef>:<milestoneRef>` | `{ reason, updatedAt }` | 回执 `queued`/`done` |

- 写入：输入后 **300ms 防抖**；额外在 `blur`、`visibilitychange`（hidden）、`pagehide` 时立即写。
- 恢复：进入屏幕时读草稿，恢复文字、平台/选项；顶部一行 `type.caption`「已恢复草稿 · x 分钟前」/“Draft restored · x min ago”（3 秒后淡出，不抢焦点）。
- **不自动聚焦**：恢复草稿不弹键盘（`UX-10`）。
- 删除只在回执 `queued`/`done` 之后；`failed`、`refused`、`expired` 都保留（`UX-11`）。

### 6.2 提交状态机（`lib/submit.ts`，M5 与 M6 共用）

```
idle ──点按──▶ sending ──200 queued──▶ queued ──receipt done──▶ done
                 │                        │
                 ├─ 200 refused(code) ──▶ refused(code)
                 ├─ 200 expired ────────▶ expired
                 └─ 网络错误/超时/5xx ──▶ failed(offline|http)
failed ──重试/自动重试──▶ sending（同一 opId）
refused / expired ──用户修改/重新发送──▶ sending（新 opId）
```

- **opId**：进入 `sending` 的那一刻用 `crypto.randomUUID()` 生成，写入 `synon:pending:<kind>:<pid>[:refs]`，与草稿分开存。**重试、刷新页面、连点、断线重连后的状态查询都用同一个 opId**；中台 §7.1 第 4 步按 opKey 幂等，只会产生一条动作（`UX-13`）。
- **`failed` 与新 opId 的边界**：只有「请求没被中台收下」的失败（网络、超时、5xx、离线）复用 opId；一旦拿到 `refused` 或 `expired`，这条 opId 在中台已是终态，再次发送必须换新 opId，否则只会拿回旧回执。
- **发送中**：主按钮禁用（`disabled` + `aria-disabled="true"`），文案「发送中…」，旁边 16pt 的线形 spinner；再点不产生请求（`UX-14`）。
- **自动重试一次**：`failed` 后，`online` 事件或页面重新可见（`visibilitychange` → visible）时自动重试一次；仍失败则等用户点「重试」。
- **queued 之后**：工作室在线时等 WS 推来的 `receipt`；不在线时显示「已排队，工作室上线后处理」并保持按钮禁用。重连或页面回到前台时，可以**重发同一帧查询当前状态**（中台不计频率），据此更新回执。
- **done**：显示「已处理」，1 秒后新需求回到项目首页（`router.replace`，返回键不再回到已经提交的表单）。聊天/决策/验收由各自场景决定是否自动前进（§10）。
- **回执去重**：HTTP 回执与 WS 回执可能先后到达；按 `opId` 合并，状态只前进不后退（`done` > `refused` > `queued`；`failed` 只在没有收到任何中台回执时出现）。

### 6.3 回执文案（8 个拒绝码 + 3 个本地状态）

`lib/strings.ts` 为每个码准备中英各一句；界面只显示客户语言，不显示码、不显示服务端原文。

| 码 / 状态 | 中文 | English |
|---|---|---|
| `not-allowed` | 这一步现在不能做，刷新后再试。 | This step isn't available right now. Refresh and try again. |
| `bad-args` | 内容不完整或格式不对，检查后再试。 | Something in this request is incomplete. Check it and try again. |
| `stale` | 页面上的内容已经更新了，刷新后再试。 | This page is out of date. Refresh and try again. |
| `not-yours` | 你没有这个项目的权限。 | You don't have access to this project. |
| `already-done` | 这一步已经做过了。 | This was already done. |
| `rate-limited` | 操作太频繁了，过一会儿再试。 | Too many actions. Try again in a little while. |
| `not-open` | 这件事已经关闭了。 | This is no longer open. |
| `unknown-plan` | 这个计划不存在或已被删除。 | This plan doesn't exist or was removed. |
| `offline`（本地） | 没发出去：你现在没有网络。文字已保留。 | Not sent: you're offline. Your text is saved. |
| `http`（本地） | 服务暂时不可用。文字已保留，稍后重试。 | The service is temporarily unavailable. Your text is saved. |
| `expired` | 没来得及处理，请重新发送。 | It wasn't processed in time. Send it again. |

回执的视觉形状（`ReceiptLine`）：一行 16pt 图标 + `type.callout` 文字，位于主按钮上方 8pt；颜色：进行中 `color.text2`，成功的勾 `color.ok`、句子 `color.text`（绿字在 bg 上只有 4.24:1），问题 `color.error`，排队 `color.warn`。不弹 toast、不自动消失（用户滚动或离开屏幕才消失）。

### 6.4 乐观显示（对话专用，M6）

- 点发送立刻在列表末尾插入自己的气泡，右下角标「发送中…」；`queued` 后标「已排队」；WS 的 `plan` 帧里出现同 `opId` 的 `StudioTurn` 时，用服务端那条替换本地气泡（按 `opId` 去重，不出现两条）。
- 失败：气泡保留原文，右下角变「没发出去 · 重试」；重试按钮本身 ≥44，点它用同一 opId 重发。
- 输入框在点击发送的瞬间清空并把内容交给气泡；草稿 key 在回执 `queued`/`done` 后删除。失败时文字在气泡里，不再回填输入框（避免重复）。

## 7. 反馈、触觉与动效

- **按压反馈**：`Pressable` 的 pressed 态——主按钮 `opacity: 0.9` 且 `transform: scale(0.985)`；文字/次要按钮背景变 `color.press`。反馈在 pointerdown 的下一帧出现（≤100ms），不等请求。
- **每次操作立刻有反馈**：点按 → 按压态；提交 → 按钮「发送中…」+ ReceiptLine；收到回执 → 同位置更新。不使用会飘走、会遮挡输入的 toast。
- **触觉**：只在原生存取（`expo-haptics`）。`lib/haptics.ts` 暴露 `tap()` / `success()` / `warn()`；Web 上是空函数，**不调用 `navigator.vibrate`**（`UX-24`）。P1 只有 Web，所以实际上没有任何振动。
- **动效**：P1 不依赖动画表达状态；允许的只有 120ms 的 `ease-out` 淡入/颜色过渡，且 `prefers-reduced-motion: reduce` 时全部取消。没有弹跳、没有 overshoot、没有骨架屏 shimmer（用静态灰块）。
- **加载**：列表用 3 个卡片形状的静态骨架；主按钮提交时内联 spinner，不整屏遮罩。

## 8. 下拉刷新与重连

### 8.1 下拉刷新（触屏）

- 只在 `/`（项目）与 `/project/:id`（项目首页）启用，这两屏的数据可能被工作室后台改变。
- 条件：滚动容器在顶部（`scrollTop === 0`）、单指、键盘未弹起（`inset === 0`）、不在发送中。
- 手势：下拉超过 8pt 开始露头，超过 64pt 松手触发；指示器是 24pt 的细线 spinner + 「松手刷新」/「下拉刷新」文案，位于标题栏下方。
- 结果：成功则更新列表与 `fetchedAt`（离线文案的分钟数归零）；失败保留旧数据，在列表上方显示 3 秒「刷新失败 · 下拉再试」。
- 不引入第三方下拉库；用 `touchstart/move/end` 与 `translateY` 实现，避免和浏览器自身的 overscroll 打架（`overscroll-behavior-y: contain`）。

### 8.2 桌面刷新

- 标题栏右侧一个 44×44 的刷新图标按钮（`accessibilityLabel`「刷新」），所有宽度都渲染，但触屏上通常被下拉替代。点击后图标旋转 600ms，完成后停止。

### 8.3 重连提示

- 项目首页打开时连接 `watch(pid)`（`lib/hub.ts`）。连接状态 `closed` 时，标题栏下方出现一条 32pt 高的横幅：「连接中断，正在重连…」+ 16pt spinner，背景 `tint.warn`，文字 `color.warn`。
- 重连退避：1s、2s、4s、8s、15s、30s，之后每 30s 一次，直到成功或离开屏幕。
- 连上后：重新拉一次 `plans(pid)`，横幅变「已重新连接」2 秒后消失；期间不阻塞操作（发送仍走 HTTP）。
- 客户自己断网时不显示「正在重连」（没网重连没意义），只显示 `SyncBanner`「你已离线 · 上次同步 x 分钟前」；恢复网络后自动重连并刷新。
- 不做全屏「无网络」页；已有缓存内容继续可读。

## 9. 状态与离线

每个屏都要有这几种状态；文案见 §11。

| 屏 | 加载 | 空 | 出错 | 你离线 | 工作室离线 | 已排队 |
|---|---|---|---|---|---|---|
| 登录 | 按钮内联 spinner | — | 链接失效 / 发送失败 | 顶部横幅 | — | — |
| 项目 | 3 个卡片骨架 | 「还没有项目」+ 说明 | 整页错误 + 重试 | 顶部 `SyncBanner` | 卡片内一行 | — |
| 项目首页 | 3 行骨架 | 「还没有需求」+「新需求」 | 整页错误 + 重试 | 顶部 `SyncBanner` | 标题栏下一行 | 计划行状态 |
| 新需求 | — | — | 回执行（拒绝码） | 回执 `offline` | 回执「已排队，工作室上线后处理」 | 回执行 |

- **错误页**：一句发生了什么 + 一个「重试」按钮（≥44，主按钮样式或文字按钮）。不显示 HTTP 状态码、不显示 JSON、不显示英文内部错误。
- **schema 解析失败**：显示「页面需要更新，请刷新」，按钮刷新页面；不崩溃、不渲染原始 JSON（`lib/hub.ts` 的 `schema` 错误）。
- **空态**：一句说明 + 一个前进一步（项目首页的「新需求」就是主按钮；项目空态说明「你的工作室会把项目加到这里」）。
- **状态行**（M6 计划页）：始终说明在等谁——「在等你：确认计划」「在等工作室批准开工」「AI 在做：登录页（3 / 8）」。轮到 AI 或工作室时不显示主按钮，但状态行一定在。

## 10. 四个输入场景

### 10.1 场景 A：新需求（M5 实现）

| 步 | 发生什么 | 界面 | 规则 |
|---|---|---|---|
| 1 | 项目首页点底部主按钮「新需求」 | 进入 `/new?project=:<pid>`，标题「新需求」 | 按钮 52pt，在 ActionDock 内 |
| 2 | 屏幕出现 | 上半屏：项目名 + 一行引导「描述你想做的，越具体越好」；下半屏：目标输入框（120 起）、平台 2×2、回执行、主按钮 | 输入框与主按钮 top ≥422；不自动聚焦 |
| 3 | 点目标输入框 | 键盘弹起，dock 上移，输入框进入可视区 | `inset` 公式；scrollIntoView nearest |
| 4 | 输入 | 文字增长，输入框长高到 40% 视口后内部滚动；300ms 后草稿落盘 | 上限 4000；3600 起显示「还剩 N 字」 |
| 5 | 选平台 | 2×2 四块（iOS / Android / 小程序 / Web），每块高 52，选中用 `color.text` 边框 + `tint.ok` 勾 | 默认全不选；至少 1 个 |
| 6 | 主按钮可点性 | 目标非空且平台 ≥1 才可点；否则置灰但文字仍可读 | 每屏只有这一个主按钮 |
| 7 | 点「开始规划」 | 按钮变「发送中…」并禁用；回执行「发送中…」；opId 生成并写入 pending | 连点不产生第二条 |
| 8 | 中台回 `queued` | 回执行：「已排队，工作室上线后处理」（工作室离线）或「已提交，等工作室确认」（在线）；按钮「已提交」禁用 | 草稿此时删除；pending 与 opId 保留到 `done`，用于重连后查状态 |
| 9 | WS 回 `done` | 回执行「已处理，工作室开始规划了」；1 秒后 `replace` 到 `/project/:id` | 草稿、pending 删除 |
| 10 | 失败（断网/超时/5xx） | 回执行「没发出去…」；主按钮变「重试」；文字与平台保留 | 同一 opId；恢复网络/回到前台自动重试一次 |
| 11 | 离开再回来 / 刷新 | 草稿恢复，顶部「已恢复草稿 · x 分钟前」；不弹键盘 | 草稿只在 queued/done 后删 |
| 12 | 被拒绝（如 `rate-limited`） | 回执行按码给客户语言；按钮可再次发送（新 opId） | 文字保留 |

### 10.2 场景 B：对话（M6 实现，状态机与 §6 相同）

| 步 | 发生什么 | 界面 | 规则 |
|---|---|---|---|
| 1 | 计划页，底部 ActionDock 上方一个 ≥44 的「对话」按钮（带未读数点） | 抽屉把手可见 | 主按钮仍是当前阶段的动作 |
| 2 | 点开对话 | 底部抽屉升起，占 55% 高；主按钮收起；历史消息最新在底部；顶部一行「对话」与关闭 | 抽屉不是独立路由；关闭后主按钮回来 |
| 3 | 点输入条 | 键盘弹起；抽屉高度按可视区重算，输入条贴着键盘上沿 | 与 ActionDock 同一 `inset` |
| 4 | 输入 | 输入条从 1 行长到 5 行；300ms 后草稿落盘（按计划和会话存） | 上限 4000；≥3600 显示剩余 |
| 5 | 点发送 | 输入框清空；列表末尾立刻出现自己的气泡「发送中…」 | 乐观显示；`opId` 作为气泡 id |
| 6 | 中台 `queued` | 气泡标「已排队」；工作室离线时再显示一句「工作室暂时离线，上线后 AI 会回复」 | 不回滚气泡 |
| 7 | WS `plan` 帧带回同 `opId` 的 turn | 服务端消息替换本地气泡 | 不出现两条 |
| 8 | 失败 | 气泡保留原文，右下角「没发出去 · 重试」；点它同 opId 重发 | 输入框不回填 |
| 9 | AI 回复中 | 最后一条下面「AI 正在写…」（typing）；不遮挡输入条 | 不自动滚动打断用户输入 |
| 10 | 离开 | 关闭抽屉，草稿保留；主按钮恢复 | 草稿在 queued/done 后删 |

### 10.3 场景 C：回答决策（M6）

| 步 | 发生什么 | 界面 | 规则 |
|---|---|---|---|
| 1 | 计划页在等客户，且有待答决策 | 抽屉里一次一个决策；顶部「第 2 / 4 个」；问题文字 + 选项 | 不把多个决策堆在一屏 |
| 2 | 单选 | 整行可点（≥56 高），左侧单选圈；选中整行描边 | 点整行，不是点小圆圈 |
| 3 | 多选 | 整行可点，左侧方框；可多选 | `multi` 来自协议 |
| 4 | 自由文字 | 可选输入框（1–3 行，上限 2000） | 与选项可以同时有 |
| 5 | 点「提交回答」 | **不立刻发送**：按钮变「已提交 · 撤销（10s）」倒计时 10 秒 | 撤销前不发出动作 |
| 6 | 10 秒内点撤销 | 回到可选状态，不发送 | 选择保留 |
| 7 | 倒计时结束 | 发送 `decision.answer`（picks / text），opId 一次 | 若用户提前离开，视为确认并立刻发送（见下） |
| 8 | 回执 `queued` / `done` | 「已记下」/「已处理」；有下一个决策就切到「第 3 / 4 个」，否则回计划页 | 工作室离线：「已记下，工作室上线后生效」 |
| 9 | 失败 | 选择与文字保留；按钮「重试」；同 opId | 断网/超时 |
| 10 | 拒绝 `stale` / `not-open` | 按码给文案；刷新决策 | 文字保留到回执，不静默丢 |

> 离开页面时若倒计时还没结束：视为用户确认，立刻发送（避免「点了提交却没发」）；若发送失败，草稿保留，下次进入显示「上次没发出去 · 重试」。

### 10.4 场景 D：验收原因「还不行…」（M6）

| 步 | 发生什么 | 界面 | 规则 |
|---|---|---|---|
| 1 | 计划页在待验收 | 主按钮「通过」，次按钮「还不行…」（≥44） | 主按钮仍是「通过」 |
| 2 | 点「还不行…」 | 底部抽屉：标题「哪里还不行？」；三个快捷标签「和我说的不一样」「有错误」「缺东西」；原因输入框（96 起） | 标签点一下追加到输入框，可再编辑 |
| 3 | 输入 | 少于 10 个字时主按钮禁用，并显示「再多写一点（至少 10 个字）」；≥3600 显示剩余 | 上限 4000 |
| 4 | 点「退回给工作室」 | 按钮「发送中…」；回执行 | 每屏一个主按钮 |
| 5 | 回执 | `queued`：「已退回，工作室上线后处理」；`done`：「已退回给工作室」；回到计划页 | 工作室离线也允许排队 |
| 6 | 失败 | 文字保留；「重试」；同 opId | |
| 7 | 拒绝 `stale` | 「页面上的内容已经更新了，刷新后再试」；原因保留 | |

### 10.5 四个场景的共同点（也是审查口径）

- 都有：草稿、opId 幂等、发送中禁用、失败保留文字与重试、排队与已处理回执、客户语言的拒绝码。
- 都不：自动聚焦、回车直接发送、toast、hover 交互、右键菜单、自定义麦克风。
- 都是：主按钮在 ActionDock，输入框贴底部，键盘弹起时一起上移。

## 11. 文案（中文默认，English 同步）

产品名一律写 **Synon Studio**。客户可见处不出现 daemon、hub、opId、planRef、任务 KEY、文件路径、模型名。

### 11.1 登录 / 项目

| 位置 | 中文 | English |
|---|---|---|
| 登录标题 | 登录 Synon Studio | Sign in to Synon Studio |
| 登录说明 | 用邮箱接收登录链接。只有被邀请过的邮箱可以登录。 | We'll email you a sign-in link. Only invited emails can sign in. |
| 邮箱标签 | 邮箱 | Email |
| 主按钮 | 继续 | Continue |
| 发送后 | 如果这个邮箱被邀请过，链接已发出。 | If this email was invited, the link is on its way. |
| 链接失效 | 链接已失效，请重新发一封。 | This link has expired. Request a new one. |
| 项目标题 | 项目 | Projects |
| 空态 | 还没有项目。你的工作室会把项目加到这里。 | No projects yet. Your studio will add them here. |
| 卡片离线 | 工作室离线 · 上次同步 x 分钟前 | Studio offline · last synced x min ago |
| 你已离线 | 你已离线 · 上次同步 x 分钟前 | You're offline · last synced x min ago |
| 出错 | 加载失败。 | Couldn't load. |
| 重试 | 重试 | Retry |

### 11.2 项目首页 / 新需求

| 位置 | 中文 | English |
|---|---|---|
| 首页标题 | 项目名 | Project name |
| 没有计划 | 还没有需求。点下面的「新需求」开始。 | No requests yet. Tap New request below to start. |
| 计划在等客户 | 在等你 | Waiting on you |
| 计划在等工作室 | 在等工作室 | Waiting on the studio |
| 计划在等 AI | AI 在做 | The AI is working |
| 新需求标题 | 新需求 | New request |
| 目标标签 | 你想做什么？ | What do you want to build? |
| 目标占位 | 例如：做一个能记录每天喝水的 App，有提醒和统计。 | e.g. An app that tracks my daily water with reminders and stats. |
| 平台标签 | 在哪些平台？ | Which platforms? |
| 平台名 | iOS / Android / 小程序 / Web | iOS / Android / Mini program / Web |
| 剩余字数 | 还剩 N 字 | N characters left |
| 主按钮 | 开始规划 | Start planning |
| 发送中 | 发送中… | Sending… |
| 已提交 | 已提交 | Submitted |
| 已排队 | 已排队，工作室上线后处理 | Queued. The studio will pick it up when it's back online. |
| 已处理 | 已处理，工作室开始规划了 | Received. The studio has started planning. |
| 没发出去 | 没发出去：你现在没有网络。文字已保留。 | Not sent: you're offline. Your text is saved. |
| 重试 | 重试 | Retry |

### 11.3 对话 / 决策 / 验收（M6）

| 位置 | 中文 | English |
|---|---|---|
| 对话 | 对话 | Chat |
| 输入占位 | 说点什么… | Say something… |
| 发送失败 | 没发出去 · 重试 | Not sent · Retry |
| 已排队标记 | 已排队 | Queued |
| AI 输入中 | AI 正在写… | The AI is writing… |
| 工作室离线 | 工作室暂时离线，上线后 AI 会回复 | The studio is offline. The AI will reply when it's back. |
| 决策计数 | 第 2 / 4 个 | 2 of 4 |
| 提交回答 | 提交回答 | Submit answer |
| 可撤销 | 已提交 · 撤销（10s） | Submitted · Undo (10s) |
| 已记下 | 已记下 | Noted |
| 验收标题 | 这个里程碑可以吗？ | Is this milestone good? |
| 通过 | 通过 | Approve |
| 还不行 | 还不行… | Not yet… |
| 原因标题 | 哪里还不行？ | What's not right? |
| 快捷标签 | 和我说的不一样 / 有错误 / 缺东西 | Not what I asked / Something's broken / Something's missing |
| 原因占位 | 具体说说哪里不对，至少 10 个字。 | Tell us what's wrong — at least 10 characters. |
| 退回 | 退回给工作室 | Send back to the studio |
| 已退回 | 已退回给工作室 | Sent back to the studio |

### 11.4 时间

`lib/time.ts` 的 `ago(ms)`：`<60s` 刚刚 / just now；`<60min` x 分钟前 / x min ago；`<24h` x 小时前 / x h ago；其余 x 天前 / x d ago。负数按「刚刚」。

## 12. 可检查项（审计逐条核对）

> 每条都要能在浏览器或代码里量出来。M5 审计核对标 **M5** 的；标 **M6** 的留给计划页与对话。
> 默认夹具：`phone` 390×844（无键盘）；`desktop` 1440×900；键盘态用 390×500 视口代理；安全区用 CSS 变量 `--safe-top:47px; --safe-bottom:34px` 模拟。

| ID | 范围 | 规则 | 怎么量 |
|---|---|---|---|
| UX-01 | M5 | 所有可点元素命中区 ≥44×44pt | 遍历当前屏 `role=button` / `[data-testid]` 的可点元素，Playwright `boundingBox()` 宽高均 ≥44（图标按钮靠 padding 补足） |
| UX-02 | M5 | 每屏最多一个主按钮，且主按钮高 ≥48 | `[data-testid="primary"]` 数量 ≤1；其 `boundingBox().height ≥48`；同屏其它动作无 `color.primary` 实底 |
| UX-03 | M5 | 390×844 静止态，主按钮与主输入框的 top ≥422，且完整在视口内 | 新需求屏 `primary` 与 `goal-input` 的 `boundingBox().y ≥422`，`y+height ≤844` |
| UX-04 | M5 | 键盘态（390×500）输入框与主按钮都完整可见且不重叠 | 视口降到 390×500，`goal-input` 与 `primary` 的 box 均在 0..500 内，两者矩形不相交 |
| UX-05 | M5 | ActionDock 跟随键盘：bottom = visualViewport inset | 注入 `visualViewport` 高度 500（inset 344），`dock.getBoundingClientRect().bottom` 距视口底 344±1；inset 0 时为 0 |
| UX-06 | M5 | 聚焦输入框后输入框与光标行完整可见，无横向滚动 | 点 `goal-input`，等 300ms，box 在可视区内；`document.scrollingElement.scrollWidth === clientWidth` |
| UX-07 | M5 | 安全区用 `env(safe-area-inset-*)`；模拟 47/34 时标题 top ≥47、主按钮 bottom ≤810 | 检查 `+html` 的 viewport meta 含 `viewport-fit=cover`；DOM 设置 `--safe-*` 后量 header 文字与 `primary` 的 box |
| UX-08 | M5 | 标题栏实色、无渐变、底部 1px hairline | `getComputedStyle(header).backgroundImage === 'none'`，背景为 `color.bar`；`borderBottomWidth === '1px'`；源码无 `linear-gradient` 用于标题栏 |
| UX-09 | M5 | 草稿 300ms 落盘；离开再回来文字还在 | 输入后等 350ms，`localStorage['synon:draft:new:<pid>']` 含文字；返回首页再进新需求，textarea 值相同 |
| UX-10 | M5 | 刷新后草稿还在；进入屏幕不自动聚焦 | `page.reload()` 后 textarea 值相同；`document.activeElement` 不是 textarea |
| UX-11 | M5 | 草稿只在 queued/done 后删；failed/refused 保留 | 请求失败时 key 仍在；回执 queued 后 key 消失 |
| UX-12 | M5 | 断网发送保留文字并可重试 | `context.setOffline(true)` → 点发送 → 出现「没发出去」行；textarea 值不变；「重试」可点；恢复网络后补发 |
| UX-13 | M5 | 连点/重试/刷新同一 opId，只产生一条动作 | 网络日志与 fake-daemon 日志里 `plan.create` 的 deliver 只有 1 条；请求体 `opId` 全部相同 |
| UX-14 | M5 | sending 期间主按钮禁用 | 请求未返回时 `primary` 有 `disabled`/`aria-disabled="true"`；再点无新请求 |
| UX-15 | M5 | 回执可见：发送 1s 内出现「发送中/已排队」；done 后 1s 内出现「已处理」 | 截图 + 文本断言 |
| UX-16 | M5 | 4000 上限、3600 起计数；目标空或未选平台时主按钮禁用 | 填 3601 字看到「还剩 399 字」；粘贴 4001 字被截到 4000；空输入/未选平台时 `primary` disabled |
| UX-17 | M5 | 滚动到底时内容不被 ActionDock 遮挡 | 最后一项 `boundingBox().y+height ≤ dock.top`；内容区 `paddingBottom ≥ dock.height` |
| UX-18 | M5 | 1440 宽：内容列 ≤720 居中；项目卡片两列；主按钮不拉全宽 | 内容列 left/right 与中心差 ≤2px；卡片两列；`primary.width ≤720` |
| UX-19 | M5 | 无仅悬停/右键的交互 | 源码 grep 无 `onMouseEnter` / `onContextMenu` / 关键 `:hover`；触屏设备上手点全部功能 |
| UX-20 | M5 | 可点元素有 role 与 testID；图标按钮有可读名称 | DOM 中每个可点元素有 `role` 与 `data-testid`；图标按钮 `aria-label` 非空 |
| UX-21 | M5 | 正文与按钮文字对比度 ≥4.5:1（大字 ≥3:1） | 用 token 值计算（`color.text`、`text2`、`text3`、`onPrimary`/`primary`、`warn`、`error`）与 axe/lighthouse 抽查 |
| UX-22 | M5 | 两种离线文案分开，分钟数来自真实时间戳并随时间更新 | 断网时看到「你已离线 · 上次同步 x 分钟前」；`studio.online=false` 时看到「工作室离线 · 上次同步 x 分钟前」；等 60s 后 x 增加 |
| UX-23 | M5 | 320 宽无横向滚动；标题单行省略 | 320×568 下 `scrollWidth === clientWidth`；长项目名标题 `text-overflow: ellipsis` |
| UX-24 | M5 | Web 不振动；减少动效时无动画 | 源码/bundle 无 `navigator.vibrate`、无 Web 端 haptics 调用；`prefers-reduced-motion: reduce` 下无位移动画 |
| UX-25 | M5 | 无价格、购买、订阅、billing 入口 | 客户端源码 grep 价格/购买/订阅/`billing`/`stripe`/`¥`/`$` 无命中（P1 本就不该有） |
| UX-26 | M5 | 未登录访问任何页回登录；登录后回到 next | 清 localStorage 打开 `/new?project=x` → `/login?next=…`；登录后落回 `/new?project=x` |
| UX-27 | M5 | 加载/空/出错三态齐全，出错可重试 | 每个列表屏截图三态；错误态有 ≥44 的「重试」；空态有前进一步 |
| UX-28 | M5 | 客户可见文案走 strings 表，中英齐全，产品名 Synon Studio，无内部词 | `lib/strings.ts` 每个 key 有 zh + en；页面上 grep 不到 daemon/hub/opId/planRef/KEY/路径 |
| UX-29 | M6 | 对话：乐观气泡、失败重试、AI typing、同 opId 去重 | 发一条断网消息 → 气泡带「重试」；恢复后同一条替换，不重复 |
| UX-30 | M6 | 决策：10 秒内可撤销，撤销前不发送 | 点提交后 5s 点撤销 → 无请求；不撤销则 10s 后恰好 1 条 `decision.answer` |
| UX-31 | M6 | 抽屉：键盘弹起时输入条贴键盘，主按钮收起 | 390×500 下打开对话抽屉，输入条 bottom 距视口底 ≤1px；`primary` 不渲染 |

## 13. 实施映射与交接

| 规则 | 落在哪 |
|---|---|
| `UX-01` `UX-02` `UX-17` `UX-18` | `components/ActionDock.tsx`、`PrimaryButton.tsx`、`Screen.tsx`、`Header.tsx` |
| `UX-03` `UX-04` `UX-05` `UX-06` | `lib/viewport.ts` + `ActionDock` + `GoalInput` |
| `UX-07` `UX-08` | `app/+html.tsx`、`Header.tsx` |
| `UX-09` `UX-10` `UX-11` | `lib/drafts.ts`、`lib/kv.ts`、`app/new.tsx` |
| `UX-12` `UX-13` `UX-14` `UX-15` `UX-16` | `lib/submit.ts`、`components/ReceiptLine.tsx` |
| `UX-19` `UX-20` `UX-21` `UX-23` `UX-24` | 组件写法与 `theme.ts` |
| `UX-22` | `components/SyncBanner.tsx`、`lib/time.ts`、中台 `studio` 字段 |
| `UX-25` `UX-28` | `lib/strings.ts` 与代码审查 |
| `UX-26` | `app/_layout.tsx`、`lib/hub.ts`（`signed-out`） |
| `UX-27` | `components/EmptyState.tsx`、各屏 |
| `UX-29` `UX-30` `UX-31` | M6：`components/ChatDrawer.tsx`、`DecisionCard.tsx`、`ReasonSheet.tsx`（沿用 `lib/submit.ts`） |

组件清单（与 M5 技术设计 §1 对齐）：`Screen`、`Header`、`ActionDock`、`PrimaryButton`、`SyncBanner`、`ProjectCard`、`PlanRow`、`ProgressRing`、`GoalInput`、`PlatformPicker`、`ReceiptLine`、`EmptyState`；M6 再加 `ChatDrawer`、`DecisionCard`、`ReasonSheet`。

给后续任务的约束：

- BLG-81（四屏版式）必须按 §2/§3 的尺寸与 §12 的量法出稿；新需求屏的输入区与 §4.2/§10.1 一致。
- BLG-83（脚手架）实现 `+html`、`Header`、`ActionDock`、`useKeyboardInset`、`strings` 的空壳；`theme.ts` 从 companion 原样复制，再按需只加 `space`/`radius` 的引用。
- BLG-84/85 实现本文件的 M5 条目；`data-testid` 命名：`primary`、`goal-input`、`platform-ios|android|miniprogram|web`、`receipt-line`、`project-card-<id>`、`plan-row-<ref>`、`back`、`refresh`。
- BLG-86（e2e）至少断言 `UX-01`…`UX-18`、`UX-22`、`UX-26`，其余人工核对并截图。

## 14. 与上游设计的差异与决定

1. **M5 没有底部导航**：P1 的待办入口在 M6 才出现；届时用两个 tab（项目 / 待办），主按钮仍在 ActionDock。上游 spec 只写了「底部待办入口」，没有要求 M5 就加栏。
2. **`expired` 后用新 opId**：中台把 opId 当幂等键，`expired` 是终态；复用旧 opId 只会拿回 `expired`。只有「请求没被收下」的失败才复用 opId。
3. **恢复草稿不自动聚焦**：草稿是「回来继续写」，不是「请立刻弹键盘」。
4. **桌面提供标题栏刷新按钮**：下拉手势在桌面不存在，不能成为唯一刷新方式。
5. **决策的 10 秒撤销在发送前**（spec §6.3 原文），所以离开页面时视为确认并立刻发送，避免「点了提交却没发」。
6. **绝对量法用 CSS px**：Web 上没有物理 pt，390×844 下 1 CSS px 与 spec 的 pt 一一对应；审计只按本表的量法判。
7. **键盘验证用缩小视口代理**：Playwright 不能真的弹系统键盘，390×500 是代理；真机在 M5 审计与 P1 验收时补看（spec §9 末尾）。
8. **键盘弹起时不再叠加安全区**：`bottom = inset`，`padding-bottom = 16`。键盘自身已经盖住 home indicator 区域，再叠 34 会在输入框和键盘之间留一条空带。
9. **原型用 `--safe-top/--safe-bottom` 模拟 47/34**：浏览器桌面没有 `env()` 值；真实 App 用 `env(safe-area-inset-*)`，审计时用相同的数值模拟。
