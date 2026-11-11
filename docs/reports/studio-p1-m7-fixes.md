# M7 复检准则 3：遗留测试的修复（BLG-149–152）

M7 复检时，准则 3（`npx vitest run` 全量通过）有三项阻断。下面每节写一项：根因、修法、修法的依据。

## a · tests/sentinel-kept-data.test.ts（BLG-149）

**现象**：三个用例的文件清单里少了 `files/deploy.html`，单独跑也失败，在 3d4f9954 上同样失败。

**根因**：测试用了真实时钟。夹具把运行时间写死成 `T = 2026-10-28 09:00 UTC`，而 sentinel 的文件（typed column 的 document）只保留 14 天（`FILES_KEEP_DAYS`）。`keepNumbers` 每次都会先 `sweepDocuments`，从 2026-11-11 09:00 UTC 起，这次运行算作 14 天前，刚写进去的 document 就被当成过期清掉了。产品行为是对的，测试是个定时炸弹。它和计划分支无关：main 上的同一个测试，过了这一天也会失败。

**修法**：夹具给 Sentinels 一个自己的时钟（`now: () => T + 1h`），断言一条都没改。另外加一条回归用例：时钟拨到 T + 15 天，document 被清掉，report 和各步输出还在。这样「14 天后清除」这个正确行为被钉住了，以后不会再被误当成 bug。

**依据**：`src/core/sentinel/sentinels.ts` 的 `filesKeepDays` / `sweepDocuments`，以及 `dataList` 返回的 `keepsDays: 14`（原测试本来就断言了这一项）。

## b · tests/machines/linux-computer.test.ts（BLG-150）

**现象**：复检时这条用例 waitFor 超时，单独跑和在 3d4f9954 上都失败。

**诊断**：在这台 Mac 上复现不了，它不是计划分支引入的回归。证据如下：
- 单独跑 6 次全部通过（15–23 s）：1 次在负载约 34 时，4 次同时并发，1 次用 30 个 `yes` 把负载压到 30 以上；
- 之前两次全量（`.beluga/scratch/m7/full/vitest*.txt`）里它也是通过的（10–13 s）；
- `git diff main` 没有改到 `src/machines` 和这个测试。

复检时的失败日志没有留下来，原来的 `waitFor timed out` 也不说是哪一步。这个用例要在 127.0.0.1 上起 hyperdht 测试网（UDP），要开本地 TCP 端口，还要另起 `beluga daemon` 子进程。复检 agent 的沙箱如果禁了其中任何一样，配对就会一直等到超时。这是目前最可能的原因，但没能确证。

**处理**（没有加长任何超时）：
1. **环境探测，并显式 skip**：开始前先检查三样，UDP 回环收发、127.0.0.1 上的 TCP 监听和连接、起一个子进程。缺任何一样，用例名会变成「… — skipped: <原因>」，stderr 里打印 `tests/machines/linux-computer.test.ts skipped: <原因>`。探测完全不碰 Beluga 自己的代码，所以产品代码出了回归，这条用例照样会失败，不会被当成「环境缺失」跳过。这条路径我人为制造过一次失败，验证过 skip 的原因确实打印出来了。
2. **超时说清楚是哪一步**：五处等待都改用 `waitStep(说明, …)`。超时报错会写明卡在哪一步，并附上 headless daemon 和 `beluga pair` 的 stdout、stderr 末尾 4000 字。下次再失败，看日志就知道是环境的问题还是产品的问题。

**结果**：在本机通过（1 passed）；在缺 UDP、TCP 或子进程的环境里显式 skip，并能看到原因。
