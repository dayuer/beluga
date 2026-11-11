# 沉稳界面 · 通话、引导、设置与对话框逐页验收（M3 · BLG-172）

- 采集时间：2026-11-12 02:00–02:10（WIB）
- git：`8fab9b836`（BLG-171 提交后的分支 HEAD；`plan/mac-fork` + M3 审计）
- 命令行：`BELUGA_URL=http://localhost:1421 node packages/mac/scripts/calm-check.mjs onboarding call network confirmremove settings person palette`
- 演示 daemon：`BELUGA_HOME=/tmp/calm-blg170 BELUGA_ALLOW_ORIGINS=http://localhost:1421 npm run dev`（一次性 home，演示数据：4 人房间、bob/mia 两个朋友、两条待决策卡片）；vite 占 1421
- 原始结果：`.context/calm/<场景>.json`、`.context/calm/img/`（gitignore）；代表截图 `docs/calm/img/m3-*.png`
- 机器负载：采集期间 other worktrees 在跑，1 分钟负载约 20–30（10 核）。

## 验收方法（四步）

1. **逐页录屏**：每场景四组合，独立浏览器 context；记录 CLS 与 sources、`getAnimations()`、JS 改写 style、首帧 `data-calm`，enter/loaded/hover/select 及场景自定义时刻截图。
2. **时刻覆盖**：进入 → 加载完成 → 悬停/选中 → 打开/关闭；通话另覆盖「呼叫中」，对话框另覆盖「破坏性确认」。
3. **reduced-motion**：`calm-on/reduce` 重看。
4. **问题成表**：文件:行、现象、改法、建议归属、状态（本阶段「待 BLG-174」）。

**本轮的两条判定线**（任务上下文）：① keep-decor 的引导动画、来电提醒、纯装饰组件**维持原状**，只确认没被覆盖层误伤；② 对话框属于「重」反馈，检查后果与按钮是否写清。

## 1 页面清单：场景 ↔ 页面/视图 ↔ 导航路径

| 场景 | 页面 / 视图 | 覆盖的时刻 | 导航（脚本步骤） |
| --- | --- | --- | --- |
| `onboarding` | 欢迎/引导页（一次性场景，keep-decor） | 进入、加载完成 | 启动时 `?welcome` 强制显示，等 3.6s |
| `call` | 房间群聊 + 呼叫中（主窗口 CallStrip/CallRoom） | 进入、呼叫中、挂断 | 侧栏 `Group chat` → 标题栏 `Call the Room`；截 `in-call` 后点 `Leave Call` |
| `network` | 房间群聊（网络页：消息、待加入/信任决策卡） | 进入、悬停决策按钮 | 侧栏 `Group chat` |
| `confirmremove` | 朋友卡 + 破坏性确认「Remove bob?」 | 打开对话框、阅读后果/按钮、取消 | 侧栏 `Group chat` → 朋友 `bob` → `Remove from Room…` → 截 `remove` → Esc（**不确认**） |
| `settings` | 设置对话框（General 等 18 个分区） | 打开 | `⌘,` |
| `person` | 朋友卡（bob：信任、用量、动作） | 打开 | 侧栏朋友 `bob` |
| `palette` | 命令面板（⌘K，`role=dialog`） | 打开 | `⌘K` |

手机页：演示环境没有 Phone 标签（`panel-model.ts:103` 需要手机端能力打开；本 demo 的 `Your Mac` 页签只有 New chat/Scratch/Info/Terminal），无法逐页录屏，见 §7。通话的**来电**铃声/波纹需要真实入站通话，演示里触不到；本轮录到的是呼叫方（Ringing）状态，keep-decor 的来电横幅按静态锚点验证。

## 2 每页结果

格式：`CLS · CSS 动画数 · JS 动效元素数`；首帧列是 `calm-on/full`。

| 场景 | on/full | on/reduce | off/full | off/reduce | 首帧 data-calm（on） |
| --- | --- | --- | --- | --- | :---: |
| onboarding | 0.000 · **9** · 0 | 0.000 · 0 · 0 | 0.000 · 10 · 0 | 0.000 · 2 · 0 | ✅ |
| call | 0.003 · 0 · 0 | 0.000 · 0 · 0 | 0.000 · 1 · 0 | 0.000 · 0 · 0 | ✅ |
| network | 0.000 · 0 · 0 | 0.000 · 0 · 0 | 0.000 · 1 · 0 | 0.000 · 0 · 0 | ✅ |
| confirmremove | 0.003 · 0 · 0 | 0.000 · 0 · 0 | 0.006 · 1 · 21 | 0.000 · 0 · 0 | ✅ |
| settings | 0.003 · 0 · 0 | 0.000 · 0 · 0 | 0.000 · 1 · 21 | 0.000 · 0 · 0 | ✅ |
| person | 0.003 · 0 · 0 | 0.000 · 0 · 0 | 0.000 · 1 · 21 | 0.000 · 0 · 0 | ✅ |
| palette | 0.003 · 0 · 0 | 0.000 · 0 · 0 | 0.000 · 1 · 21 | 0.000 · 0 · 0 | ✅ |

代表截图：

| 引导页（calm 开，keep-decor 保留） | 引导页 reduce（动画全停） |
| --- | --- |
| ![onboarding](img/m3-onboarding-calm-on-full-loaded.png) | ![onboarding reduce](img/m3-onboarding-calm-on-reduce-loaded.png) |

| 呼叫中（房间） | 网络页与待决策卡 |
| --- | --- |
| ![call](img/m3-call-calm-on-full-in-call.png) | ![network](img/m3-network-calm-on-full-group.png) |

| 破坏性确认：Remove bob? | 朋友卡 |
| --- | --- |
| ![remove](img/m3-confirmremove-calm-on-full-remove.png) | ![person](img/m3-person-calm-on-full-loaded.png) |

| 设置 | 命令面板 |
| --- | --- |
| ![settings](img/m3-settings-calm-on-full-loaded.png) | ![palette](img/m3-palette-calm-on-full-loaded.png) |

## 3 仍在播放的动画清单及理由

| 场景 | calm-on/full CSS 动画 | calm-on/reduce | calm-off/full（对照） | calm-off/reduce |
| --- | ---: | ---: | ---: | ---: |
| onboarding | **9**（keep-decor） | 0 | 10 | **2**（上游 reduce 未停） |
| call | 0 | 0 | 1（`_scan_`） | 0 |
| network | 0 | 0 | 1（`_scan_`） | 0 |
| confirmremove / settings / person / palette | 0 | 0 | 1（`_scan_`） | 0 |

`calm-on/full` 的 9 条全部来自引导页的 keep-decor：`_sheen_` 6s infinite（标题高光）、`_beam_` 3.2s infinite（按钮光束）、以及场景的一次性入场（1600/1300/900/700/650ms 等，`onboarding/scenes`）。它们按计划批准保留，覆盖层的 `[data-welcome]` 锚点没有误伤它们——**这正是 keep-decor 复核要看的「未被误伤」**。

其余页面在 calm-on/full 是 0：对话框内容走 `calm-surface-drop` 160ms（一次性，不是循环），命令面板同理；通话条没有循环（呼叫方的 `_liveDot_` 呼吸按 overlay §7.2 有意关掉，静成实心点）。

## 4 reduced-motion 下的结果

| 场景 | on/reduce CSS 动画 | on/reduce JS 动效 | on/reduce CLS |
| --- | ---: | ---: | ---: |
| onboarding | 0 | 0 | 0.000 |
| call | 0 | 0 | 0.000 |
| network | 0 | 0 | 0.000 |
| confirmremove / settings / person / palette | 0 | 0 | 0.000 |

- 引导页：M5 的 reduce 规则不带 keep-decor 排除，9 条全部停止（截图对照）；上游 `calm-off/reduce` 仍有 2 条（`_sheen_`/`_beam_` 自己没写 reduce 媒体查询）——这是上游的 reduce 缺口，见 RE-01。
- 对话框：`calm-overlays.css` 的 reduce 分支把 menu/dialog/popover/toast 的入场全部关掉，实测 `animations` 0。
- 通话：呼叫条没有动画；来电横幅的 `ringIn`/`ripple`（keep-decor）若真的响铃，calm 的 reduce 规则会停掉它们（M5 全局 + 无锚点排除），符合「reduce 下必须停」。

## 5 CLS 表（calm-on 进入 → 加载完成）

| 场景 | calm-on/full CLS | calm-on/reduce CLS | 记录到的非输入位移 | 归因 / 处置 |
| --- | ---: | ---: | --- | --- |
| onboarding | 0.000 | 0.000 | — | 欢迎页无位移 |
| call | 0.003 | 0.000 | body 0.0028 | 固定整页微小位移（同 shell.md §5） |
| network | 0.000 | 0.000 | — | 群聊加载无位移 |
| confirmremove | 0.003 | 0.000 | body 0.0028 | 同上（calm-off 的 0.006 是朋友卡/确认框打开时的整块移动） |
| settings / person / palette | 0.003 | 0.000 | body 0.0028 | 同上 |

**对话与对话框的「重」反馈检查**

- **Remove bob?**（破坏性确认）：正文写清后果「bob is disconnected and the room's invite link changes, so the old one stops working.」；按钮 `Cancel`（默认）与红色 `Remove`。后果与按钮都清楚。
- **朋友卡**：信任说明「Ask me each time. You approve each request. Their agent only reaches your shared folders; reading anything else asks you.」；动作分区清楚；`Remove from Room…` 用红色。清楚。
- **房间的两条待决策卡**：「zoe wants to join bob-api」（`Let in` / `Let in to watch` / `Not now`）与「How much do you trust bob?」（`Ask me every time` / `Trusted` / `Full trust` / `Can't use my agent`，`Later`）。按钮齐全、有退路（Not now / Later）；但**卡片本身没有写每种选择的后果**（例如 Let in to watch 与 Let in 的区别、信任三档的差别）。这是文案问题，见 RE-03。
- **设置**：每个分区用一句副标题说明作用（General 的 Your name/Your picture/Language/Requests/Updates…），开关有即时说明；命令面板只有一个输入框与结果列表，无破坏性动作。

## 6 问题表

| ID | 文件:行 | 现象 | 改法 | 建议归属 | 状态 |
| --- | --- | --- | --- | --- | --- |
| RE-01 | `onboarding/scenes/scenes.module.css`（`_sheen_` 6s、`_beam_` 3.2s） | keep-decor 的引导页动画在 calm-on/full 按预期保留（9 条，未被误伤）；calm-on/reduce 被 M5 停成 0；但 **calm-off/reduce 仍有 2 条**——上游自己的 `prefers-reduced-motion` 没覆盖这两条 | calm 侧已经兜住（M5）；上游补齐两条的 reduce 媒体查询（对所有开了 Reduce motion 的用户都对） | keep-decor（已批准）+ 上游 PR | 待 BLG-174 |
| RE-02 | `call/call.module.css:363-435,108-118`；`overlay.md §7.0` 锚点 | 来电横幅 `ringIn`/`ripple` 与铃铛 `nudge` 属 keep-decor，覆盖层按 `_incoming_`/`_ringIcon_` 锚点排除；演示环境没有入站来电，无法现场触发 | 静态验证：锚点在 `calm-motion.css` 的 `:not(:where(...))` 列表里，`fork-calm` 快照也把它们算作 keep-decor；本轮录到的是呼叫方 Ringing（无循环）。保持 | keep-decor（已批准例外） | 待 BLG-174 |
| RE-03 | `dialogs/native/parts.tsx`（Dialog.Overlay）；`dialogs/settings.module.css:6`、`dialogs/palette.module.css:6` 的 overlay | 设置/命令面板打开时，**背板背景动画 `fade` 被 M1 关掉、瞬时出现**，而对话框内容淡入 160ms——两层不同步（overlay.md §10.5 的遗留项） | 覆盖层候选：`:root[data-calm] [data-state='open'][class*='_overlay_'] { animation: calm-surface-in var(--dur) var(--ease-standard) !important }`；先做全库锚点碰撞核对（`_overlay_` 是否只命中对话框背板），再决定 | 覆盖层（候选） | 待 BLG-174 |
| RE-04 | `network/ConversationView.tsx`（待加入/信任卡） | 「重」决策卡的按钮与退路齐全，但卡片不解释各选项的后果（Let in vs Let in to watch；三档信任） | 上游文案：每条选项下加一行后果（如「Let in to watch: they read your files; their agent can't change anything」）；纯文案，不动动效 | 上游（文案，PR 候选） | 待 BLG-174 |

**手机页**：演示环境 `panel-model.ts:103` 的 Phone 标签没有出现（`Your Mac` 页签只有 New chat/Scratch/Info/Terminal），`view.kind='phone'` 也没有其他入口；本轮无法录屏。不记问题，记覆盖缺口（见 §7）。

## 7 审计备注

**演示数据的局限**

- **来电**：房间有 4 人，`Call the Room` 可以起呼叫（Ringing，等待对方接听），但入站来电（Incoming 横幅、响铃波纹、Ask 卡片）需要另一个真人/agent 打进来，演示环境没有。keep-decor 的来电图形按静态锚点与 `fork-calm` 快照验证，见 RE-02。
- **手机页**：没有 Phone 面板标签（手机端能力未开），无法录屏；`PhoneView` 的页面本身不在本轮证据里。
- 引导页的 9 条动画来自演示的 `?welcome` 场景；引导页的 hero 文本入场是 650–1600ms 的一次性动画，属 keep-decor，reduce 下停。
- 房间的待决策卡在 `calm-on/full` 的截图里可见；`network` 场景的 `pending` 计数返回 0 是因为我的选择器按按钮文字过滤没匹配到卡片标题，卡片本身在截图里（见 `m3-network-calm-on-full-group.png`）。

**人工走查（`probe-rest.mjs`，同一次运行后单独开浏览器）**

- 设置：背板 `animation-name: none`（0.16s 的声明还在，但名字被 M1 关），对话框内容 `calm-surface-drop` 160ms、`cubic-bezier(0.3,0.7,0.3,1)`。命令面板同（背板 none、内容 160ms）。
- 朋友卡：没有背板（popover），内容 `calm-surface-drop` 160ms。
- 通话条：`Leave Call` 可见，控件 `Mute` / `Microphone and Speaker` / `Resume Notes` / `Turn Camera On` / `Share Screen` / `Leave Call`；`getAnimations()` 为空（呼叫方没有循环）。
- 破坏性确认的文案是从截图逐字读的（`getByRole('dialog')` 在该实现里拿不到，对话框是自定义 sheet）。

**交给 BLG-173 的遗留**

- RE-03 与 `overlay.md §10.5` 的「Dialog.Overlay 背板瞬时出现」是同一条；若 173 决定补规则，需要一并核对 `_overlay_` 的锚点碰撞（settings/palette/native parts 共用一个类名片段）。
- RE-01 的「keep-decor 在 reduce 下必须停」在 calm 内已由 M5 满足；上游那两条是 PR 候选，不影响本里程碑的 calm 判定。
- 手机页、入站来电的覆盖缺口需要在后续里程碑或 BLG-175 的最终重跑里补（如果能造出对应状态）。
