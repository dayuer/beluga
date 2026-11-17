---
name: dev-loop
description: The loop every code change in a Beluga worktree follows, whatever the language — learn the project's own commands, change the smallest thing, prove it with its checks, look at it running, commit. Read it before the language skill for the project.
---

# The dev loop

You work in this task's own worktree. Main stays untouched until the owner merges.

## 1. Learn the project before changing it

- Read the README, `CLAUDE.md` / `AGENTS.md`, and the manifest (`package.json`, `Cargo.toml`,
  `pyproject.toml`, `Package.swift`, `project.config.json`…). The project's own scripts win over
  anything generic: if it says `npm run check`, run that, not `tsc` by hand.
- Find how it's checked: typecheck, lint, tests, build. Note the commands; you'll run them at the end.
- Match what's there: its layout, naming, error handling, libraries. Don't add a dependency for a few
  lines, and don't add one at all without saying why.

## 2. Change the smallest thing that fully does the job

- Fix the cause once, where it lives; grep every caller before changing a shared function.
- Keep unrelated code, formatting and history as they are.
- New logic with a branch, a loop, a parser, money or security gets a small test.

## 3. Prove it

- Run the project's checks on what you touched while you work, all of them once at the end.
- Read the first real error, fix that, run again. Don't paper over a failing test, skip it, or loosen
  a type to make it pass.
- A flaky failure counts only if it fails again when run alone.

## 4. Look at it running

Something a person sees (a page, a screen, a CLI) is checked by running it, not by reading code:
screenshots or output in `.beluga/scratch/`, shown in your answer (images by absolute path).

## 5. Commit and say what's true

Commit in the worktree with a message that says what changed and why. Report: what you changed, which
checks ran and passed (with their real output if anything failed), and what you didn't check.
Never claim a check you didn't run.

## Never

Secrets in code, logs or commits. Global installs or changes to the owner's machine without asking.
Force-pushing, rewriting shared history, or deleting work you didn't make.
