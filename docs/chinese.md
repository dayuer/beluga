# 中文对照（`topic/chinese`）

上游自己就带简体中文：`packages/mac/src/i18n/zh-CN.json`，界面上每一句英文都有。这个 fork 的中文放在它旁边的 `zh-CN.fork.json`，加载时盖在上游的表上面（同一句英文，fork 的说法优先）。这样同步上游时，上游的表原样进来，从不冲突。

`topic/chinese` 是分支链的第一个（`upstream/main` → `topic/chinese` → `fork/base` → …，见 `docs/fork.md`「分支」）：上游每次同步先进到这里，在这里对照上游最新的中文，处理完再往下合。

## 这里放什么

- **接入点**：网页（`packages/mac/src/i18n/index.ts`）、菜单栏（`packages/mac/src-tauri/src/i18n.rs`）、`scripts/i18n-extract.mjs` 和 `tests/i18n.test.ts` 同时读 `zh-CN.fork.json`，fork 的词条优先。
- **对上游文案的改译**：上游已有的英文，fork 想换个说法的，写在 `zh-CN.fork.json` 的最前面。现在有这几条：

  | 英文 | 上游 | fork |
  |---|---|---|
  | Work | 工作 | 计划 |
  | Agent for Its Work | 执行工作的智能体 | 编码智能体 |
  | Runs on {0} now | 现在运行于 {0} | 现在按{0}运行 |
  | “{0}” runs on {1} now. Pick how it runs from here on. | “{0}”现在运行于 {1}。选择从现在起它如何运行。 | “{0}”现在按{1}运行。选择从现在起怎么运行。 |
  | {0} waits for you | {0} 在等你处理 | {0} 在等你 |

- fork 自己功能的文案（计划分工、Studio、沉稳界面……）不在这里：它们跟着各自的分支，写在同一个文件里这几条之后。

## 同步上游时

1. 在 `topic/chinese` 上把 `upstream/main` 合进来之前，先看上游的中文变了什么：

   ```bash
   node scripts/zh-check.mjs HEAD upstream/main
   ```

   它列出上游新增、改了说法、删掉的中文，以及 fork 的改译里要处理的三种：上游改了说法的（再看一遍 fork 的说法还是不是更好）、上游删掉了英文的（删掉这条改译）、和上游现在一模一样的（删掉，多余）。有要处理的，退出码是 1。

2. 合并，按上面的清单改 `zh-CN.fork.json`，跑 `npx vitest run tests/i18n.test.ts tests/zh-check.test.ts`。
3. 合进 `fork/base`，再顺着链往下合。

只改了说法、不跟上游同步时，也在这里改，再往下合。
