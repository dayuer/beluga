# Parity: this fork's own rows

`docs/parity.md` stays as upstream wrote it; `tests/parity.test.ts` reads this file after it, so a
method, menu or action this fork adds is listed here (docs/fork.md). A row for a method upstream
already has is the whole row as this fork works, in place of upstream's.

## API methods (fork)

| Method | Mac |
|---|---|
| `companion.pair.start` | ✓ the sidebar footer's phone mark › Pair a Phone…: a one-time pairing (QR and code, 10 minutes, one phone); with `{project, ttlMs}` it is a client invite (BLG-14): 1 day by default, 7 at most, and the phone that pairs is that project's client, shown in the device list with its project and revocable like any device |
| `board.start` | ✓ Start on a task (its page, its ⋯ and right-click menu: a new worktree, In Progress, your agent on it with its brief, and you there; the task's own agent, else its plan's, else auto route's pick (fork, `shared/auto-route.ts`), else your default); Start's ▾ and the menus' Start with ▸ (BLG-506): every agent and model, this start only, one not set up greyed with why; ⋯ › Start Worktree Only; a task a worktree already does or carries shows Open Worktree instead. The phone's task › Start, and ⋯ › Start with… (1.35) |
| `plans.create` | ✓ Plans › New Plan (a goal; the agent plans in a conversation of its own in the project's main folder; More options › Architecture, Coding, Audit, Hard fixes: who does each part, starting as the tiers say — the strongest model designs it and takes over what's hard, an everyday one codes, one in between audits; BLG-497); the phone's Ask › a project › Plan (1.5); Your Mac's `start_plan` (quietly) |
| `plans.setCheckAgent` | ✓ a plan's ⋯ › Agent for Its Checks ▸: who runs its milestone checkers and Verify the Plan from now on, say a stronger model than the work's (Same as Its Work: the work's agent); the phone's plan page › ⋯ › Agent for its checks (1.51) |
| `plans.setArchAgent` | ✓ a plan's ⋯ › Agent for Its Architecture ▸: who writes each milestone's technical design before its work starts (No Architect (Start Right Away): no architect step); a designed milestone shows its Design in its details; the phone's plan page › ⋯ › Agent for its architecture, and a milestone's Design (1.53) |
| `plans.setFixAgent` | ✓ a plan's ⋯ › Agent for Hard Fixes ▸: who takes over fix tasks after a failed check, conflicts and a task that stopped twice (Strongest Model (Auto Route): auto route's strong list, else whoever is at it); New Plan › More options › Hard fixes; the phone's plan page › ⋯ › Agent for hard fixes (1.54) |

## Beyond the shared actions (fork)

| What | Where |
|---|---|
| Auto route (fork, `docs/auto-route.md`): a task nobody picked an agent for (none of its own, its plan's or its project's) starts on the first model of its list that runs here: the `hard` label, urgent or high to the hard list (Opus on your API key, then on your subscription), the rest to the build list (GLM, DeepSeek, Haiku on your API key, Haiku on your subscription). Decided when an agent starts on it (a worktree alone keeps your default), never kept on the task; an epic's other repos keep their own project agent; a task of 5 points or more is hard too; a plan that names no checker is checked by the hard list's first (Opus), and a new plan starts on autopilot (`shared/auto-route.ts` `autoChecker`, `autoAutonomy`; Mac `plans/use-default-autonomy.ts`); unset, on once one of its local candidates runs here (`session.setPrefs` `autoRoute`, rules in `shared/auto-route.ts`, `BoardWork.start`) | Mac (Settings › Agent › Auto Route in `dialogs/AutoRouteSettings.tsx`; a task's Start and its menus say "auto · Opus 5.5", `tasks/use-auto-agent.ts`); the phone's task page says "Auto · …" (`TaskPageView.autoAgent`, 1.51), read-only |
