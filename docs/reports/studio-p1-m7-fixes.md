# M7 复检准则 3：遗留测试的修复（BLG-149–152）

M7 复检时，准则 3（`npx vitest run` 全量通过）有三项阻断。下面每节写一项：根因、修法、修法的依据。

## a · tests/sentinel-kept-data.test.ts（BLG-149）

**现象**：三个用例的文件清单里少了 `files/deploy.html`，单独跑也失败，在 3d4f9954 上同样失败。

**根因**：测试用了真实时钟。夹具把运行时间写死成 `T = 2026-10-28 09:00 UTC`，而 sentinel 的文件（typed column 的 document）只保留 14 天（`FILES_KEEP_DAYS`）。`keepNumbers` 每次都会先 `sweepDocuments`，从 2026-11-11 09:00 UTC 起，这次运行算作 14 天前，刚写进去的 document 就被当成过期清掉了。产品行为是对的，测试是个定时炸弹。它和计划分支无关：main 上的同一个测试，过了这一天也会失败。

**修法**：夹具给 Sentinels 一个自己的时钟（`now: () => T + 1h`），断言一条都没改。另外加一条回归用例：时钟拨到 T + 15 天，document 被清掉，report 和各步输出还在。这样「14 天后清除」这个正确行为被钉住了，以后不会再被误当成 bug。

**依据**：`src/core/sentinel/sentinels.ts` 的 `filesKeepDays` / `sweepDocuments`，以及 `dataList` 返回的 `keepsDays: 14`（原测试本来就断言了这一项）。
