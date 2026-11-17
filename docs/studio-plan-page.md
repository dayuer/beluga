# Synon Studio 计划页、对话与待办屏（M6）

> 配套：`docs/studio-mobile-ux.md`（交互规则与 `UX-*` 可检查项；本文只补计划页专有的状态、版式与 `PP-*`/`PT-*` 条目，不重复通用规则）、`docs/studio-app-screens.md`（M5 四屏的版式与 token）、`docs/studio-protocol.md`（视图字段、动作白名单、回执码）。
>
> 范围：`packages/studio-app` 的计划页 `/plan/[id]`、对话、决策、验收、草稿差异，以及新的第二个根屏待办 `/todo`。中台和 `src/studio/protocol.ts` 本里程碑不改；客户端只渲染 `StudioPlanView` 里已有的字段。
>
> 一句话：客户在手机上看计划长出来，屏幕底部永远只有**一个属于当下阶段的动作**；对话、决策、退回原因和草稿差异都在底部抽屉里，抽屉打开时底部动作栏让位给抽屉自己的输入条。

## 0. 基准与不变量

- **尺寸**：390×844（iPhone 14/15）为基准，375×667 与 320×568 为窄屏下限，1440×900 为桌面；单位 `pt`，Web 上 1pt = 1 CSS px。断点 **900**。
- **Token**：全部来自 `packages/companion/lib/theme.ts`（`packages/studio-app/lib/theme.ts` 是同一份），不新增颜色、字号。`type`/`space`/`radius` 同 M5。
- **数据**：页面只用 `GET /v1/app/projects/:pid/plans/:ref` 的 `{view, updatedAt}`、WS 的 `plan` / `plan-gone` / `receipt` 帧，以及 `GET …/turns?before=`。视图字段：`stage`、`waitingOn`、`headline`、`progress`、`milestones[]`、`decisions[]`、`turns[]`、`typing`、`moreTurns`、`activity[]`、`review`、`draftDiff`、`gate`、`draftRev`。
- **四条不变量**：
  1. 同一时刻最多一个 `[data-testid="primary"]`，且它永远在底部 ActionDock 里；列表屏（待办）没有实底主按钮。
  2. 主按钮只由 §2 的阶段状态机决定，不由 `waitingOn` 或页面局部代码临时决定。
  3. 客户可见文字全部走 `lib/strings.ts`（中英各一条）；页面不出现 planRef、opId、任务 KEY、文件路径、模型名、服务端 error 原文（地址栏里的计划 id 是路由参数，不算可见内容）。
  4. 草稿、opId、失败重试沿用 `studio-mobile-ux.md` §6：不丢字、连点不产生第二条动作、失败保留、`queued`/`done` 后才删草稿。

## 1. 路由与入口

| 路由 | 用途 | 备注 |
|---|---|---|
| `/plan/[id]?project=<pid>` | 计划页；`[id]` 是 planRef | 任务已定 `app/plan/[id].tsx`；`project` 是 hub 接口需要的项目 id |
| `/todo` | 待办屏（第二个根） | 只在 M6 出现；底部两个 tab（§6） |

- **入口**：项目首页的每一行计划整行可点（`PlanRow` 加箭头与 `Pressable`），跳到 `/plan/<ref>?project=<pid>`；待办卡片的「回答」「还不行…」也带 `?open=decide|reason` 打开对应抽屉（§6）。
- **`project` 缺失**（用户手改链接）：先查本机记住的 `synon:plan-project:<ref>`；没有则显示空态「这个链接不完整」+「返回项目」。不遍历所有项目去猜。
- **返回**：`router.back()`；没有历史时回 `/project/<pid>`；无 `project` 时回 `/`。登录守卫同 M5（没有会话跳 `/login?next=…`）。
- **页面标题**：Header 中间是计划标题（`view.title`，来自缓存或列表时先用缓存标题），单行省略。
- **不新增的路由**：对话、决策、退回原因、草稿差异、节点详情都不是独立路由，都是抽屉/弹层；刷新页面回到计划页本身，抽屉不自动重开（`?open=` 只在首次进入时消费一次）。

## 2. 阶段状态机

### 2.1 唯一的阶段函数

`lib/plan-phase.ts` 导出纯函数 `pagePhase(view, local?)`，`local` 是动作回执带来的本机补丁（§2.4）。优先级自上而下，**先满足者胜**：

```ts
export type PagePhase =
  | 'decide' | 'review' | 'changes' | 'confirm'
  | 'awaiting-start' | 'awaiting-changes'
  | 'drafting-ai' | 'running' | 'done';

export function pagePhase(view: StudioPlanView, local?: LocalPlanState): PagePhase {
  const v = applyLocal(view, local);          // §2.4：只改视图的副本
  const open = v.decisions.filter((d) => d.open);
  if (open.length > 0) return 'decide';
  if (v.milestones.some((m) => m.status === 'review')) return 'review';
  const gatePending = v.gate?.state === 'pending';
  if (v.draftDiff && !(v.gate?.kind === 'changes' && gatePending)) return 'changes';
  if (v.stage === 'drafting' && v.milestones.length > 0 && !v.typing && v.gate?.state !== 'pending') return 'confirm';
  if (v.gate?.kind === 'start' && gatePending) return 'awaiting-start';
  if (v.gate?.kind === 'changes' && gatePending) return 'awaiting-changes';
  if (v.stage === 'drafting') return 'drafting-ai';
  if (v.stage === 'done') return 'done';
  return 'running';                            // 含 awaiting-review 但暂无 review 里程碑的竞态
}
```

- `awaiting-review` 阶段若没有任何 `milestone.status === 'review'`（daemon 正在切换），落到 `running`，页面不会出现「等你验收」却没有可验收对象。
- 不在 `view` 里的决策（运营方的、敏感词的、已关闭的）永远不会让页面进入 `decide`（§3）。

### 2.2 状态表

“主按钮”一列就是 ActionDock 里唯一那个实底按钮（`testID="primary"`）；没有主按钮的阶段，ActionDock 只留对话入口条（§4.7）。

| # | phase | 条件（按 2.1 顺序） | 主按钮 | 等谁 | 可见内容（Header/PlanHeader/页签之外） | 次要动作 |
|---|---|---|---|---|---|---|
| 1 | `decide` | 有 `decisions[].open` | 回答（{n}）→ 打开决策抽屉 | 你 | 照常显示图/大纲/动态；决策只在抽屉里展示，内容区不堆问题 | —（抽屉内一次一题） |
| 2 | `review` | 有 `milestone.status = 'review'` | 通过（10 秒撤销后发 `milestone.pass`） | 你 | 内容区顶部「验收卡」：里程碑标题、验收标准、`review.notes` | 还不行…（≥44，打开原因抽屉） |
| 3 | `changes` | `draftDiff` 存在，且不是 pending 的 `changes` gate | 应用改动（发 `draft.apply`） | 你 | 内容区顶部改动摘要行「计划有改动 +a ~c −d · 查看改动」；点它打开差异抽屉 | ••• → 放弃改动（二次确认） |
| 4 | `confirm` | `stage=drafting`，里程碑非空，不在 typing，gate 不是 pending | 确认计划（发 `plan.requestStart{draftRev}`） | 你 | 照常显示图/大纲/动态；`gate=declined` 时顶部显示「工作室没有批准：{reason}」卡 | — |
| 5 | `awaiting-start` | gate `start` + `pending` | 无 | 工作室 | 「等待工作室批准开工」卡（无按钮） | — |
| 6 | `awaiting-changes` | gate `changes` + `pending` | 无 | 工作室 | 「等待工作室批准改动」卡（无按钮） | — |
| 7 | `drafting-ai` | `stage=drafting` 且（typing 或还没有里程碑） | 无 | AI | 「AI 正在写计划…」+ 里程碑骨架（有旧版则显示旧版并置灰） | — |
| 8 | `running` | 其余（含 `running`、`awaiting-review` 无 review） | 无 | AI | 正常图/大纲/动态；PlanHeader 给出当前里程碑与进度 | — |
| 9 | `done` | `stage=done` | 无 | — | 「这个计划已完成」卡 + 可返回项目 | — |

- **等谁**与状态行的颜色沿用 M5：等客户 `color.warn`（琥珀），等工作室 `color.text2`，等 AI `color.ok`（绿），完成 `color.text3`。状态行永远在 PlanHeader 里，即使没有主按钮。
- **gate=declined**：`confirm` 阶段仍显示「确认计划」，原因卡只解释工作室为何退回；客户可以改需求（对话）后再确认。原因卡里的文字来自 `gate.reason`，已由 daemon 净化。
- **review 的 milestoneRef**：取 `milestones.find(m => m.status === 'review')` 的 `ref`；`draftRev` 取发送那一刻的 `view.draftRev`（stale 处理见 §4.11、§4.12）。

### 2.3 每个阶段的主按钮文案与动作

| phase | testID | 文案（zh / en） | 点按后 |
|---|---|---|---|
| decide | `primary` | 回答（{n}）/ Answer ({n}) | 打开决策抽屉（不直接发动作） |
| review | `primary` | 通过 / Approve | 进入 10 秒撤销；倒计时结束发 `milestone.pass` |
| changes | `primary` | 应用改动 / Apply changes | 发 `draft.apply{draftRev}` |
| confirm | `primary` | 确认计划 / Confirm plan | 发 `plan.requestStart{draftRev}` |
| 其余 | — | — | 不渲染 `primary` |

发送中：按钮禁用，文案「发送中…」，内联 16pt spinner（M5 §6.2、`UX-14`）。成功后主按钮立刻消失（§2.4 的本地态），不留在原地让客户怀疑是否点上。

### 2.4 本地态（动作回执到视图更新之间）

动作回执 `queued` 或 `done` 后、新的 `plan` 帧回来之前，页面按本机补丁显示，避免按钮在旧视图上再次可点。补丁只作用于**当时的 rev**：`usePlanView` 一旦收到 `rev > local.rev` 的帧就丢弃补丁，以 daemon 为准。

| 动作 | 补丁（`applyLocal`） | 界面立刻变成 |
|---|---|---|
| `plan.requestStart` 回执 queued/done | `gate = {kind:'start', state:'pending', draftRev: view.draftRev}` | `awaiting-start`：主按钮消失，状态行「在等工作室批准开工」 |
| `draft.apply` 回执 queued/done | `gate = {kind:'changes', state:'pending', draftRev: view.draftRev}` | `awaiting-changes`：主按钮消失，改动摘要行收起 |
| `milestone.pass` 发出（倒计时结束） | 该 review 里程碑 `status = 'passed'` | 验收卡变「已通过，等工作室继续」，无主按钮 |
| `milestone.sendBack` 回执 queued/done | 该 review 里程碑 `status = 'working'` | 状态行「已退回给工作室」，无主按钮 |
| `decision.answer` 回执 queued/done | 该 `decisionId` 的 `open = false` | 抽屉切到下一题；没有下一题就关闭，页面落到下一个阶段 |

- 补丁不改变服务端数据；刷新（••• → 刷新）或新帧到达后自然消失。
- 手动刷新时如果视图显示动作没有生效（例如 gate 不存在），补丁也一并清掉，页面回到真实状态并显示回执行，不假装成功。

### 2.5 状态行（PlanHeader 第二行）

| phase | 中文 | English |
|---|---|---|
| decide | 在等你：回答 {n} 个问题 | Waiting on you: answer {n} questions |
| review | 在等你：验收「{milestone}」 | Waiting on you: review “{milestone}” |
| changes | 在等你：查看计划改动 | Waiting on you: review the plan changes |
| confirm | 在等你：确认计划 | Waiting on you: confirm the plan |
| awaiting-start | 在等工作室批准开工 | Waiting for the studio to approve the start |
| awaiting-changes | 在等工作室批准改动 | Waiting for the studio to approve the changes |
| drafting-ai | AI 正在写计划 / AI 正在更新计划 | The AI is drafting the plan / updating the plan |
| running | AI 在做：{milestone}（{done} / {total}）；没有当前里程碑时用 `plan.aiWorkingGeneric` | The AI is working on: {milestone} ({done} of {total}); `plan.aiWorkingGeneric` when there is none |
| done | 已完成 | Done |
| 本地态（§2.4） | 已通过，等工作室继续 / 已退回给工作室 | Approved. Waiting for the studio. / Sent back to the studio. |

## 3. 哪些决策与任务不给客户

这一层**只在中台/daemon 过滤**，客户端不做第二套规则；页面只渲染 `view` 里已经存在的决策与里程碑。`src/studio/decisions.ts` 的规则：

1. **任务不是客户的**：`assignee !== 'me'` 的任务（agent 自己的任务）不产生决策；`assignee === 'me'` 且决策属于运营方时，整个任务从客户视图里隐藏（`hiddenFromCustomer`）。
2. **决策没标给客户**：`audience !== 'customer'` 的决策缺省算运营方的，客户看不到（`operatorOnly`）。
3. **哪怕标了 customer，碰到敏感词的仍归运营方**：`SENSITIVE` 会匹配问题与选项里的账号、密钥/密码/token、付款/银行卡/账单、证书、域名、商店后台、API key、console、payout、invoice 等词。误标也到不了客户面前。
4. **已关闭或未开放的决策**：`open: false` 的决策可能出现在视图里（历史），但页面只在 `decide` 阶段把 `open` 的决策算进「回答（n）」，抽屉里也只列 `open` 的；关闭的决策不显示、不可回答。
5. **运营方/工作室的任务**：里程碑 `tasks` 里 agent 的执行任务照常显示标题与状态（客户需要知道做到哪了），但任务的决策、命令、路径、校验输出不会进入客户视图（由 `sanitize.ts` 与视图白名单保证）。

页面上用一句只读说明表达边界（放在决策抽屉底部）：

- 中文：**涉及账号、密钥和付款的问题由工作室处理，不会问你。**
- English: **Questions about accounts, keys and payments stay with the studio.**

客户端审计口径：把假 daemon 的视图里塞进一个 `audience: 'customer'` 但含「密钥」的决策，页面和待办都不得出现；再塞一个已关闭决策，抽屉里也不得出现。

## 4. 390 手机版式

### 4.1 骨架（390×844，安全区 47/34 模拟）

```
y=0    ┌──────────────────────────────────┐
       │ Header 44 + safe-top 47          │  返回 / 计划标题 / •••
y=91   ├──────────────────────────────────┤
       │ PlanHeader（固定）                 │  headline、进度条、状态行、同步行
       ├──────────────────────────────────┤
       │ 页签 图 / 大纲 / 动态（各 44）      │  固定，不随内容滚动
y≈250  ├──────────────────────────────────┤
       │ 内容区（可滚动）                   │  当前页签的内容；底部留白 = dock + 16
       │                                  │
y≈676  ├──────────────────────────────────┤
       │ ActionDock                        │  对话入口条 44（+ 主按钮 52）
       │ padding-bottom 16 + safe-bottom 34 │
y=844  └──────────────────────────────────┘
```

- 从上到下**固定顺序**：Header → PlanHeader → 页签 → 内容 → ActionDock。抽屉/弹层只从底部或居中覆盖，不改变这个顺序。
- 内容区 `paddingBottom = dock 实际高度 + 16`（`UX-17`）；滚动到底时最后一项不被 dock 挡住。
- **滚动范围**：Header、PlanHeader、页签都固定；只有页签下的内容区滚动。状态行因此永远可见（M5 §9），滚动不会把「在等你」滚走。
- 只有 PlanHeader 里的状态行会随阶段变；页签与滚动位置在 `plan` 帧到达时**不重置**。

### 4.2 Header 与 PlanHeader

**Header**：沿用 `components/Header.tsx`。左边返回（44×44），中间计划标题（单行省略），右边「•••」（44×44，`accessibilityLabel`「更多」，testID `more`）。

- 「•••」打开一个底部动作表（不是抽屉，不遮主按钮太久）：每行 ≥44——「刷新」「放弃改动」（仅 `changes` 阶段，`color.error` 文字，二次确认）「关闭」。桌面是按钮下方 220 宽的小弹层。
- 计划页**不做下拉刷新**：实时帧 + 重连全量已经覆盖；手动刷新在 •••。触屏误触下拉会与图/大纲的滚动打架。

**PlanHeader**（`components/PlanHeader.tsx`，testID `plan-header`）：

1. **headline**：`type.heading`（16/600），最多 2 行；来自 `view.headline`（daemon 拼的固定句式，不含 agent 原文）。
2. **进度**：细进度条（高 4，`color.hairlineStrong` 底、`color.text` 填充）右侧 `done / total`。没有里程碑时不画进度条。
3. **状态行**：§2.5 的句子 + 7pt 状态圆点（颜色见 §2.2）。testID `plan-status`。
4. **同步行**：工作室离线时一行 `type.caption`「工作室离线 · 上次同步 {ago}」（`color.text3`，testID `studio-offline`）；客户自己断网时用顶部 `SyncBanner`（M5 §0.1），两者可以同时出现。
5. 不要放按钮、不要放下拉菜单。

### 4.3 页签

- 三个等宽页签「图 / 大纲 / 动态」（`Map / Outline / Activity`），每个高 44，整格可点；testID `tab-map` / `tab-outline` / `tab-activity`，`accessibilityRole="tab"` + `accessibilityState={{selected}}`。
- 选中：`color.text` 文字（600）+ 底部 2pt `color.text` 指示线；未选中 `color.text2`。不用实底、不用彩色。
- 页签下沿 1px `color.hairline`，与内容分隔。
- 默认页签：**图**。用户切换后记住在本机会话里（不跨刷新）不必须。
- 页签满 44 高，放在拇指区之上也可以点，但不作为主操作；主要动作永远在 dock。

### 4.4 图（手机上怎么看）

`components/plan/PlanMap.tsx` 用共用 `MilestoneMap`（BLG-90），数据来自 `lib/plan-graph.ts` 的 `mapItems(view)`。

**形状**：横向滚动的一条节点链，每个里程碑一张节点卡，卡间用箭头 `→` 连接（studio-app 不传 `dependsOn`，所以是一条链）。节点卡内容：

- 左上序号圈（1、2、3…），右上状态词（待开始 / 等待中 / 进行中 / 检查中 / 待验收 / 已完成）。
- 里程碑标题（最多 2 行）。
- `done / total` 项任务 + 细进度条。
- tone：planned/waiting `plain`，working `sky`，checking `lavender`，review `butter`，passed `mint`（tone 的 fill/ink 来自 `PlanUiTheme`，颜色只用于含义）。
- 当前里程碑（working/checking/review 中第一个）卡片边框 `hairlineStrong`，对应 `MapItem.emphasized`；其余 `hairline`。

**尺寸与缩放**：

- 基准卡宽 236，间距 12（含箭头），高度自适应；一屏约看到 1.5 张，暗示可以横向滑。
- 右上角两个 44×44 按钮：`−`（testID `zoom-out`）与 `+`（`zoom-in`），三档 **0.8 / 1 / 1.25**。缩放只改节点卡宽度与间距（189 / 236 / 295），**字号不变**，避免 0.8 档文字小到看不清；共用组件的 `scale` prop 就按这个口径实现。
- 档位存在 `synon:plan-zoom`；到 0.8 时 `−` 禁用、到 1.25 时 `+` 禁用。
- 不用手势库、不做双指缩放、不拦浏览器自带的捏合缩放（viewport meta 保持 M5 §3 的写法）。
- 横向滚动容器 `overflow-x: auto`、`overscroll-behavior-x: contain`，只在图区域内生效；纵向滚动仍归页面。

**点节点看详情**：

- 点节点卡（整卡 ≥44，`accessibilityLabel`「里程碑 {i}：{title}，{status}」）打开**节点详情底部 sheet**（`MilestoneSheet`，testID `milestone-sheet`）：
  - 标题、状态词、目标（`goal`）、验收标准（`criteria` 列表）、任务列表（标题 + 状态词，`acceptance` 可折叠）。
  - 高 44 关闭按钮；内容自己滚动，上限 **60% ×（可视高度 − dock 高度）**。
  - **sheet 的底边停在 ActionDock 上方 8pt**：不盖住主按钮，`primary` 始终可点可量（`PP-08`）。没有 scrim，点内容区空白处或关闭按钮收起。
  - 打开 sheet 不改变当前页签、不改变缩放、不移动横向滚动位置。
- 没有里程碑（`drafting-ai` 且还没写出来）：内容区放 3 个静态骨架节点卡 + 一行「AI 正在写计划…」；不显示缩放按钮。

### 4.5 大纲

`components/plan/PlanOutline.tsx` 用共用 `Outline`（BLG-90），数据来自 `outlineOf(view)`。

- 竖时间线：左侧 24pt 列（序号圈 + 连接竖线），右侧里程碑标题、`done/total`、状态词、标准列表、任务行。
- 同时只展开一个里程碑：默认展开「当前」里程碑（review > checking > working > 第一个未 passed > 第一项）；点行切换，打开另一个时前一个收起。展开/收起有 120ms 淡入（`prefers-reduced-motion` 下取消）。
- 任务行只读（studio-app 不传 `onTaskPress`）；任务行显示标题与状态词，不显示 KEY。
- 大纲的状态词、tone 与图完全一致（同一个映射函数，`lib/plan-graph.ts`）。
- 空态：没有里程碑时「AI 正在写计划…」+ 骨架。

### 4.6 动态

`components/ActivityList.tsx`：

- 最多 30 条，**最新在上**；每行左侧 `ago(at)`（`type.caption`，`color.text3`），右侧一句话（`type.callout`，`color.text`），最多 3 行。
- 行不可点，不带图标颜色含义；新条目从顶部出现，不自动滚动、不抢焦点。
- 空态：「还没有动态」/“Nothing yet”，说明「工作室有进展时会出现在这里」。
- 动态文字由 daemon 净化；页面不额外拼服务端错误。

### 4.7 ActionDock

沿用 `components/ActionDock.tsx`（fixed bottom，`bottom = keyboardInset`），内容：

1. **对话入口条**（始终有，testID `chat-open`）：外形与聊天输入框一致（高 44、圆角 12、`color.card`、1px `hairline`、占位「说点什么…」），左侧可有一个 16pt 对话图标；右侧未读点（8pt `color.info`，testID `chat-unread`）。点它打开对话抽屉（§4.9）。它不是输入框：点了不弹键盘，先开抽屉。
2. **主按钮**（仅 §2.2 有主按钮的阶段）：高 52、占满内容列、`color.primary` 实底。
3. **review 阶段的次要按钮**：与主按钮同一行，左侧「还不行…」（`TextButton` 风格、高 52、最小宽 96、`color.text2`），右侧「通过」占满剩余宽度；两者间距 12。打开原因抽屉，不直接发动作。
4. 发送中/撤销中：主按钮禁用或显示「已通过 · 撤销（10s）」，ReceiptLine 在主按钮上方 8pt（M5 §6.3）。
5. **没有主按钮的阶段**：dock 只渲染对话入口条；高度自然变矮，内容区底部留白跟着变。
6. **抽屉打开时整个 ActionDock 不渲染**（不是隐藏、不半透明、不占位），抽屉自己的输入条/动作条占据底部拇指区（`UX-31`）。

### 4.8 底部抽屉（通用）

`components/Drawer.tsx`，决策、退回原因、草稿差异、对话共用：

- **吸附点**：默认 **55%**，展开 **80%**；以可视高度 `innerHeight − useKeyboardInset()` 计算，高度变化时重算。
- **把手**：顶部 28pt 区域（命中区 ≥44），中间 36×4 圆角条。只有把手响应 `PanResponder` 拖动，内容区的原生滚动不受影响。
  - 上滑过 55% 与 80% 的中点 → 吸到 80%；下滑低于可视高度 40% → 关闭；其余回弹到较近的档位。动画 160ms `ease-out`；`prefers-reduced-motion: reduce` 时不位移，直接切换高度。
  - 点把手：55% ↔ 80% 切换（键盘上也一样）。
- **关闭**：右上角 44×44 关闭按钮（`accessibilityLabel`「关闭」），`Escape` 也关闭；底部有 scrim（`color.scrim`，轻），点 scrim 关闭。关闭不丢草稿、不丢未发送气泡；焦点回到打开它的元素。
- **键盘**：抽屉底边 `bottom = inset`，高度按可视高度重算；输入条贴着抽屉底部（与键盘上沿之间只留 8pt 内边距）。键盘弹起时不再叠加底部安全区（M5 §5.1）。
- **桌面**：`variant="modal"` 时变成主列内居中的弹层（宽 480，最大高 80%），不是底部抽屉；对话在桌面不用抽屉（§5）。
- **语义**：`role="dialog"`、`aria-modal="true"`；打开时焦点进入抽屉标题（不自动聚焦输入框），关闭后回到触发按钮。

### 4.9 对话抽屉（手机）

`components/PlanChat.tsx`（BLG-92）在抽屉里：

- 顶部一行「对话」+ 关闭；下面是消息列表（最新在底部），最下面是输入条（44 起、最多 5 行、上限 4000）。
- **发送**：点发送立刻清空输入并插入自己的气泡（右下「发送中…」），`queued` 后「已排队」，失败「没发出去 · 重试」（≥44，同 opId 重发）。发送按钮在发送中**不禁用**，可以接着发下一条；同一条气泡连点只产生一个 opId。
- **服务端替换**：`plan` 帧里出现同 `opId` 的 `StudioTurn` 时替换本地气泡，不出现两条（`UX-29`）。
- **显示名**：`who=customer` 自己的气泡在右，不显示名字；`who=studio` 左气泡「{name} · Studio」；`who=ai` 左气泡用 `roleNames[role] ?? role ?? roleNames.default ?? 'AI'`（`lib/roles.ts` 的 P1 默认只有 `default: 'AI'`）。
- **typing**：`view.typing` 时在最后一条下面「AI 正在写…」，不遮挡输入条、不自动滚动。
- **滚动**：用户停在底部时新消息自动跟随；用户往上翻过时不抢滚动，显示「新消息 ↓」pill（≥44），点它回到底部。
- **更早**：`moreTurns` 时列表顶部「更早的消息」，调 `hub.turns(pid, ref, beforeOldest)` 合并，保持当前滚动位置。
- **未读**：`synon:seen:chat:<pid>:<ref>` 存上次看到的时间；比它新的、非客户消息算未读。抽屉关闭时未读数显示在 `chat-open` 的圆点上；打开抽屉即更新 seen。新消息到达不抢焦点（客户正在输入就一直写）。
- **草稿**：`synon:draft:chat:<pid>:<ref>`，300ms 防抖；`queued`/`done` 后删。
- **离线**：工作室离线时在 `queued` 气泡下加一句「工作室暂时离线，上线后 AI 会回复」；不是错误。

### 4.10 决策抽屉

`components/DecisionCard.tsx`（BLG-93）一次一题：

- 顶部「第 {i} / {n} 个」+ 关闭；问题是 `view.decisions` 里的 `question`，选项是整行（高 ≥56、圆角 12、1px `hairline`，选中 1.5px `color.text` + `tint.ok` 勾）。
- 单选：点整行即进入 10 秒撤销（按钮「已提交 · 撤销（10s）」），撤销前不发动作；单选且只用自由文字时，点「提交回答」进入撤销。多选：点行勾选，点「提交回答」再进入撤销。自由文字输入框（1–3 行，上限 2000）可与选项同时用；`picks` 和 `text` 至少有一个才能提交。
- 倒计时结束发 `decision.answer{decisionId, picks?, text?}`；离开页面（`pagehide` 或卸载）视为确认并立刻发。撤销则回可选状态，选择保留。草稿 key `synon:draft:decision:<pid>:<ref>:<decisionId>`。
- 回执 `queued`/`done`：显示「已记下」；有下一题就切到下一题（计数减一），没有就关抽屉，页面落到下一个阶段。失败：选择与文字保留，按钮「重试」，同 opId。`stale`/`not-open`：显示回执句，刷新视图，草稿保留。
- 底部一句边界说明（§3）；已关闭的决策不出现。

### 4.11 验收（review 阶段）

- 内容区顶部 `AcceptCard`（`components/AcceptCard.tsx`，testID `accept-card`）：里程碑标题、标准列表、`review.notes`（运营方的验收说明，已净化；仅当 `review.milestoneRef` 等于当前 review 里程碑时显示）。
- dock 的「通过」进 10 秒撤销；撤销前不发 `milestone.pass`。撤销期间次要按钮「还不行…」隐藏，避免两个动作并存；撤销结束或发送后显示 ReceiptLine「已通过，等工作室继续」。
- 「还不行…」打开原因抽屉（`ReasonSheet`）：标题「哪里还不行？」，三个快捷标签「和我说的不一样 / 有错误 / 缺东西」（点一下追加到输入框，可编辑），多行输入 96 起、上限 4000，低于 10 字禁用主按钮并提示「再多写一点（至少 10 个字）」。草稿 key `synon:draft:sendback:<pid>:<ref>:<milestoneRef>`。发送「退回给工作室」→ `milestone.sendBack{milestoneRef, draftRev, reason}`。
- 回执 `queued`/`done` 关闭抽屉，状态行「已退回给工作室」；失败保留原因，同 opId；`stale` 显示回执句并刷新。

### 4.12 草稿差异（changes 阶段）

- 内容区顶部摘要行：「计划有改动 · 新增 {a} 修改 {c} 移除 {r} · 查看改动」，点它打开差异抽屉（`components/DraftDiff.tsx`）。
- 抽屉分三组：新增「+」`color.ok`；修改「~」`color.warn`，展开显示 `before → after`；移除「−」`color.error` + 删除线。每条标「里程碑 / 任务」，任务行带 under（所属里程碑）。
- **应用改动**：dock 的主按钮直接发 `draft.apply{draftRev}`（不先开抽屉）；抽屉打开时，同一动作在抽屉底部（此时 dock 不渲染，仍然只有一个实底按钮）。
- **放弃改动**：只在 ••• 里，二次确认「放弃这次改动？」→ `draft.discard{draftRev}`。不做主按钮。
- `stale` 回执：不报错，自动 `refresh()`，显示「改动已更新，请重新查看」，主按钮可再点（新 opId）。应用成功后摘要行与抽屉一起收起（§2.4 本地态），直到新视图带回 changes gate。

## 5. 桌面适配（≥900）

```
┌ 标题栏 56（返回 / 标题 / •••）────────────────────────────────────┐
├──────────────────────────────┬───────────────────────────────────┤
│ 主列（≤720，居中于剩余宽度）   │ 对话面板 360，贴右，满高           │
│ PlanHeader / 页签 / 内容      │ 顶部「对话」44                     │
│                              │ 消息列表（滚动）                    │
│                              │ 输入条（贴面板底）                  │
├──────────────────────────────┤                                   │
│ ActionDock：内容列宽内主按钮   │                                   │
└──────────────────────────────┴───────────────────────────────────┘
```

- 标题栏沿用 M5 桌面版：56 高、实色、标题左对齐紧跟返回；••• 仍在右侧。
- **主列**：宽 `min(720, 可用宽度 − 48)`，在**去掉 360 对话面板后的剩余宽度**里水平居中；内容最小 360。断点 900 以下用手机版式。
- **对话面板**：固定 360，贴在标题栏下方、满高到视口底；有自己的 44 高「对话」标题行与 1px hairline 左边框；没有 `chat-open` 入口条（dock 里不渲染）。面板不因页面滚动而移动；输入条贴在面板底部（含 `env(safe-area-inset-bottom)`）。
- **ActionDock**：跟着主列宽（不是整屏宽），按钮不拉过 720；对话面板不盖 dock。
- **抽屉变弹层**：决策、退回原因、草稿差异在桌面是主列内居中的弹层（宽 480、最大高 80%、scrim 只盖主列，不挡右侧对话），不是底部抽屉。**验收卡仍内联在主列**：设计里“验收用居中弹层”指「还不行…」的理由弹层；「通过」本身是 dock 主按钮，不再多套一层确认。
- **节点详情**：桌面用主列内居中的弹层（宽 480），底边留出 dock 高度 + 16，主按钮仍在可视区（`PP-08`）。
- **焦点**：桌面键盘 Tab 顺序 = 返回 → ••• → 页签 → 内容里的可点项 → 对话输入条 → 主按钮；焦点环 2px `color.info`。弹层打开时焦点圈在弹层内，`Escape` 关闭并回原位。
- **待办**：桌面没有底部栏；两个根用标题栏下方的一行 44 高分段控件「项目 / 待办」切换（见 §6.1），主按钮仍然只在各自屏的 ActionDock。

## 6. 待办屏 `/todo`

### 6.1 导航与入口

- **底部栏** `components/TabBar.tsx`：两个 tab「项目 / 待办」，高 56 + `env(safe-area-inset-bottom)`，只在 `/` 与 `/todo` 两个根屏显示；图标 + 文字，选中 `color.text`，未选中 `color.text2`；每个 tab 命中区 ≥44。
- 待办 tab 上显示未完成待办数（>99 显示 `99+`，testID `tab-todo-count`）；数量为 0 时不显示数字。
- 根屏有底部栏时的布局：`TabBar` 固定在底部（高 56 + safe-bottom）；`/` 的 ActionDock 坐在 TabBar 上方（`bottom = 56 + safe-bottom`，自身 `padding-bottom` 降为 16，不再叠加安全区），内容区底部留白 = TabBar + dock + 16；`/todo` 没有 ActionDock，内容底部留白 = TabBar + 16。
- **桌面**：分段控件放在标题栏下方、内容列顶部（44 高），不渲染底部栏；其余同 §5。
- **项目卡片圆点**：项目首页的项目卡在「该项目有待办」时显示 8pt `color.info` 圆点（testID `project-dot`）。圆点与待办屏使用**同一份汇总结果**（§6.3），不用 `waitingOn === 'customer'` 近似——`running` 阶段带草稿改动时 `waitingOn` 是 `ai`，近似会漏。汇总还在加载时先不显示圆点（宁可晚 1 秒，不出现假点）。
- **待办 tab 的数字**与项目圆点同源：一处汇总，两处显示。

### 6.2 汇总规则 `todosOf(pid, view)`

`lib/todo.ts` 的纯函数，返回 `Todo[]`；它和 `pagePhase` 用同一套优先级，**一个计划只会产生一种卡片**（决策除外）：

```ts
type TodoKind = 'decision' | 'review' | 'changes' | 'confirm';
interface Todo {
  kind: TodoKind;
  pid: string;
  planRef: string;
  title: string;   // 计划标题
  sub: string;     // 题面/里程碑/改动摘要，最多 2 行
  key: string;     // 稳定 key：kind + planRef + decisionId|milestoneRef
}
```

| kind | 条件 | 每个计划产生几条 | title / sub | 卡片动作 |
|---|---|---|---|---|
| `decision` | `pagePhase = decide` | 每条 `open` 决策一条 | 计划标题 / 「第 {i} / {n} 个 · {question}」 | 回答 → `/plan/<ref>?project=<pid>&open=decide` |
| `review` | `pagePhase = review` | 1 | 计划标题 / 「里程碑「{title}」等你验收」 | 通过（10 秒撤销后 `milestone.pass`）/ 还不行… → `?open=reason` |
| `changes` | `pagePhase = changes` | 1 | 计划标题 / 「计划有改动：+{a} ~{c} −{r}」 | 应用（`draft.apply`）/ 放弃（二次确认后 `draft.discard`） |
| `confirm` | `pagePhase = confirm` | 1 | 计划标题 / 「计划已拟好，等你确认」 | 确认计划（`plan.requestStart`） |

- **不产生待办**：`awaiting-start`、`awaiting-changes`（等工作室）、`drafting-ai`、`running`、`done`；已关闭的决策；没有 open 决策的 `decide` 不会出现（`pagePhase` 已经保证）。
- **优先级**：与 §2.1 完全一致。一个计划同时有 open 决策和 review 里程碑时，只出决策卡（主按钮也是「回答」），不会让客户在两个「主操作」之间选。
- **排序**：先按计划的 `updatedAt` 倒序（来自 `plans` 列表响应），同一计划内按 kind 顺序 `decision → review → changes → confirm`、决策按 `view.decisions` 顺序。项目名作为每张卡上方的 `type.caption`，项目之间不分组、不折叠（最多 30 个计划）。
- **动作所需数据**：`draftRev`、`milestoneRef`、`decisionId` 由加载器随条目保存（不渲染到卡片上）；卡片动作走与计划页相同的 `useSend`，因此 opId、重试、回执合并、stale 处理都一致。

### 6.3 加载器

`lib/todo-store.ts` 的 `useTodos()`（`/` 与 `/todo` 共用，内存缓存 60 秒，一处请求）：

1. `hub.projects()` → 对每个项目 `hub.plans(pid)`（M5 已有）。
2. 汇总所有 `stage !== 'done'` 的计划，最多 **30 个**；逐个 `hub.plan(pid, ref)` 取 view，**并发 4**。
3. 对每个 view 调 `todosOf(pid, view)`；失败的单个计划跳过（不拖垮整屏），并在返回里记 `failed` 数量。
4. 返回 `{todos, byProject, loading, fetchedAt, failed}`；按 §6.2 排序。
5. 刷新时机：进入 `/` 或 `/todo`、收到 `live.ts` 的 `plan` 帧（只重取对应 plan 的 view，节流 500ms）、下拉刷新/••• 刷新。离线时返回上次结果并带 `fetchedAt`，界面用 `SyncBanner`。

### 6.4 待办卡片

- 卡片 = M5 `Card`（白底、hairline、`radius.l`、padding 16）：项目名（caption，text3）→ 计划标题（heading，2 行）→ sub（callout，text2，2 行）→ 底部动作行。卡片 testID `todo-card`；动作按钮 testID `todo-answer` / `todo-approve` / `todo-not-yet` / `todo-apply` / `todo-discard` / `todo-confirm`。
- **动作行**：所有动作都是 ≥44 的**描边/浅底按钮**（`TextButton` 风格），不用 `color.primary` 实底——一屏多张卡时不能有多个主按钮（`UX-02`）。每张卡的主动作文字用 `color.text`（600），次动作用 `color.text2`。
- review 卡：「通过」进入 10 秒撤销（按钮变「已通过 · 撤销（10s）」），「还不行…」跳计划页并打开原因抽屉。撤销期间次按钮隐藏。
- changes 卡：「应用」直接发 `draft.apply`；「放弃」二次确认后 `draft.discard`。
- confirm 卡：「确认计划」直接发 `plan.requestStart`，随后卡片变「等工作室批准」并淡出。
- decision 卡：整卡可点（≥44），也可点「回答」，跳计划页并打开决策抽屉。
- **回执后**：任一回执 `queued` 或 `done` 后，本地按 opId 隐藏该条目（不闪烁、不重新出现）；新 view 到达后条目自然消失。`stale`：刷新相关 view，卡片保留并显示「改动已更新，请重新查看」，可再点（新 opId）。失败：卡片保留，显示回执句与「重试」。
- 空态：「现在没有要你处理的事」+「工作室有进展时会出现在这里」；加载：3 张卡片骨架；出错：整页「加载失败」+「重试」（≥44）；离线：缓存列表 + `SyncBanner`。

## 7. 文案（中文默认，English 同步）

> 产品名一律 **Synon Studio**；客户可见处不出现 daemon、hub、opId、planRef、任务 KEY、文件路径、模型名、代码块。下表是新增 key 的建议名与文案，实施时进 `lib/strings.ts`（中英必须成对）。

| key | 中文 | English |
|---|---|---|
| `plan.tabMap` | 图 | Plan map |
| `plan.tabOutline` | 大纲 | Outline |
| `plan.tabActivity` | 动态 | Activity |
| `plan.waitConfirm` | 在等你：确认计划 | Waiting on you: confirm the plan |
| `plan.waitAnswer` | 在等你：回答 {n} 个问题 | Waiting on you: answer {n} questions |
| `plan.waitReview` | 在等你：验收「{m}」 | Waiting on you: review “{m}” |
| `plan.waitChanges` | 在等你：查看计划改动 | Waiting on you: review the plan changes |
| `plan.waitStudioStart` | 在等工作室批准开工 | Waiting for the studio to approve the start |
| `plan.waitStudioChanges` | 在等工作室批准改动 | Waiting for the studio to approve the changes |
| `plan.aiDrafting` | AI 正在写计划 | The AI is drafting the plan |
| `plan.aiUpdating` | AI 正在更新计划 | The AI is updating the plan |
| `plan.aiWorking` | AI 在做：{m}（{d} / {t}） | The AI is working on: {m} ({d} of {t}) |
| `plan.aiWorkingGeneric` | AI 在做 | The AI is working |
| `plan.done` | 已完成 | Done |
| `plan.confirm` | 确认计划 | Confirm plan |
| `plan.answer` | 回答（{n}） | Answer ({n}) |
| `plan.approve` | 通过 | Approve |
| `plan.approved` | 已通过，等工作室继续 | Approved. Waiting for the studio. |
| `plan.notYet` | 还不行… | Not yet… |
| `plan.apply` | 应用改动 | Apply changes |
| `plan.discard` | 放弃改动 | Discard changes |
| `plan.discardAsk` | 放弃这次改动？ | Discard these changes? |
| `plan.changesSummary` | 计划有改动 · 新增 {a} 修改 {c} 移除 {r} · 查看改动 | The plan changed · {a} added, {c} changed, {r} removed · View changes |
| `plan.changesUpdated` | 改动已更新，请重新查看 | The changes have been updated. Take another look. |
| `plan.waitingApproveStart` | 等待工作室批准开工 | Waiting for the studio to approve the start |
| `plan.waitingApproveChanges` | 等待工作室批准改动 | Waiting for the studio to approve the changes |
| `plan.declined` | 工作室没有批准：{reason} | The studio didn't approve: {reason} |
| `plan.doneCard` | 这个计划已完成 | This plan is done |
| `plan.backToProject` | 返回项目 | Back to project |
| `plan.empty` | 这个计划不存在或已被删除 | This plan doesn't exist or was removed |
| `plan.linkIncomplete` | 这个链接不完整 | This link is incomplete |
| `plan.needsRefresh` | 页面需要更新，请刷新 | This page needs an update. Refresh it |
| `plan.more` | 更多 | More |
| `plan.zoomOut` | 缩小 | Zoom out |
| `plan.zoomIn` | 放大 | Zoom in |
| `plan.node` | 里程碑 {i}：{title}，{status} | Milestone {i}: {title}, {status} |
| `plan.nodeSheet` | 里程碑详情 | Milestone details |
| `plan.goal` | 目标 | Goal |
| `plan.criteria` | 验收标准 | Acceptance criteria |
| `plan.tasks` | 任务 | Tasks |
| `plan.status` | 状态 | Status |
| `plan.close` | 关闭 | Close |
| `plan.noMilestones` | AI 正在写计划… | The AI is drafting the plan… |
| `plan.activityEmpty` | 还没有动态 | Nothing yet |
| `plan.activityEmptyBody` | 工作室有进展时会出现在这里 | It'll show up here when your studio makes progress |
| `status.planned` | 待开始 | Not started |
| `status.waiting` | 等待中 | Waiting |
| `status.working` | 进行中 | In progress |
| `status.checking` | 检查中 | Checking |
| `status.review` | 待验收 | Needs review |
| `status.passed` | 已完成 | Done |
| `plan.privateNote` | 涉及账号、密钥和付款的问题由工作室处理，不会问你。 | Questions about accounts, keys and payments stay with the studio. |
| `chat.title` | 对话 | Chat |
| `chat.saySomething` | 说点什么… | Say something… |
| `chat.earlier` | 更早的消息 | Earlier messages |
| `chat.newMessages` | 新消息 ↓ | New messages ↓ |
| `chat.aiWriting` | AI 正在写… | The AI is writing… |
| `chat.queued` | 已排队 | Queued |
| `chat.failed` | 没发出去 · 重试 | Not sent · Retry |
| `chat.studioOffline` | 工作室暂时离线，上线后 AI 会回复 | The studio is offline. The AI will reply when it's back. |
| `chat.studioName` | {name} · Studio | {name} · Studio |
| `decision.count` | 第 {i} / {n} 个 | {i} of {n} |
| `decision.multi` | 可多选 | Select all that apply |
| `decision.submit` | 提交回答 | Submit answer |
| `decision.undo` | 已提交 · 撤销（10s） | Submitted · Undo (10s) |
| `decision.noted` | 已记下 | Noted |
| `decision.noMore` | 没有更多问题了 | No more questions |
| `review.title` | 这个里程碑可以吗？ | Is this milestone good? |
| `review.notes` | 验收说明 | Review notes |
| `review.undo` | 已通过 · 撤销（10s） | Approved · Undo (10s) |
| `reason.title` | 哪里还不行？ | What's not right? |
| `reason.tag1` | 和我说的不一样 | Not what I asked |
| `reason.tag2` | 有错误 | Something's broken |
| `reason.tag3` | 缺东西 | Something's missing |
| `reason.placeholder` | 具体说说哪里不对，至少 10 个字。 | Tell us what's wrong — at least 10 characters. |
| `reason.tooShort` | 再多写一点（至少 10 个字） | A little more, please (at least 10 characters) |
| `reason.send` | 退回给工作室 | Send back to the studio |
| `reason.sent` | 已退回给工作室 | Sent back to the studio |
| `reason.queued` | 已退回，工作室上线后处理 | Sent back. The studio will pick it up when it's back online. |
| `diff.added` | 新增 | Added |
| `diff.changed` | 修改 | Changed |
| `diff.removed` | 移除 | Removed |
| `diff.milestone` | 里程碑 | Milestone |
| `diff.task` | 任务 | Task |
| `todo.title` | 待办 | To-dos |
| `todo.projects` | 项目 | Projects |
| `todo.tab` | 待办 | To-dos |
| `todo.empty` | 现在没有要你处理的事 | Nothing for you right now |
| `todo.emptyBody` | 工作室有进展时会出现在这里 | It'll show up here when your studio needs you |
| `todo.answer` | 回答 | Answer |
| `todo.confirm` | 确认计划 | Confirm plan |
| `todo.apply` | 应用 | Apply |
| `todo.discard` | 放弃 | Discard |
| `todo.decision` | 决策 | Decision |
| `todo.review` | 验收 | Review |
| `todo.changes` | 改动 | Changes |

## 8. 可检查项

> 量法同 `studio-mobile-ux.md` §12：Playwright `boundingBox()`、DOM 文本断言、源码 grep；默认夹具 `phone` 390×844（无键盘），`desktop` 1440×900，键盘态用 390×500 视口代理，安全区用 `--safe-top:47px; --safe-bottom:34px` 模拟。

### 8.1 计划页 `PP-*`

| ID | 规则 | 怎么量 |
|---|---|---|
| PP-01 | 项目首页计划行整行可点，进入 `/plan/<ref>?project=<pid>`；刷新后页面还在，返回回到项目首页 | 点整行断言 URL；`page.reload()` 后标题仍在；点返回回到 `/project/<pid>` |
| PP-02 | 每个阶段与 §2.2 一致，且同屏最多一个 `primary`；轮到工作室或 AI 时没有 `primary` | 用 `e2e/fixtures/views.ts` 的每个 phase 夹具逐个断言文案与 `[data-testid="primary"]` 数量（0 或 1）；`pagePhase` 单测覆盖优先级 |
| PP-03 | PlanHeader 始终说明在等谁（你/工作室/AI），且与阶段一致；没有主按钮也有状态行 | 断言 `plan-status` 文本；`waitingOn=studio/ai` 的夹具下 `primary` 数量为 0 |
| PP-04 | 390×844 静止态，`primary` 的 top ≥422、bottom ≤810（844−34），滚动内容不移动它 | 每个有主按钮的阶段滚动到内容顶部/底部各量一次 `primary` 的 box；滚动前后坐标差 ≤1 |
| PP-05 | 键盘态（390×500）抽屉里的输入框底边距视口底 ≤1px；ActionDock 的 `primary` 不渲染 | 打开对话/原因/决策文字输入，注入 `visualViewport` 高度 500；量 `chat-input`/`reason-input` 的 `bottom`；`primary` 不在 DOM |
| PP-06 | 抽屉默认 55%、最大 80%，两档；把手可上滑/下滑，点把手切换；关闭按钮 44 | 无键盘 844 下量抽屉高度 456–473；点把手后 ≤675；下滑后关闭；`drawer-close` 44×44 |
| PP-07 | 桌面对话停靠在右侧：宽 360、贴右、满高（标题栏下）；主列 ≤720；没有 `chat-open` | 1440×900 下量对话面板 box（宽 360±1、right=1440、top=56、bottom=900）与主列宽 ≤720；`chat-open` 数量为 0 |
| PP-08 | 手机上节点 sheet 不挡主按钮：sheet 底边 ≤ dock top −8，`primary` 可见可点 | 点第一个节点，量 `milestone-sheet` 与 `dock` 的 box；断言不相交、`primary` 在视口内且 `enabled` |
| PP-09 | 图可缩放三档 0.8/1/1.25，按钮各 44，到底禁用；点节点打开详情 | 点 `zoom-out`/`zoom-in` 量节点卡宽度 189/236/295；到极限时按钮 `disabled`；点节点出 `milestone-sheet` |
| PP-10 | 大纲时间线（序号、标题、n/total、状态词、标准、任务）；同时只展开一个；状态词与图一致 | 截图 + 文本断言；比较图节点与大纲行的状态词 |
| PP-11 | 实时与离线：daemon 推 `plan` 帧后 ≤2 秒页面更新；断网保留最后一版并显示「你已离线 · 上次同步 x 分钟前」；重连后 GET 全量；`plan-gone` 显示空态 | fake daemon `POST /daemon/view` 推新 view，断言 headline/图在 2s 内变；`setOffline(true)` 后仍可读并出现 `SyncBanner`；恢复后断言发生一次全量 GET；`plan-gone` 断言空态与「返回项目」 |
| PP-12 | 不泄露：可见文本、aria-label 与页面标题里 grep 不到 planRef、opId、任务 KEY、文件路径、模型名、代码块；服务端 error 原文不上屏 | 对每个阶段、图节点 sheet、大纲、动态、对话、决策、验收 notes、gate reason、草稿差异逐屏 `innerText` + `aria-label` 抽查：不含 `/Users/`、`/home/`、`/src/`、`/packages/` 这类绝对路径前缀，不含 `.ts`/`.tsx`/`.env` 等源码扩展名，不含 `C:\`，不含形如 `BLG-123` 的任务 KEY，不含 `sk-`/`KEY-` 凭证，不含 `planRef`/`opId` 字样与代码围栏；`第 2 / 4 个` 这类正常斜杠不算。URL 与 `data-testid` 不算可见内容 |

### 8.2 待办屏 `PT-*`

| ID | 规则 | 怎么量 |
|---|---|---|
| PT-01 | 汇总与 §6.2 一致：一个计划只出一种卡（决策除外）；done/awaiting/running/drafting 不出卡；每个 open 决策一张 | `todosOf` 单测覆盖每个 phase 与优先级；待办屏卡片数与夹具一致 |
| PT-02 | 有待办的项目卡片出现圆点，数量与待办屏一致；加载中不出假点 | 对照项目首页 `project-dot` 与待办 tab 数字；断网/请求失败时圆点不凭空出现 |
| PT-03 | 卡片动作发出白名单动作；连点只一条；回执后条目消失 | fake daemon 日志断言动作条数与 opId 唯一；操作后 1 秒内卡片消失 |
| PT-04 | 390 宽下卡片按钮 ≥44、无实底主按钮；底部栏 56 + 安全区，只在 `/` 与 `/todo`；桌面用分段控件 | 遍历 `todo-card` 内按钮的 box；`primary` 数量为 0；在 `/project/:id` 断言无 `TabBar`；1440 下断言无底部栏、有分段控件 |
| PT-05 | 离线显示缓存待办 + `SyncBanner`；单个计划取 view 失败不拖垮整屏 | `setOffline(true)` 重进 `/todo`；让一个计划 GET 失败，断言其余卡片仍在 |

## 9. 偏离与决定

1. **路由 `/plan/[id]?project=<pid>`**：`studio-mobile-ux.md` §1.3 写的是 `/project/:id/plan/:ref`。任务已把文件定为 `app/plan/[id].tsx`，且计划页要从待办卡、聊天入口外部直达；展平一层后不需要为计划页再建嵌套 layout，`project` 留在 query 里供 hub 接口使用。以本文为准，`studio-mobile-ux.md` 不改（它只给行为规则，路由以本文为实施口径）。
2. **`awaiting-review` 无 review 里程碑时落到 `running`**：daemon 切换状态的瞬间可能出现「等你验收」但视图里没有 review 项；宁可显示 AI 在做，也不给一个点了没反应的「通过」。
3. **changes 的主按钮直接应用，不先开抽屉**：状态表的主按钮叫「应用改动」，点它就应该发 `draft.apply`；差异通过内容区摘要行「查看改动」打开抽屉。抽屉打开时同一动作在抽屉底部（dock 隐藏），仍然只有一个实底按钮。这样主按钮名实一致，也不会出现“点了应用却只是预览”。
4. **待办圆点不用 `waitingOn` 近似**：`running` 阶段有草稿改动时 daemon 的 `waitingOn` 是 `ai`，用 `waitingOn === 'customer'` 会让改动计划没有圆点。圆点与待办屏共用 `useTodos()` 的汇总（加载完成前不显示），代价是首页晚约 1 秒出点，换来两处永远一致。
5. **计划页不做下拉刷新**：M5 §8.1 只给 `/` 与 `/project/:id`；计划页靠实时帧、重连全量和 ••• 里的刷新。下拉与图/大纲的横向/纵向滚动容易打架。
6. **桌面用分段控件而不是底部栏**：M5 桌面没有底部栏，M6 的两个根在桌面用标题栏下方的 44 高「项目 / 待办」切换，保持桌面“内容列 + 底部动作条”的结构。
7. **桌面节点详情是 480 弹层并留出 dock 高度**：设计只规定决策/验收/差异在主列居中；节点详情沿用同一形状，但底边在 dock 上方 16，保证主按钮仍可见（`PP-08` 的桌面版）。
8. **缩放只改布局、不改字号**：0.8 档若把 13pt 文字缩到 10.4pt，手机上看不清；三档只改节点卡宽度与间距，字号固定。
9. **只显示 open 决策**：视图里可能带已关闭的历史决策（`open: false`），抽屉与计数都只用 open 的；关闭的决策没有可执行动作，显示出来只会让客户点一个必然失败的按钮。
10. **本地态是视图补丁，不是第二个状态机**：`applyLocal` 只复制并改 `gate`/`milestones`/`decisions` 三个字段，`pagePhase` 仍是唯一定义阶段的函数；新 rev 一到就丢掉补丁，避免客户端自作主张。

## 10. 实施映射与交接

| 规则 | 落在哪 |
|---|---|
| 阶段判定、本地补丁 | `lib/plan-phase.ts`（纯函数，新增） |
| 图/大纲数据映射、tone | `lib/plan-graph.ts`（`mapItems`、`outlineOf`，新增） |
| 全量 + 实时 + 重连 | `lib/live.ts`、`lib/plan-store.ts`（`usePlanView`） |
| 动作发送、opId、重试、回执 | `lib/send.ts`（`useSend`）、复用 `lib/submit.ts` 的 `submitNext` |
| 抽屉与键盘 | `components/Drawer.tsx`、`lib/viewport.ts` |
| 计划页骨架、页签、动态 | `app/plan/[id].tsx`、`components/PlanHeader.tsx`、`components/Segments.tsx`、`components/ActivityList.tsx` |
| 图 / 大纲 / 节点详情 | `components/plan/PlanMap.tsx`、`components/plan/PlanOutline.tsx`、`MilestoneSheet` |
| 主按钮、决策、验收、退回 | `components/PrimaryAction.tsx`、`DecisionCard.tsx`、`AcceptCard.tsx`、`ReasonSheet.tsx`、`lib/undo.ts` |
| 草稿差异 | `components/DraftDiff.tsx` |
| 对话 | `components/PlanChat.tsx`、`lib/turns.ts`、`lib/roles.ts` |
| 待办 | `app/todo.tsx`、`components/TabBar.tsx`、`lib/todo.ts`、`lib/todo-store.ts` |
| 测试 | `tests/team/studio-app-phase.test.ts`、`studio-app-turns.test.ts`、`studio-app-todo.test.ts`、`studio-app-live.test.ts`、`ui-plan-levels.test.ts` |
| e2e | `packages/studio-app/e2e/plan.spec.ts`、`e2e/fixtures/views.ts`、fake daemon 控制口 `POST /daemon/view`、`POST /daemon/approve` |

给后续任务的约束：

- `app/plan/[id].tsx` 由 BLG-91 独占；BLG-92/93/96 各自只加一行挂接，挂接冲突由后合并者解决。
- 共用组件 `packages/ui-plan` 只放源码与类型，不 import app 自己的文件；跨包解析失败时按设计 §2 的退路写进本文 §9，不改 companion 的行为。
- 所有可点元素的 testID 命名固定为本文出现的值；新增的只能追加，不能改已有名字（e2e 与 M7 soak 依赖它们）。
