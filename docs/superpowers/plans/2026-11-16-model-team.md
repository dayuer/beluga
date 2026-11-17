# 模型编队 开发计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 删掉上游的 Full Autopilot；计划可以选 Automatic：没人指定的部分（planner、builder、checker）按本机现在能跑的模型搭配，做不下去时自动换模型、向上升级。

**Architecture:** 角色和界面用上游 3.6.0 的（`Plan.planner` / `agent` / `checker`、`plans.setRoleAgent`）。上游的 Full Autopilot（`Plan.fullAuto`、`src/core/autopilot/`、*Never wait for me* 勾选框）整个删掉，运行方式回到三档。本分叉另外只加三样：一个纯函数模块（`src/shared/model-tiers.ts`）把可用模型归成强、中、快三档并搭出三个部分的候选；计划上一个开关 `autoTeam`；一个取人的函数 `teamAgent`，在上游的 `roleAgent` 找不到人时用编队。分叉原来的四个角色、自动路由和它们的界面删掉。

**Tech Stack:** TypeScript、zod、vitest、Playwright（Mac）、React Native（手机）。

**设计文档:** `docs/superpowers/specs/2026-11-16-model-team-design.md`。下文的 §n 指它的章节。

---

## 和上一版计划的区别（2026-11-17，上游 3.6.0 之后）

- **第一期 Full Autopilot（原任务 1–8）整期删掉。** 不要再写 `auto-answer.ts`、`plan_answer`、`plan_defer`、
  `Autonomy` 的第四个值。上游 #556 自己做了一版（`src/core/autopilot/`、`Plan.fullAuto`），3.6.0 已合进 `main`；
  那一版本分叉也不要，由任务 0 删掉（见本节最后一条）。
- **第二期改成建在上游的三个部分之上。** 名字用上游的 `planner` / `builder` / `checker`。不再有 `Plan.team`
  和 `plans.setTeam`：每个部分指定谁，用上游的 `plans.setRoleAgent`；分叉只加 `Plan.autoTeam` 和
  `plans.setAutoTeam`：计划上一个可选的布尔值，一个开关它的方法。
- **第三期没有了。** #546 已被维护者关闭；endpoint 检查早在 `main` 上（`src/fork/endpoint-check.ts`）。
  上游还提不提东西，是最后一节留给负责人的决定。
- 所以只剩**一期、一个 PR、一个 worktree**：分支 `fork/model-team`。
- **2026-11-17 负责人的决定：上游的 Full Autopilot 整个删掉**（设计文档 §8）。新增任务 0，排在最前面，
  这样后面的任务不用去接一个要删的东西。后面任务里原来写"照 `setFullAuto`"的地方都改掉了。
- **2026-11-17 负责人看了计划页的截图后提的：每个部分要能选具体的模型**（设计文档 §7.2）。上游计划页的子菜单
  只列 agent。并进任务 7 第 3 步，不单列任务。手机上不用改：三个部分用的 `AgentChoice` 选择器已经列出
  Mac 上的每个 agent 和模型（已核对 `packages/companion/components/AgentChoice.tsx`）。

## 怎么读这份计划

- 开工：`git worktree add ../beluga-model-team -b fork/model-team main`（`main` 要已经包含 3.6.0 的合并 `a86d20f42`）。
- 任务 0 删 Full Autopilot，做完类型检查和测试是绿的，单独提交。任务 1–6 是内核，7–9 是界面、手机和收尾。
  任务 2–6 中间类型检查是红的，到任务 6 结尾一起变绿、一起提交。
- 每个任务先写失败的测试，再实现。测试遵守 CLAUDE.md "Tests that pass everywhere"：用 `waitFor`
  （`tests/helpers.ts`）等条件；时钟和定时器传进去；路径用 `path.join`。
- **上游的文件尽量少动。** 凡是标了"接入点"的地方，只改写明的那一两行，逻辑放在 `src/fork/`、
  `packages/mac/src/fork/` 里。上游的测试 `tests/plan-roles.test.ts` 里角色的部分不改，必须原样通过。
  唯一的例外是任务 0：它按设计文档 §8 删上游的代码，删干净，不留开关。
- 最后一个任务跑完整的 `npx vitest run`，把结尾的 `Tested-on: macOS <tree>` 一行原样放进最后一次提交。
  本机 git 说中文时用 `LC_ALL=C npx vitest run`。
- 不推送，不开 PR，不碰上游，除非负责人在当次会话里说了。

## 文件一览

| 文件 | 职责 |
|---|---|
| `src/shared/model-tiers.ts`（新） | 能力表、搭配、设置 `team` 的 schema、`teamByDefault` |
| `src/shared/team-migrate.ts`（新） | 旧的 `autoRoute` → `team` |
| `src/fork/plans/team.ts`（新） | `teamAgent`、`taskAgent`、`lineupOf`：一个部分现在该用谁 |
| `src/fork/plans/escalate.ts`（新） | 升级顺序：builder → checker → planner |
| `src/fork/plans/roles.ts`、`fixer.ts`、`ladder.ts` | 只改"换给谁"，机制不动 |
| `src/core/plans/model.ts`、`plans.ts` | `autoTeam`；删 `archAgent`、`fixAgent`；`roleAgent` 改回上游原样 |
| `src/core/plans/work.ts`、`pilot.ts`、`src/core/board/work.ts` | 接入点：取人改调 `teamAgent` / `taskAgent` |
| `src/ipc/plans-api.ts`、`plans-handlers.ts` | `plans.setAutoTeam`、`plans.create` 的 `autoTeam` |
| `src/companion/protocol.ts`、`views.ts`、`coverage.ts` | 1.64：`PlanView.autoTeam`、`team`、`SINCE.autoTeam` |
| `src/shared/auto-route.ts` | 删除 |
| `packages/mac/src/fork/plans/auto-team.ts`（新） | "Automatic"这一项的纯逻辑 |
| `packages/mac/src/plans/AgentRoles.tsx` | 接入点：下拉框多一项，菜单多一行；计划页的子菜单列出具体模型 |
| `packages/mac/src/dialogs/TeamSettings.tsx`（新） | 设置里的开关和自定义表 |
| `packages/companion/app/plan/[id].tsx` | 一行开关；两行旧的按版本隐藏 |
| `src/core/autopilot/`、`src/agent/stand-in.ts`、`packages/mac/src/chat/AutopilotChip.tsx`、`tests/autopilot.test.ts`、`packages/mac/e2e/autopilot.spec.ts` | 删除（任务 0） |
| `tests/fork-no-full-autopilot.test.ts`（新） | 守门：同步上游时它不会悄悄回来 |

---

### Task 0: 删掉 Full Autopilot

设计文档 §8。上游 #556（`a46012a57`）加的 Full Autopilot 整个删掉：计划的 `fullAuto`、聊天里的开关、替身、
Mac 的 *Never wait for me* 勾选框、手机上的两行。同一个提交里上游还加了三个部分的角色（BLG-982）和
"计划等你批准"（BLG-979），**这两样不动**。

不要动的同名东西：`src/machines/` 里的 stand-in（另一台 Mac 顶替常开的那台，BLG-799）、
`src/fork/plans/fixer.ts` 里的 `standIn`、`tests/machines-*.test.ts`。

**Files:**
- Delete: `src/core/autopilot/model.ts`、`src/core/autopilot/stand-in.ts`、`src/agent/stand-in.ts`、
  `packages/mac/src/chat/AutopilotChip.tsx`、`tests/autopilot.test.ts`、`packages/mac/e2e/autopilot.spec.ts`
- Create: `tests/fork-no-full-autopilot.test.ts`
- Modify（内核）: `src/core/plans/model.ts`、`plans.ts`、`work.ts`、`prompt.ts`、`src/core/session.ts`、
  `src/core/collab-store.ts`、`src/core/board/launch.ts`、`src/agent/types.ts`、`side-calls.ts`、`mock.ts`、
  `runtime/router.ts`
- Modify（API、手机链路）: `src/ipc/api.ts`、`handlers.ts`、`plans-api.ts`、`plans-handlers.ts`、
  `src/companion/protocol.ts`、`views.ts`、`calls.ts`、`coverage.ts`、`src/external/coverage.ts`、`src/machines/coverage.ts`
- Modify（Mac）: `packages/mac/src/plans/PlanSheets.tsx`、`PlanPage.tsx`、`plans.module.css`、`packages/mac/src/chat/Composer.tsx`
- Modify（手机）: `packages/companion/app/plan/[id].tsx`、`app/conv/[id].tsx`、`lib/link/calls.ts`、`lib/link/demo/transport.ts`
- Modify（测试、文档）: `tests/plan-roles.test.ts`、`docs/tasks-and-plans.md`、`docs/parity.md`、`docs/companion.md`、`docs/fork.md`

- [ ] **Step 1: 写失败的测试**

`tests/fork-no-full-autopilot.test.ts`：

```ts
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { planAutonomy } from '../src/core/plans/model.js';
import { Plans } from '../src/core/plans/plans.js';
import { Store, initialState } from '../src/core/store.js';
import { fullAutopilotGone } from '../src/fork/no-full-autopilot.js';

const root = path.join(__dirname, '..');

/** Every source file under a folder, node_modules left out. */
function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const at = path.join(dir, name);
    if (statSync(at).isDirectory()) out.push(...sources(at));
    else if (/\.(ts|tsx)$/.test(name)) out.push(at);
  }
  return out;
}

/** Fork: Full Autopilot (upstream BLG-981) isn't part of this Beluga. A sync that brings it back fails here, not as a new checkbox. */
describe('no Full Autopilot (fork)', () => {
  it('has no stand-in that answers for you', () => {
    expect(existsSync(path.join(root, 'src', 'core', 'autopilot'))).toBe(false);
    expect(existsSync(path.join(root, 'src', 'agent', 'stand-in.ts'))).toBe(false);
  });

  it('shows it on neither screen', () => {
    const screens = [path.join(root, 'packages', 'mac', 'src'), path.join(root, 'packages', 'companion', 'app')];
    const found = screens.flatMap(sources).filter((f) => /Never wait for me|Full Autopilot/.test(readFileSync(f, 'utf8')));
    expect(found.map((f) => path.relative(root, f))).toEqual([]);
  });

  it('reads a plan saved on Full Autopilot as one on Autopilot', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'no-full-auto-'));
    try {
      const first = new Plans({ store: new Store(initialState('room')), dir, saveDelayMs: 0 });
      const plan = first.create({ projectId: 'api', home: 'ws:h', autonomy: 'autopilot' }, { kind: 'beluga' });
      first.flush?.();
      // As upstream 3.6.0 saved it: the flag beside autonomy 'autopilot'.
      const file = path.join(dir, 'plans.json');
      const saved = JSON.parse(readFileSync(file, 'utf8')) as { plans: Array<Record<string, unknown>> };
      saved.plans[0]!.fullAuto = true;
      writeFileSync(file, JSON.stringify(saved));
      const again = new Plans({ store: new Store(initialState('room')), dir }).need(plan.id);
      expect('fullAuto' in again).toBe(false);
      expect(planAutonomy(again)).toBe('autopilot');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('answers an older phone that still asks for it with a plain refusal', () => {
    expect(() => fullAutopilotGone()).toThrow(/isn.t part of this Beluga/);
    for (const file of [path.join(root, 'src', 'ipc', 'handlers.ts'), path.join(root, 'src', 'ipc', 'plans-handlers.ts')]) expect(readFileSync(file, 'utf8')).toContain('fullAutopilotGone()');
  });
});
```

搭法照 `tests/plan-roles.test.ts` 第 134–145 行（建计划、`flush`、用同一个目录再开一个 `Plans`）。`plans.json` 里计划
数组的键以实际文件为准（`plans.ts:141` 写的是 `{ version: 1, plans }`）。

- [ ] **Step 2: 确认失败**

Run: `npx vitest run tests/fork-no-full-autopilot.test.ts`
Expected: FAIL（`src/fork/no-full-autopilot.ts` 还没有）。先建这个文件（下一步），再跑一次，四条里前三条 FAIL。

- [ ] **Step 3: 内核**

新文件 `src/fork/no-full-autopilot.ts`：

```ts
/**
 * Fork: Full Autopilot (upstream BLG-981) isn't part of this Beluga. Its two API methods are kept
 * for one release, so a phone on 1.58–1.63 that still offers it gets words it can show.
 */
export function fullAutopilotGone(): never {
  throw new Error('Full Autopilot isn’t part of this Beluga. On Autopilot, what your agents ask still waits for you.');
}
```

然后删文件，跟着类型错误改：

```bash
git rm -r src/core/autopilot src/agent/stand-in.ts tests/autopilot.test.ts
npm run typecheck 2>&1 | grep -E "error TS" | cut -d'(' -f1 | sort | uniq -c
```

`src/core/plans/model.ts`：删 `FULL_AUTOPILOT_INFO` 和它上面的注释、`Plan.fullAuto`。两个函数留着名字
（五个文件在用），去掉 `fullAuto` 那一支：

```ts
/** How the plan runs as a whole. */
export const planAutonomy = (plan: Pick<Plan, 'autonomy'>): Autonomy => plan.autonomy;

/** A milestone's own autonomy, else its plan's. */
export const autonomyOf = (plan: Plan, milestone: PlanMilestone | undefined): Autonomy => milestone?.autonomy ?? plan.autonomy;
```

`src/core/plans/plans.ts`：

- 读存档的 schema 里删 `fullAuto: z.boolean().optional().catch(undefined),` 一行，注释里
  ", and Full Autopilot (BLG-981)" 去掉。这个 schema 是 `.passthrough()` 的，不认识的键会留下，所以要在结尾的
  `transform` 里显式丢掉（`autonomy` 上游当时已经写成了 `autopilot`，不用补）：

```ts
  // A plan saved with the fork's check agent: it's the plan's checker now (one picked since wins).
  // One saved on Full Autopilot (upstream 3.6.0, not in this fork): the flag is dropped, it stays on Autopilot.
  .transform(({ checkAgent, fullAuto: _gone, ...plan }) => (checkAgent && !plan.checker ? { ...plan, checker: checkAgent } : plan));
```
- `create`：参数里的 `fullAuto` 和 `...(input.fullAuto ? { fullAuto: true, autonomy: 'autopilot' as const } : {})` 删掉。
- `setAutonomy`（第 283–286 行）改回：

```ts
    if (autonomy === plan.autonomy && !(plan.body ?? plan.draft)?.milestones.some((m) => m.autonomy)) return plan;
    // A plan-wide choice wins over every milestone's own.
    const clear = (b: PlanBody | undefined): PlanBody | undefined => (b ? { ...b, milestones: b.milestones.map(({ autonomy: _a, ...m }) => m) } : b);
    return this.change(plan, { autonomy, body: clear(plan.body), draft: clear(plan.draft) }, [event(by, 'autonomy', `switched the plan to ${AUTONOMY_INFO[autonomy].label}`, this.now())]);
```

- `setFullAuto` 整个方法删掉。

`src/core/plans/work.ts`：`create` 输入里的 `fullAuto`（第 90 行）和往下传的地方删掉，注释里
"Full Autopilot: BLG-981." 去掉。`setFullAuto`（第 521–5xx 行）整个删掉。

`src/core/plans/prompt.ts` 第 237 行：`plan.fullAuto ? '…Full Autopilot…' : <另一支>` 只留另一支。

`src/core/session.ts`：`standIn`、`setAutopilot` 两个方法和 `StandInRequest` 的 import 删掉。

`src/core/collab-store.ts`：`CollabState.autopilot`（第 130–131 行）、action `{ type: 'autopilot'; … }`（153）、
`initialCollab` 里的 `autopilot: {}`（167）、reducer 的 `case 'autopilot'`（200–201）四处删掉。

`src/core/board/launch.ts`：`AutopilotStandIn` 的 import（32）和第 157–166 行 `const standIn = new AutopilotStandIn({…})`
整段删掉；往下 `grep -n "standIn" src/core/board/launch.ts`，把它的 `stop` / 订阅也删掉。`roleAgent` 的 import
如果因此没人用了，一起删。

`src/agent/`：`types.ts` 第 596–597 行的 `standIn?` 删掉；`side-calls.ts` 的 import、`SideCalls` 里的 `'standIn'`、
第 32 行的实现、注释里那半句删掉；`runtime/router.ts` 第 10 行 `SideCallBackend` 的 `'standIn'` 删掉；
`mock.ts` 第 897–9xx 行的 `standIn: async (req) => {…}` 整段删掉（第 339、857、863 行说的是别的，不动）。

- [ ] **Step 4: API 和手机链路**

`src/ipc/api.ts` 第 171–172 行、`plans-api.ts` 第 75 行：两个方法**留着**，注释改成

```ts
  // Kept for one release (fork): Full Autopilot isn't part of this Beluga; a phone on 1.58–1.63 that still offers it gets a plain refusal.
```

两个 handler 改成只回话（`import { fullAutopilotGone } from '../fork/no-full-autopilot.js';`）：

```ts
  'session.setAutopilot': () => fullAutopilotGone(),   // handlers.ts
  'plans.setFullAuto': () => fullAutopilotGone(),      // plans-handlers.ts
```

`src/companion/coverage.ts`、`calls.ts`、`src/external/coverage.ts`、`src/machines/coverage.ts` 里这两个方法的条目
留着（方法还在，类型检查要它们）；下个版本和方法一起删。

`src/companion/protocol.ts`：

- `ConvView.autopilot`（第 793–796 行）和 `PlanView.fullAuto`（第 855 行）删掉；852 行注释里 BLG-981 那半句去掉。
- `SINCE` 里的 `autopilot: 58` **留着**（编号不复用；老手机靠它画那一行）。
- 第 153–154 行 1.58 的说明后面加一句：

```ts
 * Fork, 1.64: Full Autopilot is gone. The Mac sends neither field any more (an older phone reads "off");
 * `plans.setFullAuto` and `session.setAutopilot` answer with a refusal for one more release.
```

`src/companion/views.ts`：`autopilotIn` 的 import（22）、`...autopilotOf(state, channel),`（787）、
`autopilotOf` 函数（792–796）、`...(plan.fullAuto ? { fullAuto: true } : {}),`（1014）删掉。

- [ ] **Step 5: Mac**

```bash
git rm packages/mac/src/chat/AutopilotChip.tsx packages/mac/e2e/autopilot.spec.ts
```

`packages/mac/src/chat/Composer.tsx`：import（31）、`const autopilot = useAutopilot(channel);` 和注释（240–241）、
模式菜单里的两处 `autopilot.item`（830、847：847 行整个 `...(channel.startsWith('ws:') ? [autopilot.item] : [])` 删掉）、
`<AutopilotChip …/>`（857）删掉。

`packages/mac/src/plans/PlanSheets.tsx`：

- `FullAutoBox`（第 108–115 行）和它的两处使用（95、251）删掉；`FULL_AUTOPILOT_INFO` 的 import 删掉。
- New Plan：`const [full, setFull]`（43）删掉；第 68 行改成
  `const input = { goal: goal.trim(), autonomy, testsAt, ...agents };`
- "How it runs" 表单：`full`、`fullNow`、`fullChange`（188–191）删掉；`nowLabel`（193）改成
  `plan ? AUTONOMY_INFO[plan.autonomy].label : ''`；第 197–198 行两个 `api.setFullAuto` 分支删掉；
  原生表单里 `id: 'full'` 的 checkbox 项（217）和 `else if (id === 'full') …`（227）删掉；
  `fullAutoChange` 函数（265 起）删掉。用到 `fullChange` 的地方跟着类型错误改回只看 `modeChange`。
- 文件头注释第 27 行那半句去掉。

`PlanPage.tsx` 第 390–392 行改回：

```tsx
            <Button variant="quiet" icon="gauge" title={AUTONOMY_INFO[plan.autonomy].hint} …>
              Runs on {AUTONOMY_INFO[plan.autonomy].label}
              {view.milestones.some((m) => m.milestone.autonomy && m.milestone.autonomy !== plan.autonomy) ? ' (mixed)' : ''}
```

（`…` 处的其余属性原样保留。）`plans.module.css` 第 2298 行起的 `.fullAuto` 规则删掉。

分叉自己的 New Plan（`fork/plans/NewPlanSheet.tsx`）本来就没有这个勾选框，这一步不用动它；任务 7 换回上游表单时，
换回的已经是删过勾选框的版本。

- [ ] **Step 6: 手机**

- `packages/companion/app/plan/[id].tsx`：`FULL` 常量（33–34）、`fullOk`（70）、表里 Full Autopilot 一行（185）删掉；
  第 101 行改成 `const how = p?.autonomy && p.autonomy in AUTONOMY ? AUTONOMY[p.autonomy as Autonomy] : undefined;`；
  第 181–183 行改回 `tone: a === p?.autonomy ? …`、`onPress: () => void store.call(calls.setAutonomy(id ?? '', a, …))`。
- `app/conv/[id].tsx`：`autopilotOk`（118–119）和 ••• 表里那一项（400–404）删掉。
- `lib/link/calls.ts`：`setAutopilot`（76–77）、`setFullAuto`（117–118）删掉。
- `lib/link/demo/transport.ts`：`delete p.fullAuto;`（809）和两个 `case`（814–829）删掉。

手机的界面规则不受影响：少了一行，没有多按钮。

- [ ] **Step 7: 上游的测试和文档**

`tests/plan-roles.test.ts`：`describe('Full Autopilot on a plan (BLG-981)', …)` 整组（第 148 行起）删掉；
第 138、141 行去掉 `fullAuto: true`（141 行的断言里 `autonomy: 'autopilot'` 也去掉，除非 138 行的 `create`
自己传了 `autonomy`）；第 8 行没用到的 import、第 16 行注释里 BLG-981 那半句去掉。角色的用例一行不改。

文档：

- `docs/tasks-and-plans.md`：运行方式表里 **Full Autopilot** 一行（202）和 "Full Autopilot's stand-in" 一段（204）删掉。
- `docs/parity.md`：`session.setAutopilot`（144）、`plans.setFullAuto`（700）两行的 Mac 一栏改成
  "— not in this fork: answered with a refusal for one release"（`tests/parity.test.ts` 要求方法还在表里）。
- `docs/companion.md`：加一段"1.64：Full Autopilot 删除"，写清两个字段不再发送、两个方法再答一个版本、
  `SINCE.autopilot` 留着不复用、不升 major 的理由。
- `docs/fork.md`：加一节"没有 Full Autopilot"，写：负责人 2026-11-17 的决定；删了哪些上游文件；同步上游时这些文件
  会冲突，按 `tests/fork-no-full-autopilot.test.ts` 再删一遍；上游的新功能如果建在替身上，要重新评估。

- [ ] **Step 8: 跑测试**

```bash
grep -rnE "fullAuto|FULL_AUTOPILOT|AutopilotStandIn|autopilotIn|Never wait for me|Full Autopilot" src packages/mac/src packages/companion/app packages/companion/lib tests --include="*.ts" --include="*.tsx" | grep -v "fork-no-full-autopilot"
```

Expected: 只剩 `protocol.ts` 的那句说明、`plans.ts` 的 `fullAuto: _gone` 和注释、`fork/no-full-autopilot.ts`、
两个 API 条目的注释、`external/coverage.ts` 的 `AUTOPILOT` 常量。

Run: `npm run typecheck && (cd packages/companion && npm run typecheck) && npx vitest run tests/fork-no-full-autopilot.test.ts tests/plan-roles.test.ts tests/plans.test.ts tests/companion-* tests/parity.test.ts tests/boundaries.test.ts tests/browser-safe.test.ts && (cd packages/mac && npx playwright test e2e/plan-roles.spec.ts e2e/start-with.spec.ts)`
Expected: PASS。

- [ ] **Step 9: 提交**

```bash
git add -A && git commit -m "Remove Full Autopilot (fork)

Upstream's stand-in that answers for you (BLG-981) isn't part of this fork: a plan runs step by
step, with check-ins or on Autopilot, and what its agents ask waits for you. A plan saved on Full
Autopilot goes on on Autopilot. plans.setFullAuto and session.setAutopilot answer older phones
with a refusal for one release.

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>"
```

（这一次提交不带 `Tested-on`：没有跑全量。全量在任务 9。）

---

### Task 1: 能力表和搭配

**Files:**
- Create: `src/shared/model-tiers.ts`
- Test: `tests/model-tiers.test.ts`

- [ ] **Step 1: 写失败的测试**

```ts
import { describe, expect, it } from 'vitest';
import type { RuntimeChoice } from '../src/shared/agent-runtimes.js';
import { Team, lineup, lineupWords, teamByDefault, tierOf } from '../src/shared/model-tiers.js';

const CLAUDE = ['fable', 'opus', 'sonnet', 'haiku'];
const rt = (local: string[] = [], claude = true): RuntimeChoice[] =>
  [
    { id: 'claude', label: 'Claude', available: claude },
    { id: 'local', label: 'Local model', available: local.length > 0, models: local.map((v) => ({ value: v, label: v })) },
  ] as unknown as RuntimeChoice[];
const names = (l: ReturnType<typeof lineup>) => (l ? { planner: l.planner[0]?.model, builder: l.builder[0]?.model, checker: l.checker[0]?.model } : undefined);

describe('a model’s tier, from its name', () => {
  it.each([
    ['fable', 'strong'],
    ['claude-opus-5-5', 'strong'],
    ['sonnet', 'mid'],
    ['bigmodel/glm-5.3[1m]', 'mid'],
    ['zhipu/glm-5.3', 'mid'],
    ['moonshot/kimi-k3', 'mid'],
    ['haiku', 'fast'],
    ['deepseek/deepseek-flash[1m]', 'fast'],
    ['openai/gpt-5-mini', 'fast'],
    ['google/gemini-3-pro', 'mid'],
    ['ollama/qwerty-7b', undefined],
  ])('%s is %s', (model, tier) => {
    expect(tierOf(model, undefined)).toBe(tier);
  });

  it('yours wins over the table', () => {
    expect(tierOf('ollama/qwerty-7b', { tiers: { 'ollama/qwerty-7b': 'fast' } })).toBe('fast');
    expect(tierOf('haiku', { tiers: { haiku: 'mid' } })).toBe('mid');
  });
});

describe('who plans, builds and checks, from what runs here', () => {
  it('Claude alone: the strongest plans, Haiku builds, Sonnet checks', () => {
    expect(names(lineup(undefined, rt(), CLAUDE))).toEqual({ planner: 'fable', builder: 'haiku', checker: 'sonnet' });
  });

  it('without Fable, Opus plans', () => {
    expect(names(lineup(undefined, rt(), ['opus', 'sonnet', 'haiku']))).toEqual({ planner: 'opus', builder: 'haiku', checker: 'sonnet' });
  });

  it('strong and fast only: the strong one checks too', () => {
    expect(names(lineup(undefined, rt(), ['opus', 'haiku']))).toEqual({ planner: 'opus', builder: 'haiku', checker: 'opus' });
  });

  it('strong and mid only: the mid one builds, the strong one checks', () => {
    expect(names(lineup(undefined, rt(), ['opus', 'sonnet']))).toEqual({ planner: 'opus', builder: 'sonnet', checker: 'opus' });
  });

  it('mid and fast only: the mid one plans and checks', () => {
    expect(names(lineup(undefined, rt(), ['sonnet', 'haiku']))).toEqual({ planner: 'sonnet', builder: 'haiku', checker: 'sonnet' });
  });

  it('one tier only: no team (one model does everything, as before)', () => {
    expect(lineup(undefined, rt(), ['sonnet'])).toBeUndefined();
    expect(lineup(undefined, rt(['bigmodel/glm-5.3', 'moonshot/kimi-k3'], false), [])).toBeUndefined();
  });

  it('your default agent’s runtime comes first in a tier, the others are its fallbacks', () => {
    const l = lineup(undefined, rt(['deepseek/deepseek-flash', 'bigmodel/glm-5.3']), CLAUDE, 'local')!;
    expect(l.builder.map((a) => a.model)).toEqual(['deepseek/deepseek-flash', 'haiku']);
    expect(l.checker.map((a) => a.model)).toEqual(['bigmodel/glm-5.3', 'sonnet']);
    expect(l.planner.map((a) => a.model)).toEqual(['fable', 'opus']);
  });

  it('a model it doesn’t know only builds, and only when nothing fast is here', () => {
    expect(names(lineup(undefined, rt(['ollama/qwerty-7b']), ['opus', 'sonnet']))).toEqual({ planner: 'opus', builder: 'ollama/qwerty-7b', checker: 'sonnet' });
    expect(lineup(undefined, rt(['ollama/qwerty-7b']), CLAUDE)!.builder.map((a) => a.model)).toEqual(['haiku']);
  });

  it('a greyed model is skipped', () => {
    const runtimes = [{ id: 'claude', label: 'Claude', available: true }, { id: 'local', label: 'Local model', available: true, models: [{ value: 'deepseek/deepseek-flash', label: 'd', why: 'not answering' }] }] as unknown as RuntimeChoice[];
    expect(lineup(undefined, runtimes, CLAUDE, 'local')!.builder.map((a) => a.model)).toEqual(['haiku']);
  });

  it('your own list for a role replaces the table’s, skipping what doesn’t run here', () => {
    const team: Team = { builder: ['local:moonshot/kimi-k3', 'local:gone/model', 'claude:sonnet'] };
    const l = lineup(team, rt(['moonshot/kimi-k3']), CLAUDE)!;
    expect(l.builder.map((a) => a.model)).toEqual(['moonshot/kimi-k3', 'sonnet']);
    expect(l.planner[0]!.model).toBe('fable');
  });

  it('your lists make a team even where the table finds one tier', () => {
    expect(names(lineup({ planner: ['claude:sonnet'], builder: ['claude:sonnet'], checker: ['claude:sonnet'] }, rt(), ['sonnet']))).toEqual({ planner: 'sonnet', builder: 'sonnet', checker: 'sonnet' });
  });
});

describe('the lineup in words, and whether new plans start on it', () => {
  it('says the lineup in one line', () => {
    expect(lineupWords(lineup(undefined, rt(), CLAUDE)!)).toBe('Fable plans · Haiku builds · Sonnet checks');
  });

  it('new plans are automatic as you set it; unset, once a local model runs here (auto route’s old rule)', () => {
    expect(teamByDefault({ byDefault: true }, rt())).toBe(true);
    expect(teamByDefault({ byDefault: false }, rt(['bigmodel/glm-5.3']))).toBe(false);
    expect(teamByDefault(undefined, rt())).toBe(false);
    expect(teamByDefault(undefined, rt(['bigmodel/glm-5.3']))).toBe(true);
  });
});

describe('the setting', () => {
  it('takes lists of runtime:model and tiers by model', () => {
    expect(Team.safeParse({ byDefault: true, builder: ['local:deepseek/deepseek-flash[1m]'], tiers: { 'ollama/x': 'fast' } }).success).toBe(true);
    expect(Team.safeParse({ builder: ['not a choice'] }).success).toBe(false);
    expect(Team.safeParse({ tiers: { x: 'huge' } }).success).toBe(false);
  });
});
```

- [ ] **Step 2: 跑一次，确认失败**

Run: `npx vitest run tests/model-tiers.test.ts`
Expected: FAIL，找不到 `model-tiers.js`。

- [ ] **Step 3: 实现**

`src/shared/model-tiers.ts`：

```ts
/**
 * A model team: who plans, who builds and who checks a plan on Automatic, worked out from the models that run on this
 * computer now. Each model is put in a tier by its name (strong, mid, fast); the strongest plans
 * (and takes over what's hard), a fast one builds, one between checks. Fewer tiers here: see
 * `lineup`. One tier, or one model: no team, and everything runs on one model as it always did.
 * Worked out when work starts and never kept on a plan or task, so a teammate's computer never
 * sees an endpoint only yours has. Browser-safe: the daemon, the Mac app and the phone import it.
 */
import { z } from 'zod';
import type { AgentRef } from '../protocol.js';
import type { RuntimeChoice } from './agent-runtimes.js';
import { modelName } from './agent-label.js';

export const TIERS = ['strong', 'mid', 'fast'] as const;
export type Tier = (typeof TIERS)[number];
/** The same three parts as core/plans/model.ts PLAN_ROLES (kept here too: shared/ can't import core/). */
export const ROLES = ['planner', 'builder', 'checker'] as const;
export type Role = (typeof ROLES)[number];

/** A candidate, as the agent pickers value one: `runtime:model`. */
const CHOICE = /^[a-z][a-z0-9-]{0,19}:\S{0,64}$/;
export const MAX_CANDIDATES = 8;

/** Settings › Agent › model team, kept in settings.json. Every field unset: worked out from what runs here. */
export const Team = z.object({
  /** New plans start on Automatic. Unset: see teamByDefault. */
  byDefault: z.boolean().optional(),
  planner: z.array(z.string().regex(CHOICE)).max(MAX_CANDIDATES).optional(),
  builder: z.array(z.string().regex(CHOICE)).max(MAX_CANDIDATES).optional(),
  checker: z.array(z.string().regex(CHOICE)).max(MAX_CANDIDATES).optional(),
  /** A model's tier as you set it, by its value (a local one: "<endpoint id>/<model>"). */
  tiers: z.record(z.string().max(64), z.enum(TIERS)).optional(),
});
export type Team = z.infer<typeof Team>;

/**
 * Families by name, the first that matches. The fast ones come before the families they belong
 * to ("gpt-5-mini" is fast, "gpt-5" mid). A name none matches has no tier: see `lineup`.
 */
const FAMILIES: ReadonlyArray<readonly [RegExp, Tier]> = [
  [/fable/i, 'strong'],
  [/opus/i, 'strong'],
  [/gpt-[5-9][\w.]*-pro|\bo[3-9]-pro/i, 'strong'],
  [/haiku/i, 'fast'],
  // "mini" on its own, not the one inside "gemini".
  [/flash|(?<![a-z])mini|nano|(?<![a-z])lite|turbo/i, 'fast'],
  [/sonnet/i, 'mid'],
  [/gpt-[5-9]|glm|kimi|deepseek|qwen|gemini|grok|mistral/i, 'mid'],
];

const familyOf = (model: string): number => FAMILIES.findIndex(([re]) => re.test(model));

/** A model's tier: yours, else by its name; undefined when the name says nothing. */
export function tierOf(model: string, team: Pick<Team, 'tiers'> | undefined): Tier | undefined {
  const mine = team?.tiers?.[model];
  if (mine) return mine;
  const at = familyOf(model);
  return at < 0 ? undefined : FAMILIES[at]![1];
}

/** Whether a runtime's model runs here now, as the pickers say (a greyed one doesn't). */
export function runsHere(runtimes: readonly RuntimeChoice[], runtime: string, model: string): boolean {
  const r = runtimes.find((x) => x.id === runtime);
  if (!r?.available) return false;
  if (!model || runtime === 'claude' || !r.models) return true;
  const m = r.models.find((x) => x.value === model);
  return Boolean(m && !m.why);
}

const refOf = (runtimes: readonly RuntimeChoice[], runtime: string, model: string): AgentRef => ({ runtime, label: runtimes.find((r) => r.id === runtime)?.label ?? runtime, ...(model ? { model } : {}) });

/** Every model that runs here now. Claude's are its own list (`claudeModels`: the pickers' `state.models` values). */
function runnable(runtimes: readonly RuntimeChoice[], claudeModels: readonly string[]): AgentRef[] {
  const out: AgentRef[] = [];
  for (const r of runtimes) {
    if (!r.available) continue;
    const models = r.id === 'claude' ? claudeModels.filter(Boolean) : (r.models ?? []).filter((m) => m.value && !m.why).map((m) => m.value);
    for (const model of models) out.push(refOf(runtimes, r.id, model));
  }
  return out;
}

/** Each role's candidates, in order: the first works it, the rest stand in when it can't. */
export type Lineup = Readonly<Record<Role, readonly AgentRef[]>>;

function mine(list: readonly string[], runtimes: readonly RuntimeChoice[]): AgentRef[] {
  const out: AgentRef[] = [];
  for (const value of list) {
    const at = value.indexOf(':');
    if (at <= 0) continue;
    const runtime = value.slice(0, at);
    const model = value.slice(at + 1);
    if (runsHere(runtimes, runtime, model)) out.push(refOf(runtimes, runtime, model));
  }
  return out;
}

/**
 * Who plans, builds and checks here. By tier: strong plans, fast builds, mid checks. A tier
 * missing: with no mid the planner checks; with no fast the mid builds (and the planner
 * checks); with no strong the mid plans. Within a tier your default agent's runtime comes first,
 * then the table's order. A model with no tier only builds, and only when nothing fast is here.
 * A list of your own replaces a role's. Undefined: fewer than two tiers and no lists of yours.
 */
export function lineup(team: Team | undefined, runtimes: readonly RuntimeChoice[], claudeModels: readonly string[], defaultRuntime = 'claude'): Lineup | undefined {
  const all = runnable(runtimes, claudeModels);
  const order = (a: AgentRef, b: AgentRef): number => Number(b.runtime === defaultRuntime) - Number(a.runtime === defaultRuntime) || familyOf(a.model ?? '') - familyOf(b.model ?? '');
  const of = (tier: Tier): AgentRef[] => all.filter((a) => tierOf(a.model ?? '', team) === tier).sort(order);
  const strong = of('strong');
  const mid = of('mid');
  const fast = of('fast');
  const unknown = all.filter((a) => tierOf(a.model ?? '', team) === undefined);
  const tiers = [strong, mid, fast].filter((t) => t.length).length;
  const table: Lineup | undefined =
    tiers >= 2 || (tiers === 1 && unknown.length && !fast.length)
      ? {
          planner: strong.length ? strong : mid,
          builder: fast.length ? fast : unknown.length ? unknown : mid.length && strong.length ? mid : fast,
          checker: mid.length && (fast.length || unknown.length) ? mid : strong.length ? strong : mid,
        }
      : undefined;
  const own = { planner: team?.planner ? mine(team.planner, runtimes) : undefined, builder: team?.builder ? mine(team.builder, runtimes) : undefined, checker: team?.checker ? mine(team.checker, runtimes) : undefined };
  const pick = (role: Role): readonly AgentRef[] => (own[role]?.length ? own[role]! : (table?.[role] ?? []));
  const out: Lineup = { planner: pick('planner'), builder: pick('builder'), checker: pick('checker') };
  return ROLES.every((r) => out[r].length) ? out : undefined;
}

/** Whether a new plan starts on Automatic: as you set it; unset, once a local model runs here (what auto route did before it). */
export const teamByDefault = (team: Pick<Team, 'byDefault'> | undefined, runtimes: readonly RuntimeChoice[]): boolean =>
  team?.byDefault ?? runtimes.some((r) => r.id === 'local' && r.available && (r.models ?? []).some((m) => !m.why));

const short = (a: AgentRef | undefined): string => (a?.model ? modelName(a.model).replace(/\[1m\]/gi, '').replace(/\s[\d.]+$/, '').trim() : (a?.label ?? '—'));

/** "Opus plans · Haiku builds · Sonnet checks": the one line a picker and a plan's page show. */
export const lineupWords = (l: Lineup): string => `${short(l.planner[0])} plans · ${short(l.builder[0])} builds · ${short(l.checker[0])} checks`;
```

- [ ] **Step 4: 跑测试，按失败调表**

Run: `npx vitest run tests/model-tiers.test.ts`
Expected: PASS。两处最可能要调：`lineupWords` 依赖 `modelName('fable')` 的输出（先 `grep -n "export function modelName" -A20 src/shared/agent-label.ts`
看它对别名返回什么，再定 `short` 里要不要去版本号）；"a model it doesn't know only builds"那条里只有强、中两档加一个
未知模型的分支。以测试为准改实现，不改测试里的期望。

- [ ] **Step 5: 浏览器安全**

Run: `npx vitest run tests/browser-safe.test.ts tests/boundaries.test.ts`
Expected: PASS（新文件只依赖 zod 和 `shared/` 里的文件）。

- [ ] **Step 6: 提交**

```bash
git add -A && git commit -m "Model team: tiers by model name, and who plans, builds and checks from what runs here"
```


### Task 2: 设置 `team`，旧的 `autoRoute` 读取时换算

**Files:**
- Create: `src/shared/team-migrate.ts`
- Modify: `src/shared/settings-schema.ts:137`、`src/core/store.ts:335,853`、`src/machines/sync.ts:38,112`、`src/ipc/api.ts:109`
- Test: `tests/team-migrate.test.ts`

- [ ] **Step 1: 写失败的测试**

```ts
import { describe, expect, it } from 'vitest';
import { teamFromAutoRoute } from '../src/shared/team-migrate.js';

describe('auto route’s settings become the team’s', () => {
  it('on → byDefault; hard, build, review → planner, builder, checker; the rest is dropped', () => {
    expect(teamFromAutoRoute({ on: true, hard: ['claude:opus'], build: ['local:deepseek/deepseek-flash'], review: ['claude:sonnet'], ladder: ['claude:haiku'], hardLabel: 'tough', urgentIsHard: false, hardEstimate: 3 })).toEqual({
      byDefault: true,
      planner: ['claude:opus'],
      builder: ['local:deepseek/deepseek-flash'],
      checker: ['claude:sonnet'],
    });
  });

  it('nothing set is nothing set', () => {
    expect(teamFromAutoRoute(undefined)).toBeUndefined();
    expect(teamFromAutoRoute({})).toBeUndefined();
  });

  it('a team already there wins', () => {
    expect(teamFromAutoRoute({ on: true }, { byDefault: false })).toEqual({ byDefault: false });
  });
});
```

- [ ] **Step 2: 跑一次，确认失败**

Run: `npx vitest run tests/team-migrate.test.ts`
Expected: FAIL，找不到模块。

- [ ] **Step 3: 实现**

`src/shared/team-migrate.ts`：

```ts
import type { Team } from './model-tiers.js';

/** What settings.json's `autoRoute` held before the model team replaced it (fork, builds up to 24). */
export interface OldAutoRoute {
  readonly on?: boolean;
  readonly hard?: readonly string[];
  readonly build?: readonly string[];
  readonly review?: readonly string[];
  readonly ladder?: readonly string[];
  readonly hardLabel?: string;
  readonly urgentIsHard?: boolean;
  readonly hardEstimate?: number;
}

/** The team an old `autoRoute` says, unless there's a team already. Its ladder and its hard-task rules have no place any more. */
export function teamFromAutoRoute(old: OldAutoRoute | undefined, team?: Team): Team | undefined {
  if (team) return team;
  if (!old) return undefined;
  const out: Team = {
    ...(old.on !== undefined ? { byDefault: old.on } : {}),
    ...(old.hard ? { planner: [...old.hard] } : {}),
    ...(old.build ? { builder: [...old.build] } : {}),
    ...(old.review ? { checker: [...old.review] } : {}),
  };
  return Object.keys(out).length ? out : undefined;
}
```

- `settings-schema.ts:137`：`autoRoute` 留着只为读旧文件，改成宽松的 `z.record(z.string(), z.unknown()).optional()`，
  旁边加 `team: Team.optional()`（从 `./model-tiers.js` 引入）。
- `store.ts`：`Prefs` 的 `autoRoute`（335 行）换成 `readonly team?: Settings['team']`；853 行那张键名表里
  `'autoRoute'` 换成 `'team'`；把 settings.json 变成 `prefs` 的地方最后做一次
  `const team = teamFromAutoRoute(raw.autoRoute as OldAutoRoute | undefined, raw.team);`，`prefs` 里放 `team`，
  不再放 `autoRoute`。下次保存时文件里就没有 `autoRoute` 了。
- `machines/sync.ts`：38 行 `'autoRoute'` 换成 `'team'`，112 行换成 `team: 'Model team'`。
- `ipc/api.ts:109`：`autoRoute: AutoRoute.nullable().optional()` 换成 `team: Team.nullable().optional()`。

- [ ] **Step 4: 跑测试**

Run: `npx vitest run tests/team-migrate.test.ts && npm run typecheck`
Expected: 测试 PASS；类型检查在每个还读 `prefs.autoRoute` 的文件报错。这些留给任务 4–7 逐个改，这一步先不提交。

### Task 3: 计划的 `autoTeam`，旧的两个角色读取时换算

**Files:**
- Modify: `src/core/plans/model.ts`（`Plan`、`roleAgent`）、`src/core/plans/plans.ts`（`SavedPlan`、`PlanRoles`、`create`、三个 setter）
- Modify: `src/core/plans/work.ts`、`src/ipc/plans-api.ts`、`src/ipc/plans-handlers.ts`
- Modify: `src/companion/coverage.ts`、`src/fork/coverage.ts`、`src/external/coverage.ts`、`src/machines/coverage.ts`
- Test: `tests/plan-auto-team.test.ts`（新）；`tests/plan-arch-agent.test.ts`、`tests/plan-fix-agent.test.ts` 里只测两个 setter 的用例删掉

- [ ] **Step 1: 写失败的测试**

`setup()` 照 `tests/fork-plan-roles.test.ts` 现有的写（它给出 `work` 和 `plans`）。

```ts
const opus = { runtime: 'claude', label: 'Claude', model: 'opus' };
const sonnet = { runtime: 'claude', label: 'Claude', model: 'sonnet' };

describe('a plan on Automatic', () => {
  it('create takes it, setAutoTeam turns it on and off, and the plan’s feed says so', () => {
    const { work, plans } = setup();
    const made = work.create({ projectId: 'api', goal: 'x', autoTeam: true });
    expect(plans.need(made.id).autoTeam).toBe(true);
    work.setAutoTeam(made.id, false);
    expect(plans.need(made.id).autoTeam).toBeUndefined();
    expect(plans.need(made.id).activity.at(-1)!.text).toMatch(/your agent/i);
    work.setAutoTeam(made.id, true);
    expect(plans.need(made.id).activity.at(-1)!.text).toMatch(/automatic/i);
  });

  it('picking nothing leaves it off: the plan runs as upstream’s does', () => {
    const { work, plans } = setup();
    expect(plans.need(work.create({ projectId: 'api', goal: 'x' }).id).autoTeam).toBeUndefined();
  });
});

describe('a plan saved with the fork’s old roles', () => {
  it('its architect becomes its planner, and it is on Automatic', () => {
    const p = readSaved({ archAgent: opus });
    expect(p.planner).toEqual(opus);
    expect(p.autoTeam).toBe(true);
    expect('archAgent' in p).toBe(false);
  });

  it('a planner picked since keeps its place', () => {
    expect(readSaved({ archAgent: opus, planner: sonnet }).planner).toEqual(sonnet);
  });

  it('its fix agent is dropped, and it is on Automatic (hard fixes go up its team now)', () => {
    const p = readSaved({ fixAgent: opus });
    expect('fixAgent' in p).toBe(false);
    expect(p.autoTeam).toBe(true);
  });

  it('a plan with neither is left alone', () => {
    expect(readSaved({ agent: sonnet }).autoTeam).toBeUndefined();
  });
});
```

`readSaved(extra)`：把一份最小的存档计划（照 `tests/plan-check-agent.test.ts` 里测 `checkAgent → checker` 的那条怎么喂存档）
加上 `extra` 读回来。

- [ ] **Step 2: 跑一次，确认失败**

Run: `npx vitest run tests/plan-auto-team.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现**

`model.ts`，`Plan` 里删掉 `archAgent`、`fixAgent` 两个字段，在 `checker` 下面加：

```ts
  /** Automatic (fork): a part nobody picked goes to the model team worked out from what runs here (shared/model-tiers.ts), not to your default agent. */
  readonly autoTeam?: boolean;
```

`roleAgent` 改回上游的原样（去掉分叉的 `?? plan.archAgent` 和参数类型里的 `'archAgent'`）：

```ts
export function roleAgent(plan: Pick<Plan, 'agent' | 'planner' | 'checker'>, role: PlanRole): AgentRef | undefined {
  if (role === 'planner') return plan.planner ?? plan.agent;
  if (role === 'checker') return plan.checker ?? plan.agent;
  return plan.agent;
}
```

`checkerAgentOf`、`homeAgentOf` 两个分叉的别名删掉，调用处在任务 4 换成 `teamAgent`。

`plans.ts`：

- `SavedPlan` 加 `autoTeam: z.boolean().optional().catch(undefined)`。`checkAgent`、`archAgent`、`fixAgent` 三行留着（只为读旧文件），`.transform` 换成：

```ts
  // Saved by the fork before 3.6: its check agent is the checker, its architect the planner (one picked since wins);
  // a plan that had an architect or a fix agent ran on roles by tier, so it is on Automatic now.
  .transform(({ checkAgent, archAgent, fixAgent, fullAuto: _gone, ...plan }) => {
    const planner = plan.planner ?? archAgent;
    const checker = plan.checker ?? checkAgent;
    const auto = plan.autoTeam ?? (archAgent || fixAgent ? true : undefined);
    return { ...plan, ...(planner ? { planner } : {}), ...(checker ? { checker } : {}), ...(auto ? { autoTeam: true } : {}) };
  });
```

- `PlanRoles` 去掉 `archAgent`、`fixAgent`。`create` 的参数加 `readonly autoTeam?: boolean`，对象里加
  `...(input.autoTeam ? { autoTeam: true } : {})`，去掉 `archAgent`、`fixAgent` 两行。
- `setArchAgent`、`setFixAgent` 两个方法删掉，加：

```ts
  /** Automatic on or off (fork): on, a part nobody picked goes to the model team; off, to your default agent, as upstream. */
  setAutoTeam(id: string, on: boolean, by: Actor): Plan {
    const plan = this.need(id);
    if (Boolean(plan.autoTeam) === on) return plan;
    const text = on ? 'switched its agents to Automatic: the parts nobody picked go to the models that fit them' : 'gave the parts nobody picked back to your agent';
    return this.change(plan, { autoTeam: on ? true : undefined }, [event(by, 'note', text, this.now())]);
  }
```

`work.ts`：`create` 的输入加 `autoTeam`（`checker` 旁边）；加

```ts
  /** Automatic on or off (fork): see Plans.setAutoTeam. */
  setAutoTeam(id: string, on: boolean): Plan {
    return this.plans.setAutoTeam(id, on, this.me());
  }
```

（如果旁边的 `setRoleAgent` 在改完后还做别的事，比如通知、重排，照它补上。）
`setArchAgent`、`setFixAgent` 留一个版本（老手机还会调）：

```ts
  /** Kept for one release (a phone before 1.64 still calls it): the architect is the planner now. */
  setArchAgent(id: string, agent: AgentRef | undefined): string {
    return this.setRoleAgent(id, 'planner', agent);
  }

  /** Kept for one release: nothing to set any more. */
  setFixAgent(_id: string, _agent: AgentRef | undefined): string {
    return 'Hard fixes go up the plan’s own agents now: its checker’s model, then its planner’s';
  }
```

（`setRoleAgent` 的返回值按 `work.ts:509` 附近实际的写。）

`plans-api.ts`：`plans.create` 的对象里去掉 `archAgent`、`fixAgent`，加 `autoTeam: z.boolean().optional()`；在 `plans.setRoleAgent` 下面加

```ts
  // Automatic on or off (fork): on, the parts nobody picked go to the model team worked out from what runs here → the plan.
  'plans.setAutoTeam': { args: z.tuple([id, z.boolean()]) },
```

`plans.setArchAgent`、`plans.setFixAgent` 两行留着，注释改成 "kept for one release"。`plans-handlers.ts` 加一个 handler。
四个 coverage 文件各加一行：`src/companion/coverage.ts` 里是 `'plans.setAutoTeam': 'phone'`，其余三个按 `plans.setRoleAgent`
在各自表里的取值写。`src/external/domain/tools.ts` 里的 `plan_set_arch_agent`、`plan_set_fix_agent` 跟着两个 setter
留一个版本；给不给外部 agent 一个开 Automatic 的工具，照 `plans.setRoleAgent` 在那里的做法（有就加，没有就不加）。

**还在跑的旧计划（§6.3 最后一行）。** 自动路由开着时建的、没选 builder 的计划，存档里没有任何标记，升级后会突然
改用默认 agent。启动时补一次：`Plans` 加一个方法

```ts
  /** Once, when auto route's settings are first read as the team's: plans still at work with no builder picked ran on auto route, so they are on Automatic. → how many. */
  adoptAutoTeam(by: Actor): number {
    let n = 0;
    for (const plan of this.all()) {
      if (plan.status === 'done' || plan.movedTo || plan.agent || plan.autoTeam !== undefined) continue;
      this.change(plan, { autoTeam: true }, [event(by, 'note', 'runs on Automatic now (it ran on auto route before)', this.now())]);
      n++;
    }
    return n;
  }
```

（`this.all()` 用 `Plans` 里实际列出全部计划的方法。）调用处在任务 2 读设置的地方之后：只有这次启动时
settings.json 里还有旧的 `autoRoute`、并且换算出的 `teamByDefault(team, runtimes)` 为真，才调一次；设置保存后旧字段
消失，下次启动不会再调。`tests/plan-auto-team.test.ts` 加两条：没选 builder 的在跑计划被标上、动态里有那句话；
选了 builder 的、已完成的、已经有 `autoTeam` 的不动。

- [ ] **Step 4: 跑测试**

Run: `npx vitest run tests/plan-auto-team.test.ts tests/plan-roles.test.ts`
Expected: PASS（`plan-roles.test.ts` 是上游的，没改，必须通过）。类型检查仍有红，继续。

### Task 4: 每个部分开工时用谁

**Files:**
- Create: `src/fork/plans/team.ts`
- Modify（接入点）: `src/core/plans/work.ts:120,171,177,178,243,491`、`src/core/plans/pilot.ts:870,895`、`src/core/board/work.ts:372`、`src/companion/views.ts:1141`
- Modify: `src/fork/plans/roles.ts`（`workAgentFor`、`milestoneRoles`）
- Test: `tests/plan-team-agent.test.ts`（新），改 `tests/fork-plan-roles.test.ts`、`tests/fork-plan-roles-visible.test.ts`、`tests/plan-arch-agent.test.ts`

- [ ] **Step 1: 写失败的测试**

```ts
import { describe, expect, it } from 'vitest';
import type { RuntimeChoice } from '../src/shared/agent-runtimes.js';
import { roleAgent } from '../src/core/plans/model.js';
import { taskAgent, teamAgent, teamOf } from '../src/fork/plans/team.js';

const RUNTIMES = [{ id: 'claude', label: 'Claude', available: true }] as unknown as RuntimeChoice[];
const st = (team?: object, models = ['opus', 'sonnet', 'haiku']) => ({ prefs: { ...(team ? { team } : {}) }, runtimes: RUNTIMES, models: models.map((value) => ({ value })) }) as never;
const claude = (model: string) => ({ runtime: 'claude', label: 'Claude', model });

describe('who a part of a plan goes to when work starts', () => {
  it('Automatic, nothing picked: Opus plans, Haiku builds, Sonnet checks', () => {
    expect(teamOf({ autoTeam: true }, st())).toEqual({ planner: claude('opus'), builder: claude('haiku'), checker: claude('sonnet') });
  });

  it('what you picked wins, part by part', () => {
    const plan = { autoTeam: true, planner: claude('sonnet') };
    expect(teamOf(plan, st())).toEqual({ planner: claude('sonnet'), builder: claude('haiku'), checker: claude('sonnet') });
  });

  it('a builder you picked plans and checks too, as upstream says, Automatic or not', () => {
    const plan = { autoTeam: true, agent: claude('sonnet') };
    expect(teamOf(plan, st())).toEqual({ planner: claude('sonnet'), builder: claude('sonnet'), checker: claude('sonnet') });
  });

  it('not on Automatic: exactly upstream’s roleAgent, whatever the setting', () => {
    for (const plan of [{}, { agent: claude('opus') }, { planner: claude('opus'), checker: claude('sonnet') }]) {
      for (const role of ['planner', 'builder', 'checker'] as const) expect(teamAgent(plan, role, st({ byDefault: true }))).toEqual(roleAgent(plan, role));
    }
  });

  it('Automatic where no team can be made (one model): your default agent, as before', () => {
    expect(teamAgent({ autoTeam: true }, 'builder', st(undefined, ['sonnet']))).toBeUndefined();
  });
});

describe('who works a task', () => {
  it('the agent you start it with, then its own, then its plan’s builder', () => {
    const plan = { autoTeam: true };
    expect(taskAgent(plan, {}, st(), claude('sonnet'))).toEqual(claude('sonnet'));
    expect(taskAgent(plan, { agent: claude('opus') }, st())).toEqual(claude('opus'));
    expect(taskAgent(plan, {}, st())).toEqual(claude('haiku'));
  });

  it('in no plan: the team’s builder only when new plans start on Automatic', () => {
    expect(taskAgent(undefined, {}, st({ byDefault: true }))).toEqual(claude('haiku'));
    expect(taskAgent(undefined, {}, st())).toBeUndefined();
  });
});
```

- [ ] **Step 2: 跑一次，确认失败**

Run: `npx vitest run tests/plan-team-agent.test.ts`
Expected: FAIL，找不到模块。

- [ ] **Step 3: 实现**

`src/fork/plans/team.ts`：

```ts
import type { AgentRef } from '../../protocol.js';
import { defaultAgentOf } from '../../protocol.js';
import { type Plan, type PlanRole, PLAN_ROLES, roleAgent } from '../../core/plans/model.js';
import type { RuntimeChoice } from '../../shared/agent-runtimes.js';
import { type Lineup, type Team, lineup, teamByDefault } from '../../shared/model-tiers.js';

/**
 * Fork: who a part of a plan goes to when its work starts. Upstream's rule first (roleAgent: the
 * part's own pick, else the builder's); a plan on Automatic that finds nobody that way takes the
 * model team's pick for the part, worked out now from what runs here. Undefined: your default agent.
 * Browser-safe (types and shared/ only): the daemon, the Mac's plan page and the phone's view ask here.
 */

/** What of the app's state a pick reads. */
export interface TeamState {
  readonly prefs: { readonly team?: Team; readonly defaultAgent?: AgentRef; readonly agents?: readonly AgentRef[] };
  readonly runtimes: readonly RuntimeChoice[];
  /** Claude Code's own models (the pickers' `state.models`). */
  readonly models: ReadonlyArray<{ readonly value: string }>;
}

type Parts = Pick<Plan, 'agent' | 'planner' | 'checker' | 'autoTeam'>;

/** Who plans, builds and checks here now (undefined: no team to be had here). */
export const lineupOf = (st: TeamState): Lineup | undefined => lineup(st.prefs.team, st.runtimes, st.models.map((m) => m.value), defaultAgentOf(st.prefs).runtime);

export function teamAgent(plan: Parts, role: PlanRole, st: TeamState): AgentRef | undefined {
  const picked = roleAgent(plan, role);
  if (picked || !plan.autoTeam) return picked;
  return lineupOf(st)?.[role][0];
}

/** All three parts at once: for the escalation order and for what a screen says. */
export const teamOf = (plan: Parts, st: TeamState): Readonly<Record<PlanRole, AgentRef | undefined>> =>
  Object.fromEntries(PLAN_ROLES.map((r) => [r, teamAgent(plan, r, st)])) as Record<PlanRole, AgentRef | undefined>;

/** Who works a task: the agent you start it with, its own, its plan's builder; in no plan, the team's builder when new plans start on Automatic. */
export function taskAgent(plan: Parts | undefined, task: { readonly agent?: AgentRef }, st: TeamState, pick?: AgentRef): AgentRef | undefined {
  if (pick ?? task.agent) return pick ?? task.agent;
  if (plan) return teamAgent(plan, 'builder', st);
  return teamByDefault(st.prefs.team, st.runtimes) ? lineupOf(st)?.builder[0] : undefined;
}
```

`prefs` 里默认 agent 的字段按 `defaultAgentOf`（`src/protocol.ts:92`）读的写；`state.models` 的形状先
`grep -n "models" src/core/store.ts | head` 确认，不是 `{ value }[]` 就在 `lineupOf` 里按实际的取。

接入点，逐个替换（`st` 都是 `deps.store.getState()`）：行号是任务 0 之前的，任务 0 删过代码后会往前移，先 grep 再改。
`src/core/board/launch.ts` 里原来有一处取人（Full Autopilot 的替身），任务 0 已经连那一段一起删了，那个文件不用再动。

| 现在 | 换成 |
|---|---|
| `work.ts:120` `checkerAgentOf(plan) ?? autoChecker(st)` | `teamAgent(plan, 'checker', st)` |
| `work.ts:178,243,491` `homeAgentOf(plan)` | `teamAgent(plan, 'planner', st)` |
| `work.ts:171` `if (ws && plan.archAgent) …setAgent(ws.id, plan.archAgent)` | 条件改成 `plan.autoTeam`，agent 用 `teamAgent(plan, 'planner', st)`（没有就不设） |
| `pilot.ts:870,895` 里的 `plan.archAgent` | `plan.autoTeam`：里程碑的设计步骤只在 Automatic 的计划上运行 |
| `work.ts:177` `fixer: plan.fixAgent ?? autoFixer(st)` | 任务 5 |
| `board/work.ts:372`、`views.ts:1141` 的 `routedAgent(issue, state)` | `taskAgent(planOfIssue, issue, state)`；项目自己的 agent（`prefs.projectAgents`）仍然排在它前面，照 `routedAgent` 原来的顺序写 |
| `roles.ts` 的 `workAgentFor(plan, task, st, pick, fixer)` | 里面 `autoAgentFor(...)` 那一步换成 `teamAgent(plan, 'builder', st)`，`via` 仍是 `'auto'`；其余顺序不变 |
| `roles.ts` 的 `milestoneRoles` | `plan.archAgent` → `plan.autoTeam ? teamAgent(plan, 'planner', st) : undefined`；`plan.fixAgent ?? autoFixer(st)` → 任务 5 的 `fixerFor(teamOf(plan, st), 2)`；`autoRouteOn(...)` → `Boolean(plan.autoTeam)`。返回的四项形状不变（手机协议 1.63 的 `roles` 不能改） |
| `autoAutonomy(st)`（`work.ts`）、`packages/mac/src/plans/use-default-autonomy.ts` | 删掉：新计划的自主程度不再跟着这个设置变，回到 `DEFAULT_AUTONOMY` |

- [ ] **Step 4: 改旧测试**

`tests/fork-plan-roles.test.ts`、`tests/fork-plan-roles-visible.test.ts`、`tests/plan-arch-agent.test.ts`：建计划时的
`archAgent: X` 换成 `planner: X, autoTeam: true`；断言"规划对话跑在 X 上"、"设计步骤由 X 写"的不动。原来靠
`prefs.autoRoute` 得到 Opus / Sonnet 的用例，改成 `autoTeam: true` 加 `models: opus, sonnet, haiku`。

- [ ] **Step 5: 跑测试**

Run: `npx vitest run tests/plan-team-agent.test.ts tests/plan-roles.test.ts tests/fork-no-full-autopilot.test.ts tests/fork-plan-roles.test.ts tests/fork-plan-roles-visible.test.ts tests/plan-arch-agent.test.ts`
Expected: PASS。

### Task 5: 升级顺序

**Files:**
- Create: `src/fork/plans/escalate.ts`
- Modify: `src/fork/plans/ladder.ts:34`（`ladderAgents`）、`src/fork/plans/fixer.ts`、`src/core/plans/work.ts:177`
- Test: `tests/plan-escalate.test.ts`，改 `tests/fork-model-ladder.test.ts`、`tests/fork-model-ladder-fixer.test.ts`、`tests/plan-fix-agent.test.ts`

- [ ] **Step 1: 写失败的测试**

```ts
import { describe, expect, it } from 'vitest';
import type { Lineup } from '../src/shared/model-tiers.js';
import { chainOf, fixerFor, standIn } from '../src/fork/plans/escalate.js';

const c = (model: string) => ({ runtime: 'claude', label: 'Claude', model });
const glm = { runtime: 'local', label: 'Local model', model: 'bigmodel/glm-5.3' };
const TEAM = { planner: c('opus'), builder: c('haiku'), checker: c('sonnet') };
const L: Lineup = { planner: [c('opus')], builder: [c('haiku'), glm], checker: [c('sonnet')] };

describe('where work goes when it can’t go on', () => {
  it('up the chain: builder, checker, planner', () => {
    expect(chainOf(TEAM)).toEqual([c('haiku'), c('sonnet'), c('opus')]);
  });

  it('a model in two parts is one step, and a part with nobody is none', () => {
    expect(chainOf({ planner: c('opus'), builder: c('haiku'), checker: c('opus') })).toEqual([c('haiku'), c('opus')]);
    expect(chainOf({ planner: undefined, builder: undefined, checker: undefined })).toEqual([]);
  });

  it('a failed check’s fixes: the builder the first time, the planner from the second', () => {
    expect(fixerFor(TEAM, 1)).toEqual(c('haiku'));
    expect(fixerFor(TEAM, 2)).toEqual(c('opus'));
    expect(fixerFor(TEAM, 3)).toEqual(c('opus'));
  });

  it('a conflict goes straight to the planner', () => {
    expect(fixerFor(TEAM, 'conflict')).toEqual(c('opus'));
  });

  it('a model that can’t run is stood in for by the next of its part, then nobody', () => {
    expect(standIn(L, 'builder', c('haiku'))).toEqual(glm);
    expect(standIn(L, 'builder', glm)).toBeUndefined();
    expect(standIn(L, 'checker', c('sonnet'))).toBeUndefined();
    expect(standIn(L, 'builder', c('opus'))).toBeUndefined();
  });
});
```

- [ ] **Step 2: 跑一次，确认失败**

Run: `npx vitest run tests/plan-escalate.test.ts`
Expected: FAIL，找不到模块。

- [ ] **Step 3: 实现**

`src/fork/plans/escalate.ts`：

```ts
import type { AgentRef } from '../../protocol.js';
import type { PlanRole } from '../../core/plans/model.js';
import type { Lineup } from '../../shared/model-tiers.js';
import { modelKey } from '../failing-models.js';

/**
 * Where a plan's work goes when it can't go on (a plan on Automatic; another one keeps whoever was
 * at it, as upstream). Sideways first: a model that can't run (its quota, its key, no such model)
 * is stood in for by the next candidate of the same part. Then up the plan's own agents: builder,
 * checker, planner, one step each time a task stops twice. A failed check's fix tasks go to the
 * builder the first time and to the planner from the second; a conflict goes straight to the
 * planner. Above the planner: you.
 */

/** The three parts as they resolve now (team.ts teamOf). */
export type Resolved = Readonly<Record<PlanRole, AgentRef | undefined>>;

/** Builder, checker, planner: a model in two parts once. */
export function chainOf(team: Resolved): AgentRef[] {
  const out: AgentRef[] = [];
  for (const a of [team.builder, team.checker, team.planner]) if (a && !out.some((x) => modelKey(x) === modelKey(a))) out.push(a);
  return out;
}

/** Who takes a milestone's fix tasks after its `round`-th failed check, or a conflict. */
export function fixerFor(team: Resolved, round: number | 'conflict'): AgentRef | undefined {
  return round === 'conflict' || round >= 2 ? team.planner : team.builder;
}

/** The next candidate of a part after `current` (undefined: it was the last, or isn't one of them). */
export function standIn(l: Lineup, role: PlanRole, current: AgentRef): AgentRef | undefined {
  const at = l[role].findIndex((a) => modelKey(a) === modelKey(current));
  return at >= 0 ? l[role][at + 1] : undefined;
}
```

接线：

- `ladder.ts` 的 `ladderAgents(route, runtimes)` 改成 `ladderAgents(team: Resolved | undefined): AgentRef[]`，函数体
  `return team ? chainOf(team) : [];`。`nextRung`、`rungKnown`、`modelFailed`、`modelGone` 不动。调用处只在
  `plan.autoTeam` 时传 `teamOf(plan, st)`，否则传 `undefined`（空梯子，不升级）。
- `work.ts:177` 的 `fixer: (plan) => plan.fixAgent ?? autoFixer(st)` 改成
  `fixer: (plan, round) => (plan.autoTeam ? fixerFor(teamOf(plan, st), round) : undefined)`。`fixer.ts` 调它的三处
  （第一次检查没过、之后的检查没过、冲突）分别传这个里程碑已经失败的检查次数和 `'conflict'`。检查次数用
  里程碑 `run` 上记轮次的字段（`grep -n "round" src/core/plans/model.ts`）。
- `fixer.ts` 的 `EscalateHow` 和 `settle`（做完换回 builder）不变。模型"彻底不行"（`modelGone`）时先
  `standIn(lineupOf(st), 'builder', current)`，有就换它；没有再走 `nextRung`。额度用完时换下一个候选的现成逻辑在
  分支 `fork/limit-next-model`（`fb2fe2682`）：先 `git cherry-pick fb2fe2682`，再把它读 `tierList` 的地方换成 `standIn`。
  cherry-pick 有冲突而且一小时内理不清，就停下来报告，不要重写那段逻辑。

- [ ] **Step 4: 改旧测试**

`tests/fork-model-ladder.test.ts`：第一条（默认梯子是 Haiku、Sonnet、Opus、Fable，`AutoRoute` 解析）删掉，换成
"梯子就是 `chainOf` 的结果"；`nextRung` 的几条不动。`tests/fork-model-ladder-fixer.test.ts`、`tests/plan-fix-agent.test.ts`：
建计划时的 `fixAgent: X` 换成 `planner: X, autoTeam: true`，"第一次检查没过就交给 fix agent"的断言改成
"第一次给 builder、第二次给 planner"。

- [ ] **Step 5: 跑测试**

Run: `npx vitest run tests/plan-escalate.test.ts tests/fork-model-ladder.test.ts tests/fork-model-ladder-fixer.test.ts tests/plan-fix-agent.test.ts`
Expected: PASS。

### Task 6: 删掉自动路由，手机协议 1.64，类型检查变绿

**Files:**
- Delete: `src/shared/auto-route.ts`、`docs/auto-route.md`、`tests/auto-route.test.ts`、`tests/auto-route-paths.test.ts`、`tests/auto-route-plans.test.ts`、`tests/companion-supports-fix-agent.test.ts`
- Modify: `src/companion/protocol.ts`、`src/companion/views.ts`、`src/core/plans/prompt.ts`、其余 `grep -rl "auto-route" src` 列出的文件
- Test: `tests/companion-plan-team.test.ts`（新）

- [ ] **Step 1: 写失败的测试**

照 `tests/companion-*` 里测 `planPageView` 的现有用例搭状态：

```ts
  it('a plan on Automatic says so and names its team; the parts are the ones that will run', () => {
    const view = planPageView(stateWith({ autoTeam: true }, { models: ['opus', 'sonnet', 'haiku'] }), 'p1')!;
    expect(view.autoTeam).toBe(true);
    expect(view.team).toBe('Opus plans · Haiku builds · Sonnet checks');
    expect(view.planner?.model).toBe('opus');
    expect(view.agent?.model).toBe('haiku');
    expect(view.checker?.model).toBe('sonnet');
  });

  it('a plan not on Automatic still gets the team’s words, so the phone can offer it', () => {
    const view = planPageView(stateWith({}, { models: ['opus', 'sonnet', 'haiku'] }), 'p1')!;
    expect(view.autoTeam).toBeUndefined();
    expect(view.team).toBe('Opus plans · Haiku builds · Sonnet checks');
    expect(view.agent).toBeUndefined();
  });

  it('where no team can be made the phone is told nothing', () => {
    expect(planPageView(stateWith({}, { models: ['sonnet'] }), 'p1')!.team).toBeUndefined();
  });

  it('the old roles are no longer sent', () => {
    const view = planPageView(stateWith({ autoTeam: true }, { models: ['opus', 'sonnet', 'haiku'] }), 'p1')!;
    expect('archAgent' in view).toBe(false);
    expect('fixAgent' in view).toBe(false);
  });
```

- [ ] **Step 2: 协议（只增）**

`protocol.ts`：`COMPANION_PROTO.minor` 改成 64；注释块加一段

```
 * 1.64 (fork): Automatic, a plan's parts nobody picked go to the model team worked out on the Mac
 * (`PlanView.autoTeam`, `plans.setAutoTeam`); `PlanView.team` says the team in a line, sent whenever one
 * can be made, so the phone can offer it. The Mac no longer sends `archAgent` / `fixAgent`. An older
 * Mac sends neither, and the phone offers nothing.
```

`SINCE` 末尾加 `autoTeam: 64`（`archAgent: 60`、`fixAgent: 61` 留着）。`PlanView` 里 `checker` 下面加：

```ts
  /** 1.64 (fork): Automatic is on; and the team in a line ("Opus plans · Haiku builds · Sonnet checks"), whenever one can be made on that Mac. */
  autoTeam: z.boolean().optional(),
  team: z.string().max(200).optional(),
```

`archAgent`、`fixAgent` 两个字段留在 schema 里（可选，注释加 "no longer sent since 1.64"）。

`views.ts` 的 `planPageView`：`archAgent`、`fixAgent` 两行删掉；`agent`、`planner`、`checker` 三行在 `plan.autoTeam` 时
用 `teamOf(plan, state)` 的结果（没开时和现在一样只发你选的）；加

```ts
    ...(plan.autoTeam ? { autoTeam: true } : {}),
    ...(lineupOf(state) ? { team: lineupWords(lineupOf(state)!) } : {}),
```

`src/companion/calls.ts` 加 `plans.setAutoTeam`，照 `plans.setRoleAgent` 那一行。

- [ ] **Step 3: 删文件，跟着类型错误改**

```bash
git rm src/shared/auto-route.ts docs/auto-route.md tests/auto-route.test.ts tests/auto-route-paths.test.ts tests/auto-route-plans.test.ts tests/companion-supports-fix-agent.test.ts
npm run typecheck
```

每个报错按下表改：

| 用到的 | 换成 |
|---|---|
| `runsHere` | `model-tiers.ts` 的 `runsHere` |
| `firstRunning`、`parseChoice`、`tierList`、`candidateRuns` | 只在被删的逻辑里用，连同调用一起删 |
| `autoAgentName(ref)` | `lineupWords` 里的 `short`，从 `model-tiers.ts` 导出为 `shortModel` |
| `routedAgent`、`autoAgentFor` | `taskAgent`（任务 4） |
| `planRoleDefaults`、`autoChecker`、`autoFixer` | `teamOf` / `lineupOf` |
| `Routable`、`autoTierOf`、`HARD_LABEL`、`autoRouteOn`、`autoAutonomy` | 删：不再按难度分流，也不再改新计划的自主程度 |

`views.ts` 的 `TaskPageView.autoAgent` 保留字段（协议只增不减），值改成：任务没有自己的 agent 且 `taskAgent(...)`
有结果时填它。`src/core/plans/prompt.ts` 里让写计划的 agent 给难任务打 `hard` 标签、按估点分档的句子删掉
（`grep -n "hard" src/core/plans/prompt.ts`）；`headBrief` 里 `plan.archAgent ? '…an architect of its own…'`
的条件改成 `plan.autoTeam`。Mac 包里的报错留给任务 7。

- [ ] **Step 4: 核心的类型检查和测试全绿**

Run: `npm run typecheck && npx vitest run tests/plan-* tests/fork-* tests/model-tiers.test.ts tests/team-migrate.test.ts tests/companion-* tests/parity.test.ts tests/browser-safe.test.ts tests/boundaries.test.ts`
Expected: PASS。`tests/parity.test.ts` 会要求 `docs/parity.md` 里有 `plans.setAutoTeam`：现在就加这一行
（Mac 一栏写 "Plan page › Agents › Automatic; New Plan › agent picker"），其余文档留到任务 9。

- [ ] **Step 5: 提交（任务 2–6 一起）**

```bash
git add -A && git commit -m "Plans: Automatic fills the parts nobody picked from the models that run here; the fork's four roles and auto route are gone"
```

### Task 7: Mac 界面

**Files:**
- Create: `packages/mac/src/fork/plans/auto-team.ts`、`packages/mac/src/dialogs/TeamSettings.tsx`
- Delete: `packages/mac/src/fork/plans/NewPlanSheet.tsx`、`packages/mac/src/plans/PlanSettingsSheet.tsx`、`packages/mac/src/plans/PlanRoles.tsx`、`packages/mac/src/plans/plan-roles-model.ts`、`packages/mac/src/dialogs/AutoRouteSettings.tsx`、`packages/mac/src/plans/use-default-autonomy.ts`、`packages/mac/src/tasks/use-auto-agent.ts`、`packages/mac/e2e/plan-settings.spec.ts`、`packages/mac/e2e/plan-roles-walk.spec.ts`、`tests/plan-roles-i18n.test.ts` 里测被删文件的用例
- Modify（接入点）: `packages/mac/src/plans/AgentRoles.tsx`、`packages/mac/src/plans/PlanSheets.tsx`、`packages/mac/src/plans/PlanPage.tsx`、`packages/mac/src/fork/sheets.tsx`
- Modify: `packages/mac/src/fork/plans/MilestoneRoles.tsx`、`packages/mac/src/dialogs/Settings.tsx`、`packages/mac/src/dialogs/settings-index.ts`、`packages/mac/src/fork/settings-index.ts`、`packages/mac/src/i18n/zh-CN.json`
- Test: `tests/mac-auto-team.test.ts`、`packages/mac/e2e/plan-auto-team.spec.ts`

- [ ] **Step 1: "Automatic"这一项的逻辑（纯函数，先测）**

`tests/mac-auto-team.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { AUTO, autoRolesInput, startChoice, withAuto } from '../packages/mac/src/fork/plans/auto-team.js';

const YOURS = '';
const mine = { runtime: 'claude', label: 'Claude' };
const forChoice = (v: string) => ({ runtime: v.split(':')[0]!, label: 'Claude', model: v.split(':')[1]! });
const entries = [{ value: YOURS, label: 'Your agent (Claude)' }, { section: 'Claude', options: [{ value: 'claude:opus', label: 'Opus' }] }];

describe('Automatic in the agent picker', () => {
  it('comes first, with the team in words; where no team can be made it isn’t there', () => {
    expect(withAuto(entries, 'Opus plans · Haiku builds · Sonnet checks')[0]).toEqual({ value: AUTO, label: 'Automatic', icon: 'sparkles', description: 'Opus plans · Haiku builds · Sonnet checks' });
    expect(withAuto(entries, undefined)).toBe(entries);
  });

  it('a new plan starts on it when new plans do and a team can be made, else on your agent', () => {
    expect(startChoice(true, 'x')).toEqual({ planner: AUTO, builder: AUTO, checker: AUTO });
    expect(startChoice(false, 'x')).toEqual({ planner: YOURS, builder: YOURS, checker: YOURS });
    expect(startChoice(true, undefined)).toEqual({ planner: YOURS, builder: YOURS, checker: YOURS });
  });

  it('all three on Automatic: just the switch', () => {
    expect(autoRolesInput({ planner: AUTO, builder: AUTO, checker: AUTO }, forChoice, mine)).toEqual({ autoTeam: true });
  });

  it('a part of your own beside Automatic ones: that part picked, the switch on', () => {
    expect(autoRolesInput({ planner: 'claude:opus', builder: AUTO, checker: AUTO }, forChoice, mine)).toEqual({ autoTeam: true, planner: forChoice('claude:opus') });
  });

  it('the builder picked and another part on Automatic: that part can’t follow the builder, so it isn’t offered (it reads as the builder’s)', () => {
    expect(autoRolesInput({ planner: AUTO, builder: 'claude:opus', checker: 'claude:opus' }, forChoice, mine)).toEqual({ agent: forChoice('claude:opus') });
  });

  it('nothing on Automatic: undefined, and upstream’s rolesInput decides', () => {
    expect(autoRolesInput({ planner: YOURS, builder: YOURS, checker: YOURS }, forChoice, mine)).toBeUndefined();
  });
});
```

`packages/mac/src/fork/plans/auto-team.ts`：

```ts
import type { AgentRef } from '@beluga/protocol.js';
import type { PlanRole } from '@beluga/core/plans/model.js';
import { YOUR_AGENT } from '../../components/agent-options.js';

/** Fork: "Automatic" in a plan's agent pickers. Pure: tests/mac-auto-team.test.ts. */

/** The pop-up value for "the model team's pick for this part". */
export const AUTO = '@auto';

type Choice = Readonly<Record<PlanRole, string>>;

/** The picker's entries with Automatic first (`words`: the team in a line; none: no team here, nothing added). */
export function withAuto<T extends object>(entries: readonly T[], words: string | undefined): readonly (T | { value: string; label: string; icon: string; description: string })[] {
  return words ? [{ value: AUTO, label: 'Automatic', icon: 'sparkles', description: words }, ...entries] : entries;
}

/** Where a new plan's pickers start. */
export function startChoice(byDefault: boolean, words: string | undefined): Choice {
  const v = byDefault && words ? AUTO : YOUR_AGENT;
  return { planner: v, builder: v, checker: v };
}

/**
 * The picks as plans.create takes them when a part is on Automatic. Upstream's rule stays: a
 * planner or checker with nothing picked follows a builder you picked, so with a builder of your
 * own the other parts on Automatic are the builder's. Undefined: nothing is on Automatic.
 */
export function autoRolesInput(v: Choice, forChoice: (value: string) => AgentRef, mine: AgentRef): { autoTeam?: true; agent?: AgentRef; planner?: AgentRef; checker?: AgentRef } | undefined {
  if (!Object.values(v).includes(AUTO)) return undefined;
  const pick = (value: string): AgentRef => (value === YOUR_AGENT ? mine : forChoice(value));
  if (v.builder !== AUTO) {
    const agent = pick(v.builder);
    return { agent, ...(v.planner !== AUTO && v.planner !== v.builder ? { planner: pick(v.planner) } : {}), ...(v.checker !== AUTO && v.checker !== v.builder ? { checker: pick(v.checker) } : {}) };
  }
  return { autoTeam: true, ...(v.planner !== AUTO ? { planner: pick(v.planner) } : {}), ...(v.checker !== AUTO ? { checker: pick(v.checker) } : {}) };
}
```

图标名用 `packages/mac/src/components/Icon.tsx` 里已有的一个（`grep -n "sparkles\|wand\|bot" packages/mac/src/components/Icon.tsx`），
测试里跟着改。

Run: `npx vitest run tests/mac-auto-team.test.ts`
Expected: PASS。

- [ ] **Step 2: 用回上游的 New Plan**

- `packages/mac/src/fork/sheets.tsx`：删掉 `case 'new_plan'` 和那个 import，让它落回上游 `plans/PlanSheets.tsx` 的 `NewPlanSheet`。
  分叉版里上游没有的东西只有"More options 里的四个角色"，不用搬。
- `AgentRoles.tsx`（接入点）：
  - `const words = useTeamWords();`（新 hook，写在 `auto-team.ts` 旁边的 `use-team-words.ts`：
    `useApp((s) => { const l = lineupOf(s); return l ? lineupWords(l) : undefined; })`）。
  - `const entries = withAuto(useAgentEntries(), words);`
  - `mixed()` 不变。合并回 One Agent 时沿用 builder 的值，AUTO 也一样。
- `PlanSheets.tsx`（接入点，两行）：`useState<RoleChoice>(ONE_AGENT)` 改成
  `useState<RoleChoice>(() => startChoice(teamByDefault(prefs.team, runtimes), words))`；
  `const agents = rolesInput(roles, runtimes, mine)` 改成
  `const agents = autoRolesInput(roles, (v) => agentForChoice(v, runtimes), mine) ?? rolesInput(roles, runtimes, mine)`。
  本机原生表单那一支（`useNativeSheet`）的 agent 下拉框同样包一层 `withAuto`。

- [ ] **Step 3: 计划页**

`AgentRoles.tsx` 的 `PlanAgentsButton`（接入点）：

- 菜单最上面加一行（有 `words` 才有）：
  `{ label: 'Automatic', hint: words, checked: Boolean(plan.autoTeam), onSelect: () => setAuto(!plan.autoTeam) }`，下面一条分隔线。
  `setAuto` 由 `PlanPage.tsx` 传进来，调 `api.setAutoTeam(plan.id, on)`，用 `usePlanActions` 的 `act`。
- `roleName` 在 `plan.autoTeam` 时先看 `teamAgent(plan, role, state)`，有就显示它的名字（带模型）；按钮上
  三个部分不全相同时仍是 "3 Agents"。
- builder 子菜单里 "Your Agent (…)" 一行在 Automatic 开着时写成 "Automatic (Haiku)"，选它仍是 `pick(role, null)`。
- **每个部分能选具体的模型**（设计 §7.2）。现在子菜单用的是 `agentOnlyItems`，只列 agent。换成完整列表
  （`components/agent-options.ts` 里已有的 `useAgentEntries` 和 `agentMenuItems`，New Plan 用的就是它们）：

```tsx
  const entries = useAgentEntries();
  // Every agent and model, a section per runtime; the first entry ("Your agent") is this menu's own first row.
  const models = entries.filter((e) => 'section' in e);
  // …在每个部分的 submenu 里，把 ...agentOnlyItems(…) 那一行换成：
      ...agentMenuItems(models, role === 'builder' ? plan.agent : plan[role], (value) => pick(role, agentForChoice(value, runtimes))),
```

  `agentMenuItems` 自己给每段的第一行加分隔线，所以原来的 `.map((row, j) => (j === 0 ? { ...row, separate: true } : row))`
  去掉。`agentOnlyItems` 的 import 没人用了就删（`chat/BuildWith.tsx` 还在用它，函数本身留着）。函数上方注释里的
  "(no models: each runs its default)" 改成 "(every agent and model, as New Plan lists them)"。打勾按
  `choiceForAgent` 比较，所以 planner 是 Claude Opus 时只有 Opus 那一行打勾。
- 截图里 "与 the Builder 相同" 是半句没翻译：`zh-CN.json` 里补上 "Same as the Builder" 的整句
  （`tests/plan-roles-i18n.test.ts` 加一条断言）。

`PlanPage.tsx`：••• 里"计划设置…"一行（分叉加的）删掉，连同 `PlanSettingsSheet` 的 sheet 类型。
`MilestoneRoles.tsx`：整块只在 `plan.autoTeam` 时渲染；"架构"一栏的标题改成 "Design"，"疑难修复"改成 "Escalations"，
数据形状不变。

- [ ] **Step 4: 设置**

`TeamSettings.tsx` 取代 `AutoRouteSettings.tsx`（在 `Settings.tsx`、`settings-index.ts`、`fork/settings-index.ts` 里换掉引用和搜索词）：

- 一行开关 "New plans pick their models automatically"，值是 `teamByDefault(prefs.team, runtimes)`，
  写 `session.setPrefs({ team: { ...team, byDefault } })`；副标题是 `words`，搭不出编队时写
  "Needs models of at least two strengths here"，开关灰掉。
- 按钮 "Customize…" 打开一张表：Planner、Builder、Checker 三张有序列表（上移、删除、Add ▸、Restore Defaults；
  行为照搬 `AutoRouteSettings.tsx` 里列表那一段，删文件前先把它搬过来），和 "Models Beluga doesn’t know" 一栏
  （本机能跑、`tierOf` 得不到档的模型，每个一个三选一的下拉框，写 `team.tiers`）。
- 新增的每个英文字符串在 `i18n/zh-CN.json` 加译文；删掉的页面的键一并删。

- [ ] **Step 5: 端到端**

`packages/mac/e2e/plan-auto-team.spec.ts`，照 `e2e/plan-roles.spec.ts` 的搭法（demo 状态里放 Opus、Sonnet、Haiku）：

1. New Plan：下拉框第一项是 Automatic，下面是 "Opus plans · Haiku builds · Sonnet checks"；选它建计划，
   计划页 agents 按钮的菜单里 Automatic 勾着，三行是 Opus、Haiku、Sonnet。
2. Mix Agents：planner 选 Sonnet，其余留在 Automatic；建出的计划 planner 是 Sonnet，builder 是 Haiku。
3. 计划页取消 Automatic：三行回到 Your Agent。再在 Planner ▸ 里选 Opus：按钮变成 "2 Agents"，
   菜单里 Planner 一行是 "Claude Opus"，子菜单里只有 Opus 打勾。
4. Settings › Agent：打开开关后，New Plan 默认选中 Automatic。
5. New Plan 选 Autopilot：下面**没有** *Never wait for me*（任务 0 删的；这条防止换回上游表单时把它带回来）。

`e2e/plan-roles.spec.ts`、`e2e/start-with.spec.ts` 是上游的，不改，必须通过。

Run: `npm run typecheck && npx vitest run tests/mac-* tests/plan-roles-i18n.test.ts && (cd packages/mac && npx playwright test e2e/plan-auto-team.spec.ts e2e/plan-roles.spec.ts)`
Expected: PASS。

- [ ] **Step 6: 截图和提交**

亮、暗各一张，放 `docs/reports/model-team/`：New Plan 的下拉框展开、Mix Agents、计划页的 agents 菜单、设置的自定义表。
再录一段从 New Plan 选 Automatic 到第一个里程碑开工的 GIF。

```bash
git add -A && git commit -m "Mac: Automatic in a plan's agent pickers; back on upstream's New Plan, the fork's role sheets are gone"
```

### Task 8: 手机和 Studio

**Files:**
- Modify: `packages/companion/app/plan/[id].tsx`、`packages/companion/lib/link/calls.ts`、`packages/companion/lib/link/demo/transport.ts`、`packages/companion/lib/fork/roles-words.ts`
- Modify: `src/studio/`（客户建计划的入口）
- Test: `tests/companion-plan-team.test.ts`（任务 6 已建，加用例）、`tests/studio-*.test.ts`

- [ ] **Step 1: 手机的计划页**

`[id].tsx` 的 ••• 表，角色那一组最上面加一行，`hidden: !store.supports('autoTeam') || !p?.team`：

```tsx
{ Icon: Sparkles, label: 'Automatic', sub: p?.autoTeam ? p.team : 'Your agent does the parts nobody picked', tone: p?.autoTeam ? 'lavender' : 'plain',
  onPress: () => void store.call(calls.setAutoTeam(id ?? '', !p?.autoTeam)).catch((e: Error) => store.toast(e.message)) },
```

图标用 `lucide-react-native` 里已经在用的一个，柔和的粉彩，不加发光（`lib/theme.ts`）。
"Agent for its architecture"、"Agent for hard fixes" 两行的 `hidden` 各加一个条件 `|| store.supports('autoTeam')`：
连到新 Mac 时不显示，连到老 Mac 时照旧。`calls.ts` 加

```ts
  /** 1.64 (fork): Automatic on a plan. */
  setAutoTeam: (planId: string, on: boolean): Call => make('plans.setAutoTeam', [planId, on], on ? 'Automatic' : 'Your agent'),
```

demo transport 里的示例计划加
`autoTeam: true` 和 `team`。`roles-words.ts` 里"架构""疑难修复"的中英文跟着 Mac 改成 Design、Escalations。

- [ ] **Step 2: 新老两头都测**

`tests/companion-plan-team.test.ts` 加：`supports('autoTeam')` 对 1.63 的 Mac 是 false、对 1.64 是 true；
老手机（按 1.63 的 schema 解析）读 1.64 的 `PlanView` 不报错，`planner` / `agent` / `checker` 是解析后的三个模型。

- [ ] **Step 3: Studio**

`grep -rn "plans().create\|autonomy" src/studio/*.ts` 找到客户建计划的地方（`service.ts:80` 是运营方替客户建的那一处，
参数是写死的）。客户能传参的入口（`actions.ts:186` 附近的 schema）如果已经是只收白名单字段的，就只加一条测试：
客户传 `autoTeam: true` 被拒或被丢掉，建出的计划 `autoTeam` 跟运营方的 `teamByDefault`。不是的话在 schema 里拒掉它。
`service.ts:80` 那一行加 `...(teamByDefault(prefs.team, runtimes) ? { autoTeam: true } : {})`。

- [ ] **Step 4: 跑测试，截图，提交**

Run: `npx vitest run tests/companion-* tests/studio-* && (cd packages/companion && npm run typecheck)`
Expected: PASS。手机截图两张（开、关）放 `docs/reports/model-team/`。

```bash
git add -A && git commit -m "Phone: Automatic on a plan's page (protocol 1.64); Studio plans follow the operator's setting"
```

### Task 9: 文档、全量测试

**Files:**
- Create: `docs/model-team.md`
- Modify: `docs/parity.md`、`docs/parity.fork.md`、`docs/tasks-and-plans.fork.md`、`docs/fork.md`、`docs/companion.md`

- [ ] **Step 1: 文档**

- `docs/model-team.md`（取代已删的 `auto-route.md`）：Automatic 是什么、能力表、§4.2 的表、谁优先、升级顺序、
  设置和迁移、在哪里能看到。
- `docs/fork.md`："计划按档位分工"和"自动路由"两节改写：现在分叉只在上游的三个部分上加 Automatic；
  列出上游文件里剩下的接入点（任务 4、6、7 里标了"接入点"的那些），删掉已经不存在的。
- `docs/tasks-and-plans.fork.md`：四个角色的段落换成 Automatic；上游的 `docs/tasks-and-plans.md` 不动。
- `docs/parity.md`、`parity.fork.md`：`plans.setAutoTeam`；`plans.setArchAgent`、`plans.setFixAgent` 标 "kept for one release"；
  去掉 Auto Route 设置页和 Plan Settings 表单的行。
- `docs/companion.md`：1.64 一段（Automatic；Full Autopilot 的删除任务 0 已写，合成一段）。

- [ ] **Step 2: 全量**

Run: `npm run typecheck && (cd packages/companion && npm run typecheck) && LC_ALL=C npx vitest run`
Expected: 全部 PASS，结尾有 `Tested-on: macOS <tree>`。

- [ ] **Step 3: 最后一次提交**

```bash
git add -A && git commit -m "Docs: the model team

Tested-on: macOS <tree>

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>"
```

`<tree>` 用上一步输出的那一行原样替换；跑完之后改过任何文件，就重跑再提交。然后停下：推送、开 PR、合并都等负责人的话。

---

## 留给负责人的决定：上游

#546 已被维护者关闭，他选了更小的粒度（三个部分，下拉框里只列 agent，不列模型）。三个选项：

1. **先不向上游提任何东西**（建议）。在分叉里用一段时间，有真实的截图和 GIF 再说。本分叉删了维护者刚做的
   Full Autopilot，方向已经和上游分开，这时候提 Automatic 更难被接受。
2. 把 Automatic 作为一个小 PR 提给上游，建在 BLG-982 之上：只有 `model-tiers.ts`、`autoTeam`、下拉框里一项，
   不带升级和设置页。说明里放任务 7 的截图和 GIF。
3. 把 endpoint 检查（`src/fork/endpoint-check.ts`，保存前先验证）单独提给上游。它和编队无关，原来夹在 #546 里。

未经负责人在当次会话里同意，不向 `beluga-labs/beluga` 推任何东西。

## 自查记录

- 设计文档 §2–§9 各有对应任务：§8 → 任务 0；§4 → 任务 1；§6.2、§6.3 → 任务 2、3；§2、§3 → 任务 4；§5 → 任务 5；
  §7.4、协议 → 任务 6、8；§7.1–7.3 → 任务 7；§9 → 任务 8。
- 任务 0 里的行号是 2026-11-17 `main`（`1a148bfe8`）上的；动手前用第 8 步的 grep 重新定位。没有验证过的假设：
  `plans.json` 里计划数组的键名；handler 的参数个数不对时 TypeScript 是否接受零参数的写法（不接受就写
  `(_s, _id, _on) => fullAutopilotGone()`）。已核对：计划的 schema 是 `.passthrough()` 的，所以 `fullAuto` 在
  `transform` 里显式丢掉；`e2e/plan-roles.spec.ts`、`e2e/start-with.spec.ts` 里没有 Full Autopilot。
- 名字前后一致：`ROLES` / `PlanRole` 都是 `planner`、`builder`、`checker`；`Lineup` 是每个部分的候选列表，
  `Resolved` 是每个部分解析出的一个 agent；`teamAgent`（一个部分）、`teamOf`（三个）、`taskAgent`（一个任务）。
- 执行时要对着真实代码核对的地方，都在各步里写了 grep：`state.models` 的形状、里程碑检查轮次的字段、
  `setRoleAgent` 的返回值、图标名、Studio 客户入口的 schema、`fork/limit-next-model` 的 cherry-pick。
- 没有验证过的假设：分叉的 New Plan 里除四个角色外没有别的上游没有的东西（任务 7 第 2 步删之前先 diff 一遍
  `fork/plans/NewPlanSheet.tsx` 和 `plans/PlanSheets.tsx`）。
