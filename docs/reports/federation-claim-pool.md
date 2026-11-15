# 里程碑 2：认领池（不指定给谁）

日期：2026-11-15 · 分支：`beluga/blg-229`（已提交，还没有 PR）· 任务：BLG-229 – BLG-235 · 基准：计划分支 `plan/756ad109` 的 `af01253a7`（里程碑 1 已合入）

accept 选「派给我的，以及认领池」时，带池标签（默认 `pool`）、没人接的 Ready 任务由有空的电脑认领：负责人改成自己，等 3–7 秒，负责人还是自己才开工。两台同时领时看板合并只留一个；断网时两边都开了工，输家在合并后停 agent、归档 worktree。用法见 `docs/federation.md`「认领池」一节。

## 做了什么

| 文件 | 内容 |
|---|---|
| `src/fork/federation/eligible.ts` | 拆出 `eligibleCore(issue, ctx, giver, { selfOk })`，`eligible()` 先查负责人再调它，规则和顺序不变；新增 `poolGiverOf`（`fields.labels.a`，最后改标签的电脑） |
| `src/fork/federation/claim.ts` | 纯函数：`pickClaimable`、`pickPending`（按 `listOrder` 排序，名额 = atOnce − 在跑 − 待确认）、`confirmDelay`（`CONFIRM_MIN_MS` 3000 + `CONFIRM_JITTER_MS` 4000 内的随机量）、`stillMine`。不含计时器、时钟、随机源 |
| `src/fork/federation/accept.ts` | 对账顺序：输家清理 → 待确认重新排队 → 定向派活（名额含待确认）→ 认领（同步 `board.update`）。确认用注入的 `after`、`random`；`settled()` 也等确认中的 start；pool 模式下标签变化也触发对账 |
| `src/fork/federation/marker.ts` | `isAutoLine` 去掉 `for.id !== self`：自己打标签、自己领的任务也认得出是自动开工的 |
| `src/fork/federation/parts.ts` | 转交 `after`、`random`；有 `session` 时接上 `stopAndArchive`（先 `host.stopRun('ws:'+id, { quiet })`，再 `workspaces.archive(id, false, { quiet })`） |
| `packages/mac/src/fork/federation/FederationSettings.tsx` | 「派给我的，以及认领池」选项；选了才出现「池标签」输入框 |
| `packages/mac/src/fork/settings-index.ts`、`packages/mac/src/i18n/zh-CN.fork.json`、`docs/parity.fork.md` | 搜索索引、中文文案、对照表那一行 |
| `docs/federation.md` | 「认领池」一节和两条局限 |

## 上游文件的改动

| 文件 | 本里程碑之前 | 现在 | 改了什么 |
|---|---|---|---|
| `src/core/board/launch.ts` | 2 | **2** | 只改 fork 自己的那一行：`...federationParts({ team, board, sync: teamSync, work, store, live, session })`，多传一个 `session` |

没有新增上游接入点，没有别的上游文件被改。`node scripts/sync-upstream.mjs --report` 里 `src/core/board/launch.ts` 是 `+2/-1`，前面没有 `!`。`src/core/team/protocol.ts` 和 `src/companion/protocol.ts`：`git diff --quiet af01253a7 -- src/core/team/protocol.ts src/companion/protocol.ts` 退出码 0（没改）。`src/fork/federation/settings.ts` 和 `src/shared/settings-schema.ts` 也没改。

## 通过标准和对应的测试

| 通过标准 | 测试 |
|---|---|
| 带 `poolLabel`、无归属人、Ready、其余条件满足的任务被本机认领：`assignee` 改成本机 | `fork-federation-claim`：pickClaimable: a pool task nobody has, Ready, is picked；each missing rule leaves it out（11 条）；one I labelled myself is picked。`fork-federation-pool`：pool: claims a pool task as mine; after the delay, starts it once |
| 认领后等过注入时钟上的一小段（带随机量），归属人仍是自己才调用 `work.start` | `fork-federation-claim`：confirmDelay spans [3000, 7000)；stillMine: mine / someone else / cleared。`fork-federation-pool`：pool: claims a pool task as mine…（flush 前 0 次，flush 后 1 次）；a teammate takes it before the delay: no start；cleared before the delay: no start, and it may be claimed again |
| 认领后、确认前重启（新建部件实例、同一块看板），仍能接着确认并开工，且只开一次 | `fork-federation-claim`：pickPending: mine, claimed by me, no worktree, is pending；each broken rule leaves it out。`fork-federation-pool`：restart between claim and confirm: a new instance confirms and starts exactly once；two passes on one instance: one confirm queued, one start |
| 两个内存里的团队实例同时认领同一个任务：合并后只有一方开工 | `fork-federation-pool`：both claim at once: the merge keeps one, and only that one starts（`teamMac` 两台，真实 `TeamBoardSync`，两次 `reconcile()` 之间不 await） |
| 输的一方（归属人变成了别人）停掉 agent 并归档自己的 worktree；人手动开的不动 | `fork-federation-pool`：partitioned: both start; after the merge the loser stops and archives once, the winner never；a worktree started by hand stays when the task goes to someone else; one auto accept started goes, once；`fork-federation-launch`：launch.ts keeps its parts…（那一行含 `live, session })`） |
| 本机名额已满时不认领；待确认的任务算进名额 | `fork-federation-claim`：pending holds places: atOnce 2, 1 running, 1 pending → none; room 1 → one。`fork-federation-pool`：a pending one holds a place: atOnce 1 → nothing new is claimed；a pending one holds a place for tasks given to me too |
| accept 为 assigned 时不认领池里的任务、自派任务不开工；为 off 时什么都不做 | `fork-federation-claim`：not pool (off / assigned): both empty；assigned: a pool task I claimed myself still isn't ok for eligible。`fork-federation-pool`：assigned: no claims, a self-claimed pool task waits, a teammate's still starts；switched to assigned while a confirm waits: it does not start；assigned: a lost pool task is never archived；off: no reads, no claims |
| Mac 设置里能选认领池并改池标签 | `mac-settings-search`（Pool label 在索引里、在源码里）；`i18n`；`packages/mac` typecheck。界面没在运行中的 app 里点过，见下面「两台机器怎么手动试」 |
| `docs/reports/federation-claim-pool.md` 写好，每条通过标准有对应测试 | 本页 |
| `src/core/team/protocol.ts` 和 `src/companion/protocol.ts` 没有改动；不新增上游接入点 | 上一节 |
| 测试里没有 sleep，没有靠时间的竞争 | `fork-federation-claim`：claim.ts has no timers, clocks or randomness；`fork-federation-pool`：no real timers or waits: time moves only through the injected after。两台的测试只用 `settle` 等条件，不断言耗时 |
| 本里程碑新增和改动的测试文件、`npm run typecheck` 通过 | 下面「运行结果」 |
| 整套测试 | 下面「整套测试」，由计划最后一步填 |

其余顺带测到的：`fork-federation-pool`：pool still starts what a teammate gives me, straight away；a status line for myself counts as auto started（marker.ts 那一处改动）。`fork-federation-eligible` 原有 13 条一行没改，全部通过。

## 运行结果

```console
$ npx vitest run tests/fork-federation-settings.test.ts tests/fork-federation-eligible.test.ts tests/fork-federation-claim.test.ts tests/fork-federation-accept.test.ts tests/fork-federation-pool.test.ts tests/fork-federation-launch.test.ts tests/mac-settings-search.test.ts tests/i18n.test.ts tests/boundaries.test.ts tests/browser-safe.test.ts
 Test Files  10 passed (10)
      Tests  164 passed (164)
$ npm run typecheck                       # 通过
$ (cd packages/mac && npm run typecheck)  # 通过
```

`tests/fork-federation-pool.test.ts` 单独连跑 3 次，3 次都是 17 条通过。

## 整套测试

由计划最后一步（审计）填写：整套 `npx vitest run`、`npm run typecheck`、`packages/companion` 的 `npm run typecheck` 的结果，以及那次的 `Tested-on` 行。本任务没有跑整套。

## 和设计不同的地方

- 分区那条测试里，B 断网期间的「认领 + 开工」直接在 B 的看板上做（改负责人、`linkWorktree`、移到 In Progress，actor 用 `autoActor`）。原因：`teamMac.stop()` 会停掉 B 的部件，断网期间没有在跑的 FederationAccept。合并和输家清理走的是真实的 `TeamBoardSync` 和 FederationAccept。
- `tests/fork-federation-accept.test.ts` 的假 board 加了一个会抛错的 `update`，因为 `AcceptDeps.board` 现在需要 `update`。
- 定向派活的循环在名额满时改成 `break`（原来是 `return`），这样同一轮里还能走到认领那一步（认领自己会因为没名额而什么都不选）。

## 两台机器怎么手动试认领池

要两台电脑 A 和 B，都装了这个分支的 Beluga，互为好友，在同一个 GitHub 仓库上组了团队，互相设成「完全信任」。

1. A 和 B：设置 › Agent › 自动接单，选「派给我的，以及认领池」。池标签保持 `pool`，「同时进行」填 1。
2. A：在共用看板上新建一个任务，状态 Ready，负责人留空，加上标签 `pool`。
3. 两台中的一台（一般是先看到的那台）把负责人改成自己；3–7 秒后它开出 worktree，任务变成进行中，活动里写着「…'s Claude, for A moved this to In Progress」。另一台不开工。
4. 再建两个池任务。刚才开工的那台名额已满，不再领；另一台领一个。
5. 在一台上领了、还没开工时（3 秒内）退出 Beluga 再打开：重新打开后等一会儿照样开工，只开一次。
6. 断网试：先把两台的「同时进行」都调大，A 上建一个池任务，但先不加 `pool` 标签；等它同步到 B 后断开 B 的网络，再在 A 和 B 上各自给它加上 `pool`。两边各自领、各自开工。恢复网络后看板只留一个负责人；另一台随后停掉 agent，worktree 进 Archive（可以恢复）。
7. 在一台上手动点 Start 开一个池任务，然后在另一台把负责人改成自己：手动开的 worktree 不会被归档。
8. 把设置改回「派给我的」：池里的任务不再有人领。改池标签为 `free`，只有带 `free` 的任务才算在池里；清空输入框回到 `pool`。
9. 看 `~/.beluga/settings.json` 里的 `federation.accept` 和 `poolLabel`。

## 已知局限

- 3–7 秒的等待只能挡住几乎同时的认领；消息走得更慢或断网时两边都会开工，由输家收拾，其中一边白做一段。
- 输家在下次对账时才收拾（负责人或状态变了、有电脑上线等），不是一合并马上停。
- 负责人被清空（不是换成别人）时不收拾。
- 里程碑 1 的局限照旧（活动记录上限、`working.*` 变化不触发对账等），见 `docs/reports/federation-auto-accept.md`。
