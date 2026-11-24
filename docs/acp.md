# ACP agents

Beluga runs an ACP agent (an agent with an [Agent Client Protocol](https://agentclientprotocol.com) server) through one core, `src/agent/runtime/acp/`. Antigravity runs on it today.

## The core

- `spec.ts`: an agent's spec. Its id and name, the command that starts its ACP server, where to look for it, its flag for an extra folder, and its words for "not installed" and "not signed in".
- `connection.ts`: finds the command (its variable, then PATH, then its own folders), starts it, and shakes hands. On macOS and Linux the agent gets a process group of its own, so ending it ends what it started too (`group.ts`: SIGTERM, then SIGKILL for what's left). Windows ends the one process.
- `wire.ts`: between the agent's stdio and the JSON-RPC. It frames lines by bytes itself (a character split between two reads stays whole, the last line comes through without a newline, nothing over 16 MB), passes stray log lines on, and ends a run whose agent prints a sign-in link instead of answering, said as "not signed in" without the link.
- `watch.ts`: reads every frame each way and never changes one. A turn quiet for 30 s says so once in the chat. A turn ends only when it has said nothing for 15 minutes with no step running and nobody asked about one; a step that runs long or waits for you is never ended for being quiet. A request that isn't a turn ends when the agent has said nothing at all for 90 s (an agent's spec can give it longer, `limits`). Time the computer slept isn't counted. A run that ends says why (stuck, not signed in, how it exited), and nothing is sent again.
- `runner.ts`: a run. One process per run, one conversation per place, continued with `session/load`. The model, thinking level and mode are set as the session's options. Every step the agent asks about is judged by the same gate as Claude's. Beluga's tools are served over HTTP, gated per call. It covers plan mode and plan approval, Stop and Steer Now (`session/cancel`), and messages that wait for a turn of their own. A loaded conversation's history can still be coming in after `session/load` answered: until the first turn goes, what it says of the conversation is history (its steps stay history when spoken of later), and the first turn waits until the line has been quiet a moment (never more than 2 s).
- `complete.ts`: a side call, in a conversation of its own.
- `status.ts`: installed, signed in, and the models a session offers. Kept a minute per agent.
- `parts.ts`: what every agent shares: models, modes, failures, a declined step's note.

## An agent's extension

What an agent does past the protocol is its extension (`extension.ts`). Two members are required: its instructions (the `_meta` of `session/new`) and its tools (how its tool calls read as Beluga's). Everything else is optional:

| Member | What it is | Antigravity's |
|---|---|---|
| `model`, `effort` | A model it knows; Beluga's effort as one of its options | Gemini's thinking levels |
| `ownNote` | Files of its own written without being judged | Its notes folder (`brain/`) |
| `questions` | Its own question tool, asked as Beluga's card | `ask_question` |
| `compact` | `/compact` as its own command | Yes |
| `declinedNote`, `failure` | Its words after a declined step; a failure in its words | Its quota's words |
| `quota` | Your plan's quota, for the usage tab | From its language server |
| `tidy`, `dropSession`, `afterLook` | What it leaves behind | Its conversations and logs |

## Adding an agent

1. A spec, and an extension with its instructions and its tool dialect.
2. A runtime in `src/agent/runtime/registry.ts`, with its capabilities.
3. Tests against a scripted agent in its own shapes, and a live script against the real one.
