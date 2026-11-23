# Parity: this fork's own rows

`docs/parity.md` stays as upstream wrote it; `tests/parity.test.ts` reads this file after it, so a
method, menu or action this fork adds is listed here (docs/fork.md). A row for a method upstream
already has is the whole row as this fork works, in place of upstream's.

## API methods (fork)

| Method | Mac |
|---|---|
| `companion.pair.start` | ✓ the sidebar footer's phone mark › Pair a Phone…: a one-time pairing (QR and code, 10 minutes, one phone); with `{project, ttlMs}` it is a client invite (BLG-14): 1 day by default, 7 at most, and the phone that pairs is that project's client, shown in the device list with its project and revocable like any device |
| `board.start` | ✓ Start on a task (its page, its ⋯ and right-click menu: a new worktree, In Progress, your agent on it with its brief, and you there; the task's own agent, else its plan's, else your default); Start's ▾ and the menus' Start with ▸ (BLG-506): every agent and model, this start only, one not set up greyed with why; ⋯ › Start Worktree Only; a task a worktree already does or carries shows Open Worktree instead. The phone's task › Start, and ⋯ › Start with… (1.35) |
| `acp.agents` | ✓ Settings › Claude › ACP agents: this computer's ACP agents (built-in ones whose CLI is here, ones from the ACP Registry, commands of yours), each with where it came from and its command line (fork, BLG-ACP) |
| `acp.search` | ✓ Settings › Claude › ACP agents › ACP Registry: Browse, or type words and Search (fork, BLG-ACP) |
| `acp.install` | ✓ a Registry result's Install…, then Download and Install (a binary, SHA-256 checked when the Registry gives one) or Install (an npx or uvx package at its exact version) (fork, BLG-ACP) |
| `acp.addLocal` | ✓ Settings › Claude › ACP agents › Add Command…: a name, a command, its ACP arguments and variables (fork, BLG-ACP) |
| `acp.remove` | ✓ an agent's Uninstall (a Registry one, with what Beluga downloaded), Remove (a command of yours) or Turn Off (a built-in one) (fork, BLG-ACP) |
| `acp.restore` | ✓ a built-in agent's Turn On (fork, BLG-ACP) |

## Beyond the shared actions (fork)

| What | Where |
|---|---|
| Resizing the sidebar (`fork/sidebar/resize.tsx`): drag its right edge (col-resize cursor, lit only while hovered), double-click it for the default width, or → / ← with it focused; 200–360 points, kept across launches as the `sidebarWidth` preference (the same as Settings' slider) | Mac only |
| Auto accept (fork, `src/fork/federation/settings.ts`): a Ready task a teammate gives this computer starts by itself with Claude: Off, Tasks given to me, or Tasks given to me and the pool (a Ready task with the Pool label, default `pool`, and nobody on it is claimed by a free computer), Only from (people you fully trust, or trust), Running at once 1–6 (default 2); this computer's own setting, never synced (`session.setPrefs` `federation`) | Mac only (Settings › Agent › Auto Accept, `fork/federation/FederationSettings.tsx`); the phone doesn't offer it |
| A plan's task card names its model (fork, `fork/plans/TaskAgentChip.tsx`, data `src/fork/plans/task-agent.ts`): at work, its worktree's agent and model; not yet (the outline), the task's own agent, else the plan's builder, else the project's agent; nothing for a task that's yours to do or on your default agent. The phone doesn't show it. | Plans › a plan › the canvas and the outline |

## Agent runs on ACP agents (fork)

Every runtime Beluga doesn't run with code of its own is an ACP agent (BLG-ACP): Cursor (`cursor-agent acp`), Grok Build (`grok agent stdio`), Kiro (`kiro-cli acp`), Muse Code, Pi, fx, Gemini CLI, Qwen Code, Kimi Code, goose, Droid, Cline, Auggie, Kilo, any agent from the ACP Registry, or a command of yours. They all run on one runtime (`src/agent/runtime/acp/`) with `ACP_CAPABILITIES`, and do what this table says, in the same words as upstream's "Agent runs, per runtime" table; `src/shared/acp-fallbacks.ts` has their fallbacks and missing features. `tests/fork-acp-parity.test.ts` checks the two agree, as `tests/parity.test.ts` does for upstream's runtimes; `tests/fork-acp-runtime.test.ts` runs the conformance suite on it over a scripted ACP agent, and starts a real process speaking ACP.

| What | Ways in | ACP agents |
|---|---|---|
| Start a run in a worktree or chat, answers streamed | `session.submit`, `workspaces.startWorktree`, `workspaces.startChat` | pass (its ACP command, `cursor-agent acp`, `grok agent stdio`, `kiro-cli acp`, a Registry agent's or yours; a session per place) |
| Pick the agent and model, hand a live conversation off | `/model`, `workbench.setAgent`, `workbench.setModel`, `/handoff` | pass (the models and thinking levels its session offers, set as the session's options or with `session/set_model`; one it doesn't offer runs on its own and says so; a handoff starts a new session with the conversation carried) |
| Continue a conversation later | `canResume` | pass (`session/load` when it says it can; otherwise, or one that can't be opened, it starts afresh and says so) |
| Queue and steer while it works | `host.promote`, `canSteer` | pass (`missing:steer`: the composer always queues, one prompt at a time; Steer Now on an existing message stops the turn to read it) |
| Stop, Send now | `host.stopRun`, `host.steerNow`, `/stop`, `canInterrupt` | pass (`session/cancel`, then the process) |
| Approve or deny a command or an edit | `host.answerApproval`, `canGateEveryTool` | pass (every step it asks about is judged by the same gate as Claude's, read by its ACP kind and the files it names; what it runs without asking isn't) |
| .env files and secrets stay out | `env.claudeDotenv`, `hasSandbox` | pass (steps it asks about are judged by policy.ts; what it runs without asking isn't, which is why friends' tasks and guests stay off it) |
| A friend's task on your Mac | `gateway.decide` | fallback (`fallback:friends`): handed to Claude (or Codex) when one runs here, the friend's card saying why; it can run some steps without asking |
| A guest in your room prompting your agent | `invites.create` | fallback (`fallback:guests`): turned away with the reason; the Invite People sheet says it beside Prompt and Edit |
| A main folder stays read-only | `continue_in_worktree` | pass (policy.ts on every write it asks about, Continue in New Worktree) |
| Plan first, then approve | `/plan`, `session.setPlanMode`, `plans.here`, `hasPlanMode` | pass (its own plan mode when it has one; either way its writes are turned down until you approve, then the same approval card) |
| Images in a message | `attachments.add`, `promptImages` | pass (when it says it takes them: `promptCapabilities.image`) |
| Beluga's tools (room, board, plans, views, Mac, phone, sentinels) | `toolMounts` | pass (http on 127.0.0.1 when it says it takes MCP over HTTP, else stdio; scoped by a token either way) |
| Steps on the agent card | `agent.steps`, `agent.step` | pass (its read, edit, execute, search, fetch and MCP calls mapped to the same steps by their ACP kind) |
| Usage and plan limits | `/usage`, `hasUsage` | pass (tokens per turn and the context meter, when it sends them; no plan windows: ACP doesn't say what's left of a plan) |
| Compact the conversation | `/compact`, `session.compact`, `workspaces.compact`, `hasCompaction` | fallback (`fallback:compact`): Compact greyed in the toolbar with the reason; a /compact of its own runs as typed |
| Fork a worktree | `/fork`, `workspaces.fork`, `canFork` | fallback (`fallback:fork`): the toolbar's Fork says it in its hint, and the fork's first run says it as it starts |
| Edit a sent message (Rewind Here, New Fork) | `workspaces.editPrompt` | fallback (`fallback:rewind`): the files go back; the line under the edit says the conversation starts afresh |
| Skills and custom commands | `claudeCode.skills`, `skills` | pass (its own commands run as typed; Claude Code's custom commands are expanded for it, Claude Code's own built-ins go in as text with a note) |
| MCP servers of your own | `claudeCode.mcpServers`, `claudeCode.mcpSignIn`, `claudeCode.mcpSetEnabled` | n/a: the ones in its own config run in its runs, as in that agent; Settings lists Claude Code's and Codex's |
| Questions the agent asks you mid-run | `questions.answer`, `canAskUser` | n/a: it asks in its answer, and you reply in the box |
| Sub-agents and background agents | `claudeCode.findAgent`, `hasSubagents`, `hasBackgroundAgents` | n/a: no sub-agent rows (`hasSubagents`, `hasBackgroundAgents`); a run ends when it answers |
| Claude Code sessions outside Beluga | `claudeCode.steps` | n/a: Claude Code's own transcripts |
| The process watched and killed for sure | `hasProcess` | pass |
| Side calls (naming a worktree, drafting a task, chat answers) | `complete` | pass (`acpComplete`: one prompt in a session of its own) |
| A side question (/btw) | `/btw`, `session.btw` | n/a (`missing:btw`): an ACP agent can't branch its session here (`canFork`), so /btw isn't offered in its conversations |
| The agent's own terminal | `agentTerm.open` | n/a (`missing:terminal`): no Terminal view; its conversations stay in the chat |
