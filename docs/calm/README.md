# 沉稳界面总报告（M0–M4）

这个页面收尾整件事：每个页面验收了什么、同步上游要付多少代价、还剩哪些动效在播、六条规范逐条是否真的满足。

| 节 | 内容 | 状态 |
| --- | --- | --- |
| [§1](#1-m0m4-总览) | M0–M4 各页索引与一行结论 | BLG-179 |
| [§2](#2-同步演练模拟上游改动接入点) | 同步演练：种子、冲突与解法、检查报告 | BLG-177 已完成 |
| [§3](#3-真实同步记录) | 对真实 upstream 的同步记录 | BLG-178 |
| [§4](#4-全量验证) | 测试、e2e、calm-check 全场景 | BLG-178 |
| [§5](#5-仍在播放的动画及理由) | 仍在播放的动画清单与理由 | BLG-179 |
| [§6](#6-上游文件改动清单) | 本计划改了哪些上游文件（文件数、行数） | BLG-179 |
| [§7](#7-六条规范逐条判定) | 逐条规范判定表与问题表 | BLG-179 |
| [§8](#8-同步操作手册) | fork.md「同步上游」五步的展开版 | BLG-179 |

## 1. M0–M4 总览

（BLG-179 填：各页报告索引与一行结论。）

## 2. 同步演练：模拟上游改动接入点

目的：用一次真实的合并证明同步代价很小——脚本能先标出风险文件，冲突有固定解法，合并后报告能立刻指出新动效和失效的覆盖层规则。

### 2.1 种子（「上游身份」）

从真实 `upstream/main`（`0f1358f92`，`packages/mac` 3.2.0）切出 `calm-rehearsal-up`，按上游的提交风格写两个提交：

1. `feat(mac): live dot on the sentinel dashboard; the needs row is the needs line`
2. `fix(mac): small wording and guard fixes in sidebar, chat, toasts, steps and board`

| 文件 | 种子改动 | 想验证什么 |
| --- | --- | --- |
| `packages/mac/src/layout/Sidebar.tsx` | 把 `useSidebarHold` 下一行的注释改写（KLD-48 → KLD-52） | 相邻行改动 |
| `packages/mac/src/chat/ChatLog.tsx` | 回到底部按钮：`Latest` → `Back to latest`，图标 12 → 13 | 与 fork 的 `<JumpLabel>` 同一段 |
| `packages/mac/src/App.tsx` | `if (!toast) return null` → 加 `!toast.text` | 与 fork 的 `!one` 同一行 |
| `packages/mac/src/chat/steps/AgentSteps.tsx` | `usePrefs().reduceMotion` → `?? false` | fork 的 `useCalm()` 上一行 |
| `packages/mac/src/tasks/TaskBoard.tsx` | 在 reduce 行上新增一行注释 | 覆盖 fork 的 calm 三行 |
| `packages/mac/src/sentinel/home.module.css` | 新增 `.liveDot`、`@keyframes pulse`、`animation: pulse 2s … infinite` | 新增动效应出现在 fork-calm 的 NEW |
| `packages/mac/src/layout/signal.module.css` | `.needsRow` → `.needsLine`（5 处，TSX 不改） | 覆盖层 `[class*='_needsRow_']` 应判为失效 |

### 2.2 怎么跑

```bash
# 种子推到本地裸仓库，当作这次演练的「上游」；真实 upstream remote 不碰
git init --bare /tmp/beluga-calm-rehearsal.git
git push /tmp/beluga-calm-rehearsal.git calm-rehearsal-up:main
git remote add calm-rehearsal /tmp/beluga-calm-rehearsal.git

# 从 M4 分支切一个演练分支，指向本地镜像跑同步
git switch -c calm-rehearsal-work
node scripts/sync-upstream.mjs --remote calm-rehearsal

# 解完 6 个冲突后
git add -A && git commit --no-edit
node scripts/sync-upstream.mjs --after-merge --remote calm-rehearsal
```

脚本切出的同步分支是 `sync/upstream-3.2.0-2026-11-11`，合并提交仍是 `Merge upstream 3.2.0`——amend 护栏按预期生效。

### 2.3 合并前：脚本标出了什么

```
合并时检查 (check while merging): 11 files this fork changes that upstream changed too
  docs/parity.md
  ⚠ 沉稳界面  packages/mac/src/App.tsx
  ⚠ 沉稳界面  packages/mac/src/chat/ChatLog.tsx
  packages/mac/src/chat/Composer.tsx
  ⚠ 沉稳界面  packages/mac/src/chat/flight.ts
  ⚠ 沉稳界面  packages/mac/src/chat/steps/AgentSteps.tsx
  ⚠ 沉稳界面  packages/mac/src/layout/EntryRow.tsx
  ⚠ 沉稳界面  packages/mac/src/layout/Sidebar.tsx
  packages/mac/src/layout/workspace-row.tsx
  packages/mac/src/sentinel/SentinelCards.tsx
  ⚠ 沉稳界面  packages/mac/src/tasks/TaskBoard.tsx
```

- 五个种子里的 TSX 文件（Sidebar、ChatLog、App、AgentSteps、TaskBoard）全部被标为「合并时检查」；信号/仪表盘两个 CSS 种子不是 fork 改过的文件，所以不进这份清单（它们只可能带来新动效/失效规则，后面两段会报）。
- 另外 8 个是这次真实 upstream 也改了的 fork 文件（其中 `EntryRow.tsx` 是真实改动，不是种子，见下）。

### 2.4 六个冲突与解法

| 文件 | 上游改动 | fork 接入点 | 解法 |
| --- | --- | --- | --- |
| `layout/Sidebar.tsx` | 注释改写（KLD-52） | `useSidebarHold(drop.ref)` | 用上游的新注释，接入点留在它上一行 |
| `chat/ChatLog.tsx` | 图标 13 + `Back to latest` | `<JumpLabel rows={rows.length} />` | 保留 `JumpLabel`：它同时给出「下面来了几条」，上游只改文案 |
| `App.tsx` | `!toast.text` 守卫 | `!one` 守卫 | 合成 `if (!toast \|\| !toast.text \|\| !one) return null;` |
| `chat/steps/AgentSteps.tsx` | `reduceMotion ?? false` | `const calm = useCalm()` + 返回值 | 上游表达式留在原位，`calm` 一行与 `return os \|\| reduce \|\| calm` 跟上 |
| `tasks/TaskBoard.tsx` | 新注释 + 原 reduce 行 | calm 注释、`calm`、新 reduce 表达式 | 上游注释保留，fork 的两行替换 reduce 并沿用 |
| `layout/EntryRow.tsx`（真实上游改动，非种子） | 新增 `import type { WorkspaceRowActions }` | `import { useHeldEntries }` | 两个 import 都保留 |

解法模板就是 fork.md 各登记行的意思：**上游改动留原位，fork 的一行接入点跟上**。六处解法都已被 rerere 记住（见 2.7）。

### 2.5 合并后：新动效与失效规则

`--after-merge` 跑 `tests/fork-calm.test.ts` 后的报告（NEW 段）：

```
  NEW since tests/fork-calm.snapshot.json (9):
    + call/PointerMark.tsx:59  element-animate|call/PointerMark.tsx|animate
    + sentinel/home.module.css:640  infinite|sentinel/home.module.css|pulse
    + components/SelectionBar.module.css:31  keyframes|components/SelectionBar.module.css|drop
    + components/SelectionBar.module.css:25  keyframes|components/SelectionBar.module.css|rise
    + sentinel/home.module.css:647  keyframes|sentinel/home.module.css|pulse
    + call/pointer.module.css:44  long-duration|call/pointer.module.css|transition=320ms
    + call/pointer.module.css:61  long-duration|call/pointer.module.css|transition=420ms
    + sentinel/home.module.css:640  long-duration|sentinel/home.module.css|animation=2s
    + call/PointerMark.tsx:59  overscale|call/PointerMark.tsx|scale(1.16)
```

- 3 条是种子里的 `pulse`（infinite、keyframes、2s 时长）；另外 6 条来自这次真实 upstream 的 8 个提交（PointerMark、SelectionBar、pointer.module.css）——说明这个检查不只对种子有效。
- 覆盖层失效规则报告：`⚠ [class*='_needsRow_']  (fork/calm/calm-state.css)`，正是种子把 `.needsRow` 改名造成的。真实同步遇到时，按 fork.md 第 ④ 步改覆盖层锚点或等上游稳定。
- GONE 为 0；快照没有被自动改写（`CALM_UPDATE=1` 只在人逐条裁决后手动跑）。

### 2.6 合并提交的说明（脚本自动附加）

```
## 沉稳检查（sync 自动附加）

- 合并时检查（fork 改过、上游也改了）: 11
  …
- 新增的动效（fork-calm NEW）: 9
  …
- 消失的动效（fork-calm GONE）: 0
- 覆盖层失效的规则: 1
  - `[class*='_needsRow_']`（fork/calm/calm-state.css）

处理完再开 PR；快照只在逐条裁决后以 CALM_UPDATE=1 更新（docs/fork.md「同步上游」）。
```

再跑一次 `--after-merge` 打印「提交说明里已有沉稳检查段，没有重复追加。」——幂等。

### 2.7 逐条对照里程碑判定

| 判定 | 结果 |
| --- | --- |
| 上游也改了的 fork 文件全部被脚本标出 | 是：Sidebar、ChatLog、App、AgentSteps、TaskBoard 五个种子所在的 fork 文件，加 8 个真实上游也改了的 fork 文件，全部进入「合并时检查」 |
| 冲突有写好的解法 | 6 个冲突逐条见 2.4，模板固定；rerere 已记住这 6 处 |
| 报告列出新增动效 | 是：`pulse` 三项在 NEW |
| 报告列出失效规则 | 是：`[class*='_needsRow_']` |
| 合并后沉稳体验完好 | fork-calm 3 个测试通过（13 个 TOUCHPOINTS 全在）；唯一失效的规则就是种子故意改名的类 |
| 临时物清理 | `calm-rehearsal-up`、`calm-rehearsal-work`、`sync/upstream-3.2.0-2026-11-11` 已删；`git remote remove calm-rehearsal`；`/tmp/beluga-calm-rehearsal.git` 已删；真实 upstream remote 全程未动 |

### 2.8 留下的东西与注意

- rerere 的演练解法按**冲突内容**寻址，和真实上游的同名文件不会误配；想清掉可 `git rerere clear`（会一并清掉真实同步记住的解，一般不必）。
- 演练没有暴露脚本缺陷，未打补丁；`--remote/--ref`、`--after-merge`、amend 护栏、幂等追加都按设计工作。
- 演练分支和合并提交已删除，§2 里的分支名/提交号只作为记录。

## 3. 真实同步记录

日期 2026-11-12（同步分支名里的日期取 UTC，为 `2026-11-11`）。

```bash
node scripts/sync-upstream.mjs
```

- 上游这次领先 8 个提交，`upstream/main` 为 `0f1358f92`，`packages/mac` 3.2.0。
- 合并前脚本标出 8 个「合并时检查」文件：

  ```
  docs/parity.md
  ⚠ 沉稳界面  packages/mac/src/App.tsx
  packages/mac/src/chat/Composer.tsx
  ⚠ 沉稳界面  packages/mac/src/chat/flight.ts
  ⚠ 沉稳界面  packages/mac/src/chat/steps/AgentSteps.tsx
  ⚠ 沉稳界面  packages/mac/src/layout/EntryRow.tsx
  packages/mac/src/layout/workspace-row.tsx
  packages/mac/src/sentinel/SentinelCards.tsx
  ```

  （`chat/Composer.tsx` 与 `layout/workspace-row.tsx` 不在沉稳登记里，没有 ⚠。）

- 合并时只有 1 个冲突：`packages/mac/src/layout/EntryRow.tsx`（上游新增 `import type { WorkspaceRowActions }`，与 fork 的 `useHeldEntries` 同一段）。**rerere 直接套用了 BLG-177 演练里记住的解法**——两次冲突的内容相同——无需手改，脚本打印 `Staged '…/EntryRow.tsx' using previous resolution`。
- 合并后：fork-calm `NEW` 6 条、`GONE` 0、失效覆盖层规则 0；`tests/fork-calm.test.ts` 3 个测试通过。
- 合并提交 `59832b9a7` 的说明里已自动带「沉稳检查」段（`## 沉稳检查（sync 自动附加）`）。
- 同步分支 `sync/upstream-3.2.0-2026-11-11` 已合回 M4 工作分支 `beluga/blg-176-m4-2`；下面的三项检查都跑在这棵合并后的代码上。

NEW 的 6 条（都是这次真实上游带来的，不是演练种子）：

```
call/PointerMark.tsx:59            element-animate|call/PointerMark.tsx|animate
call/PointerMark.tsx:59            overscale|call/PointerMark.tsx|scale(1.16)
components/SelectionBar.module.css:25  keyframes|components/SelectionBar.module.css|rise
components/SelectionBar.module.css:31  keyframes|components/SelectionBar.module.css|drop
call/pointer.module.css:44         long-duration|call/pointer.module.css|transition=320ms
call/pointer.module.css:61         long-duration|call/pointer.module.css|transition=420ms
```

逐条裁决（fork.md 第 ④ 步）：

| 动效 | 处置 |
| --- | --- |
| `SelectionBar` 的 `rise`/`drop` | 覆盖层已管：M1 的全局 `animation-name: none` 在沉稳模式下停掉 |
| `pointer.module.css` 的 320/420ms 过渡 | 覆盖层已管：M3 的过渡 clamp 收到 160ms |
| `PointerMark` 点击时的 1.16 弹跳（WAAPI，CSS 管不到） | 加一行挂钩：`calmOn()` 进 `paintTag` 的守卫，沉稳模式下不放大；登记 `docs/fork.md`、`tests/fork-calm.test.ts` 的 TOUCHPOINTS 与 `docs/calm/overlay.md` §12.2 |

裁决后 `CALM_UPDATE=1 npx vitest run tests/fork-calm.test.ts` 把快照更新到 446 条；再跑一次报告 NEW/GONE 都为 0。

## 4. 全量验证

（BLG-178 填：根目录 vitest、packages/mac e2e、calm-check 场景 × 组合表，与 M3 终值对比。）

## 5. 仍在播放的动画及理由

（BLG-179 填：一种循环白名单 + keep-decor 例外。）

## 6. 上游文件改动清单

（BLG-179 填：`git diff --numstat upstream/main...HEAD` 里非 fork 新建的文件，文件数与行数。）

## 7. 六条规范逐条判定

（BLG-179 填：对照 `docs/calm-ui.md` §1–§7 的判定表与不通过项问题表。）

## 8. 同步操作手册

（BLG-179 填：fork.md「同步上游」五步的展开版。）
