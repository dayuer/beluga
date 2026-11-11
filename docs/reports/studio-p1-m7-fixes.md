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

## c · tests/studio-sanitize.test.ts 的 S-1（BLG-151）

**现象**：S-1 断言「每次 < 1500 ms」，复检时负载在 33–36，实际跑了 1.7–3.7 s，于是失败。

**改测试时发现了真问题**：`sanitizeText` 会把输入截到 `4 × max` 字（默认 16000），原测试的「长输入」其实都被截短了，所以它从来没有真正测过增长曲线。按长度 2000 和 16000 对比，有 4 条正则在空白很多的输入上是平方级的（16000 个空格要 300–600 ms）：

| 正则 | 在哪 | 修法 |
|---|---|---|
| `\s*(?:&&\|\|\|)\s*` | replacers | 加 `(?<!\s)` |
| `\s+([，。…])` | tidy | 加 `(?<!\s)` |
| `\s*\n\s*` | sanitizeLine | 加 `(?<!\s)` |
| FENCE：`^(?:[ \t]*(?:>[ \t]?)*(?:[-*+]\|\d{1,3}[.)])?[ \t]*)` | dropFences，逐行 | 改为 `^[ \t]*(?:>[ \t]*)*(?:(?:[-*+]\|\d{1,3}[.)])[ \t]*)?` |

`(?<!\s)` 让匹配只从一段空白的开头开始。最左匹配本来就从那里开始，所以匹配结果不变；空白段内部的每个起点会被立刻排除，不再各扫一遍剩下的空白，整体变回线性。FENCE 原来在可能为空的两个可选组两边都有 `[ \t]*`，一行空格有 n² 种切分；新写法里每个空格只有一种归属。这个新写法比原来多接受一种形状（`>  - ```` `），也就是会多当成代码去掉一点，这是更安全的方向。studio 的 13 个测试文件、290 个用例全部通过。

**新断言的原理**：同一轮里，把一段长输入（16000 字）跑一次，和把一段短输入（2000 字）跑 8 次（总字数相同）做比较。两边各测 5 轮，各取最小值，再看两者的比值。
- 线性实现两边成本相同，比值约 1。部分规则有 `{0,2000}` 这类有界窗口，比值可能到 2 左右（实测最大 1.9）。
- 平方级实现在长输入上要多花 8 倍，比值约 8。
- 断言比值 < 4，没有任何毫秒阈值。两边是在同一时刻、同一台机器上测的，负载对两边的影响基本抵消。
- 覆盖 `的`、`a.`、空格、`x/`、空格换行、制表符空格、`&& ` 七种形状，`sanitizeText` 和 `sanitizeLine` 都测。

**验证**：单独连跑两次都通过。把 `&&` 那条临时改回 `\s*…\s*`，用例失败：`sanitizeText on " ": 230.4 vs 27.0: expected 8.55 to be less than 4`。验证完已改回。

## d · packages/studio-app 的 e2e 时序敏感（BLG-153）

**现象**：复检时连跑三次都失败：flow.spec 和 plan.spec 在 phone、desktop 下都超时，登录页的 `getByTestId('email')` 一直没出现，而 hub 日志里 login/verify 和 plans GET 都是 200。同一提交早些时候跑过一次是全过的。

**复现**：本机在负载约 31 时跑了两次，两次都全过（16 passed，4 skipped），没有复现出来。日志：`.beluga/scratch/m7/e2e/studio-app-before.txt`、`studio-app-after.txt`。

**找到的两处隐患**：
1. **flow.spec 第一步是固定等待**：`goto('/login')` 之后固定等 400 ms，接着直接读 `getByTestId('email').boundingBox()`。`boundingBox()` 不会等元素出现，负载一高，打包后的 JS 400 ms 内还没画出登录页，就拿到 null，失败信息还说不清是什么情况。
2. **`run.mjs` 不检查端口有没有被占**：8787 和 8790 也是真实全流程演练（BLG-98）用的端口。如果另一次运行留下的 wrangler 或 proxy 还在监听，新起的服务绑不上端口，但 `waitFor('/healthz')`、`waitFor('/login')` 会被旧服务应答，测试实际驱动的是别人的构建和数据。这和「中台接口都是 200，页面却不对」的现象吻合，但当时的日志里看不出确证。

**修法**（没有普遍加长超时，也没有靠失败后重跑）：
- 新增 `ready(page, testId, 说明)`：等某个 testid 真正可见。等不到时报错写明是哪一屏、当前 URL、页面上显示的前 300 字（转圈、错误还是登录页）。登录页改为等 `email` 和 `primary` 都可见以后再量尺寸，原来的固定 400 ms 去掉了。`login`、`sessionLogin`、`openHome` 也都改用 `ready`。
- `run.mjs` 启动前检查 8787、8790、8791、8792 都空着，有被占的就立刻停下，并给出 `lsof` 命令。我人为占住 8790 验证过：`port 8790 is already in use (another hub, proxy or e2e run?)`。wrangler 和 proxy 如果在就绪之前退出，会带上日志末尾 30 行报错，而不是一直等到 60 s 超时。日志路径的提示也从 `m5` 改成了实际的 `m6`。

**低负载通过记录**：开始时负载 8.1（10 核），16 passed，4 skipped，结束时负载 24（别的进程）。日志：`.beluga/scratch/m7/e2e/studio-app-lowload.txt`。在这之前那次被新的端口检查拦了下来：8790 上留着我自己验证端口检查时起的监听进程。也就是说，「旧服务占着端口、冒充就绪」这种情况在这台机器上确实会发生。

**为什么不能只靠重跑**：两种失败都和负载、时机有关。重跑能碰巧过，但下次还会在同样的条件下再失败，而且失败信息说不清原因。现在等待的是「元素真的画出来了」，端口被占时直接说是哪个端口，失败时也会写明卡在哪一屏。

## e · 修复后全量验证（BLG-152）

### 全量 `npx vitest run`
- 开始时负载 **9.46**（10 核），结束时 24（别的工作区的 Mac e2e 正好开始）。
- **656 个文件通过，1 个跳过（`tests/machines/ready-real.test.ts`，本来就按设计跳过）；7931 个用例通过，7 个跳过。** 结尾有 `Tested-on: macOS c403d8b0…` 行。
- 本轮修过的三个文件都在这次全量里通过：`linux-computer`（21 s，没有被 skip）、`studio-sanitize`（92 个用例）、`sentinel-kept-data`（5 个用例）。
- 日志：`.beluga/scratch/m7/full/vitest-blg152.txt`

### packages/studio-app 的 `npm run e2e`
- 开始时负载 **8.1**：16 passed，4 skipped。日志：`.beluga/scratch/m7/e2e/studio-app-lowload.txt`（详见 §d）

### packages/mac 的 `npm run e2e`（第三轮，full-3）
- 20:26 时负载 9.4，开始排队；e2e-lock 一直在等另一个工作区（`ship-check-wt2`）跑了一个多小时的 Mac e2e，**20:37 才真正开跑，当时负载 12.8**。跑的过程中，别的会话又把负载推到 30 以上（lock 记的是 4.3×）。
- 第一遍：469 passed，15 failed，26 did not run，用时 24.5 min。lock 单独重跑失败项：22 passed，2 failed，17 did not run。日志：`.beluga/scratch/m7/e2e/full-3.txt`
- 重跑后剩下的两个失败：
  1. **`sentinel.spec.ts:37`：夹具问题，已修。** 每个 worker 会在当前文件跑的时候预先起好下一个文件的 demo daemon（预热）。demo 里 "Watch the web" 那次运行从 daemon 启动起 90 秒后结束（`src/core/sentinel/demo.ts`），而用例要看到它还在 Running。前一个文件跑得久的时候（有用例卡满 45 秒超时、负载高），预热的 daemon 轮到 sentinel.spec 时已经超过 90 秒，运行早已结束。所以它总在前面有失败的重跑阶段出问题，单独跑却能过（BLG-145 的第二轮也是这样）。修法：`e2e/fixtures.ts` 里，预热超过 45 秒的 daemon 丢掉，换一个新起的。**验证**：在它前面放一个空等 100 秒的临时 spec，旧夹具下 sentinel:37 失败，新夹具下通过（`.beluga/scratch/m7/e2e/stale-warm-check.txt` 是没有长文件时的对照）。
  2. **`instant-worktrees.spec.ts:51` / `:68`：没有修，是已知的偶发问题。** 用例读完右键菜单的文字、截完图以后，菜单自己关掉了，接下来的 `dispatchEvent('click')` 等不到菜单项，直到超时。单独跑整个文件全过；用 `--repeat-each=6` 在负载约 16 时重复 6 遍，失败 1 次，快照里菜单确实已经不见了。用例里的注释说「demo 的流式输出让侧栏和它的菜单一直在重画」，最可能的原因是侧栏重新挂载了那一行，Radix 的 ContextMenu 跟着被卸载了。这算一个产品体验问题：右键菜单开着时可能自己关掉。但要确认得深入侧栏组件，超出了本轮的范围。我没有改测试去掩盖它，留作单独的任务。

**没有做到的**：没有一轮 Mac e2e 是在负载始终不超过核数的情况下一次全过的。这台机器上同时有别的工作区在跑 Mac e2e，还有别的 Claude 会话，负载反复涨到 30 以上，不是这个工作区能控制的。
