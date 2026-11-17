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

## 三、中文（BLG-125）

中文环境检查：`packages/mac/e2e/plan-zh.spec.ts`（新建计划展开更多选项、••• 菜单、计划设置、保存后的弹出提示、
“发生了什么”、设置 › 自动路由四组，模型名、项目名和计划名之外没有英文）；句子级检查：`tests/plan-roles-i18n.test.ts`
（界面、各角色切换的提示、计划动态里的“交给 …”“又停了：已交给 …”、何时跑测试、git-locale 页列出的 git 原话）。

- 词条只加在 `zh-CN.fork.json`；顺手把 fork 词条里夹的 “agent” 统一成“智能体”。
- 计划动态：角色变更、疑难问题交给修复模型、何时跑测试，原来只写进计划记录、Mac 上看不到；
  现在作为“改动”出现在“发生了什么”里（`plans-model.ts` 的 `feedKind` 一行，`tests/mac-plans.test.ts` 有用例）。
- 没修的一条：上游的 `passed “{0}”`（“你 passed “…””）。match.ts 规定短模板不包住多词标题，要改上游的匹配规则，不在本里程碑。

截图（本工作树 `.beluga/scratch/`）：`zh-new-plan.png`、`zh-plan-menu.png`、`zh-plan-settings.png`、`zh-toast.png`、
`zh-feed.png`、`zh-auto-route.png`；英文与窄宽度：`plan-settings-en.png`、`plan-settings-760.png`、`new-plan-roles-760.png`、
`plan-header-760.png`、`auto-route-plan-audits.png`。

## 四、审计（BLG-126）

独立复查 `f10e4ced..c4011bf2`。运行：`plan-zh.spec.ts` + `plan-roles.spec.ts`（4 个用例全过，31 秒）；
`WALK=1 … plan-roles-walk.spec.ts -g "zh-CN"` 失败两次（见“新问题 4”，不是产品问题）。
为拿到修改后的中文截图，另用一份去掉旧子菜单的临时副本重拍了 1440 宽（用完已删，不在仓库里）。
证据都在 `.beluga/scratch/agents/G4foXS3ny7/`（下称 `A/`）和 `.beluga/scratch/`。

### 1. 问题清单 1–10 逐条对照（中文截图）

| # | 结论 | 证据 |
|---|---|---|
| 1 子菜单叫法不一、没有计划设置 | 基本修好（部分） | `.beluga/scratch/zh-plan-menu.png`：••• 里有“计划设置…”，验收/架构/疑难修复三个子菜单已没了。但保留的上游子菜单仍叫“执行工作的智能体”，而计划设置里同一件事叫“编码”，两个说法还在；这是设计里写明的取舍（不改上游行） |
| 2 同一个“没设”两处意思不同 | 修好 | `.beluga/scratch/zh-new-plan.png`（新建：按档位的四项）与 `A/zh-plan-settings-full.png`（计划设置：不设架构 / 你的智能体 (Claude) / 与编码相同 / 由当前在做的智能体处理，因为演示计划没设角色且自动路由关）；两处共用 `PlanRoles.tsx`，初始值由 `roleFromPlan`（plan-roles-model.ts:87 起）按计划现状算。`plan-roles.spec.ts` 用例 1 过 |
| 3 底部说明还说“在 ••• 菜单里改” | 修好 | `zh-new-plan.png` 底部“以后可以在计划设置里改。” |
| 4 四个下拉框没对齐 | 修好 | `zh-new-plan.png`、`zh-plan-settings.png`：标签一列，下拉框同一起点（`plan-roles.module.css` 两列网格） |
| 5 “当前使用”/“正在使用”两种译法 | 修好 | `zh-auto-route.png`：行内、组底都是“当前使用”（zh-CN.fork.json 把旧条目改了） |
| 6 看不出计划用哪一组；审计组叫法不一 | 修好 | `A/walk-after/14-auto-route-on-zh-CN-1440.png`：疑难任务组底“这类任务、计划的架构和疑难修复，都从标着‘当前使用’的模型开始”；`zh-auto-route.png`：组名“计划审计” |
| 7 窄宽度计划名压住按钮 | 修好 | `.beluga/scratch/walk/05-plan-page-zh-CN-760.png`、`plan-header-760.png`：操作行换到标题下面，不再重叠。（窄宽度下“画布/列表”标签自己折成竖排，是原有的，不属于这条） |
| 8 展开“更多选项”后角色在可视区外 | 修好 | `walk/02-new-plan-more-zh-CN-760.png`：展开后四个角色都在视野内（`PlanRoles` 的 `reveal`） |
| 9 候选显示原始 id | 修好 | `zh-auto-route.png`：“Haiku 5.5 · 本地模型”“Sonnet 5.5 · 本地模型”，不再是 `local:anthropic/…` |
| 10 “现在运行于逐步进行”不通 | 修好（还算通顺） | `A/walk-after/12-how-it-runs-zh-CN-1440.png`：“Card checkout for launch”现在按逐步进行运行。选择从现在起怎么运行。 |

### 2. 新建计划与计划设置的对应

| 新建计划里能设的 | 计划设置里 | 说明 |
|---|---|---|
| 目标（Goal） | 无 | 目标是计划的内容，不是设置；改它走计划对话/`plans.edit`，设计里本来就没有 |
| 项目（只在没从项目进来时可选） | 项目，只读 | PlanSettingsSheet.tsx 的 Project 行 |
| 运行于（RunsOnRow） | 运行于，只读（`RunsOnLabel`，没配对电脑不显示） | 移动用 ••• › 迁移到 |
| 如何运行（`AutonomyCards`） | 如何运行（同一组件，标“现在”，改了先说会变什么） | PlanSheets.tsx 导出 `AutonomyCards` |
| 何时运行测试（`TESTS_AT`） | 何时运行测试（同样的选项和说明） | |
| 更多选项 › 架构 / 编码 / 审计 / 疑难修复 | 谁来做哪部分 › 同四项 | 都是 `<PlanRoles>`（PlanSheets.tsx:109，PlanSettingsSheet.tsx:102），选项来自同一个 `roleEntries`，顺序同为 `PLAN_ROLES` = arch, work, check, fix；只有“新建里折叠、设置里常开”不同 |

结论：每一项都有对应，通过。

### 3. 切换角色、改测试时机的中文提示和动态

通过。`plan-zh.spec.ts` 的断言是真的在查：保存后 toast 必须含“计划设置已保存”和“Claude (Opus) 负责审计这个计划的里程碑”，
且 toast 里除模型名外没有英文字母词；动态里必须含“从现在起把审计交给 Claude (Opus)”和“只在最后一步运行测试套件”。
看了 `.beluga/scratch/zh-toast.png`（“计划设置已保存 · 从现在起，里程碑检查跳过测试套件；……· Claude (Opus) 负责审计这个计划的里程碑，并审阅它的草稿”）
和 `zh-feed.png`（“你 从现在起把审计交给 Claude (Opus)”“你 只在最后一步运行测试套件”）。
保留的一条英文：`你 passed “Test-mode foundations”`，上游模板，文档第三节已写明不修。
注意：`zh-feed.png` 是对话框元素截图，toast 盖在它下面，不影响内容。

### 4. 手机端

通过。
- `packages/companion/app/plan/[id].tsx` 里没有“Plan Settings”，仍是自己的 ⋯ 条目（Agent for its checks / architecture / hard fixes，第 141–160 行）和自动驾驶卡片；本次改动没动 `src/`、`packages/companion`，也没新增 API 方法（`git diff 4673d3ba..HEAD --stat` 里没有这些路径）。
- `src/companion/coverage.ts:443`：`'plans.setTestsAt': 'mac',`。
- `src/fork/coverage.ts:13-17`：`setCheckAgent / setArchAgent / setFixAgent` 仍是 `'phone'`（手机各有自己的选择行），`setAutonomy`、`setWorkAgent` 在 `src/companion/coverage.ts:440、445` 也是 `'phone'`。
- `docs/parity.fork.md:25` 写明“Mac only；the phone keeps its plan page’s ⋯ items”，和实际一致。

### 5. 新问题（按严重度）

1. **中（体验）“保存/取消”在 1280×900 下被折在可视区外。**`A/zh-plan-settings-full.png`：计划设置高 648 像素，底下“取消/保存”只露上半截。
   原因是 `components/form.module.css:7-13` 整个 `.form`（标题、字段、按钮）一起滚动，按钮不固定；计划设置比其他表单高得多，改完角色后看不到保存键，要自己往下滚（⌘↩ 可以保存）。
   这是共用表单的行为，不是新代码的错，但计划设置是第一个高到触发它的表单。修法：给 `.buttons` 加 `position: sticky; bottom: 0`，或让 `.fields` 滚、按钮固定（改 fork 之外的共用样式，需单独决定）。
2. **低（逻辑）`PlanSettingsSheet.tsx` 的“只发改了的”对角色是对的（对比的是打开时的快照 `start`，`roleChanges` plan-roles-model.ts:102 起，`v === from[role]` 跳过），但对运行方式和测试时机对比的是实时的 `plan.autonomy` / `plan.testsAt`（第 42、44、65 行）。**
   打开后别处把测试时机或运行方式改了、而你没碰这两项，保存会把它们改回打开时的旧值，且会写一条动态。和上面“角色以打开时为准”的注释不一致。修法：这两项也存一份打开时的值再比。
3. **低（保存失败的反馈）**`onSubmit` 先 `close()` 再逐项保存；中途某项失败只有 `act` 自己的错误提示，没有“保存了哪几项”的说明，已成功的几项不会回滚。可接受，但文档第二节“一次保存一次说清”在失败时不成立。
4. **低（工具）`e2e/plan-roles-walk.spec.ts` 已过时，WALK 运行必失败（中英文各两个用例）。**第 68–70 行还去悬停已被删掉的“验收/架构/疑难修复”子菜单（超时），第 96 行还找旧组名 `Checking the Work|审计`（现在是 Plan Audits / 计划审计）。
   它是 BLG-121 的“改动前走查”脚本，改完没跟着改；修法：删掉 08–10 三行，第 96 行换成 `Plan Audits|计划审计`。我这次的 08–15 号旧图（`.beluga/scratch/walk/08-…` 起，时间戳 15:06–15:07）是改动前的，别当证据用。
5. **低（测试）`plan-zh.spec.ts:19` 的 `NAMES` 白名单含 `Agent|Issue|Actions|Overview|Mac|Markdown`，会把中文界面里漏掉的“Agent”一并放过**（侧栏“外部 Agent”就是这样留着的，设置侧栏同理）。建议只在有名字的位置放行。
6. **低（fork 文件规则）**新代码基本在新文件里：`PlanSettingsSheet.tsx`、`PlanRoles.tsx`、`plan-roles-model.ts`、`plan-roles.module.css`。上游文件的改动：`PlanPage.tsx` 净删 31 行并加 1 行菜单项；`WorkSheets.tsx` 1 个 case；`sheets.ts` 1 行；`PlanSheets.tsx` 把角色行换成 `<PlanRoles>` 并导出 `AutonomyCards`（净删）。
   略超“只加接入行”的是 `plans-model.ts` 的 `feedKind` 一行改动外加新正则常量 `ROLE_NOTE`（4 行）和 `plans.module.css` 三行换行样式——都小，但按 docs/fork.md 严格说该放到 fork 文件里，由 `feedKind` 只留一行调用。
7. **低（中文）**其余中文界面里没发现漏掉的英文（`english()` 检查过新建计划、••• 菜单、计划设置、保存提示、自动路由四组）。唯一英文是上面的 `passed “…”`，设计里已记。`This plan is gone.` 的兜底提示在 `zh-CN.json` 里已有译文。

### 审计之后的处理（实施方）

| 审计新问题 | 处理 |
|---|---|
| 1 中：1280×900 下保存键在可视区外 | 没改共用表单（上游）；计划设置变矮：项目和“运行于”并成一行，运行方式没改时不再重复卡片下的说明（新建对话框本来也不显示）。`plan-settings.spec.ts` 加断言：1280×900 打开时“保存”完整在视野内。截图 `zh-plan-settings.png` |
| 2 低：运行方式和测试时机对比实时值 | 改成和角色一样，对比打开时的值；别处同时改过的不会被改回 |
| 3 低：中途失败没有汇总 | 不改：每项失败各有错误提示，有失败时不显示“已保存”。写在这里备查 |
| 4 低：走查脚本过时 | 删掉 08–10 三个已不存在的子菜单，组名换成 Plan Audits / 计划审计；`WALK=1` 四个用例重新全过 |
| 5 低：白名单含 Agent | `plan-zh.spec.ts` 白名单去掉 Agent，仍然通过 |
| 6 低：feedKind 正则在上游文件里 | 正则挪到 fork 自己的 `plan-roles-model.ts`（`roleNote`），`plans-model.ts` 只留一个 import 和一次调用 |
| 问题 1“部分”：上游子菜单叫“执行工作的智能体” | fork 词表覆盖为“编码智能体”，和计划设置的“编码”一致；英文原文不动 |
