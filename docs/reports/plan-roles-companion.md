# 计划角色：手机端类型检查与显示（里程碑 4）

交接文档 `docs/reports/plan-roles-handoff.md` 里，手机端类型检查当时没跑成（本机缺 expo 依赖）。这一页记下补跑的结果。

## BLG-127 装依赖、跑类型检查

- **依赖**：在 `packages/companion` 里跑 `npm ci --registry=https://registry.npmjs.org`。第一次解包报了几十个 `TAR_ENTRY_ERROR`，装得不全（缺 `react-native-reanimated`、`expo-image` 等），typecheck 报 331 个错。删掉 `node_modules` 重装一次就好了（446 个包，没有报错）。`package.json` 和 lock 都没改。
- **`npm run typecheck`（packages/companion）**：通过，0 个错误。`app/plan/[id].tsx`、`lib/link/calls.ts` 不用改。
- **根目录 `npm run typecheck`**：通过，0 个错误。
- **协议**：`eda56a0d` 只做了加法：`COMPANION_PROTO` 从 1.53 升到 1.54（major 仍是 1），加了 `SINCE.fixAgent = 54` 和可选的 `PlanView.fixAgent`。没有改动或删掉任何已有字段。
- **新旧协议下的 ⋯ 菜单**：计划页里“Agent for hard fixes”这一项是 `hidden: !p?.agents || !store.supports('fixAgent')`。新加的 `tests/companion-supports-fix-agent.test.ts` 用的是真实的手机端 store（只把原生模块换成替身），测了以下几种情况：
  - Mac 是 1.53 或 1.50 时，`supports('fixAgent')` 为 false，菜单项隐藏；
  - 1.54、1.60、2.0 时为 true，菜单项显示；
  - 1.53 时，架构和审计两个角色仍然显示。
  - 也就是说，旧 Mac 上不会出现这一项，也不会发出它不认识的 `plans.setFixAgent`。
  - 这个测试要求 `packages/companion/node_modules` 已经装好。worktree 的 setup 本来就会装。

## BLG-128 审计：手机端改动与手机限制规则

结论：**符合手机端规则**，修了一处文档里的版本号，还有一项遗留留给用户决定。

- **coverage 分类**：`src/fork/coverage.ts` 把 `plans.setCheckAgent`、`setArchAgent`、`setFixAgent` 都归为 `phone`。这是对的。
  - 它们和上游已归为 `phone` 的 `plans.setWorkAgent`、`plans.setAutonomy` 是同一类：从计划自带的 `agents` 列表（`workPicker`）里选一个，只改这一个计划的状态。
  - 它们不是 settings，也没有给手机编辑源码、看 diff 或做 Merge 以外 git 操作的能力。
  - 外部访问归为 `covered`，机器归为 `drive`，和 setArchAgent 一样，也有测试（`tests/plan-fix-agent.test.ts`）。
- **参数校验**：handler 收到的参数先经 zod `AgentRef.nullish()` 校验，和 `setWorkAgent` 一样。手机发来的 agent 不会再拿列表去核对，这一点和上游 setWorkAgent 的做法相同，所以不算新增的风险。
- **协议**：只增不改，仍是 major 1（见上一节）。
  - `PlanView.fixAgent` 是可选字段，只在计划设置了它时才发（`src/companion/views.ts` 里的 `...(plan.fixAgent ? …)`）。旧手机收到不认识的字段会忽略。
  - `SINCE.fixAgent = 54`，和 `COMPANION_PROTO.minor` 一致。
- **新旧协议下的显示**：计划页 ⋯ 菜单里检查、架构、疑难修复三项，各自用 `store.supports('checkAgent' | 'archAgent' | 'fixAgent')` 判断显示或隐藏。在 1.53 的 Mac 上只隐藏疑难修复这一项（有测试，见上一节）。
- **其他规则**：没碰 `worktree-files.ts`、`isSecretPath` 或 `stripCode` 的路径。`docs/parity.fork.md` 三个方法都写了。
- **已修**：`docs/parity.fork.md` 里 `plans.setCheckAgent` 标的是“(1.50)”，实际 `SINCE.checkAgent = 51`，改成了 1.51。
- **遗留**：手机端这几项的文案还是英文（“Agent for hard fixes”“Strongest model”等）。要不要中文、怎么做，等用户在 BLG-129“决定手机端的中文怎么做”里定，这里没有改。
