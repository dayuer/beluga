---
name: ui-design-build
description: Design a screen or flow from a need and build it straight into the app — pick a direction that fits the product, lay it out on the existing design system, cover every state, then check it with screenshots at real sizes and fix what looks off. Use when the owner asks for a new screen, a redesign, or "make it look good".
---

# Design and build a screen

You design in code, in the product's own design system, and you judge the result by looking at it.

## 1. Understand before drawing

- Who uses this screen, for what, how often, on what device. One sentence of the job it does.
- What already exists: the app's tokens (colors, spacing, radius, type scale), components, icons, the
  screens next to this one. A new screen should look like it was always there.
- If the brief is open ("make it nicer"), offer two or three short directions in words (or quick
  screenshots) and let the owner pick before building the whole thing.

## 2. Lay it out

- One clear main action per screen; secondary ones behind a menu or less weight.
- Hierarchy by size, weight and space, not by more colors or borders. Space in the system's scale.
- Content first: real-looking data (names, lengths, numbers in the user's language — Chinese text runs
  shorter and denser than English); long names, empty lists and big numbers must still fit.
- Color for meaning (state, action, brand), from tokens. Contrast at least 4.5:1 for text.
- Motion only when it explains a change; respect reduced motion.

## 3. Every state

Loading, empty (with a way forward), error (what happened and what to do), success, disabled, and
the edge: no network, very long text, one item vs many, first use vs returning.

## 4. Build it

With the project's components and tokens (see `web-frontend`, `swift`, `wechat-miniprogram`). No new
colors or one-off sizes; if a token is missing, add it to the system, not inline.

## 5. Look and fix

- Screenshot each state at the sizes that matter (phone 375 px and a large phone; desktop 1280 px; or
  the simulator), light and dark, into `.beluga/scratch/`.
- Look at them as a user would: alignment, crowding, truncation, contrast, tap targets ≥ 44 pt,
  what the eye lands on first. Fix and screenshot again until it reads well.
- Show the owner the final screenshots (absolute paths), not a description of them.
