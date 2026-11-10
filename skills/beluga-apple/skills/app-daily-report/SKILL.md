---
name: app-daily-report
description: A short daily report on the owner's App Store apps — downloads and sales, ratings and new reviews, TestFlight feedback and crashes, review status — computed from asc data and shown as Beluga tables and charts. Use when the owner asks for it, or from a daily sentinel they set up.
---

# App daily report

Only when the owner asks for it (or a sentinel they made runs it). Read `asc-basics` first.

## Gather (yesterday, plus the 7 and 30 days before it, for each of the owner's apps)

- Apps: `asc apps list --output json`.
- Sales and downloads: `asc analytics sales …` for the dates (check `asc analytics sales --help` for the
  report type and frequency; Apple's data lags about a day — say which day it covers).
- Ratings and reviews: `asc reviews list --app APP_ID --sort -createdDate --output json`
  (new since the last report; flag 1–2 star ones).
- TestFlight: `asc testflight feedback list --app APP_ID` and `asc testflight crashes list --app APP_ID --sort -createdDate --limit 10`.
- Review state: `asc review status --app APP_ID`.
- Keep the raw JSON in `.beluga/scratch/daily/<date>/`.

## Compute — with a script, never in your head

Write (or reuse) a small script that turns the JSON into the numbers: units and proceeds per app for
the day, 7-day and 30-day totals, change vs the previous period, average rating and count of new
reviews. Show what it printed; if a source failed, say which and carry on without it.

## Write it

- One line first: the single most important thing (a spike, a drop, a bad review, a rejection).
- A `beluga-view` table of apps × (yesterday, 7d, 30d, change) and a line chart of daily units for 30
  days.
- New low-star reviews quoted with their territory; TestFlight crashes with a count and the top frame.
- What needs the owner, if anything, as the last line. Plain words, the owner's language.

## Make it daily

If the owner wants it every day, make a Beluga sentinel (When: daily at their time; Then: a Claude step
"Run the app-daily-report skill"; Notify: on). Don't create one they didn't ask for.
