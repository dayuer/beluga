# Studio 协议、客户视图与动作白名单（接口说明）

依据：`docs/superpowers/specs/2026-11-10-beluga-studio-design.md`（M1 修订版）§3、§4、§5。本文只定形状和规则，
实施在 `src/studio/protocol.ts`（zod）、`src/studio/sanitize.ts`、`src/studio/view.ts`、`src/studio/actions.ts`。
四个文件都是纯函数、browser-safe，都列进 `tests/browser-safe.test.ts`。`protocol.ts` 只依赖 zod。

## 1. 版本

`STUDIO_PROTO = { major: 1, minor: 1 }`（M3 加了 `patch`，只做加法）。

- 同一个 `major` 内只做加法：新字段都是可选的，新 `kind`、新回执码只追加。
- 中台入口对 daemon 发来的视图用 `.strict()`，所以**中台先升级，daemon 后升级**；daemon 在 `hello` 里报自己的
  `minor`，中台按它的 `minor` 决定能收哪些字段，中台的 `minor` 比 daemon 旧时标"工作室需要更新"。
- 客户端对视图用同一 schema 的宽松版（`StudioPlanViewLoose`：去掉 `.strict()`，未知字段忽略）。

## 2. 长度上限（所有字符串都有上限）

| 名字 | 上限 | 用在 |
|---|---|---|
| `REF` | 64 | `planRef`、`milestoneRef`、`taskRef`、`decisionId`、turn id |
| `TITLE` | 200 | 计划、里程碑、任务、决策选项的标题 |
| `TEXT` | 4000 | 目标、对话消息、"还不行…"原因、checker 结论 |
| `LINE` | 400 | 验收标准每条、动态每条、决策选项描述 |
| `ANSWER` | 2000 | 决策的自由回答 |
| 数组 | 里程碑 ≤ 40、每里程碑任务 ≤ 60、每条标准列表 ≤ 20、决策 ≤ 40、turns ≤ 50、动态 ≤ 30、差异每组 ≤ 100 | |

## 3. `StudioPlanView`（白名单构造）

`view.ts` 的 `studioPlanView(input)` 只读下面"来源"一列，**逐字段拷贝**，不展开、不复制 `planPageView` 的输出。
所有对象都是 `.strict()`。标"净化"的字段过 §5 的 `sanitizeText`。

输入 `StudioViewInput`：`{ planRef, view: PlanView /* src/core/plans/progress.ts 的 planView(plan, board) */,
turns?: StudioTurn[], typing?: boolean, moreTurns?: boolean, gate?: StudioGate, roles?: Record<string,string> }`。
`planRef` 由 daemon 传入（不透明，不含计划 id）；`roles` 是 AI 角色名映射（P1 有默认值）。

| 字段 | 类型 | 来源 | 净化 |
|---|---|---|---|
| `planRef` | `REF` | 输入 `planRef` | — |
| `draftRev` | int ≥ 0 | `plan.draftRev` | — |
| `title` | `TITLE` | `shownBody(plan).title` | 是 |
| `goal` | `TEXT` | `shownBody(plan).goal` | 是 |
| `stage` | `drafting \| awaiting-start \| running \| awaiting-review \| done` | `plan.status`、`plan.body` 有无、`gate`、是否有里程碑在 `gate` 状态 | — |
| `waitingOn` | `customer \| studio \| ai` | 由 `stage`、待答决策、`gate` 推出 | — |
| `headline` | `LINE` | 由 `stage` 与当前里程碑标题拼成的固定句式（不取 agent 文本） | 是 |
| `progress` | `{ done, total }` int | `view.done`、`view.total` | — |
| `milestones[]` | 见下 | `view.milestones` | |
| `milestones[].ref` | `REF` | 位置编号 `m<index>`（不用计划内 id，那是 agent 起的 slug） | — |
| `milestones[].title` / `goal` | `TITLE` / `TEXT` | `milestone.title` / `goal` | 是 |
| `milestones[].criteria[]` | `LINE[]` | `milestone.criteria` | 是 |
| `milestones[].status` | `planned \| waiting \| working \| checking \| review \| passed` | `MilestoneState` 映射（`draft→planned`、`later→waiting`、`running/failed/merging→working`、`checking→checking`、`gate→review`、`passed→passed`） | — |
| `milestones[].tasks[]` | 见下 | `MilestoneView.tasks` | |
| `tasks[].ref` | `REF` | `m<i>-t<j>` | — |
| `tasks[].title` | `TITLE` | **`task.title`**（不是拼好的 `KEY 标题`；`issue.key` 永不读取） | 是 |
| `tasks[].goal` | `TEXT`，可选 | `task.goal` | 是 |
| `tasks[].acceptance[]` | `LINE[]` | `task.acceptance` | 是 |
| `tasks[].status` | `planned \| waiting \| doing \| done` | `TaskState` 映射（`draft→planned`；`later/blocked/ready→waiting`；`running/asking/idle/stalled→doing`；`FINISHED→done`） | — |
| `decisions[]` | 见下 | 只取 `task.decision` 存在、`task.audience === 'customer'` 的任务；计划级 `body.decisions` **不读** | |
| `decisions[].decisionId` | `REF` | `d-m<i>-t<j>` | — |
| `decisions[].question` | `TEXT` | `decision.question` | 是 |
| `decisions[].options[]` | `{ id: 'o<k>', label: TITLE, description?: LINE }` | `decision.options` | 是 |
| `decisions[].multi` | bool | `decision.multi` | — |
| `decisions[].open` | bool | 任务未完成且可答 | — |
| `turns[]` | `StudioTurn[]` | 输入 `turns`（由 `chat.ts` 产生，已是客户可见的轮次），这里再净化一次 `text` | 是 |
| `typing` | bool | 输入 | — |
| `moreTurns` | bool | 输入 | — |
| `activity[]` | `{ at: int, text: LINE }` | `plan.activity` 里 `kind` 属于 `started / finished / passed / approved / changed / done` 的事件，文字用固定句式加里程碑或任务标题，**不取 `event.text`** | 是 |
| `review` | 可选 `{ milestoneRef, verdict: pass \| fail, notes: TEXT }` | 待验收里程碑的 `run.check` | 是（notes） |
| `draftDiff` | 可选 `StudioDraftDiff` | `plan.body` 与 `plan.draft` 都在时，按标题比较 | 是 |
| `gate` | 可选 `StudioGate` | 输入 `gate` | 是（reason） |

明确不出现：`needsYou`、`topic`、`checker`、`agentNow`、`agent`、`checkAgent`、`agents`、`issue`/`KEY`、`touches`、
`blockedBy`、`worktree`、`branch`、`base(s)`、`why`、qid、approval id、方法名、`plan.id`、`projectId`、`home`、
`body.decisions`、`review.findings`（运营方的草稿复审，不给客户）。

### 3.1 `StudioTurn`

`{ id: REF, who: 'customer' | 'ai' | 'studio', role?: TITLE, name?: TITLE, text: TEXT, at: int, opId?: uuid }`。

### 3.2 `StudioDraftDiff`

`{ draftRev, added: [{ kind: 'milestone' | 'task', title, under?: TITLE }], changed: [{ kind, title, before: TEXT, after: TEXT }],
removed: [{ kind, title }] }`。按里程碑标题和任务标题对齐（不暴露计划内 id）；`before`/`after` 是目标与验收标准的净化文字。

### 3.3 `StudioGate`

`{ kind: 'start' | 'changes', state: 'pending' | 'approved' | 'declined', draftRev, reason?: TEXT }`。

### 3.4 P2/P3 的字段位置（只做加法）

- P2 `previews?: [{ milestoneRef, kind: 'testflight' | 'apk' | 'miniprogram' | 'web', title, url?, expiresAt? }]`（交付 Gate 放行后才有）。
- P2 `gate.kind` 追加 `'deliver'`。
- P3 `entitlement?: { tier: TITLE, expiresAt?: int }`；`gate.overLimit?: { projects?: int, activePlans?: int }`。
- P2 `chat.send` 的 payload 追加可选 `attachments`。

## 4. 帧

所有帧是 `z.discriminatedUnion('t', …)`，每个分支 `.strict()`。

daemon → 中台：

- `hello`：`{ t, proto: { major, minor }, daemon: REF, projects: [{ id: REF, name: TITLE }] }`（签名在传输层，M3 定）。
- `plan`：`{ t, rev: int, view: StudioPlanView }` 全量。
- `plan-gone`：`{ t, planRef }`。
- `patch`（M3 追加，`minor = 1`）：`{ t, project: REF, planRef: REF, rev: int, set?: {顶层字段}, turns?: StudioTurn[] (≤50) }`。
  `set` 只放 `StudioPlanView` 顶层里变了的字段；中台要求 `rev === 缓存 rev + 1`，合并后整份再过 strict schema。
  线上的外层信封（`{t:'for', project, frame}` 等）见 `docs/studio-hub.md` §10，本文只列内层帧。
- `receipt`：见下。

中台 → daemon：`action`、`resync`、`welcome`、`outdated`（信封见 `docs/studio-hub.md` §10）。中台 → 客户端：
`plan`、`plan-gone`、`receipt`。客户端 → 中台：`action`。

### 4.1 动作帧

`{ t: 'action', opId: uuid, kind, planRef?: REF, payload }`，按 `kind` 判别，每个 payload `.strict()`：

| `kind` | `planRef` | `payload` |
|---|---|---|
| `plan.create` | 无 | `{ goal: TEXT(min 1), platforms: ('ios' \| 'android' \| 'miniprogram' \| 'web')[] (1–4, 不重复) }` |
| `chat.send` | 必须 | `{ text: TEXT(min 1) }` |
| `plan.verify` | 必须 | `{}` |
| `plan.requestStart` | 必须 | `{ draftRev }` |
| `decision.answer` | 必须 | `{ decisionId, picks?: ('o<k>')[], text?: ANSWER }`（至少一个） |
| `milestone.pass` | 必须 | `{ milestoneRef, draftRev }` |
| `milestone.sendBack` | 必须 | `{ milestoneRef, draftRev, reason: TEXT(min 10) }` |
| `draft.apply` | 必须 | `{ draftRev }` |
| `draft.discard` | 必须 | `{ draftRev }` |

客户端不发 `customerId`、`projectId`、`studioId`：中台从会话和绑定补上，放在中台内部的信封里，不进这个帧。

### 4.2 回执帧

`{ t: 'receipt', opId: uuid, state: 'done' | 'refused' | 'queued' | 'expired', code?, planRef? }`。

`code`（`state` 为 `refused` 时必有）：`not-allowed`、`bad-args`、`stale`、`not-yours`、`already-done`、`rate-limited`、
`not-open`（决策已答或不给客户、里程碑不在待验收）、`unknown-plan`。客户端按码显示客户语言；不带任何原文原因。

## 5. 客户文本净化器 `sanitizeText(text, max)`

规则见设计 §4.2，按顺序执行：先折叠同形字（全角字母数字、各种连字符和斜杠、零宽与格式字符、拉丁词里的西里尔和希腊字母），并把输入截到 20000 字；然后围栏（```` ``` ```` 与 `~~~`，含未闭合、在引用或列表里、缩进的，各换成"（代码已省略）"）→ 行内代码（连内容）→ 无围栏的代码（连续两行以上像代码的行，或单行三个以上代码符号，换成"（代码已省略）"）→ markdown 图片（整段）与
链接（留文字）→ URL 的 query 与 fragment、带 token 的 URL 整个去掉 → 绝对路径、`~/`、`./`、`../`、三段以上 `a/b/c`、
以扩展名结尾的文件名、点开头的文件名 → 分支（`plan/…`、`beluga/…`、`feature/…`、`fix/…`）→ `ws:`/`conv:`/`client:`
id、`pl_`/`ws_` 这类 id、≥ 16 位 hex、≥ 24 位 base64 → 任务 KEY（`[A-Z][A-Z0-9]+-\d+`，允许表外的）→ 模型与运行时名 →
疑似密钥（`sk-…`、`ghp_…`、`AKIA…`、`Bearer …`、`NAME=value`）→ 收拢空白与多余标点 → 若剩下的可读量（每个汉字、每个其他文字的词各算一）不到原文的 25% 或少于 4，且
原文 ≥ 20，整段换成"（技术细节已省略）"→ 截到 `max`。

不误伤：两段斜杠（`iOS/Android`、`3/8`、`和/或`）、`COVID-19`、`ISO-8601`、`UTF-8`、`H5`、普通中英文句子、数字与日期、
`Apple`、`Google`、`Web`。

必须测试的对抗样例：

| 类 | 样例 |
|---|---|
| 行内代码 | ``改了 `login()` 函数``、``用 `npm run build` `` |
| 围栏 | ```` ```ts … ``` ````、`~~~ … ~~~`、未闭合的 ```` ``` ```` |
| 绝对与相对路径 | `/Users/me/app/src/auth.ts`、`~/.beluga/x`、`./src/a`、`../lib/b`、`C:\repo\a.ts`、`src/studio/view.ts` |
| 文件名 | `login.tsx`、`.env`、`package.json`、`Podfile.lock` |
| 分支 | `plan/synon-studio-p1`、`beluga/blg-52-m1`、`feature/login` |
| worktree / 会话 id | `ws:abc123def`、`conv:ws:9f8e7d6c5b4a3921`、`pl_1a2b3c4d` |
| 模型与运行时名 | `claude-opus-5-5`、`Claude Sonnet`、`OPUS`、`gpt-5`、`codex`、`Fable`（大小写混写） |
| 任务 KEY | `BLG-52`、`blg-52`（小写不当 KEY，但若在允许表外的大写形式出现则去） |
| 密钥 | `sk-ant-xxxx`、`ghp_xxx`、`AKIAxxxx`、`Bearer eyJ…`、`API_KEY=abc` |
| 链接与图片 | `[文档](https://x.dev/a?token=1)`、`![截图](/tmp/a.png)` |
| 动态里的路径 | 动态事件 `text` 写"Edited src/auth.ts"（view.ts 不取 `event.text`，测试断言它不出现） |
| 无围栏代码 | 缩进的 `const user = await login(email);` 加 `if (!user) { return null; }`；`修好了 if (a && b) { run(); } 的问题` |
| 中文夹路径 | "我把 src/auth/login.ts 改好了，分支 plan/ab12" |

## 6. 动作白名单 `src/studio/actions.ts`

两层，两个纯函数：

1. **`checkAction(frame, ctx)`**：客户动作帧 → 结论。`ctx` 是 daemon 或中台当时的状态快照：
   `{ scope: { studio, plan? }, seen: (key) => Receipt | undefined, plan?: { started: boolean, draftRev, milestones: { ref → awaitingReview: boolean },
   decisions: { decisionId → { audience, open, options } } } }`。
   结论：
   - `{ ok: false, code }`（`refused`），或
   - `{ ok: true, replay: Receipt }`（同一 opId 已处理：返回第一次的回执，不再执行），或
   - `{ ok: true, call: { method, args } }`（daemon 要发的一次内部调用），或
   - `{ ok: true, gate: { kind: 'start' | 'changes', draftRev } }`（`plan.requestStart`、`draft.apply`：只产生 Gate，结果里没有 `plans.approve`）。
   规则：未知 `kind`（含大小写不同）→ `not-allowed`；帧不过 schema → `bad-args`（带 `thenApprove`、`autonomy`、`agent`、`testsAt`、
   `projectId` 都在这里被拒）；`draftRev` 不等 → `stale`；`draft.discard` 在未开工计划上 → `not-allowed`；`decision.answer` 的决策不是
   customer 或已不 open → `not-open`；选项 id 不存在 → `bad-args`。
   opId 去重键：`${studio}\u0000${plan ?? 'new'}\u0000${opId}`。
2. **`callRefusal(method, args)`**：daemon 执行前对内部调用再判一次（也是遍历 `PLANS_API` 测试的对象）。只放行：
   `plans.create`（只有 `projectId`、`goal`）、`plans.verify`（第二个参数缺省或 `{}`；有 `thenApprove` 一律拒）、`plans.pass`、
   `plans.sendBack`、`plans.discard`、`session.submit`、`questions.answer`。`plans.approve` 永远拒（原因："只能从开工 Gate 批准"），
   Gate 批准路径不经过这个函数。`host.answerApproval` 永远拒。其余返回"不在客户白名单里"。

Gate 批准（M4 `gates.ts`）调用 `plans.approve` 前比对 `draftRev`，不在本文范围。

## 7. 调用方的义务（M1 审计结论）

- **客户端按纯文本渲染**视图里的所有文字（不当 markdown，不当 HTML）。净化器不处理 `cla****ude`、`&shy;`、`&#60;img…&#62;` 这类只有按 markdown/HTML 渲染才会还原的写法；M5/M6 的客户端测试要断言这一点。
- **daemon 构造视图时传入本工作室的任务 KEY 前缀**（`studioPlanView({ keyPrefixes })`，内部传给 `sanitizeText(text, max, { keyPrefixes })`）：不传时，小写的 `blg-52` 与看着像普通词的 `PM-12` 会保留。
- **净化器挡不住故意伪装**（`c(l(a(u(d(e)))))`、`s r c / a u t h`、小型大写字母、用话念出路径）。边界是客户回合的受限工具集（设计 §3.5），不是净化器。
- 客户文字交给 agent 一律用 `wrapCustomerText`（`actions.ts`）：开头是标记，`@` 换成全角，不可见字符与仿写的尖括号去掉；`callRefusal` 只放行包好的文字。
