# 修复 git 输出语言导致的误判（plan-roles · 里程碑 1）

## 根因

Beluga 有好几处靠 git 的**英文提示文字**判断发生了什么：

- `src/workspaces/sync.ts` 的 `IN_THE_WAY`（“would be overwritten / commit your changes or stash them”）→ 判成 `dirty`；
- `sync.ts` 的 `AUTH` / `OFFLINE` / `no such remote…` → 判成登录、断网、没有远端；
- `tests/plan-branch.test.ts` 等待 `git branch -d` 的 “not fully merged”；
- `src/core/plans/move-git.ts` 的 `said()` 找 `^(error|fatal)` 开头的行；
- `src/workspaces/pr.ts` 的 `non-fast-forward|[rejected]|fetch first` 和 `pushWhy()` 的 `^(fatal|error|remote):`。

而 git 的运行环境（`src/workspaces/git.ts` 的 `GIT_ENV`、`pr.ts` 的 `QUIET_ENV`）没有固定语言。
Homebrew 的 git 2.56 带 gettext：**即使 `LANG`/`LC_*` 全没设，它也会读 macOS 的系统首选语言（`AppleLanguages = zh-Hans-CN`）**，
于是输出“错误：您对下列文件的本地修改将被检出操作覆盖”“致命错误：无法读取远程仓库”。英文正则全部落空，
`updateDefault` 本该返回 `dirty` 却返回 `failed`，全量测试在这台 Mac 上过不了，拿不到 Tested-on。

## 改法：用哪个变量

在两处共用环境里加 `LC_MESSAGES: 'C', LANGUAGE: 'C'`，只固定 git 的**提示语言**：

| 写法 | 中文系统（无 LANG） | `LANG=zh_CN.UTF-8` | `LC_ALL=zh_CN.UTF-8` | 影响其他类别 |
|---|---|---|---|---|
| 不设 | 中文 ✗ | 中文 ✗ | 中文 ✗ | — |
| `LC_MESSAGES=C` | 英文 | 英文 | 中文 ✗（被 LC_ALL 盖住） | 否 |
| `LANGUAGE=C` | 英文 | 英文 | 英文 | 否 |
| `LC_ALL=C` | 英文 | 英文 | 英文 | **是**：连 LC_CTYPE 也改成 C |
| **`LC_MESSAGES=C` + `LANGUAGE=C`（选用）** | 英文 | 英文 | 英文 | 否 |

（本机 git 2.56.0 实测，命令 `git branch -D nope`。）两个都设：`LC_MESSAGES` 管住没有 `LANGUAGE` 支持的实现，`LANGUAGE` 在用户自己设了 `LC_ALL` 时仍然优先。

### 为什么不影响中文文件名与提交信息

- 文件名的转义只由 `core.quotePath` 决定，与 locale 无关；提交信息按 `i18n.commitEncoding` / `logOutputEncoding`（默认 UTF-8）原样输出字节。
- 实测同一仓库（文件 `中文文件.txt`、提交信息 `提交：中文信息`）在“不设 / LC_MESSAGES+LANGUAGE=C / LC_ALL=C”三种下，
  `status --porcelain`（含与不含 `-c core.quotePath=false`）、`log -1 --format=%s`（逐字节 `od -c` 比对）、`diff --stat` 输出完全相同。
- 选用的写法不碰 `LC_CTYPE`，所以 git 调起的 hook、编辑器、`ssh` 等子进程的字符编码（Python/Perl 的 I/O 编码、宽字符对齐）都不变；
  这是不用 `LC_ALL=C` 的原因。副作用只有一条：hook 里程序的**提示**也会是英文。

## 要改的地方（都是上游文件，各改一行）

| 文件 | 改什么 | 为什么 |
|---|---|---|
| `src/workspaces/git.ts:13` `GIT_ENV` | 加 `LC_MESSAGES: 'C', LANGUAGE: 'C'` | `git()`/`tryGit()` 走这里：sync.ts、plan-branch（`branch -d`）、move-git.ts、new-project.ts 等全部覆盖 |
| `src/workspaces/pr.ts:113` `QUIET_ENV` | 同上 | `run()`（push、rev-parse…）和 `gitOut()`（merge-tree）都用它；push 失败的 `AUTH`/`pushWhy` 要英文 |

不用改的直接调用（只看退出码或读路径，不解析提示文字）：

| 调用 | 读什么 |
|---|---|
| `src/workspaces/env.ts:37` `ls-files` | 路径列表 |
| `src/workspaces/merge-preview.ts:49` `merge-tree --name-only --no-messages` | 退出码 + 路径 |
| `src/workspaces/archive-git.ts:51` `check-ignore -v -z` | 路径 |
| `src/agent/sync-main.ts:182` `diff --name-only` | 路径 |
| `src/core/workspace-files.ts:272` `ls-files -z` | 路径（`:236` 的正则解析的是 ripgrep，不是 git） |
| `src/machines/env-send.ts:150` `config --get` | 配置值 |
| `src/cli/project.ts:66` `clone` | 只转发给终端、看退出码；终端里的提示保持用户自己的语言 |

遗留：`src/machines/ready-model.ts:274-280` 解析的是**另一台电脑**经 ssh 跑的 git 输出，环境在对方机器上，不在本次范围（审计 BLG-117 复核）。

## 会展示给用户的 git 报错及中文处理

改成英文后，以前 git 自己翻成中文、原样塞进界面的报错会变成英文。Mac 界面的 i18n 会把模板里填进去的部分再查一次目录
（`packages/mac/src/i18n/match.ts`），所以只需在 `zh-CN.fork.json` 里给这些 git 原话加模板，由 mac-ui 的 zh-sweep 统一写入：

| 出处 | 用户看到 | 处理 |
|---|---|---|
| `manager.ts:789` 切到默认分支被挡 | `Couldn’t switch to {0}: {1} would be overwritten` | 已有中文：`Couldn’t switch to {0}: {1}{2}`、`{0} would be overwritten`（zh-CN.json），无需新增 |
| `sync.ts:271` `updateDefault` 的 `failed.message`（merge --ff-only / fetch . 的原话） | `fatal: Not possible to fast-forward, aborting.` 等 | 加模板 `fatal: Not possible to fast-forward, aborting.` → `致命错误：无法快进，已中止。` |
| `sync.ts:369` `switchToDefault` 的 `failed.message` | git 原话，如 `error: pathspec '{0}' did not match any file(s) known to git` | 加模板 → `错误：路径规格 '{0}' 未匹配任何 git 已知文件` |
| `git.ts:148` `dropBranch`（`branch -d`） | `error: the branch '{0}' is not fully merged` + 两行 hint | 加模板 → `错误：分支 '{0}' 没有完全合并`；hint 两行加 `hint: If you are sure you want to delete it, run 'git branch -D {0}'` → `提示：如果确定要删除，运行 'git branch -D {0}'` |
| `sync.ts:48` fetch 的 `other` | `Couldn’t fetch from {0}: {1}`（{1} 为 git 最后一行） | 外层已有中文时沿用；{1} 常见值 `fatal: Could not read from remote repository.` → `致命错误：无法读取远程仓库。` |
| `pr.ts:502` `pushWhy` | `error: failed to push some refs to '{0}'` 之外的第一行 fatal/error/remote 行 | `fatal: Could not read from remote repository.` 同上；`remote:` 行是服务器的话，保持原样 |
| `move-git.ts:80` `said()` | 第一行 error/fatal | 与上面共用模板 |

原则：Beluga 自己的句子（外层）全部走已有中文；git 的原话只给最常见的几条加模板，其余保持英文原文（它们本来就是技术细节，英文还便于搜索）。

## 回归测试（BLG-116 已实施）

- `tests/git-locale.test.ts`：导入 git.ts 之前把 `LANG`/`LC_ALL`/`LC_MESSAGES` 设成 `zh_CN.UTF-8` 并清掉 `LANGUAGE`，然后：
  - `updateDefault` 遇到挡路的改动仍返回 `dirty`（files `notes.txt`，behind 1）；
  - `deleteMergedBranch`（`git branch -d`）仍报 “not fully merged”；
  - 含中文文件名、中文提交信息的 `status --porcelain`（含 `-z`、`core.quotePath=false`）、`log --format=%s`、`diff --stat`、`diff`，
    经 Beluga 的 `git()` 与用户自己终端（中文环境）跑出来**逐字节相同**。
- 去掉两行修复时前两条失败、第三条仍过（红→绿已验证）；加上修复后
  `npx vitest run tests/main-sync.test.ts tests/plan-branch.test.ts tests/git-locale.test.ts` 在本机（系统语言 zh-Hans-CN）36/36 通过，`npm run typecheck` 通过。

## 审计（BLG-117，独立的 Sonnet agent）

做法：grep `src/` 里所有运行 git 的地方（execFile/execFileSync/spawn/bash 命令串）和所有匹配 git 提示文字的正则，逐个看走哪个 runner。
同时在 /tmp 实测：`stash drop`（“丢弃了 stash@{0}”）、`fatal:`、`Could not read from remote repository` 会本地化；
`--shortstat`、`reflog --format=%gs`、`status -sb` 不会。`LC_ALL=zh_CN` + 本方案仍是英文。

| 位置 | 依赖的 git 文字 | 走哪个 runner | 结论 |
|---|---|---|---|
| `sync.ts:28-48` `classifyFetchError`（AUTH / OFFLINE / no such remote） | fetch 报错 | `git()` | 已覆盖 |
| `sync.ts:244,270,368` `IN_THE_WAY`、`filesInTheWay` | would be overwritten… | `git()` | 已覆盖 |
| `sync.ts:325` `stashDrop` 从 “Dropped …(sha)” 取 sha | stash drop 输出（**会**本地化） | `git()` | 已覆盖（原来中文下“放回改动”会悄悄跳过） |
| `git.ts:433` index.lock 重试 | index.lock 报错 | `git()` | 已覆盖 |
| `git.ts:148` `deleteMergedBranch` | not fully merged | `git()` | 已覆盖 |
| `pr.ts:369,402,458,500-502` push 报错、`classifyGitError` | rejected / non-fast-forward / fatal… | `run()`、`gitOut()`（QUIET_ENV） | 已覆盖 |
| `new-project.ts:116-124` `cloneError` | clone 报错 | `git()` | 已覆盖 |
| `core/plans/move-git.ts:80` `said()` | `^error\|fatal` 行 | `git()` | 已覆盖 |
| `merge-preview.ts:60` `parseShortstat` | shortstat（不本地化） | `git()` | 不需要，也已覆盖 |
| `core/merge-counter.ts:54` reflog `%gs` | 不本地化 | `tryGit()` | 不需要 |
| **`machines/ready.ts:154` → `ready-model.ts:274-282` `cloneTrouble`** | clone 报错 | 自己的 `bash -lc`（`shAt`），不走 GIT_ENV | **漏了 → 已修**：clone 命令前加 `LC_MESSAGES=C LANGUAGE=C`（gh repo clone 内部的 git 也继承） |
| `archive-git.ts:28-38` `run` | 报错只作为 ArchiveError 文字展示，不解析 | 自己的 execFile | 不需要（遗留：那里的 git 报错会照用户语言显示，属合理） |
| `merge-preview.ts:49`、`pr.ts:448` merge-tree；`env.ts`、`workspace-files.ts:272` ls-files；`archive-git.ts:51` check-ignore；`agent/sync-main.ts:182`；`env-send.ts:150`、`cli/chat.ts:249`；`cli/project.ts:66` clone（只转发终端） | 路径 / 退出码 / 值 | 各自直接调用 | 不需要 |

另外核实：没有调用点给 `git()` 传会覆盖 `LC_*`/`LANGUAGE` 的 `env`；`src/` 里没有设 `LC_ALL` 的地方；`pr.ts:118` 把 QUIET_ENV 放在最后，优先级最高。
没有经 ssh 在别的机器上跑 git 解析其输出的地方（`withSshRoutes` 只改本机 git 的参数）。

ready.ts 修复后 `tests/machines-ready.test.ts`（更新了两条命令串断言）与 `tests/machines/ready-real.test.ts` 通过（35 过、1 跳过），typecheck 通过。

遗留：zh-CN.fork.json 的 git 原话模板（上面“会展示给用户的 git 报错”一节）交给 mac-ui 的 zh-sweep。

## 改到的上游文件（供 ship-pr 补进 docs/fork.md）

- `src/workspaces/git.ts`（一行：`GIT_ENV` 加两个变量）
- `src/workspaces/pr.ts`（一行：`QUIET_ENV` 加两个变量）
- `src/machines/ready.ts`（一行：clone 命令前加 `LC_MESSAGES=C LANGUAGE=C`）
- `tests/machines-ready.test.ts`（两条断言跟着改）
