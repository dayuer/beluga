# ACP agents (fork, BLG-ACP)

Beluga runs any [Agent Client Protocol](https://agentclientprotocol.com) agent on one runtime
(`src/agent/runtime/acp/`), the way T3 Code does: the agents T3 Code supports as its own
(Cursor, Grok Build, Kiro, Muse Code, Pi, fx), the other well-known ones (Gemini CLI, Qwen Code,
Kimi Code, goose, Droid, Cline, Auggie, Kilo), any agent in the
[ACP Registry](https://agentclientprotocol.com/get-started/registry), and a command of yours.
Claude, Codex, OpenCode, Copilot and Antigravity keep their own runtimes.

## Where they come from

- **Built in** (`catalog.ts`): each agent's own CLI in its ACP mode (`cursor-agent acp`,
  `grok agent stdio`, `kiro-cli acp --agent-engine=v3`, `muse acp` with `MUSE_EXPERIMENTAL_ACP=on`,
  `pi-acp`, `fx acp`, `gemini --acp`, `qwen --acp`…). One shows in the agent pickers once its CLI
  is on this computer: on PATH, in its installer's folder, or where its `BELUGA_<NAME>_PATH`
  variable points. Turning one off (Settings) keeps it out until you turn it on again.
- **The ACP Registry** (`registry.ts`): Settings › Claude › ACP agents › ACP Registry lists the
  Registry's agents (`cdn.agentclientprotocol.com/registry/v1/latest/registry.json`, read again
  after a quarter of an hour). Nothing is downloaded or run until you press Install, then Download and
  Install. A binary goes over HTTPS only, up to 600 MB, is checked against the Registry's SHA-256
  when it gives one, and is unpacked into `~/.beluga/acp/tools/<agent>/<version>/` (its command
  must stay inside that folder); older versions there go. An npx or uvx package runs at the
  Registry's exact version (`npx -y <package>@<version>`, `uvx <package>==<version>`). A Registry
  agent that is a built-in one keeps the built-in id (`cursor`); others are `acp-<id>`. Agents
  Beluga runs itself (Claude Agent, Codex, Copilot, Antigravity, OpenCode) don't show.
- **A command of yours**: Add Command… takes a name, a command (a name on PATH or a full path),
  its ACP arguments and variables. It is `acp-<name>`.

The ones you add are kept in `~/.beluga/acp-agents.json` (0600).

## How a run goes

The same as Copilot's and Antigravity's, for any agent (`runner.ts`):

- One process per run, one ACP session per place. `session/load` continues a conversation when
  the agent says it can (`loadSession`); otherwise it starts afresh and says so.
- Beluga's instructions go ahead of the first message (ACP has no system prompt every agent takes).
- Its model, thinking level and plan mode are set through the session: ACP's `configOptions`
  (`session/set_config_option`) or the older `models` / `modes` (`session/set_model`,
  `session/set_mode`). Every list starts with Default (the agent's own model). Claude's aliases
  mean nothing to another agent, so those run on its own.
- Every step it asks about (`session/request_permission`) is read by its ACP kind, its input in
  any case and the files it names (`dialect.ts`), and judged by the same gate as Claude's
  (`gateTool`). Planning, and a conversation that only looks, turn its writes down.
- Beluga's tools reach it over HTTP when it says it takes MCP so (`mcpCapabilities.http`), else
  over stdio, which every ACP agent takes; either way scoped to the run by a token.
- Stop and Send now cancel the turn (`session/cancel`), then the process.

What it can't do is in `ACP_CAPABILITIES` (`spec.ts`): ACP lets an agent run some of its own
tools without asking, so it gets no friends' tasks and no guests; no steering, sub-agent rows,
fork, side questions or its own terminal view. The screens say why where it matters
(`src/shared/acp-fallbacks.ts`), and `docs/parity.fork.md` has the table.

## Your computers

`acp.*` is `drive` on your computers (Settings › Your Computers): your app adds and installs ACP
agents on a computer of yours as it does on this Mac, so each computer can run the agents and
models set up there. Outside agents (MCP) can't install or add one.
