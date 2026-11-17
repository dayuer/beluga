---
name: app-review-guard
description: Watch an app's App Store review and, when Apple rejects it, find out why, fix what needs fixing in a worktree, draft the reply and the resubmission, and send them only after the owner says yes. Meant for a Beluga sentinel that runs it on a schedule, or when the owner asks "why was it rejected?".
---

# App Review guard

Goal: a rejection never sits unnoticed, and the owner only has to read a short summary and say yes.
Nothing goes to Apple without that yes. Read `asc-basics` first.

## 1. Check (every run)

```bash
asc review status --app APP_ID --output json
asc review submissions list --app APP_ID --output json
```

- Compare with what you saw last time (keep the last state in `.beluga/scratch/review-state.json`).
  Nothing changed: end the run with one line ("Waiting for Review, unchanged").
- Approved / Ready for Distribution: tell the owner; releasing is their call.
- Rejected, or Apple asked a question (Developer Rejected / Metadata Rejected / message in the
  Resolution Center): go on.

## 2. Read why

- `asc review doctor --app APP_ID` for the blockers the API can see.
- The Resolution Center thread needs the owner's web session (`asc web auth status`; if it's missing,
  ask them to run `asc web auth login`): `asc web review show --app APP_ID` (downloads attachments
  next to it — put them in `.beluga/scratch/review/`) and `asc web review threads`.
- Quote the guideline numbers and Apple's words; don't paraphrase what Apple asked.

## 3. Sort each point into one of three

| Kind | Example | What you do |
|---|---|---|
| **Code** | crash on launch, broken sign-in, missing account deletion, IAP not restorable | fix it in a new worktree (`ios-build-verify`), with a test where it fits |
| **Metadata** | screenshots don't match, misleading description, missing privacy URL | prepare the change (`asc metadata …` with `--dry-run`, or new screenshots) |
| **Information** | demo account needed, explain a feature, need a video | draft the answer; ask the owner for anything only they have (a demo account, a video) |

If you're not sure what Apple means, say so and propose asking Apple in the reply rather than
guessing.

## 4. Ask the owner — one message, then wait

Post one summary: what Apple said (quoted), what you changed (worktree/branch, screenshots), the
reply you'd send (full text), and what happens on yes:

1. merge the fix (checks green; the owner presses Merge in Beluga),
2. build a new build and upload it (`testflight-publish`, or `asc publish appstore … --submit`),
3. send the reply: `asc web review reply --thread-id THREAD --message @file:.beluga/scratch/review/reply.txt --confirm`,
4. resubmit: `asc review submissions-submit --id SUBMISSION --confirm`.

Ask with a question the owner answers in one tap (send all / only the reply / let me edit / not now).
Do none of 2–4 before that answer. Never resend a reply whose result was unclear — re-read the thread.

## 5. Close the loop

After sending, re-read the thread and the submission state, record it in `review-state.json`, and tell
the owner it went. The next scheduled run picks up Apple's answer.

## Running it as a sentinel

When: every 30 minutes (or hourly). Then: a Claude step in the project — "Run the app-review-guard
skill for APP_ID". Notify: the owner, on any change. A fix worktree it opens shows on the board like
any task; merging stays the owner's.
