# 代码交付与 git 托管：GitHub、GitLab、CNB（设计稿）

状态：**设计稿，未实施，未审计**。两件事：节点开发时把代码推到哪、合并请求走哪家（**托管适配**）；一轮做完后
客户怎么拿到代码（**代码交付**）。国内默认 CNB（cnb.cool，腾讯云原生构建），同时支持 GitHub 与 GitLab。

先读：[`studio-loop.md`](studio-loop.md) §5（交付 Gate）、[`studio-standalone.md`](studio-standalone.md) §2.2
（桌面的本机 git）、§5（签名）。

> **2026-11-18 改：Beluga 无人值守，客户自己做决定。** 合并由节点在检查通过后自动做；代码交付方式与推到哪里由
> **客户**在 Studio 的设置里选，设备签名；推到客户仓库用的令牌由客户在 Studio 里填，封给节点（`studio-env.md` §2）。
> 下文已按此改过。

## 0. 结论摘要

- **最大的一块工作在 Beluga 节点这一侧，不在 Studio 应用里。** Beluga 现在开合并请求、查检查、合并，全靠 GitHub
  的命令行 `gh`，没有托管平台这一层抽象。先抽出这一层，三家各一个适配器。
- **令牌只在节点上。** 托管平台的令牌存在节点（Settings › Environment / 钥匙串），中台永远拿不到；Studio 应用也
  不经手，除了客户自己在桌面上克隆代码时用的那一个（存客户本机钥匙串）。
- **代码交付是可选的，按项目开。** 默认只交付预览；开了之后，每次客户通过验收，节点打一个交付标签，客户在
  Studio 里看到仓库地址与版本，桌面上可以一键克隆。
- **CNB 有三处与 GitHub 不同，决定了适配器的写法**：只有 HTTPS 没有 SSH；没查到 webhook，状态要轮询；它自己的
  流水线临时令牌对「不可信事件」只读。

## 1. 现状：Beluga 绑在 `gh` 上

用到 `gh` 的地方（本仓库 `src/`）：

| 文件 | 用来做什么 | 用到的命令 |
|---|---|---|
| `src/workspaces/pr.ts` | 推分支、开合并请求、读状态与检查、合并 | `pr create` / `pr view` / `pr list` / `pr merge`、`config get` |
| `src/workspaces/pr-review.ts` | 读评审与评论 | `api`、`api graphql` |
| `src/workspaces/github.ts`、`github-repos.ts` | 仓库信息、列仓库 | `api` |
| `src/core/issues/gh.ts` | 读 issue、发评论 | `api`、`api graphql` |
| `src/core/sentinel/triggers/`（github） | 哨兵的 GitHub 事件 | `api` |
| `src/core/main-sync.ts`、`board/launch.ts`、`stats/counter.ts`、`sentinel/launch.ts` | 把上面的能力接进各处 | 间接 |
| CI 操作 | 重跑、取消工作流 | `run rerun` / `run cancel` |

git 本身（fetch、push、分支）已经不挑平台，`sync.ts` 与 `pr.ts` 里对 GitLab、Bitbucket 的 https 登录失败也有提示。
缺的是**合并请求及其周边**。

## 2. 托管适配层（节点侧）

### 2.1 接口

`src/workspaces/forge/`，一个接口三个实现；按仓库 `origin` 的主机名选（可在项目设置里指定，给自建 GitLab 用）：

```ts
interface Forge {
  kind: 'github' | 'gitlab' | 'cnb';
  state(dir): Promise<'ok' | 'logged_out' | 'missing'>;          // 现在的 ghState
  repo(dir): Promise<{ slug: string; webUrl: string; defaultBranch: string }>;
  pushBranch(dir, head): Promise<'pushed' | 'replaced'>;          // 现在的 pushForPr
  openPull(dir, { head, base, title, body, draft }): Promise<Pull>;
  findPull(dir, head): Promise<Pull | undefined>;                 // 状态、是否草稿、可否合并、head 的提交
  listPulls(dir, limit): Promise<Map<string, Pull>>;
  checks(dir, pull): Promise<Check[]>;                            // 归一成 pending / passed / failed
  merge(dir, pull, { method, matchHead }): Promise<void>;         // 必须能钉住提交
  comment(dir, pull, text): Promise<void>;
  // 可选能力，没有就在界面上隐藏对应功能
  reviews?(dir, pull): Promise<Review[]>;
  issues?: IssueApi;
  rerunChecks?(dir, pull): Promise<void>;
  release?(dir, { tag, title, notes }): Promise<{ webUrl: string }>;
}
```

- `Pull` / `Check` 用 Beluga 现有的 `PullRequest` / `PrCheck` 形状，上层（计划、看板、哨兵的 `pr` 与 `merge` 步骤）
  不改。
- **`merge` 的 `matchHead` 是硬要求**：哨兵与 Studio 的合并都钉在「检查通过的那个提交」上（`sentinel.md` §5）。
  哪家的接口不支持钉提交，适配器就在合并前自己再读一次 head 比对，不一致就拒绝。
- 第一步只是**把 GitHub 的现有实现搬到接口后面，行为不变**，测试原样通过；之后再加另外两家。

### 2.2 三家对照

CNB 一栏来自 2026-11-18 读的官方文档（`docs.cnb.cool`、`api.cnb.cool/swagger.json`）；标「未核实」的是没在文档里
找到或只读到摘要的。GitLab 一栏来自通用知识，**这次没有对着文档核对**，实施前要核。

| | GitHub | GitLab | CNB |
|---|---|---|---|
| 实现方式 | `gh`（现状） | REST v4；可选命令行 `glab` | OpenAPI `https://api.cnb.cool`，`Authorization: Bearer <令牌>` |
| git 传输 | HTTPS / SSH | HTTPS / SSH | **只有 HTTPS**；用户名固定 `cnb`，密码是令牌 |
| 仓库路径 | `owner/repo` | `group/sub/…/project` | `group/sub/…/repo`（地址不需要 `.git`） |
| 合并请求 | Pull Request | Merge Request | 合并请求，接口路径是 `pulls` |
| 开 | `gh pr create` | `POST /projects/:id/merge_requests` | `POST /{repo}/-/pulls` |
| 查 | `gh pr view` | `GET …/merge_requests/:iid` | `GET /{repo}/-/pulls/{number}` |
| 检查状态 | 状态汇总 | 流水线与提交状态 | `GET /{repo}/-/pulls/{number}/commit-statuses` |
| 合并 | `gh pr merge --match-head-commit` | `PUT …/merge`（带 `sha`） | `PUT /{repo}/-/pulls/{number}/merge`；能否钉提交**未核实**，按 2.1 自己比对 |
| 评论 | `gh api` | `POST …/notes` | `POST /{repo}/-/pulls/{number}/comments` |
| 令牌范围 | 细粒度令牌，可限到单仓库 | 项目 / 群组访问令牌 | `repo-code`、`repo-pr`、`repo-notes`、`repo-commit-status`、`repo-release` 等，各分只读 / 读写；能否限到单仓库**文档未写明** |
| 非个人令牌 | 有（App、部署密钥） | 有（项目令牌、部署令牌） | 「部署令牌」，**只读** |
| 事件推送 | webhook | webhook | **没查到 webhook**；有仓库动态的拉取接口（按小时 / 天，天级滞后一天） |
| CI | Actions | GitLab CI | `.cnb.yml` 流水线 |
| 自建 | Enterprise | 自建很常见（国内还有极狐） | 无 |
| 命令行 | `gh` | `glab` | `cnb`（`@cnbcool/cnb-cli`）；是否有合并请求子命令**未核实** |

### 2.3 CNB 适配器的三个要点

1. **只走 HTTPS。** 远端若是别的形式要先换成 `https://cnb.cool/<路径>`。推送用 git 的凭证助手喂
   `cnb` + 令牌，令牌不写进远端地址、不进日志。
2. **状态靠轮询。** 没有 webhook，所以检查与合并请求状态用 Beluga 现有的轮询节奏（`PR_FAST_MS`）读
   `commit-statuses`。想更快，可以在项目的 `.cnb.yml` 里加一步：流水线结束时调哨兵的 webhook 地址。但要注意 CNB 的
   规则——`pull_request` 这类「不可信事件」里流水线的临时令牌只读、且只能访问当前仓库，所以这一步**只当提醒用**，
   节点收到后仍自己去读状态，不信请求里带的结论。
3. **令牌要的范围**：`repo-code:rw`、`repo-pr:rw`、`repo-notes:rw`、`repo-commit-status:r`；开了代码交付再加
   `repo-release:rw`。用个人访问令牌即可。CNB 的 OAuth 应用要它的运营管理员审核上架、换来的令牌 8 小时过期，
   对「一个人的几台节点」不值得。

### 2.4 没有的能力怎么办

Beluga 有些功能只对 GitHub 有意义（Issues 页、团队按仓库指纹匹配、哨兵的 GitHub 触发器）。适配层不强求三家齐全：
接口里是可选项，哪家没有，界面上那一处就不显示，并在项目设置里说一句。Studio 这条闭环**只依赖必选的那几项**
（推分支、开 / 查 / 合并合并请求、检查状态），所以三家都能跑通。

## 3. 代码交付

### 3.1 三种方式，按项目选

| 方式 | 客户拿到什么 | 适合 |
|---|---|---|
| **只给预览**（默认） | 预览链接、安装包；看不到任何仓库信息 | 客户只要成品 |
| **给仓库** | 开发仓库的地址 + 每次交付的标签；客户在托管平台上有只读权限（搭环境的人在平台上加一次，Studio 不替人加权限） | 客户要看代码、自己留档 |
| **推到客户的仓库** | 每次交付后，节点把交付的那个提交推到客户指定的远端（可以是另一家平台） | 外包交付，代码归客户 |

### 3.2 一次交付发生什么

客户点「通过」（`delivery.accept`）之后，在节点上：

1. 确认交付的提交已经在默认分支上。合并由节点在交付之前自动做（`studio-loop.md` §5.1）：检查通过、没有冲突就
   合并；有冲突交给 pilot 解决后重新检查。所以客户点「通过」时代码已经在默认分支上。
2. 打标签 `delivery/<项目内序号>`，推到远端；适配器支持的话建一个发布（release），说明取自这一轮确认过的
   `summary` 与验收说明——**不是**提交记录原文。
3. 方式是「推到客户的仓库」时：把该标签与默认分支推到交付远端。只推这一个分支与交付标签，不推其他分支，不强推。
4. 向视图写入交付记录。

```ts
// 计划视图里的可选字段，只有开了代码交付的项目才有
delivery?: {
  mode: 'repo' | 'mirror',
  host: 'github' | 'gitlab' | 'cnb',
  webUrl: string,            // 仓库页面地址
  cloneUrl: string,          // https 克隆地址，不含任何凭证
  tag: string,               // delivery/7
  commit: string,            // 短哈希
  releaseUrl?: string,
  at: number,
}
```

- 这是白名单视图里**唯一**允许带仓库地址与提交哈希的地方；净化器在别处照旧拿掉它们。
- 地址不含令牌。客户克隆要用**他自己**在那家平台上的身份。
- 「推到客户的仓库」需要一个对客户仓库**能写**的令牌，由客户在自己平台上创建，在 Studio 的设置里填入；值在客户设备上封给节点，中台只过密文（`studio-env.md` §2）。CNB 的部署
  令牌只读，不能用于这件事，要用访问令牌（`repo-code:rw`）。令牌按项目存，随项目删除而删除。

### 3.3 客户在 Studio 里怎么拿

对话里的**代码卡**（`studio-ui.md` §2.2）与结果区「产物」里的一张卡：仓库名、交付标签、时间。

| 平台 | 动作 |
|---|---|
| 桌面 | **克隆到本机**：选文件夹，用系统的 git 克隆并检出交付标签；需要登录时弹该平台的登录或让客户贴令牌，存进系统钥匙串。已克隆过的显示 **更新到这一版** 与 **在编辑器里打开** |
| 手机 / Web | 复制地址、打开仓库页面、打开发布页 |

桌面上的克隆完全在客户本机进行，不经中台，也不经节点。

### 3.4 设置在哪

客户在 Studio 的 **设置 › 代码交付** 里选方式、填交付远端与令牌，签名后发给节点。选了「给仓库」或「推到客户的
仓库」的客户，在结果区「变更」页签多看到一栏「代码」：这一轮的合并请求、状态、检查、是否已合并，点开跳到托管
平台。没有 diff 与文件路径。

### 3.5 用登录代替手填令牌（新增项目时导入）

客户新增项目时可以**从仓库导入**（`studio-ui.md` §2.5、`studio-standalone.md` §4.7）。为了让不懂技术的客户不用去创建令牌，
导入用**登录**拿令牌，列仓库，选一个：

| | GitHub | cnb.cool |
|---|---|---|
| 登录方式 | OAuth 应用的**设备授权流程**（手机上打开授权页，输入码；不需要回调地址）。范围：读客户选的仓库的代码 | OAuth 应用（要它的运营管理员审核上架，**审核没下来之前先让客户贴访问令牌**） |
| 令牌寿命 | OAuth 应用的用户令牌不过期（GitHub App 的 8 小时） | **8 小时** |
| 列仓库 | `GET /user/repos`，应用直接调，令牌只在手机上 | `api.cnb.cool` 的仓库列表接口，同样只在手机上 |
| 给节点 | 应用用节点的公钥**封好**，随 `project.create` 一起发；中台只转发密文 | 同左 |

要点：
- **令牌只在手机和那台节点上。** 中台、其他节点都看不到；这和 §4「托管平台的令牌：节点上」一致。
- **导入要设备签名**：它把一个能读客户代码的令牌交了出去。
- **登录令牌只用来导入。** CNB 的 8 小时令牌不能撑住之后的推送；要「推到我的仓库」，仍然用 §3.4 的访问令牌流程。GitHub 的不过期令牌可以直接
  沿用（客户在设置里选「推到我的仓库」时不用再填）。
- OAuth 应用的客户端编号是 Studio 自己的，写进应用配置；密钥不进应用（设备流程不需要密钥）。

## 4. 安全边界

- 托管平台的令牌：节点上，0600 或钥匙串，按项目隔离；不进 store、不进视图、不进日志（`redactSecrets` 已认得常见
  令牌前缀，CNB 的令牌格式要加进去）。
- 推送只做「这个分支 + 这个标签，不强推」；推到客户仓库失败（被保护、无权限）时交付记录标「代码没推上」，不影响
  验收已通过这件事；客户在代码卡上看到「代码没推上」和原因，改好令牌或权限后可以点「重新推送」。
- 对话里的文字永远不决定推到哪：交付远端只在设置里填，且要设备签名；agent 读不到也改不了这项设置。
- 交付标签一经推送不改不删；要重发就是下一个序号。

## 5. 建议的里程碑

| # | 内容 | 依赖 |
|---|---|---|
| G1 | `Forge` 接口；把 `gh` 的现有实现搬进 `github` 适配器，行为不变，原测试全过 | — |
| G2 | `cnb` 适配器（HTTPS 凭证、OpenAPI、轮询检查、自比对后合并）+ 一个假的 CNB 服务做测试 | G1 |
| G3 | `gitlab` 适配器（含自建主机配置） | G1 |
| G4 | 自动合并；代码交付：标签与发布、交付远端、`delivery` 视图字段、Studio 设置页（签名） | G1、loop M11 |
| G5 | 桌面的克隆 / 更新 / 在编辑器里打开；代码卡 | G4、standalone S5 |

G1 动的是 Beluga 的核心文件（`src/workspaces/pr.ts` 等），不是 Studio 自己的目录；它会增加与 Beluga 分支链合并时的
冲突面。做法上要么只在本仓库做并接受冲突，要么先把 G1 做到 Beluga 的分支链上再合过来——后者更干净。

## 6. 待你决定

1. **G1 做在哪。** Beluga 的分支链上（推荐，Beluga 自己也因此能用 CNB / GitLab），还是只在 synon-studio 里。
2. **默认的代码交付方式。** 本稿默认「只给预览」。
3. **GitLab 指哪种。** gitlab.com、极狐，还是自建的；决定 G3 要不要做主机配置与自签证书。
4. **CNB 上要不要用它的流水线做检查。** 用的话每个项目要有 `.cnb.yml`；不用的话 CNB 上的合并请求没有检查，
   合并闸门只剩 Beluga 自己的 checker（无人值守下没有人再看一眼，这一项更值得做）。

## 7. 资料

- CNB：[Git 访问](https://docs.cnb.cool/zh/guide/git-access.html) ·
  [访问令牌](https://docs.cnb.cool/zh/guide/access-token.html) ·
  [部署令牌](https://docs.cnb.cool/zh/guide/deploy-key.html) ·
  [OAuth 应用](https://docs.cnb.cool/zh/oauth/developer.html) ·
  [OpenAPI](https://docs.cnb.cool/zh/develops/openapi.html) ·
  [触发规则](https://docs.cnb.cool/zh/build/trigger-rule.html) ·
  [内置变量与 `CNB_TOKEN`](https://docs.cnb.cool/zh/build/build-in-env.html) ·
  [命令行](https://docs.cnb.cool/zh/develops/cnb-cli.html)
- CNB 的接口文件很大，只读到合并请求一段；建仓库、保护分支、webhook 的接口没有核实到。
