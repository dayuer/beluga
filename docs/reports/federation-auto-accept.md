# 里程碑 1：自动接单（定向派活）

日期：2026-11-15 · 分支：`beluga/blg-221`（已提交，还没有 PR）· 任务：BLG-221 – BLG-228

队友在共用看板上把一个 Ready 任务派给这台电脑，它就自己开工：`work.start(id, { claude: true, quiet: true, by })`，按信任门槛和同时数量把关。默认关。用法见 `docs/federation.md`。

## 做了什么

| 文件 | 内容 |
|---|---|
| `src/fork/federation/settings.ts` | `Federation` 的 zod 形状、`federationOf`（逐字段回落默认）、`clampAtOnce`、`FEDERATION_DEFAULTS`（off / full / 2 / "pool"） |
| `src/fork/settings-fields.ts` | `forkSettingFields`、`forkPrefsPatch`：fork 的设置字段（autoRoute、federation）合在一处，上游文件各一行展开 |
| `src/fork/federation/eligible.ts` | 纯函数 `eligible(issue, ctx)`，按顺序检查 10 个 `Why`；`assignerOf` 读 `fields.assignee.a` |
| `src/fork/federation/marker.ts` | `autoActor`（本机 Claude，for 派活人），`isAutoStarted`、`isAutoRunning`：从看板活动认出自动开的任务 |
| `src/fork/federation/accept.ts` | `FederationAccept`：串行对账、名额、失败不重试；触发和合并（`defer`，默认 200 ms） |
| `src/fork/federation/parts.ts` | `federationParts`：把真实的 board、sync、work、store 接进来 |
| `packages/mac/src/fork/federation/FederationSettings.tsx` | 设置 › Agent › 自动接单：关／派给我的、只接、同时进行 |
| `docs/federation.md` | 用户说明 |

## 上游文件的改动（相对 merge-base `3c592112e`，增删取大者）

| 文件 | 本里程碑之前 | 现在 | 改了什么 |
|---|---|---|---|
| `src/shared/settings-schema.ts` | 3 | **2** | import 换成 `forkSettingFields`；`...forkSettingFields, // fork: src/fork/settings-fields.ts` 替换原来的注释和 autoRoute 两行 |
| `src/machines/sync.ts` | 2 | **3** | `LOCAL_SETTINGS` 里加 `'federation',` |
| `src/core/board/launch.ts` | 0 | **2** | 一行 import；parts 数组末尾 `...federationParts({ team, board, sync: teamSync, work, store, live })` |
| `src/core/store.ts` | 33 | 33 | 只改 fork 旧行：Prefs 的 autoRoute 注释并到行尾，加 federation（换掉原注释行）；`prefsFrom` 数组加 `'federation'` |
| `src/ipc/api.ts` | 4 | 4 | 只改 fork 旧行：import 换成 `forkPrefsPatch`，`autoRoute:` 那行换成 `...forkPrefsPatch,` |
| `tests/mac-settings-search.test.ts` | 11 | 11 | 已是 fork 的那一行里加 `read('fork/federation/FederationSettings.tsx')` |

`node scripts/sync-upstream.mjs --report`：上面几个文件前面都没有 `!`（原因写在 `docs/fork.md`「联邦制：自动接单」一节和「自动路由」一节）。没改：`packages/mac/src/dialogs/Settings.tsx`、`src/core/team/protocol.ts`、`src/companion/protocol.ts`（`git diff e45932b1c` 为空）。全局报告里别的文件原有的超限不属于本里程碑。

## 通过标准和对应的测试

| 通过标准 | 测试 |
|---|---|
| `federation.accept` 默认 off；关着时不订阅、不调用 `work.start` | `fork-federation-settings`：federationOf gives the defaults when unset；`fork-federation-accept`：off: no start, and the board is never read；off: never subscribes and asks for no pass；`fork-federation-launch`：off (unset): never subscribes, never starts |
| assigned 时，队友派给本机、满足全部条件的任务被 `work.start(id, { claude: true, quiet: true })` 启动，且只启动一次 | `fork-federation-accept`：starts a task given to me exactly once…；`fork-federation-launch`：on: a task a teammate gave starts with Claude, quietly；`fork-federation-eligible`：每条规则各一个用例（1 assignee … 10 capacity） |
| 本机自己派给自己的任务不自动开工 | `fork-federation-eligible`：5 self-assigned…；`fork-federation-accept`：leaves a task from someone trusted less than `from`, and one I gave myself |
| 同时开工数不超过 atOnce；名额释放后补上排队的 | `fork-federation-accept`：keeps the rest in Ready past atOnce; a place freed lets the next start；a worktree started by hand takes no place |
| 派活人信任低于 `from` 时不动 | `fork-federation-eligible`：9 trust…；`fork-federation-accept`：leaves a task from someone trusted less than `from`… |
| 重启后不重复开工，仍认得之前自动开的 worktree 并用来算名额 | `fork-federation-accept`：a new instance over a board that already has the worktree starts nothing；after a restart it still knows what it started and counts them |
| 连续变化合成一次对账，测试里不 sleep | `fork-federation-accept`：three onChange and a linkUp in one burst: one pass；a change to labels only asks for nothing；after stop() nothing runs；never two passes at once（`defer` 由测试注入） |
| `federation` 在 `LOCAL_SETTINGS`，不随设置同步；autoRoute 读写不变 | `fork-federation-settings`：federation is this computer's own；federation never travels；old autoRoute settings parse the same；a bad federation keeps the rest；PrefsPatch and prefsFrom carry federation；`settings-sync`（原有，全过） |
| 上游文件 fork 改动 ≤ 3 行，`--report` 不报；Settings.tsx 不再改 | 上表；`fork-federation-launch`：launch.ts keeps its parts…；`browser-safe` |
| protocol.ts、companion/protocol.ts 没改 | `git diff e45932b1c -- src/core/team/protocol.ts src/companion/protocol.ts` 为空 |
| Mac 设置能切 关／派给我的，改信任门槛和同时数量 | `mac-settings-search`（索引里的标签都在源码里）；`clampAtOnce keeps 1–6`；界面没在运行中的 app 里点过，见下面「怎么手动试」 |
| 本页写好 | 本页 |

## 运行结果

```console
$ npx vitest run tests/fork-federation-settings.test.ts tests/fork-federation-eligible.test.ts tests/fork-federation-accept.test.ts tests/fork-federation-launch.test.ts tests/browser-safe.test.ts tests/mac-settings-search.test.ts tests/settings-sync.test.ts tests/boundaries.test.ts
 Test Files  8 passed (8)
      Tests  118 passed (118)
$ npm run typecheck                       # 通过
$ (cd packages/mac && npm run typecheck)  # 通过
```

整套 `npx vitest run` 和 e2e 不在这里跑，在计划最后一步跑。

## 怎么手动试

要两台电脑 A（你）和 B（队友），都装了这个分支的 Beluga，互为好友，在同一个 GitHub 仓库上组了团队。

1. A：设置 › Agent › 自动接单，把「队友派给我的任务自动开工」切到「派给我的」。「只接」保持「完全信任的人」，「同时进行」填 1。
2. A：在房间里把 B 设成「完全信任」。
3. B：在共用看板上新建两个任务，状态 Ready，都派给 A。
4. A：大约一秒内，排在前面的那个任务出现 worktree、变成进行中，A 的 Claude 开始做；活动里写着「A's Claude, for B moved this to In Progress」。第二个留在 Ready。
5. A：把第一个移到 In Review。第二个随后自己开工。
6. A：退出并重新打开 Beluga。不会有任务被再开一次。
7. B：再派一个给 A，但先在 A 上把 B 的信任改成「信任」。任务不动；把「只接」改成「信任的人」后它开工。
8. A：自己新建一个任务派给自己。它不动。
9. A：把开关切回「关」。再派任务过来，什么都不发生。
10. 看 `~/.beluga/settings.json` 里的 `federation`，以及另一台属于 A 的电脑上它没有被同步过去。

## 已知局限

- 活动记录有上限（`KEEP_ACTIVITY`）；活动特别多时「自动开工」那一行会被挤掉，名额少算一个。
- 朋友托付的 Claude（BLG-701，带 `for`）通过看板工具开的任务，会被当成自动开的。
- 老版本队友写的 Claude 归属被改写成本机时，任务不开工（只少开，不多开）。
- `working.*` 变化不触发对账。
- 和设计不同的一处：Mac 上「At once」改成「Running at once」（同时进行），因为上游中文目录里 "At once" 已经是「立即」。
