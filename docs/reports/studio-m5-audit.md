# Synon Studio M5 审计：界面、状态与越权

- 日期：2026-11-11
- 范围：`packages/studio-app` 的登录、项目、项目首页、新需求四屏；390×844 与 1440×900；加载/空/出错/离线/排队/发送/已处理等状态；客户端对中台数据的渲染与越权。
- 对照：`docs/studio-mobile-ux.md` 的 UX-01…UX-31、`docs/studio-app-screens.md`、`packages/companion/lib/theme.ts`、`src/studio/protocol.ts`、`docs/studio-hub.md`。
- 方法：design-review 流程。用 Playwright 在 `.beluga/scratch/review/` 留了 30+ 张状态截图；用 `packages/studio-app/e2e` 的真中台 + fake-daemon 重跑了四屏流程；做了客户端代码 grep 与逐条可检查项核对。
- 模型的限制：本工作区只提供一个模型，没有第二个模型可切换。为降低“自己审自己”的偏差，审查用一次独立的状态遍历和代码 grep 重新取证，不沿用实施时的结论。

## 0. 结论

- **M5 四屏可用**：390×844 与 1440×900 都能完成登录 → 项目 → 首页 → 新需求；`npm run e2e` 5 passed（27s），四屏截图齐全。
- 审计发现 **13 组必须修**（对比度、中文默认、内部用语、键盘遮挡、空/错状态、桌面登录按钮、深链上下文、同页魔法链接、大小写、焦点环、重连、重复离线、减少动效），**全部已修并复核**；复核截图在 `.beluga/scratch/review/`，回归 e2e 仍 5 passed。
- `docs/studio-mobile-ux.md` 中 M5 的 UX-01…UX-28 **全部通过**；UX-29…UX-31 属于 M6，本次 N/A。UX-07/UX-04 的真机刘海与 iOS 键盘仍建议在 P1 验收时用真机补看一眼（Chromium 里只能用 `visualViewport` 和缩小视口模拟）。
- **没有越权入口**：客户端只访问自己的项目/计划/动作与 WebSocket，没有任何运营者 API；客户端代码不渲染原始 JSON、文件路径、KEY 或模型名；没有价格/购买/订阅入口（P1 本就不该有）。
- 未修的 4 条是 should-fix（下拉刷新、限频后的重试、320 宽平台在首屏下、计划行动作文案重复），不阻塞 M5；列在 §2.2。

## 1. 证据与截图

### 1.1 真实中台 + fake-daemon 的 e2e（四屏，两个宽度）

| 屏 | 390×844 | 1440×900 |
|---|---|---|
| 登录 | `.beluga/scratch/m5/login-phone.png` | `.beluga/scratch/m5/login-desktop.png` |
| 项目 | `.beluga/scratch/m5/projects-phone.png` | `.beluga/scratch/m5/projects-desktop.png` |
| 项目首页 | `.beluga/scratch/m5/home-phone.png` | `.beluga/scratch/m5/home-desktop.png` |
| 新需求 | `.beluga/scratch/m5/new-phone.png` | `.beluga/scratch/m5/new-desktop.png` |

e2e 还覆盖：连点「开始规划」只产生 1 条 `plan.create`（fake-daemon 日志用 `actionKind`/`opId` 断言）；离开/刷新后草稿与平台恢复；390×500 下输入框与主按钮都在视口内；客户端断网时保留文字、恢复后补发仍只有一条；杀掉 daemon 显示「已排队」、重启（复用 key）后变「已处理」。日志：`.beluga/scratch/blg-86-e2e-run.log`、`.beluga/scratch/blg-87-e2e-run.log`。

### 1.2 状态矩阵（390 宽；桌面主状态另有截图）

| 屏 | 状态 | 截图 |
|---|---|---|
| 登录 | 默认 / 已发送 / 坏链接 / 同页新链接 / 键盘焦点 / 你已离线 / 英文浏览器 | `review/login-{default,sent,bad,hashchange-bad,focus,offline,en-browser}-phone.png` |
| 项目 | 加载 / 空 / 出错 / 完整 / 你已离线 / 320 宽 | `review/projects-{loading,empty,error,full,offline,320}-phone.png`；桌面 `projects-{full,empty,error}-desktop.png` |
| 项目首页 | 加载 / 空 / 出错 / 完整（工作室离线）/ 重连中 | `review/home-{loading,empty,error,full,reconnect}-phone.png`；桌面 `home-{full,empty,error}-desktop.png` |
| 新需求 | 默认 / 草稿恢复 / 发送中 / 已排队 / 已处理 / 发送失败 / 被拒绝 / 键盘（inset 344） | `review/new-{default,draft,sending,queued,done,failed,refused,keyboard}-phone.png`；桌面 `new-default-desktop.png` |

## 2. 按对用户伤害排序的问题

### 2.1 必须修（已修并复核）

#### 1. 多处小字对比度低于 4.5:1（全局，影响可读性）

- 现象：页面底色 `#F6F6F7` 上的 `text3 #737379` 只有 **4.36:1**；成功回执的绿字 `#2E8550` 在 `bg` 上只有 **4.24:1**；重连/离线横幅的 warn 字在 warn 底上只有 **4.42:1**，恢复横幅的绿字只有 **4.04:1**。涉及首页/新需求的 eyebrow、同步行、提示、计数、草稿恢复说明、登录的「正在登录…」、已处理回执、恢复横幅。
- 为什么重要：这些是小字说明和成功反馈；看不清会让客户怀疑“到底提交成功没有”。WCAG AA 正常文字要求 4.5:1。
- 修法：页面底上的小字改用 `color.text2`（6.05:1）；`text3` 只在卡片上使用（4.71:1）。`ReceiptLine` 成功态保留绿色勾，句子用 `color.text`；`SyncBanner` 保留 warn/绿圆点或 spinner，句子用 `color.text`。没有新增颜色。
- 复核：`review/home-full-phone.png`、`review/new-default-phone.png`、`review/projects-offline-phone.png`、`review/new-done-phone.png`；对照值：text2/bg 6.05、text3/card 4.71、warn/bg 4.94、error/bg 5.61、onPrimary/primary 16.83。

#### 2. 中文默认被浏览器语言覆盖（中国客户在英文浏览器里看到全英文）

- 现象：`detectLang()` 只看 `navigator.language`，英文浏览器整屏渲染 en，包括「Sign in / Continue / Projects」。
- 为什么重要：设计写明“中文为主”；客户多为中文用户，浏览器语言是英文（或没设置）时会被迫读英文；也没有切换语言的入口。
- 修法：`detectLang()` 默认 `zh`；只有显式存了 `synon:lang` 时才用它（留给以后的语言开关）。en 文案继续保留。
- 复核：`review/login-en-browser-phone.png`（en-US 浏览器现在显示中文）；`review/login-default-phone.png`。

#### 3. 键盘弹起时平台选择被挡在首屏外（新需求）

- 现象：390×844、键盘 inset 344 时，输入框和主按钮可见，但“在哪些平台？”的 2×2 块在 dock 后面；客户要先收起键盘或滚动才能选平台，而主按钮在未选平台时是灰的。
- 为什么重要：平台是必填项；客户可能以为“按钮坏了”。
- 修法：键盘弹起（`inset > 0`）时收起 intro 与三条写作提示，只保留项目/工作室一行；`ActionDock` 的 `bottom/margin` 随 `visualViewport` 上移。输入、平台、按钮同时可见。
- 复核：`review/new-keyboard-phone.png`，实测 goal 128–248、iOS 305–357、主按钮 432–484、dock 底边 500（可视区 0–500）。

#### 4. 空/错状态钉在顶部、操作像纯文字（项目/首页）

- 现象：空项目和加载失败时，标题在内容顶部、下面一大片空白；“刷新/重试”是纯文字，没有按钮外观，客户不一定知道能点。
- 为什么重要：这是客户唯一的下一步；看不出来会停在死页面。
- 修法：`EmptyState` 撑满剩余内容并垂直居中；`TextButton` 改成 quiet 的「sunken 底 + 1px hairline」按钮（仍是次要动作，不抢主按钮）。`docs/studio-app-screens.md` 已同步。
- 复核：`review/projects-empty-phone.png`、`review/projects-error-phone.png`、`review/home-empty-phone.png`、`review/home-error-phone.png`；桌面 `projects-empty-desktop.png`、`projects-error-desktop.png`。

#### 5. 桌面登录：400 宽的表单下面是 720 宽的主按钮

- 现象：登录内容列 400 居中，但 `ActionDock` 内宽统一 720，按钮比表单宽出一截，视觉上像错位。
- 为什么重要：登录是客户看到的第一屏；错位会显得没做完。
- 修法：`ActionDock` 支持 `maxWidth`；登录桌面传 400，与表单对齐；其它屏继续 720。
- 复核：`review/login-default-desktop.png`（按钮 400，和表单同列）。

#### 6. 新需求刷新/深链后丢了项目上下文

- 现象：直接打开或刷新 `/new?project=<pid>` 时，项目缓存不在 localStorage，顶部“项目名 · 工作室”一行消失；客户不知道这条需求是给哪个项目写的。
- 为什么重要：刷新很常见；上下文缺失会让客户写错项目。
- 修法：缓存没有时，新需求屏用 `hub.projects()` 取一次项目名（同时写回缓存），只补这一行的上下文。
- 复核：`review/new-default-phone.png`（饮水打卡 · Acme Studio）、`review/new-failed-phone.png`。

#### 7. 同一标签页里再点一封魔法链接没有反应

- 现象：已经停在 `/login` 时，新链接只改变 `#token=`，是 same-document 导航；登录屏只在挂载时读一次 hash，第二次链接不会被验证。
- 为什么重要：客户会在同一标签页重新点邮件里的链接；没反应会被当成“链接坏了”。
- 修法：登录屏监听 `hashchange`，用 `verified` ref 防止同一个 token 验证两次；`history.replaceState` 仍先把 token 从地址栏去掉。
- 复核：`review/login-hashchange-bad-phone.png`（同页切到坏链接后显示「链接已失效」）。

#### 8. 首页/新需求的 eyebrow 把英文工作室名变成全大写

- 现象：`type.eyebrow` 带 `textTransform: uppercase`；同一工作室在项目卡片里是“Acme Studio”，在首页/新需求顶部变成“ACME STUDIO”。
- 为什么重要：同一实体两种写法，显得不一致；英文名的客户会觉得被“喊”。
- 修法：工作室名用 `type.caption` + 600，保留小号与字距，不做大写；`type.eyebrow` 仍留给真正的 section label。
- 复核：`review/home-full-phone.png`、`review/new-default-phone.png`。

#### 9. 桌面键盘焦点没有可见的焦点环

- 现象：所有 Pressable 用浏览器默认焦点，没有产品自己的 2px info 焦点环；键盘用户看不出焦点在哪。
- 为什么重要：桌面无障碍；表单和多按钮页面必须有可追踪的焦点。
- 修法：`public/index.html`（以及 `+html.tsx`）加 `:focus-visible` 规则：2px `#2F64D0`，偏移 2px。输入框同时保留 info 边框。
- 复核：`review/login-focus-phone.png`（Tab 到「继续」，蓝色 2px 环）。

#### 10. 重连横幅在开发代理下不出现

- 现象：杀掉 fake-daemon 后，客户 WebSocket 的上游断开，但 dev-proxy 的 WS 管道没有把 close 传播给浏览器，页面一直以为连接还在。
- 为什么重要：客户不知道自己已经掉线；设计要求的「连接中断，正在重连…」是恢复路径的起点。
- 修法：dev-proxy 在 WS upgrade 的 `up`/`socket` 上加 `close` 互相销毁；这是开发期同源代理的修正，生产由 Worker 托管同源（P2）。应用本身的 `hub.watch` 已有指数退避与 `closed/open` 回调。
- 复核：`review/home-reconnect-phone.png`（横幅「连接中断，正在重连…」，下方计划与「工作室离线」仍在；重连不阻塞阅读）。

#### 11. 没有缓存且离线时，项目/首页会出现两条「你已离线」

- 现象：顶部 `SyncBanner`「你已离线 · 上次同步…」和错误空态的标题「你已离线」同时出现。
- 为什么重要：重复消息让人以为出了两件事；也没有可操作的新信息。
- 修法：有缓存数据时才显示顶部离线横幅；没有数据时只由空态说明并给重试。
- 复核：离线状态 `review/projects-offline-phone.png`（有数据，横幅 + 卡片）；无数据路径由代码与 `projects-error` 截图覆盖。

#### 12. 减少动效偏好没有照顾

- 现象：页面切换/加载 spinner 没有对 `prefers-reduced-motion` 做处理。
- 为什么重要：前庭敏感的用户会被不必要的位移和旋转影响。
- 修法：在 HTML shell 加 `@media (prefers-reduced-motion: reduce)`，把动画/过渡时长压到 0.01ms、`scroll-behavior: auto`；应用本身没有依赖动画表达状态。
- 复核：`public/index.html` 与 `app/+html.tsx` 的样式；e2e 仍通过。

#### 13. 客户文案里出现「中台」

- 现象：服务不可用文案写成「中台暂时不可用」；「中台」是对内的架构词（hub）。
- 为什么重要：客户不知道“中台”是什么；设计明确客户可见处不出现 daemon/hub/opId 等内部词。
- 修法：`login.serviceDown` 与 `refusal.http` 改为「服务暂时不可用…」；客户端 strings 中已无「中台」。设计文档的文案表同步。
- 复核：`review/new-failed-phone.png`（「服务暂时不可用。文字已保留，稍后重试。」）。

### 2.2 应该修（未修，给出修法，不阻塞 M5）

1. **下拉刷新未实现**（`docs/studio-mobile-ux.md` §8.1）。项目/首页目前只有标题栏的 44×44 刷新按钮；下拉手势没有。修法：在项目与首页的 ScrollView 上做 64pt 阈值的手势刷新，`overscroll-behavior-y: contain`，键盘弹起时忽略。为什么没在 M5 做：刷新动作已有可达入口，e2e 不覆盖手势；建议在 M6 抽公共 `usePullRefresh` 时一起做。
2. **限频拒绝后「重试」立刻可点**。回执说「操作太频繁了，过一会儿再试」，但主按钮仍写着「重试」。修法：按 `rate-limited` 进入 5 秒倒计时，按钮显示「稍后再试（5s）」并禁用；或改成「返回」。
3. **320×568 首屏下平台块被 dock 压住**。390 基准没有问题；320 是下限，平台块在首屏只露出一半，需要滚动。修法：在 <360 宽时进一步压缩 intro/提示，或把平台块改为 4 个横排小按钮（仍 ≥44）。不作为阻塞：内容可滚动，320 是极端宽度。
4. **计划行 meta 可能与 headline 重复**（「AI 在做 · 在做：第 N 次更新」）。这是 daemon 给的 headline 与状态词重复，不是客户端拼错。修法：`PlanRow` 在 headline 已以状态词开头时只显示 headline；或在 daemon 侧约定 headline 不重复状态词。
5. **魔法链接重发没有冷却提示**。`POST /v1/login` 恒 202，界面允许连点；中台每小时 5 次。修法：发送后 30 秒内「再发一封」禁用并显示剩余时间。
6. **真机刘海/安全区与 iOS Safari 键盘未在真机复核**。代码用 `viewport-fit=cover` + `useSafeAreaInsets` + `visualViewport`，Chromium 只能模拟。P1 验收时用 iPhone Safari 与 Android Chrome 各走一遍聚焦、切换输入法、旋转。

### 2.3 打磨（不改也不影响 M5）

- 首页空态把整句「还没有需求。点下面的「新需求」开始。」用作 heading；可以拆成标题 + 说明两行，层级更清楚。
- 桌面登录表单从视口约 33% 开始，设计写的是约 28%；差别很小。
- 新需求的写作提示对小屏偏长；可以在首次使用后折叠。
- 登录页的“已发送”面板不会自动消失；是有意的（统一回执），但可加一个更清楚的“没收到？”帮助。
- 计划行动作里 `planRef` 只出现在 `data-testid`（如 `plan-row-plan1`）与 URL，不在可见文字；这是测试需要的不透明 id，不是信息泄露。

## 3. 对照 `docs/studio-mobile-ux.md` 的可检查项

| ID | 结果 | 证据 / 说明 |
|---|---|---|
| UX-01 | 通过 | e2e 与审计：返回/刷新 44×44，主按钮 52，平台块 52，邮箱 52，项目卡片整卡可点 |
| UX-02 | 通过 | 登录/首页/新需求各 1 个 `[data-testid=primary]`，高 52；项目屏无主按钮 |
| UX-03 | 通过 | 390×844：新需求目标框 top=450，登录/首页/新需求主按钮 top=776（≥422） |
| UX-04 | 通过 | e2e 390×500；`review/new-keyboard-phone.png`：goal 128–248、primary 432–484 |
| UX-05 | 通过 | `review/new-keyboard-phone.png`：dock 419–500，等于 inset 344 + 底部栏 77；inset 0 时归位 |
| UX-06 | 通过 | GoalInput/邮箱聚焦 `scrollIntoView({block:'nearest'})`；键盘态输入完整可见；320 无横向滚动 |
| UX-07 | 通过（代码/模拟） | `viewport-fit=cover`、`useSafeAreaInsets` 用于 Header/ActionDock；刘海与横屏真机待 P1 验收补看 |
| UX-08 | 通过 | 截图：实色 `color.bar`、1px hairline，无渐变/模糊 |
| UX-09 | 通过 | e2e：输入 300ms 后 `synon:draft:new:<pid>` 有文字；离开再回来恢复 |
| UX-10 | 通过 | e2e：刷新后草稿仍在；`document.activeElement` 不是输入框 |
| UX-11 | 通过 | e2e queued 后草稿删除；失败/被拒保留；空目标+空平台不写空草稿 |
| UX-12 | 通过 | e2e：断网发送显示「没发出去」、文字保留、可重试 |
| UX-13 | 通过 | e2e 连点后 fake-daemon 的 `plan.create` deliver 恰好 +1；hub actions 1 个唯一 opId |
| UX-14 | 通过 | `PrimaryButton` 在 sending 时 disabled + spinner；e2e `review/new-sending-phone.png` |
| UX-15 | 通过 | 截图 sending/queued/done；e2e 从「已排队」到「已处理」并回到项目 |
| UX-16 | 通过（代码） | `LIMITS.text=4000`、`GoalInput maxLength`；≥3600 显示「还剩 N 字」；目标空或平台 0 时主按钮 disabled |
| UX-17 | 通过 | 内容区/Composer 位于 ActionDock 之上；首页/新需求截图底部留白；滚动不被遮 |
| UX-18 | 通过 | 1440：内容列 720 居中，项目卡片两列 352，新需求 424+264，主按钮 720；登录 400 |
| UX-19 | 通过 | 源码 grep 无 `onMouseEnter`/`onContextMenu`/关键 `:hover`；所有功能触屏可达 |
| UX-20 | 通过 | 所有可点元素 `accessibilityRole` + `testID`；图标按钮有 `accessibilityLabel`；焦点环已加 |
| UX-21 | 通过（已修） | text2/bg 6.05、text3/card 4.71、warn/bg 4.94、error/bg 5.61、onPrimary 16.83；失败/成功/横幅的语义色保留在图标/圆点 |
| UX-22 | 通过 | 两种离线分开：`review/projects-offline-phone.png`（你已离线）与 `review/home-full-phone.png`（工作室离线）；分钟数来自缓存时间戳 |
| UX-23 | 通过 | 320×568：`scrollWidth == clientWidth == 320`（项目与新需求）；截图 `projects-320`、`new-320` |
| UX-24 | 通过 | 无 `navigator.vibrate`/Web haptics；`prefers-reduced-motion` 规则在 HTML shell；应用不依赖动画表达状态 |
| UX-25 | 通过 | 客户端 grep 无价格/购买/订阅/billing/Stripe；P1 没有任何商业入口 |
| UX-26 | 通过 | `_layout` 守卫：无会话 → `/login?next=…`；登录后回 next；e2e/本地流程验证 |
| UX-27 | 通过 | 加载骨架、空态、错误态（带「重试」）在项目/首页均有截图；空态有前进一步 |
| UX-28 | 通过 | `lib/strings.ts` 每个 key 有 zh+en；默认 zh；产品名 Synon Studio；客户端 strings 无内部词 |
| UX-29 | M6 | 对话抽屉、乐观气泡、失败重试属于 M6 |
| UX-30 | M6 | 决策 10 秒撤销属于 M6 |
| UX-31 | M6 | 对话抽屉的键盘行为属于 M6 |

## 4. 越权与信息暴露

### 4.1 客户端能做什么

- 只调用 `/v1/login`、`/v1/login/verify`、`/v1/logout`、`/v1/app/projects`、`/v1/app/projects/:pid/plans`、`/v1/app/projects/:pid/actions`、`/v1/app/projects/:pid/ws`；没有任何 `/v1/admin/*`。
- `pid` 只来自 URL 与中台返回，请求体没有 `projectId`/`customerId`；成员校验由中台 `canAccess` 每次做（`docs/studio-hub.md` §3.5）。
- 动作只构造 `plan.create`（`StudioAction` 先校验）；不存在任意 `kind` 或内部方法名。
- WebSocket 用子协议 `synon.v1, bearer.<session>`，会话不进 query；中台只发本项目白名单视图、`plan-gone` 与回执。

### 4.2 客户端渲染什么

- 只渲染 schema 解析出的字段：项目名/工作室名、计划的 `title/headline/stage/waitingOn/progress`、`studio.online/lastSyncAt`；对话/决策/验收是 M6。
- 没有 `dangerouslySetInnerHTML`、没有 `innerHTML`、没有把 JSON 直接渲染；所有文本走 `<Text>`。`hub-schema.ts` 对项目/计划/登录/回执做宽松解析，未知字段丢弃；坏的响应变成 `schema` 错误与通用文案，不显示原始 JSON。
- 计划视图的净化由中台/daemon 侧完成（`src/studio/view.ts` / `sanitize.ts`）；客户端只拿白名单字段，不引入 `view.ts`/`sanitize.ts`/`actions.ts`。
- 客户端源码里没有可见文案包含文件路径、KEY、模型名；唯一的 `process.env` 读取是公开的 `EXPO_PUBLIC_HUB_URL`（不是密钥）。`theme.ts` 的注释提到 companion 路径，但不会渲染。
- 没有价格、购买、订阅、Stripe 或外链；P1 没有 `/billing`。

命令与结果（`review/greps.txt`）：

```
price/purchase/billing/stripe/订阅/购买  -> 无
dangerouslySetInnerHTML/innerHTML/JSON.stringify/parse（app/components） -> 无
strings.ts 中的 daemon/hub/opId/planRef/KEY/model/中台/路径 -> 无
跨包 import -> 只有 src/studio/protocol
onMouseEnter/onContextMenu/:hover -> 无
secret-looking paths/keys -> 只有 hub.ts 的公开 EXPO_PUBLIC_HUB_URL
```

### 4.3 会话

- 会话在 `localStorage` 的 `synon:session`，30 天；过期或 401 清掉并回登录。XSS 风险按设计接受：不渲染 HTML、不用 `dangerouslySetInnerHTML`、所有文本走 `<Text>`；M5 没有用户生成的 HTML 渲染。
- 中台日志不记请求体、邮箱、令牌、客户文字（M2 已做）；客户端不把 token 写日志。

## 5. 复核与回归

修复后的检查（日志 `.beluga/scratch/blg-87-checks.log`）：

- `npm run typecheck --prefix packages/studio-app` 通过。
- `npx vitest run` 的 5 个相关测试文件：35 passed。
- `npm run e2e --prefix packages/studio-app`：5 passed、3 skipped（phone-only 在 desktop 跳过），27.0s；四屏截图与 deliver 计数仍通过。
- 审计截图：`.beluga/scratch/review/` 30+ 张；修复后的关键复核：`login-en-browser-phone.png`、`new-keyboard-phone.png`、`new-failed-phone.png`、`login-default-desktop.png`、`projects-{empty,error}-phone.png`、`home-{full,reconnect}-phone.png`、`login-hashchange-bad-phone.png`、`login-focus-phone.png`、`projects-320-phone.png`、`new-320-phone.png`。
- 设计文档已同步：`docs/studio-mobile-ux.md`（http 文案、成功回执颜色、SyncBanner 墨色字）、`docs/studio-app-screens.md`（TextButton 的 tonal 外观、SyncBanner、ReceiptLine、登录 5xx 文案）。

## 6. 交接

- M5 可进入验收；剩余 should-fix 已列在 §2.2，建议 M6 抽公共交互时一起处理（下拉刷新、限频倒计时、320 宽的 composer）。
- M6 可以直接复用：`lib/submit.ts`（状态机与 opId）、`ActionDock`、`useKeyboardInset`、`lib/drafts.ts`、`ReceiptLine`、`EmptyState`、`strings.ts`。
- 真机复核（iOS Safari 键盘/刘海、Android Chrome）建议在 P1 验收时作为最后一道；Chromium e2e 已覆盖逻辑与几何。
