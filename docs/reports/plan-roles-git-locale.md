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

## 回归测试（BLG-116 实施）

- `tests/git-locale.test.ts`：在 `LANG=zh_CN.UTF-8`、`LC_ALL=zh_CN.UTF-8` 下（并清掉 `LANGUAGE`），`updateDefault` 遇到挡路的改动仍返回 `dirty`；
  `dropBranch` 仍报 “not fully merged”；含中文文件名的 `status --porcelain` 与不设环境时逐字节一致。

## 改到的上游文件（供 ship-pr 补进 docs/fork.md）

- `src/workspaces/git.ts`（一行：`GIT_ENV` 加两个变量）
- `src/workspaces/pr.ts`（一行：`QUIET_ENV` 加两个变量）
