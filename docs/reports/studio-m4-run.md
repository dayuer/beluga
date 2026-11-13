# Studio M4 真实链路演示：客户确认 → Mac 开工卡 → 批准 / 驳回

日期：2026-11-11。分支 `beluga/blg-72-m4-gate`。目标：把 M4 的页面验收在本地中台上真跑一遍，而不是用 Vite
桩页证明卡片能画。结论：**两条流程都走通**，并在这个过程中发现、修掉 4 个真实链路上的问题（§4）。

## 1. 这套环境

| 端 | 怎么起的 | 说明 |
|---|---|---|
| 中台 | `cd packages/studio-hub && npx wrangler dev --persist-to .wrangler/state`（8787） | Wrangler 4.160，本地 D1 + DO；先 `wrangler d1 execute synon-studio --local --persist-to .wrangler/state --file schema.sql`；`packages/studio-hub/.dev.vars` 里是本地运营者令牌（已 gitignore） |
| daemon | `BELUGA_HOME=/tmp/beluga-studio-demo/home npx tsx src/cli.ts daemon --keep-alive` | **真实 daemon**（不是 demo 模式），一个 git 项目 `/private/tmp/beluga-studio-demo/shop`；`beluga studio link <code> --hub http://127.0.0.1:8787`、`beluga studio share` |
| 计划 | 在 `$BELUGA_HOME/plans.json` 里种两份草稿（`Coffee shop app` rev 3、`Loyalty program` rev 2） | **没有跑 AI 规划**：链路从 `plan.requestStart` 开始（本任务验收的起点），种好的草稿让每次跑都确定、不花 agent 回合。计划有正文/草稿后，后续批准走的是真实的 `plans.approve` → 上板 → 发布 |
| Mac App | `BELUGA_HOME=… npm run dev --prefix packages/mac -- --port 1420` | **Mac 应用的真实前端**（同一个 App，Vite dev server 读 `daemon.json` 连上真实 daemon）；不是 `01-start-gate-card.png` 那种只挂一张卡片的桩页。不是 Tauri 原生窗口：本机没有构建 Tauri（见 §5） |
| 客户 | `.beluga/scratch/fake-customer.mjs`（Node） | 走中台的 app API：管理员发魔法链接 → `POST /v1/login/verify` → `GET /v1/app/projects/:id/plans` → `POST /v1/app/projects/:id/actions`（`plan.requestStart`）→ 轮询 `GET …/plans/:ref` 读 `gate` |
| 操作者点击 | Playwright 驱动 Mac 前端 | 真实 UI、真实点击；不是手点，但和手点走同一条 `studio.answerGate` |

中台侧的准备（全走 §6 的管理 API）：建工作室 → 建 Studio 项目 → 用 daemon 报上来的 project ref 绑定 →
邀请客户并加进项目 → 发魔法链接。daemon 的 `studio status --json` 给出本机 project id，`plans.json` 用它。

**截图在哪**：全部在 `.beluga/scratch/`，文件名见 §2、§3。

## 2. 批准流

1. 客户读计划：`stage: drafting`，`draftRev: 3`。
2. 客户发 `plan.requestStart`（`draftRev: 3`）：回执 `queued` → daemon 收件箱执行 → Gate pending。
   客户再读：`stage: awaiting-start`，`gate: { kind: start, state: pending, draftRev: 3 }`
   （`.beluga/scratch/customer-view-pending.json`）。
3. Mac 铃铛出现开工卡（**真实 Mac 窗口/应用 UI**）：`m4-03-mac-start-gate.png`
   - 标题 `Approve start of “Coffee shop app”?`
   - `Asked by a customer · 5m`（中台还没带 `by`，见 §5）
   - `3 milestones · 21 pts`
   - `Approve` / `Decline`
4. 点 `Approve` → `studio.answerGate(g-id, {approve:true})` → Gate 比对 `draftRev 3` → `plans.approve` 恰好一次
   → 草稿上板。Mac 上卡片消失，`Work` 里出现运行中的 `Coffee shop app`（`m4-04-mac-approved.png`）。
5. 客户再读：`stage: running`，`headline: 在做：Menu，已完成 0 项，共 6 项`，`draftRev: 4`，
   `gate: { state: approved, draftRev: 3 }`（`customer-view-approved.json`，渲染见
   `m4-08-customer-approved.png`）。

## 3. 驳回流

1. 客户对 `Loyalty program` 发 `plan.requestStart`（rev 2）→ Gate pending（客户视图 `awaiting-start`）。
2. Mac 卡片 `m4-05-mac-loyalty-card.png`：`2 milestones · 8 pts`。
3. 点 `Decline` → 卡片展开输入框（`Why not? The customer reads this.`），填
   `Please add the birthday reward first, then we start.`（`m4-06-mac-decline-reason.png`），点 `Send decline`。
4. 卡片消失（`m4-07-mac-declined.png`）；计划保持原状。
5. 客户再读：`stage: drafting`，`gate: { state: declined, draftRev: 2, reason: "Please add the birthday reward
   first, then we start." }`（`customer-view-declined.json`，渲染见 `m4-09-customer-declined.png`）。

## 4. 这次真跑发现并修掉的 4 个问题

| # | 现象 | 原因 | 修 |
|---|---|---|---|
| R1 | 客户视图永远没有 `gate`，驳回原因到不了客户 | `StudioInbox` 的 Gate 插件接口叫 `view(planId)`，`StudioGates` 只有 `viewGate`：publisher 的 `extras` 拿到 `undefined`，`gate` 从未进 `StudioPlanView`。单元测试都直接调 `viewGate`，所以没发现 | `StudioGates.view()` 转发到 `viewGate`；`tests/studio-gates` 加 “the publisher’s plug sees the Gate” |
| R2 | 开了 Studio 的计划仍出现原生 `Approve the plan …` 卡，客户确认的 Gate 卡旁边能直接绕过 | `service.dispatchStudio()` 用 store 的 `projects` 过滤 `config.projects`；daemon 启动时项目列表是异步扫出来的，connect 时还是空，于是 `studio.shared` 写成 `[]`，NeedsYou 的抑制条件失效 | 直接以 `config.projects` 为准（配置里只有共享项目）；启动后仍会按需 dispatch |
| R3 | 打开 Mac 铃铛整页白屏，控制台 `Maximum update depth exceeded` | `Center` 用 `useApp(waitingList, sameDeep)`；`sameDeep` 默认只比 6 层，而 NeedsYou 的 `actions[].args` 是列表里的对象，超过 6 层就被当成“变了”，`useSyncExternalStore` 每渲染拿到新快照 → 无限循环。开工卡是第一个让铃铛里出现这种结构的卡 | 铃铛这一处用 `sameDeep(a, b, 20)`（`NotificationCenter.tsx`） |
| R4 | 重启 daemon 后 pending Gate 变 `void`，客户的 `gate` 消失 | `launchBoard` 在 stop 时 dispatch `plans_off`；`StudioGates.reconcile` 看到计划列表为空，以为计划被删，把 Gate 作废。Gate 文件本来是跨重启保存的 | `reconcile` 在 `state.plans.enabled === false` 时直接返回；`tests/studio-gates` 加 “a pending Gate survives plans being switched off…” |

R1–R4 都在本次提交里修好并有回归测试；修后批准/驳回两条流程按 §2、§3 重新走通。

## 5. 没做到 / 需要人手的地方

- **Tauri 原生窗口**：没有构建。Mac App 的前端是真实的（同一套 React App、真实 daemon、真实 NeedsYou 数据），
  只是跑在 Vite dev server 的浏览器窗口里；Tauri 外壳的构建在这台 Mac 上是可选且耗时的（Rust 依赖 + 签名），
  本任务没把它当作链路证据。若验收要求必须是 `.app` 窗口，需要一台能跑 `npm run app:dev` 的机器和人手启动。
- **真实 AI 规划**：没跑。计划是种好的草稿；`plan.create` 的 AI 起草不在本次页面验收的链路里。若要看“计划长出来”，
  需要配置可用的 Claude（或别的 agent）并等一轮规划。
- **中台的 `by`**：hub 的 `deliver` 帧还没有 `by`，卡片显示 `Asked by a customer`（或项目名）。设计 §8 计划由中台
  先升级再加这个可选字段；不影响 Gate 与批准。
- **客户视图截图**：`m4-08`/`m4-09` 是中台 app API 的响应，按客户会看到的样子渲染成一张卡；M5 的 Web 屏幕不在
  M4 范围，所以这不是“客户 App 截图”，是**链路响应**的证据。
- **旧桩页截图**：`.beluga/scratch/01-start-gate-card.png`、`02-start-gate-decline.png` 是用一个临时 Vite 页面
  **只挂卡片**拍的，只能证明渲染，**不算链路证据**；本报告的链路证据是 `m4-03`–`m4-09`。

## 6. 复现命令（简）

```sh
# 中台
cd packages/studio-hub
cp .dev.vars.example .dev.vars
npx wrangler d1 execute synon-studio --local --persist-to .wrangler/state --file schema.sql
npx wrangler dev --persist-to .wrangler/state --port 8787 --ip 127.0.0.1

# daemon（另一个终端；repo 根）
BELUGA_HOME=/tmp/beluga-studio-demo/home npx tsx src/cli.ts daemon --keep-alive
BELUGA_HOME=… npx tsx src/cli.ts project add /tmp/beluga-studio-demo/shop
BELUGA_HOME=… npx tsx src/cli.ts studio link <code> --hub http://127.0.0.1:8787
BELUGA_HOME=… npx tsx src/cli.ts studio share /private/tmp/beluga-studio-demo/shop
# 管理 API：建 studio 项目、绑定、邀请客户、加成员、发魔法链接（见 .beluga/scratch 里的脚本与日志）

# Mac 前端
BELUGA_HOME=/tmp/beluga-studio-demo/home npm run dev --prefix packages/mac -- --port 1420

# 客户
node .beluga/scratch/fake-customer.mjs login <token>
node .beluga/scratch/fake-customer.mjs start <pid> <planRef>
```

Playwright 驱动脚本与客户脚本都在 `.beluga/scratch/`（临时脚本，未提交）；截图同目录。
