# 自动路由(Auto route)

本分叉新增的功能。任务启动时，如果没有人给它指定 agent,Beluga 会按任务的难度自动挑一个模型。规则写在 `src/shared/auto-route.ts`。

## 谁来做这个任务

依次检查下面几项，用第一个有结果的:

1. 这次启动时选的 agent(Start with ▸)。
2. 任务自己的 agent。
3. 任务所属 Plan 的 agent。
4. 项目的 agent(项目设置里指定的)。
5. 自动路由选出的模型。
6. 你的默认 agent。

自动路由只在有 agent 开始做这个任务时计算(只建 worktree 不算，那样仍用你的默认 agent),结果不写进任务。所以团队看板上的队友不会收到只有你这台 Mac 才有的 endpoint。

跨仓库的 epic:其他仓库的 worktree 也用同一个自动选出的模型，但那个仓库设了自己的项目 agent 时，用它自己的。

注意：标签和优先级是看板上共享的。队友把任务标成 `hard` 或紧急、高，你的 Mac 启动它时就会用疑难档(比如你 API key 上的 Opus)。

## 规则

| 档位 | 条件 | 默认候选，依次尝试 |
|---|---|---|
| 疑难 | 带 `hard` 标签，或优先级为紧急、高 | `local:anthropic/claude-opus-5-5`(API key)→ `claude:opus`(订阅) |
| 其他 | 其余所有任务 | `local:bigmodel/glm-5.3[1m]` → `local:deepseek/deepseek-flash[1m]` → `local:anthropic/claude-haiku-5-5` → `claude:haiku` |

- 每档取第一个在本机可用的候选。可用的标准和 agent 选择器一致：运行时已配置;local endpoint 列出了这个模型，并且正在应答。选择器里灰掉的候选会被跳过。
- 某一档的候选全部不可用时，交给你的默认 agent,和以前一样。

## 让任务能带上 `hard` 标签

默认标签里没有 `hard`。在任务看板的项目标签里加一个名为 `hard` 的自定义标签。之后 drafter 写任务时如果判断它难，会自己打上这个标签，你也可以手动加。

## 设置

Settings › Agent › 自动路由:

- 开关：没有手动设置过时，只要列表里有一个 `local:` 候选在本机可用(比如 GLM、DeepSeek 或 API key 上的 Anthropic 模型)就默认开启。只用 Claude 订阅或只开着 Ollama 的 Mac 保持原来的行为，需要手动打开。
- 紧急和高优先级是否也算疑难。
- 两档的候选列表：可以换模型、调整顺序、添加、删除、恢复默认。

设置保存在 `settings.json` 的 `autoRoute` 字段，会同步到你的其他电脑。某台电脑上没有的候选会自动跳过。

疑难标签的名字默认是 `hard`,想换成别的，可以在 `settings.json` 的 `autoRoute.hardLabel` 里改，设置面板里没有这一项。

## 在哪里能看到

- Mac:任务页的 Start、任务右键菜单的提示里显示"自动 · Opus 5.5"。
- 手机：任务页显示"Auto · …"(协议 1.51,`TaskPageView.autoAgent`)。

## 第一版不做的

- 运行中途出错或余额不足时，切换到下一个候选。
- 同一个错误出现两次时，自动升级到 Opus。

注意:local 运行时会把子代理的模型也设成同一个模型(`src/agent/runtime/local.ts` 的 `endpointEnv`),所以模型分工只能做在任务层面。
