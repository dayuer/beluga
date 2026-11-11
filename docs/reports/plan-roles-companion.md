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
