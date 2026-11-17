---
name: asc-basics
description: Use the open-source asc CLI (App Store Connect) from a Beluga worktree — install it, sign in with an API key, find the right command, read its output, and know which commands reach Apple and need the owner's yes. Read this before any other App Store skill.
---

# asc: App Store Connect from the terminal

`asc` is the open-source App Store Connect CLI (github.com/rorkai/App-Store-Connect-CLI, MIT).
It wraps Apple's App Store Connect API, and `asc web …` adds what only Apple's signed-in website
can do (Resolution Center replies, some Developer Portal pages).

## Before anything

1. Is it there? `asc --version`. If not, tell the owner it's needed and give them the line to run
   themselves — never install tools machine-wide on your own:
   `brew install asc` (or `curl -fsSL https://asccli.sh/install | bash`).
2. Is it signed in? `asc auth status --validate`. If not, the owner makes an App Store Connect API
   key (Users and Access › Integrations › App Store Connect API) and runs `asc auth login` with it.
   Never ask for the key in chat, never print, copy or commit it, never read `~/.asc` yourself.
   `asc auth doctor` explains a broken setup.
3. Web-only features (`asc web …`) need a separate Apple Account session the owner starts:
   `asc web auth login --apple-id <their Apple ID>`; check with `asc web auth status`.

## Finding the command

- Don't guess flags. Use `asc <group> --help`, or describe the job: `asc search "upload build"`.
- Flags go after the subcommand: `asc reviews list --app APP_ID --stars 1`.
- Long text goes in a file: `--whats-new @file:notes.txt` (and `@env:NAME` for a variable).
- Most lists page: add `--paginate` when you need everything.
- `--app` takes the numeric Apple ID of the app (`asc apps list` shows it); `ASC_APP_ID` sets a default.

## Reading what it says

- For yourself, `--output json` (pipe through `jq`). For the owner, `--output table`, or turn the
  JSON into a Beluga table/chart block in your answer.
- A non-zero exit is a failure: read stderr before trying anything else, and don't loop on retries.

## What reaches Apple — ask first

Writes that go to Apple or to real users carry `--confirm` (or their own flag). Before running one,
**say exactly what will happen and get the owner's yes in this conversation**, unless the owner
already asked for that exact action. In particular, each of these is one-way:

- submitting a version or build for review (`asc review submissions-submit`, `asc publish appstore --submit`)
- a Resolution Center reply (`asc web review reply`) — it goes to Apple and can't be taken back
- releasing a version, changing price or availability, removing an app
- sending external TestFlight builds to Beta App Review

Prefer `--dry-run` where a command has one, and show its plan first.

## Deeper

`asc install-skills` installs the project's own 25 reviewed agent skills (signing, metadata,
screenshots, analytics…). When a task goes beyond these Beluga skills, suggest the owner installs
them, then use them.
