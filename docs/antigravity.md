# Antigravity

Beluga can run [Antigravity](https://antigravity.google) as your agent, beside Claude, Codex, OpenCode, Copilot and local models. It's one of your [ACP agents](acp.md): you add it, and only then is it in the agent pickers. It runs the Antigravity CLI (`agy`) you have installed, signed in with your own Google account, on the models your Antigravity plan has: Gemini, and the Claude and GPT-OSS models Antigravity offers.

## Set it up

1. Install the Antigravity CLI: `curl -fsSL https://antigravity.google/cli/install.sh | bash` (it puts `agy` in `~/.local/bin`). Version 1.5 or newer: an older `agy` has no ACP server (`agy update`).
2. Sign in once in Terminal: run `agy`, and it opens Google's sign-in in your browser.
3. Open **Settings › Agent › ACP agents** and press **Add** beside Antigravity (Add shows once `agy` is on this Mac; before that, the row has its install command to copy). It shows **Ready** once Beluga finds it signed in. **Sign In** beside it starts `agy` in Terminal for you, and **Check Again** (behind •••) looks again.

Make it yours in **Your agent** at the top of Settings › Agent, or pick it for one conversation in the agent picker above the message box. **Remove** (behind •••) takes it out of the pickers again.

A Mac that ran Antigravity before it became an ACP agent (it was your agent, a project's, or a conversation's) has it added already, once.

`BELUGA_AGY_PATH` points Beluga at another `agy`.

## Your Google account or an API key

Antigravity comes as two agents, one per sign-in, each with its own `agy` folder. You add each one in Settings › Agent › ACP agents. Beluga never guesses which one a run uses, and a variable in your shell (`GEMINI_API_KEY`, `GOOGLE_CLOUD_PROJECT`…) never changes it.

- **Antigravity**: your Google account, the one `agy` in Terminal signs in to. Once you pick it, Beluga runs it as any agent: your messages, a plan's parts, tasks, Sentinels, Continue, other agents' requests. Beluga doesn't stop or warn. Google's own answers on its forum ask that an app not drive a personal account on its own (an outer harness, automated loops); whether to use it that way is yours to weigh. The API-key agent is the one Google's API terms cover for that.
- **Antigravity (API key)**: a Gemini API key, billed per token, in a folder of its own (`~/.beluga/agy-api`: your skills, plugins and settings linked in, its own conversations, its settings on the key). The Gemini API's terms let an app drive it. Its key is `GEMINI_API_KEY` in Settings › Environment (your own variables; from [aistudio.google.com/apikey](https://aistudio.google.com/apikey)). Without one it says so, and it never falls back to your Google account. Set a budget on the key in Google's console: a plan's work uses a lot.

Neither reads Antigravity's quota: only its internal APIs have it, and Google said calling them can get an account flagged. The Usage tab shows the tokens of each turn.

To list your models and see that agy is signed in, Beluga opens a session with it now and then, as `agy` itself does when it starts: no message is sent, so nothing reaches the model.

### Its tool budget

Antigravity keeps about 42 KB of a client's tool definitions. Past that it drops the larger ones from the middle of the list; they stay listed by name, and a call to one fails with "tool … is not enabled for server …". Beluga's tools come to some 120 KB in all, so on Antigravity a run gets what it is for first: its task, its plan, its board, and in a Sentinel's run that Sentinel's tools. Then come Beluga's other tools, most useful first, as long as they fit in 36 KB. The conversation says which ones were left out.

## Models

Antigravity is listed with the models your plan has, as `agy models` shows them. Gemini takes a thinking level (Low, Medium, High), picked as its effort. If your plan doesn't have a model you picked, the conversation runs on Antigravity's own model and says so in a line.

A model Google retires leaves the list on its own: Beluga asks Antigravity each time.

## What works

- Worktrees and chats, with steps on the card as they happen: commands, reads, writes, edits, searches, and Beluga's own tools.
- Approvals: Antigravity asks before each command, write and MCP tool, and Beluga asks you when Claude would.
- **Plan** first, then approve: Antigravity's own Plan mode, and Beluga turns its writes down until you approve.
- **Stop**, and **Steer Now**, which stops the turn and answers your message next. Antigravity takes one message at a time, so a message you send while it works waits for its turn.
- **Compact**, picking up a conversation later, and handing a conversation to another agent.
- Pictures in a message.
- Beluga's instructions go into Antigravity's own system prompt, so your rules and its own stay as they are.
- Usage: tokens for each turn, and the context meter. Not its quota (see above). Each look Beluga takes leaves nothing behind: its conversation and its log go once it has stopped, and Beluga clears what earlier ones left (journals of gone conversations, its `acp-server` logs older than a week). Antigravity's own CLI logs stay.

## What's different

- **Reads without asking.** Antigravity reads files (`.env` files too) without asking first, and its own permission rules don't reach reads from Beluga. See [security](security.md#antigravity-runs).
- **Friends' tasks go to Claude or Codex.** Because it doesn't ask before every step, a task a friend sends you runs on Claude (or Codex) when one is set up here, and their card says so.
- **No guests.** A guest you invite into a project can't prompt Antigravity: switch that conversation to Claude for them.
- **No Fork, no /btw.** Antigravity can't branch a conversation, so a fork starts a fresh one (the files come along), and editing a sent message starts afresh from your edited message.
- **No Terminal view.** Antigravity conversations stay in the chat.
- **Questions mid-run**: Antigravity's own question form doesn't reach Beluga, so when it asks (its `ask_question`), Beluga asks you for it: the same card Claude's questions get, on your phone too. Your answer goes back to Antigravity as its next turn (the question also stays written in its answer).
- **A declined step.** Antigravity ends its turn without a word when a step is turned down, so Beluga tells it why, once, and it answers.
- **Gemini looks around a lot.** On Gemini 3.8 Flash, Antigravity often reads and searches well past what you asked (other folders, your home folder) before it answers. Its commands still come to you, but a Claude model on your plan keeps closer to the request.
- **Your plan's quota.** On your Google account, every message uses some of your Antigravity quota, and so do the small asks Beluga makes for you (naming a worktree, drafting a task). When it runs out, the card says so. On Antigravity (API key), every token is billed to the key.
- **Your project's rules, not Antigravity's global ones.** In Beluga, Antigravity follows your project's `AGENTS.md`, `GEMINI.md` and `.agents/` rules and Beluga's instructions, not your global rules (`~/.gemini/GEMINI.md`, `~/.gemini/AGENTS.md`, `~/.gemini/config/rules/` and the like). agy has no switch for that, so Beluga starts it on a Gemini folder of its own, `~/.beluga/agy-gemini` (`--gemini-dir`): everything of `~/.gemini` linked in (your sign-in, conversations, settings, skills, plugins, MCP servers) except those rules. A file agy saves there goes back to `~/.gemini` on its next start. Antigravity in your terminal still reads them. On Windows, and with no global rules, it reads `~/.gemini` as it is. A project with only a `CLAUDE.md` gives it nothing to read: Antigravity doesn't read that file.
- **Your MCP servers**: the ones in your Antigravity config run in its conversations, as they do in Antigravity. Settings › MCP lists Claude Code's and Codex's.
- **Deleting a chat** deletes Antigravity's own record of it too (its conversation file and notes in `~/.gemini/antigravity-cli`).

## Checking it

Antigravity runs on Beluga's ACP core ([ACP agents](acp.md)): what it does past ACP is its extension (`src/agent/runtime/antigravity/extension.ts`).

`npx vitest run tests/antigravity-flow.test.ts` runs it against a scripted `agy acp` in the shapes the Antigravity CLI 1.5.8 sends. `npx tsx scripts/live-antigravity.ts` runs the same checks against your real `agy` (about 15 messages of your quota).
