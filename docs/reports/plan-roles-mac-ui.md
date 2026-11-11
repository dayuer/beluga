# 里程碑 3：Mac 计划角色界面——实测与计划设置页

计划：按角色分配模型：计划设置页、中文输入法与收尾验证。交接见 `plan-roles-handoff.md`。

## 一、走查现有界面（BLG-121）

截图用 `packages/mac/e2e/plan-roles-walk.spec.ts` 拍（只拍图，平时跳过）：

```console
cd packages/mac && WALK=1 npx playwright test e2e/plan-roles-walk.spec.ts --project=app
```

图在本工作树的 `.beluga/scratch/walk/`（git 不收），文件名 `<序号>-<状态>-<语言>-<宽度>.png`，
语言 `en` / `zh-CN`，宽度 `1440` / `760`（窄）。每个状态四张：

| 序号 | 状态 |
|---|---|
| 01 | 新建计划（收起更多选项） |
| 02 | 新建计划 › 更多选项：四个角色 |
| 03 / 04 | 架构、编码的下拉框展开 |
| 05 | 计划页 |
| 06 | 计划页 ••• 菜单 |
| 07–10 | ••• › 执行工作 / 验收 / 架构 / 疑难修复 子菜单 |
| 11 | ••• › 何时运行测试 子菜单 |
| 12 | 如何运行（PlanModeSheet，选了自动驾驶） |
| 13–15 | 设置 › 自动路由：关、开、审计组 |

默认值实测：演示环境只有 Claude 订阅时，架构“高级：Claude (Opus)”、编码“普通：Claude (Haiku)”、
审计“中级：Claude (Sonnet)”、疑难修复“高级：Claude (Opus)”，符合 tiers 决定。

### 问题清单

“必须”是这个里程碑要修的；“应该”尽量修，修不了写明原因。“归属”是哪个任务修。

| # | 级别 | 在哪 | 问题 | 修法 | 归属 |
|---|---|---|---|---|---|
| 1 | 必须 | ••• 菜单（06–10） | 四个角色子菜单叫法各不一样：“执行工作的智能体”“验收用的 Agent”“架构用的 Agent”“疑难修复智能体”；新建对话框叫“架构 / 编码 / 审计 / 疑难修复”。同一件事两套说法，Agent 和智能体混用 | 加“计划设置…”，去掉 fork 自己加的三个子菜单（验收、架构、疑难修复），角色只在计划设置里改 | BLG-123 |
| 2 | 必须 | 新建对话框 vs ••• | 同一个“没设”在两处意思不同：疑难修复在新建里叫“由当前在做的智能体处理”，在 ••• 里叫“最强模型（自动路由）”；审计没设时其实走自动路由的审计档，下拉框却写“与编码相同” | 共用角色组件：从计划现有值得出初始项；没设且自动路由开着时显示“按档位”那项 | BLG-122 |
| 3 | 必须 | 新建对话框（02） | 底部说明写“以后在计划的 ••• 菜单里改” | 改成“以后可以在计划设置里改” | BLG-123 |
| 4 | 必须 | 新建对话框（02） | 四个角色的下拉框没对齐：标签宽度不同（架构 / 编码 / 审计 / 疑难修复，英文更明显），下拉框起点各不相同 | 角色组件用两列网格，标签列等宽 | BLG-122 |
| 5 | 必须 | 设置 › 自动路由（15） | 同一个标记两种译法：行内写“当前使用”，组底写“标着‘正在使用’的那个” | 统一成“当前使用” | BLG-124 |
| 6 | 必须 | 设置 › 自动路由（14–15） | 看不出计划的角色用哪一组：疑难任务组只说“这类任务从…开始”，没说计划的架构和疑难修复也用它；审计组英文叫 Checking the Work，和角色名 Audit 不一致 | 疑难组底部补“计划的架构和疑难修复也用它”；审计组英文改为 Plan Audits（中文“计划审计”） | BLG-124 |
| 7 | 必须 | 计划页，窄宽度（05/06-760） | 760 宽时计划名换成三行，压在“运行于 这台 Mac”上，返回键旁的文字被盖住 | 标题行与工具栏换行而不是重叠（plans.module.css） | BLG-124 |
| 8 | 应该 | 新建对话框（02） | 展开“更多选项”后四个角色在可视区外，要自己往下滚 | 展开时把角色区滚进视野 | BLG-122 |
| 9 | 应该 | 设置 › 自动路由（15） | 本机没配的候选显示原始 id（`local:anthropic/claude-sonnet-5-5`），窄宽度被截断 | 显示可读名（“Claude Sonnet 5.5 · API key”），完整 id 放提示 | BLG-124 |
| 10 | 应该 | 如何运行（12） | 中文“现在运行于逐步进行”拼出来不通顺 | 给整句加模板词条：“…”现在按{1}运行 | BLG-125 |

## 二、计划设置页设计

### 入口

- 计划页 ••• 菜单，放在“何时运行测试”下面：**Plan Settings… / 计划设置…**。计划没做完（`status !== 'done'`）时才有。
- 新建对话框底部说明改为：**Change any of them later in Plan Settings. / 以后可以在计划设置里改。**

### ••• 里旧子菜单

- 去掉 fork 加的三个：Agent for Its Checks、Agent for Its Architecture、Agent for Hard Fixes。它们是 fork 代码，去掉反而让 PlanPage.tsx 离上游更近。
- 保留上游原有的 Agent for Its Work 和 When to Run Tests 子菜单，不改上游行（按 docs/fork.md）。计划设置里也能改这两项，两处调的是同一个 API。
- 工具栏的“运行于 逐步进行”按钮和 PlanModeSheet 照旧（上游）。

### 字段与顺序（与新建对话框同序）

| 顺序 | 字段 | 控件 | 能改 |
|---|---|---|---|
| 1 | Project / 项目 | 文字 | 只显示 |
| 2 | Runs on / 运行于 | 文字（电脑名；没配对其他电脑时不显示，和新建对话框的 RunsOnRow 一样） | 只显示 |
| 3 | How it runs / 如何运行 | 三张卡片（复用 AutonomyCards，标“现在”） | 能 |
| 4 | When to run tests / 何时运行测试 | 下拉框 + 下方说明 | 能 |
| 5 | Who does each part / 谁来做哪部分（小标题） | | |
| 6–9 | Architecture / Coding / Audit / Hard fixes（架构 / 编码 / 审计 / 疑难修复） | 共用角色组件 PlanRoles（和新建对话框同一个，选项顺序、文案一致），不折叠 | 能 |
| 10 | 说明一行：档位规则 | 文字 | |

角色下拉框的初始值来自计划现有的 agent / archAgent / checkAgent / fixAgent：
有值时选中它（等于档位推荐的那个时显示“按档位”那项）；没值时，自动路由开着且该档有模型就显示“按档位”，
否则显示“以前的做法”那项（不设架构 / 你的智能体 / 与编码相同 / 由当前在做的智能体处理）。

### 保存方式：点“保存”

- 改动先留在页面里，底部 **Save / 保存**，没改时灰掉；**Cancel / 取消** 丢掉改动。不做即改即存：
  运行方式要先看清“会变什么”再确认，四个角色各自有一句“从现在起…”的提示，一次保存一次说清。
- 改了运行方式时，卡片下面出现和 PlanModeSheet 一样的“会变什么”说明（`modeChange`），保存即确认。
- 保存时只调改了的那几项：`setAutonomy`、`setTestsAt`、`setWorkAgent`、`setCheckAgent`、`setArchAgent`、`setFixAgent`，
  都是已有 API，不加新方法，所以 coverage 不动。手机端不加这个页面。
- 保存后关掉，弹出 **Plan settings saved / 计划设置已保存**；角色接口返回的话（如“正在做的里程碑保留原来的智能体”）接在后面。
- 值存在守护进程的计划里，关掉重开、重启守护进程都还在。

### 文案

| English | 中文 |
|---|---|
| Plan Settings… | 计划设置… |
| Plan Settings | 计划设置 |
| How “{0}” runs and who does each part. Changes apply from now on; work already running keeps its agent. | “{0}”怎么运行、每部分由谁来做。改动从现在起生效，正在进行的工作保留原来的智能体。 |
| Project | 项目 |
| Runs on | 运行于 |
| Who does each part | 谁来做哪部分 |
| Save | 保存 |
| Plan settings saved | 计划设置已保存 |
| Change any of them later in Plan Settings. | 以后可以在计划设置里改。 |

### 文件（fork-files）

- 新文件：`packages/mac/src/plans/PlanSettingsSheet.tsx`、`packages/mac/src/plans/PlanRoles.tsx`。
- 接入点：`lib/sheets.ts` 一行 kind `plan_settings`；`dialogs/native/WorkSheets.tsx` 一个 case；
  `PlanPage.tsx` 一行菜单项（并删掉 fork 的三个子菜单）；`PlanSheets.tsx` 导出 AutonomyCards、角色行换成 `<PlanRoles>`。
- 词条在 `zh-CN.fork.json`；菜单项写进 `docs/parity.fork.md`。
