# Synon Studio P1 真实全流程：提需求 → 计划长出来 → 批准开工 → 首个里程碑 → 客户验收

日期：2026-11-11。分支 `beluga/blg-97-m7`（从 `plan/synon-studio-p1-web` 开）。按
[`docs/studio.md`](../studio.md) 的步骤，在**本地真实中台**上走了一遍：真 daemon、真 AI 规划与真 agent
干活、真 Mac 前端点批准、客户在 studio-app Web 上点通过。截图在 `docs/img/studio-p1/`（原图在
`.beluga/scratch/m7/`）。

**结论：整条链路走通，客户在 Web 上点通过了首个里程碑。** 一处没有按设计做到：**邮件不是真发的**。
`packages/studio-hub/.dev.vars` 不存在（业主尚未放入 Resend 配置），所以这次用中台的 `MAIL_MODE=outbox`：
魔法链接出现在管理页的「待转发的登录链接」里，`01-login-email` 截的就是它（令牌已遮住）。真邮箱收信与
登录仍是**等待人手**的一步；其余各端都是真的。没有用种好的草稿或 outbox 冒充真邮件。

## 1. 这套环境

| 端 | 怎么起的 | 说明 |
|---|---|---|
| 中台 | `cd packages/studio-hub`；`npx wrangler d1 execute synon-studio --local --persist-to .beluga/scratch/m7/hub-state --file schema.sql`；`npx wrangler dev --port 8787 --persist-to .beluga/scratch/m7/hub-state --var OPERATOR_TOKEN:… --var MAIL_MODE:outbox --var HUB_ORIGIN:http://localhost:8790` | Wrangler 4.160.0，本地 D1 + DO。**没有 `.dev.vars`**，所以没有 Resend；`.dev.vars` 一旦就位，换成正常启动即可（`MAIL_MODE=resend`） |
| 客户 Web | `cd packages/studio-app`；`npm run export`（`expo export -p web`）；`PORT=8790 HUB_PORT=8787 node scripts/dev-proxy.mjs --dist` | 与中台同源；Playwright 在 **390×844**、`deviceScaleFactor: 2` 下驱动 |
| daemon | `BELUGA_HOME=/tmp/beluga-studio-p1/home BELUGA_ALLOW_ORIGINS=http://localhost:1420 npx tsx src/cli.ts daemon --keep-alive` | **真 daemon**；项目 `/tmp/beluga-studio-p1/site`（一个只有 README 的 git 仓库）。`beluga project add` → `beluga studio link <code> --hub http://127.0.0.1:8787` → `beluga studio share` |
| 计划 | 客户在新需求里提交，规划 agent 真写 | **不是种好的草稿**：`plan.create` → 受限客户回合 → agent `plan_write` / `plan_update` |
| Mac | `BELUGA_HOME=/tmp/beluga-studio-p1/home npm run dev --prefix packages/mac -- --port 1420` | **Mac 应用的真实前端**（同一个 App、真实 daemon、真实 NeedsYou），不是 Tauri 原生窗口（本机未构建 Tauri，同 m4） |
| 操作者点击 | Playwright 驱动 Mac 前端 | 真实 UI、真实点击，走同一条 `studio.answerGate` |

中台侧准备（`docs/studio.md` §3）：建工作室 → daemon 报上 project ref 后建 Studio 项目并映射 → 邀请客户
(`customer@example.test`) 并加进项目 → 发登录链接（outbox）。

## 2. 每一步、截图与用时

时间取自这次运行（本地时间）。"用时"是从上一端动作到这一张图。

| # | 步骤 | 截图 | 用时 / 时刻 |
|---|---|---|---|
| 1 | 管理页 outbox 里拿到魔法链接（**非真邮件**）；令牌遮住后截图 | `01-login-email.jpg` | 11:41:55 |
| 2 | 客户用链接登录，进入项目列表 | `02-login-done.jpg` | 2 s，11:41:57 |
| 3 | 新需求：只有标题和报名按钮的单页落地页，平台 Web | `03-new-request.jpg` | 2 s，11:41:59 |
| 4 | 计划在写：第一版草稿，1 个里程碑 | `04-plan-growing-a.jpg` | 规划回合约 40 s（rev 2） |
| 5 | 客户在对话里追加一条验收标准；第二版草稿（任务 + 5–6 条验收标准） | `05-plan-growing-b.jpg` | 约 2.5 min（rev 3） |
| 6 | 客户确认计划；页面「等工作室批准开工」 | `06-confirm-waiting.jpg` | 11:49:00 |
| 7 | Mac 铃铛的 `studio-start` 卡；Playwright 点 Approve | `07-mac-start-card.jpg` | 约 2 min 后，11:51:34 |
| 8 | 批准后客户页 `AI 在做`；agent 真跑首个里程碑 | `08-running.jpg` | 9 s，11:51:43 |
| 9 | 任务完成、checker 通过；客户页「等你验收」 | `09-accept-card.jpg` | 任务约 2.5 min + 检查约 1 min，11:56:27 |
| 10 | 客户在 Web 上点**通过**（等过 10 秒撤销窗）；计划完成 | `10-passed.jpg` | 13 s，11:56:40 |

说明：`04`/`05` 是在**同一条需求又提交了一次**之后补拍的（第一次的草稿期截图漏拍），所以两张图的计划
实例与 `06`–`10` 不同，但页面、需求文字与计划形状相同；`04` 是「里程碑」视图，`05` 是展开后的「任务 +
验收标准」。没有拿验收后的终态冒充草稿期。

客户在对话里追加的那条验收标准（“报名成功后显示当前报名人数”）确实进了 rev 3 的 `criteria`，agent 的
回复也出现在 turns 里；这是对话通道在真实链路上的证据（截图未单列）。

## 3. 真实链路上发现的问题

| # | 现象 | 原因 | 修法 | 回归 |
|---|---|---|---|---|
| R1 | Mac 前端（Vite dev server）连不上 daemon：页面「Beluga isn't running yet」，浏览器控制台 `WebSocket … HTTP Authentication failed` | daemon 的 `verifyClient` 只放行 Tauri webview 的 origin（`APP_ORIGINS`），`http://localhost:1420` 不在里面 | 启动 daemon 时加 `BELUGA_ALLOW_ORIGINS=http://localhost:1420`（`src/cli/daemon.ts` 已有此开关）。手册 §4 已补这一行 | 无需改代码；启动参数写入手册 |
| R2 | 自动化点铃铛时报「element is inert」 | 首次启动的欢迎页（“Every project. Every agent.”）盖在上面，主界面 inert | 先点 **Skip Setup**；手册 §7 已补一句 | 自动化脚本处理，不是产品问题 |
| R3 | 客户点「通过」后没有立刻发出 | 客户端的 10 秒撤销窗（BLG-93） | 等 11 秒再断言；手册 §8 已写明 | 客户端既有行为 |
| R4 | 计划页的验收标准里出现「根目录 存在」「目录中只有，」这样的断句 | 净化器按设计拿掉了文件名/路径（`index.html` 等），留下句子空格 | 预期行为（no-code-leak），不是 bug；如果以后要更顺，可在净化器里把整句改写为「（文件已省略）」 | 无 |
| R5 | 中途重启 daemon（为了加 origin）后，客户页短暂「工作室离线」，随后自动恢复，开工卡还在 | 设计中的重连：先 `hello` → 全量快照 → `synced`；pending Gate 存在 `studio-inbox.json` | 无需修；这正是 M4 R4 修复后的行为 | `tests/studio-gates` 的 pending Gate 用例 |

## 4. 手册偏差（照 `docs/studio.md` 做时不一样的地方）

1. **§4 绑定 daemon**：Mac 前端用 Vite dev server（不是 Tauri 窗口）时，daemon 要带
   `BELUGA_ALLOW_ORIGINS=http://localhost:1420`；手册已补。
2. **§5 客户 Web**：`npm run proxy -- --dist` 是对的（`dist/` 已由 `npm run export` 生成）；只跑
   `npm run proxy` 会去连 Expo dev server（:8081），没有起它会打不开。
3. **§7 Mac 批准**：首次启动先 **Skip Setup**，否则铃铛不可点；手册已补。
4. **§8 客户验收**：点「通过」有 10 秒撤销窗才真正发送；手册已补。
5. **§2 中台**：本次因没有 `.dev.vars`，用 `--var` 启动且 `MAIL_MODE=outbox`；有 `.dev.vars` 时按手册
   原样即可。

上面 1、3、4 已经改进 `docs/studio.md`（BLG-99 的手册）；这里留档。

## 5. 没走通的步骤

- **真发信 / 真邮箱登录（步骤 1）没有做**：`packages/studio-hub/.dev.vars` 不存在，没有
  `RESEND_API_KEY`，无法按 `MAIL_MODE=resend` 发信。这次用管理页 outbox 的链接完成了登录，`01` 是 outbox
  的截图。**这不是真实邮件证据。** 业主放入 `.dev.vars`（`OPERATOR_TOKEN`、`MAIL_MODE=resend`、
  `RESEND_API_KEY`、`MAIL_FROM`、`HUB_ORIGIN=http://localhost:8790`）后，只需重跑步骤 1 并把
  `01-login-email.jpg` 换成真邮箱里的那封信（用掉链接之后再拍、遮住令牌）。
- 其余步骤都真实走通；没有用桩页、种好的草稿或 fake daemon 冒充。

## 6. 复现命令（简）

```sh
# 中台（没有 .dev.vars 时；有就按 README 用 .dev.vars）
cd packages/studio-hub
npx wrangler d1 execute synon-studio --local --persist-to ../../.beluga/scratch/m7/hub-state --file schema.sql
npx wrangler dev --port 8787 --persist-to ../../.beluga/scratch/m7/hub-state \
  --var OPERATOR_TOKEN:… --var MAIL_MODE:outbox --var HUB_ORIGIN:http://localhost:8790

# 客户 Web
cd packages/studio-app && npm run export
PORT=8790 HUB_PORT=8787 node scripts/dev-proxy.mjs --dist

# daemon（repo 根）
BELUGA_HOME=/tmp/beluga-studio-p1/home BELUGA_ALLOW_ORIGINS=http://localhost:1420 \
  npx tsx src/cli.ts daemon --keep-alive
BELUGA_HOME=… npx tsx src/cli.ts project add /tmp/beluga-studio-p1/site
BELUGA_HOME=… npx tsx src/cli.ts studio link <code> --hub http://127.0.0.1:8787
BELUGA_HOME=… npx tsx src/cli.ts studio share /private/tmp/beluga-studio-p1/site

# Mac 前端
BELUGA_HOME=/tmp/beluga-studio-p1/home npm run dev --prefix packages/mac -- --port 1420
```

管理 API、Playwright 脚本与各端日志都在 `.beluga/scratch/m7/`（`customer-login.mjs`、`customer-send.mjs`、
`chat-ask.mjs`、`plan-shot.mjs`、`plan-grow-shots.mjs`、`mac-approve.mjs`、`logs/*.log`）。

## 7. 提醒

跑完验收后请**轮换 Resend key**（它已在群聊出现过一次）。
