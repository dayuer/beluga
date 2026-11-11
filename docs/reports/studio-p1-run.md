# Synon Studio P1 真实全流程：提需求 → 计划长出来 → 批准开工 → 首个里程碑 → 客户验收

日期：2026-11-11。分支 `beluga/blg-97-m7`（从 `plan/synon-studio-p1-web` 开）。按 [`docs/studio.md`](../studio.md)
的步骤，在**本地真实中台**上走一遍：真 Resend 邮件、真 AI 规划、真 agent 干活、真 Mac 前端点批准、客户在
studio-app Web 上点通过。每一步在 `.beluga/scratch/m7/` 留截图，压缩后放 `docs/img/studio-p1/`。

> **状态：等待人手，未执行。** 本报告先记录这套环境、步骤与卡点；在拿到业主放进
> `packages/studio-hub/.dev.vars` 的 Resend 配置之前，不跑、也不假称跑过。邮件这一步需要人手（看真邮箱、
> 点链接）。

## 1. 这套环境

环境照 [`studio-m4-run.md`](studio-m4-run.md) §1，三处不同：**真 AI 规划、真 agent 干活**；客户用
**studio-app Web**；**真发邮件**（Resend）。

| 端 | 怎么起 | 说明 |
|---|---|---|
| 中台 | `cd packages/studio-hub`，`npx wrangler d1 execute synon-studio --local --persist-to .wrangler/state --file schema.sql`，然后 `npx wrangler dev --persist-to .wrangler/state`（8787） | Wrangler 4.160，本地 D1 + DO。`.dev.vars` 由业主准备：`OPERATOR_TOKEN`、`MAIL_MODE=resend`、`RESEND_API_KEY`、`MAIL_FROM`、`HUB_ORIGIN=http://localhost:8790`。**本报告不读、不打印、不提交 `.dev.vars`** |
| 客户 Web | `cd packages/studio-app`，`npx expo export -p web`，`npm run proxy -- --dist`（8790） | 与中台同源（代理把 `/v1/*` 与 App 放一个 origin）；Playwright 在 390×844 下驱动 |
| daemon | `BELUGA_HOME=/tmp/beluga-studio-p1/home npx tsx src/cli.ts daemon --keep-alive` | **真 daemon**；一个很小的 git 项目 `/tmp/beluga-studio-p1/site`（只有标题和报名按钮的单页落地页），计划只有 1–2 个里程碑。`beluga studio link <code> --hub http://127.0.0.1:8787`、`beluga studio share` |
| 计划 | 客户在新需求里提交，规划 agent 真写 | **不是种好的草稿**：`plan.create` → 受限客户回合 → agent 用 `plan_write` / `plan_update` 一版一版写 |
| Mac | `BELUGA_HOME=/tmp/beluga-studio-p1/home npm run dev --prefix packages/mac -- --port 1420` | **Mac 应用的真实前端**（同一个 App、真实 daemon、真实 NeedsYou），不是 Tauri 原生窗口（同 m4，本机不构建 Tauri） |
| 操作者点击 | Playwright 驱动 Mac 前端 | 真实 UI、真实点击，走同一条 `studio.answerGate` |

中台侧准备走管理页/管理 API（`docs/studio.md` §3）：建工作室 → 建 Studio 项目 → 用 daemon 报上来的
project ref 绑定 → 邀请客户并加进项目。客户登录用**真邮箱**收到的魔法链接。

## 2. 每一步、截图与用时

截图固定文件名（`.beluga/scratch/m7/` 原图，`docs/img/studio-p1/` 为 ≤300 KB 的 jpg，同名换扩展名）。
状态一列：**待跑** = 还没执行；**等待人手** = 需要人打开邮箱或做决定。

| # | 步骤 | 截图 | 状态 |
|---|---|---|---|
| 1 | 客户在 `/login` 填邮箱；Resend 真发信；业主在邮箱里打开链接 | `01-login-email.jpg`（链接用过之后再拍，遮住令牌） | **等待人手**（真邮箱） |
| 2 | 客户 Web 登录成功，进入项目 | `02-login-done.jpg` | 待跑 |
| 3 | 新需求：一个只有标题和报名按钮的落地页，平台 Web | `03-new-request.jpg` | 待跑 |
| 4 | 计划第一版：规划 agent 写出里程碑 | `04-plan-growing-a.jpg` | 待跑 |
| 5 | 计划第二版：任务与验收标准 | `05-plan-growing-b.jpg` | 待跑 |
| 6 | 客户确认计划；页面显示「等工作室批准开工」 | `06-confirm-waiting.jpg` | 待跑 |
| 7 | Mac 铃铛的 `studio-start` 卡；点 Approve（人手或 Playwright） | `07-mac-start-card.jpg` | 待跑（批准可人手可脚本） |
| 8 | 批准后客户页 `running`；agent 真跑首个里程碑 | `08-running.jpg` | 待跑 |
| 9 | 里程碑进验收；客户页「通过 / 还不行」 | `09-accept-card.jpg` | 待跑 |
| 10 | 客户在 Web 上点**通过** | `10-passed.jpg` | 待跑（验收的关键证据） |

## 3. 需要人手的地方

- **真邮箱收信**（步骤 1）：只有业主能打开收件箱、点魔法链接。链接 15 分钟、一次性；截图要在链接用掉
  之后再拍，并遮住 `#token=`。
- **Resend 配置**（前置）：`packages/studio-hub/.dev.vars` 目前**不存在**。需要业主按
  `.dev.vars.example` 填 `OPERATOR_TOKEN`、`MAIL_MODE=resend`、`RESEND_API_KEY`、`MAIL_FROM`
  （Resend 已验证域名）、`HUB_ORIGIN=http://localhost:8790`。key 不进 git、不进聊天、不进本报告。
- **Mac 批准**（步骤 7）：人手点也行，Playwright 驱动真实前端也行；报告里会写明是哪一种。

## 4. 真实链路上发现的问题

（跑完补：现象 / 原因 / 修法 / 回归测试，照 m4 的 R 表。）

## 5. 手册偏差

照 [`docs/studio.md`](../studio.md) 做时不一样的地方（跑完补）。已知两处待确认：

- 手册 §5 用 `npm run proxy -- --dist` 服务 `dist/`（README 的说法）；设计 §2 写的是 `npm run proxy`。
- 手册 §2 的 D1 初始化带 `--persist-to .wrangler/state`，与 `packages/studio-hub/README.md` 的
  `npx wrangler d1 execute synon-studio --local --file schema.sql` 不同（不带时状态不落在同一个目录）。

## 6. 没走通的步骤

- 目前卡在**前置条件**：`packages/studio-hub/.dev.vars` 不存在，中台无法按 `MAIL_MODE=resend` 发真邮件；
  没有真登录，后面的每一步都无法作为「真实全流程」的证据。没有执行，也没有用 outbox 或种好的草稿冒充。

## 7. 提醒

跑完验收后请**轮换 Resend key**（它已在群聊出现过一次）。
