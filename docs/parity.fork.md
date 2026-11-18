# Parity: this fork's own rows

`docs/parity.md` stays as upstream wrote it; `tests/parity.test.ts` reads this file after it, so a
method, menu or action this fork adds is listed here (docs/fork.md). A row for a method upstream
already has is the whole row as this fork works, in place of upstream's.

## API methods (fork)

| Method | Mac |
|---|---|
| `companion.pair.start` | ✓ the sidebar footer's phone mark › Pair a Phone…: a one-time pairing (QR and code, 10 minutes, one phone); with `{project, ttlMs}` it is a client invite (BLG-14): 1 day by default, 7 at most, and the phone that pairs is that project's client, shown in the device list with its project and revocable like any device |
| `board.start` | ✓ Start on a task (its page, its ⋯ and right-click menu: a new worktree, In Progress, your agent on it with its brief, and you there; the task's own agent, else its plan's, else your default); Start's ▾ and the menus' Start with ▸ (BLG-506): every agent and model, this start only, one not set up greyed with why; ⋯ › Start Worktree Only; a task a worktree already does or carries shows Open Worktree instead. The phone's task › Start, and ⋯ › Start with… (1.35) |

## Beyond the shared actions (fork)

| What | Where |
|---|---|
| Resizing the sidebar (`fork/sidebar/resize.tsx`): drag its right edge (col-resize cursor, lit only while hovered), double-click it for the default width, or → / ← with it focused; 200–360 points, kept across launches as the `sidebarWidth` preference (the same as Settings' slider) | Mac only |
| Auto accept (fork, `src/fork/federation/settings.ts`): a Ready task a teammate gives this computer starts by itself with Claude: Off, Tasks given to me, or Tasks given to me and the pool (a Ready task with the Pool label, default `pool`, and nobody on it is claimed by a free computer), Only from (people you fully trust, or trust), Running at once 1–6 (default 2); this computer's own setting, never synced (`session.setPrefs` `federation`) | Mac only (Settings › Agent › Auto Accept, `fork/federation/FederationSettings.tsx`); the phone doesn't offer it |
| A plan's task card names its model (fork, `fork/plans/TaskAgentChip.tsx`, data `src/fork/plans/task-agent.ts`): at work, its worktree's agent and model; not yet (the outline), the task's own agent, else the plan's builder, else the project's agent; nothing for a task that's yours to do or on your default agent. The phone doesn't show it. | Plans › a plan › the canvas and the outline |
| Custom address (BLG-259, BLG-261, `fork/phone-advanced.tsx`): Settings › Phone › Advanced › Custom address: this computer's `host:port` in a GNB, ZeroTier, WireGuard, Nebula or Tailscale network (`session.setPrefs` `customAddress`, empty turns it off; a wrong form is refused before it is saved); the relay also listens there (the status line says Listening, or why not: port in use, no such address, Remote access set to network only), and a phone tries it beside the direct connection and the Cloudflare relay (`companion` state `custom`, 1.64) | Mac (the phone's Settings › Advanced says “Connected through the custom address (end-to-end encrypted)”, read-only) |
