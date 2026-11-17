# M7：Mac e2e 修复与重跑（BLG-140–145）

M7 检查时，计划分支上有 5 个 Mac e2e 用例稳定失败。下面是每个用例的根因、修法和单独重跑的结果，最后是整套重跑的结果。
日志都在 `.beluga/scratch/m7/e2e/`（git 不收）。

## 五个阻断项

| 项 | 用例 | 根因 | 修法 | 单独跑 |
|---|---|---|---|---|
| a · BLG-140 | copilot-flow.spec.ts:16 | 测试是旧版。UI 和 main 一样，「External agents」这一项本来就包含 agent；main 在 4b54e83c 已改为 `exact: true` | 把 main 的这一行带过来（按名字精确匹配，比原来更严） | 1 passed |
| b · BLG-141 | diff-comments.spec.ts:33 | i18n 迁移时文案写成「{count} comment(s)」，单复数丢了 | 新增 `views.diff.waitingOne`，多数写成 "comments" | 1 passed |
| d · BLG-142 | onboarding-agents.spec.ts:13 | i18n 迁移时 `onboarding.steps.heroBody` 漏了 GitHub Copilot | en 和 zh-CN 都补回 | 1 passed |
| e · BLG-143 | sentinel.spec.ts:358 | 产品问题，不是夹具问题。瓦片菜单借用了添加瓦片页的「Show it as」，main 上是「Show as」 | 新增 `sentinel.dashboard.tileShowAs` | sentinel.spec.ts 18/18 |
| c · BLG-144 | git.spec.ts:126 | 产品问题，main 上也一样：`sync.ts` 靠 git 的英文消息（"would be overwritten"）判断改动挡路，这台 Mac 的 git 说中文，于是弹出「Couldn’t update main」。`tests/setup.ts` 固定了 `LC_ALL=C`，所以单元测试看不到 | `src/workspaces/git.ts` 设 `LC_MESSAGES=C`（`LC_ALL` 移到 `LC_CTYPE`）；新增 `tests/git-env.test.ts` | git.spec.ts 6/6 |

## 整套重跑中新发现的问题

| 用例 | 根因 | 修法 | 结果 |
|---|---|---|---|
| usage.spec.ts:177 | 单独跑也失败。时间轴上 2px 的「Now」线落在当前 5 小时窗口的中点附近，挡住了悬停 | `.now { pointer-events: none }` | usage.spec.ts 11/11 |

## 整套 `npm run e2e`（packages/mac，共 520 个用例）

| 轮次 | 开始时负载（10 核） | 第一遍 | e2e-lock 单独重跑失败项 | 之后 |
|---|---|---|---|---|
| full-1.txt | 115 → 7.7 | 466 passed，16 failed，28 did not run（负载 11.4×） | 43/44 passed，usage:177 仍失败 | 修了 usage:177，单独跑 11/11 |
| full-2.txt | 7.2 → 中途被别的进程推到约 50 | 396 passed，78 failed，38 did not run（负载 7.8×） | 94 passed，3 failed，17 did not run（重跑时负载约 20） | 3 个文件在负载约 12 时单独跑，22/22 passed（rerun-3.txt） |

第二轮里所有用例都至少通过了一次：要么在第一遍，要么在 lock 的重跑，要么在最后把三个文件单独再跑一次。
失败的用例大多只用了 0–60 ms，是 demo daemon 在负载下没起来，不是断言出错。最后剩下的 3 个在负载降下来后单独跑都通过。
**没有做到的**：没有一轮是在负载始终不超过核数的情况下一次跑完、全部通过的。这台 Mac 上同时开着 iOS 模拟器等别的工作，第二轮刚开始时负载是 7，跑到中途又涨到 50。
