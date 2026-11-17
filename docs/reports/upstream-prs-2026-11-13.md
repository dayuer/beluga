# Upstream PRs, ready to open (2026-11-13)

Six branches off `beluga-labs/beluga` `main` (`e97469a36`, 3.3.0), one fix each. All six merged together: full `npx vitest run` on macOS, 8195 passed, 16 skipped. It ran with English git messages, since three of upstream's own git tests fail on a Chinese-locale Mac with or without these changes. Each keeps its original author;
the follow-up commits come from reviewing them. The branches are `upstream-pr/<name>` on dayuer/beluga. Opened 2026-11-13 as beluga-labs/beluga #490 (credential-safe-search), #491 (ps-deadline-test-home), #492 (codex-tool-gate), #493 (autopilot-merge-failed), #494 (answer-images) and #495 (zsh-compat).

Conflicts, checked 2026-11-13 with `git merge-tree` against upstream `main` `e97469a36`:

- Each branch merges into upstream `main` cleanly, and every pair of them merges cleanly too, so they can land in any order. #6 adds `CLAUDE_ENV_FILE` after the options are built, not on the `env` line that #1 changes.
- Open upstream PRs: #474 merges cleanly with all six. #386 (Schedules in a chat) is 96 commits behind `main` and already conflicts with it in 22 files. Our branches add no file to that list.

---

## 1. `upstream-pr/credential-safe-search`

**Title:** A directory search can't open a credential file, a friend's Claude doesn't get the daemon's env, a bad identity.json stays

Commits: `848050c6b` (guxiaobin, from faufderhar/beluga), `b1cf89df9` (review follow-ups).

```markdown
## What changes

Three holes, found in faufderhar/beluga and never sent upstream:

- **Grep, Glob and LS could read credential files.** A directory search never named the secret, so `decideTool` let it through, and the results carried `credentials.json` or `id_ed25519` contents. Now `confineSearch` narrows a Grep or Glob with a negated glob that leaves every credential file out (symlinks followed), and `decideTool` denies a search it can't narrow. LS of such a folder is denied. A search with its own glob or pattern isn't narrowed, since the exclusion would replace it and widen the search: it's denied. `**` and `**/*` still narrow.
- **A friend's or guest's Claude inherited the daemon's whole `process.env`** (API tokens, cloud credentials) whenever a run passed any variable. Now `claudeLaunchEnv` gives them a scrubbed env: PATH/HOME/locale, plus Claude Code's own non-secret settings (`CLAUDE_CONFIG_DIR`, `ANTHROPIC_BASE_URL`, Bedrock/Vertex switches, proxies without a password, `NODE_EXTRA_CA_CERTS`), so the run still starts. Your own runs, dialogues and compactions inherit as before.
- **A corrupt identity.json was silently replaced**, which changes your peer id and drops the trust friends gave you. Now the file stays as it is; at start Beluga runs with a one-off identity and logs the path and what to do. A missing file is still created.

## Both clients

No API, view or protocol change.

## Test plan

- [x] `tests/policy.test.ts`: searches that would open a key are denied or narrowed; a search with its own glob is denied, not widened.
- [x] `tests/claude-launch-env.test.ts` (new): a friend's env has no planted tokens and keeps Claude Code's settings; your own run inherits.
- [x] `tests/identity.test.ts`: corrupt and unreadable files stay as they are; a broken file at start gives a one-off identity and a message naming the file.
- [x] `npm run typecheck`, Mac typecheck, full `npx vitest run` on macOS (with the other five branches).

Known, not in this PR: `scanSearch` walks the tree on the daemon's event loop, two or three times per Grep (hook plus `canUseTool`). The interactive terminal's hook (`agent/terminal-hook.ts`) uses `decideTool` without `confineSearch`, so it denies where the chat narrows. That fails closed.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

## 2. `upstream-pr/ps-deadline-test-home`

**Title:** macOS `ps` can't hang an archive, and tests get their own OS home

Commit: `1f00721a8` (Michael Gardiner, from gardinermichael/beluga).

```markdown
## What changes

- `ps -axwwE` can hang on a protected system process, and `execFile`'s timeout waits for the pipe to close, so archiving a worktree could block for good. It now lists only the current user's processes (`-U <uid>`) and kills `ps` after a hard 3 s deadline (`src/workspaces/test-procs.ts`).
- Tests get their own OS `HOME` (`tests/setup.ts`), so workspace discovery and git never scan or sign with the developer's real home. The tests that relied on it are adjusted.

## Both clients

No API or screen change.

## Test plan

- [x] `tests/test-procs-timeout.test.ts`, `tests/setup-isolation.test.ts` (new), and the adjusted suites.
- [x] Full `npx vitest run` on macOS.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

## 3. `upstream-pr/codex-tool-gate`

**Title:** Codex hands Beluga's own tool calls to Beluga's permission gate

Commit: `e908f3c19` (Joe Hosman, from JoeHosman/beluga).

```markdown
## What changes

Beluga's MCP servers for Codex (beluga_plan, beluga_board…) get `default_tools_approval_mode: 'approve'`. Codex otherwise asks its own approval for each call, which Beluga can't answer. Calls then reach ToolHost's per-call gate, the same one Claude's go through. Only Beluga's mounted servers get it, never yours.

## Both clients

None.

## Test plan

- [x] `tests/codex-parity.test.ts`: each Beluga server's config carries the setting.
- [ ] Not tried against a live Codex here.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

## 4. `upstream-pr/autopilot-merge-failed`

**Title:** Autopilot doesn't re-pass a milestone whose merge failed

Commit: `cce5b09f2` (Martin Herrmann, from voshond/beluga). Two lines in `src/core/plans/pilot.ts`, plus a test in `tests/plans.test.ts`.

## 5. `upstream-pr/answer-images`

**Title:** Images in answers to an agent's questions reach it

Commits: `fe2f2809a` (Martin Herrmann, from voshond/beluga), `d37b8024d` (follow-up).

```markdown
## What changes

- An image pasted into an answer to the agent's question (AskUserQuestion, plan feedback) is linked to its file in `~/.beluga/attachments` (`withImagePaths`). Finder drops are off in the plan's answer box.
- That folder was one of Beluga's own secret paths (`secretInHome`), so Claude's Read of the image was denied as a credential and the image never reached it. It's now open, like workspaces and chats.

## Test plan

- [x] `tests/attachments.test.ts`: the link rewrite, and that the folder isn't secret while identity.json beside it is.
- [x] Mac typecheck.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

## 6. `upstream-pr/zsh-compat`

**Title:** zsh takes the bash agents write

Commits: `b471b0014` (Martin Herrmann, from voshond/beluga), `839769266` and `e9d277a79` (follow-ups).

```markdown
## What changes

Agents run commands in your login shell and write them for bash. On zsh, an unquoted glob with no match (`--include=*.ts`), `[ a == b ]`, `for f in $list` or `${arr[0]}` stopped the whole command.

- Claude runs (chat and terminal view) get `CLAUDE_ENV_FILE` pointing at `~/.beluga/zsh-compat.sh`, which Claude Code sources before each Bash command. In zsh it turns on `NO_NOMATCH NO_BAD_PATTERN NO_EQUALS SH_WORD_SPLIT KSH_ARRAYS BSD_ECHO`; in bash it does nothing. If you set `CLAUDE_ENV_FILE` yourself, it's left alone. Nothing is set on Windows. The file is written whole.
- Every agent on a zsh login shell gets a short prompt piece on writing for zsh.

Note: `KSH_ARRAYS` and `SH_WORD_SPLIT` also apply to shell functions Claude Code's snapshot loads (nvm, conda…). Worth a look if one of those misbehaves.

## Test plan

- [x] `tests/zsh-compat.test.ts`: the file, the env, a set CLAUDE_ENV_FILE, Windows, the prompt piece.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

---

## Not proposed upstream

- The Studio customer-turn search check (`a663330e3`): Studio is this fork's.
- The sentinel kept-data test fix: upstream fixed it its own way in 3.3.0.
- The MCP sign-in port: upstream merged its own final version (#427).
