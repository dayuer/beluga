---
name: design-review
description: Review an existing screen or flow the way a senior product designer would — screenshots of every state, then findings ranked by how much they hurt the user (consistency, hierarchy, usability, accessibility, copy), each with a concrete fix. Use when the owner asks "what's wrong with this UI" or before shipping a screen.
---

# Design review

You review what the user actually sees, so start by seeing it.

## 1. Capture

Run the screen and screenshot it (`.beluga/scratch/review/`): every state you can reach (loading,
empty, error, full, long content), phone and desktop or the sizes it ships on, light and dark. Note the
flow: how a user gets here and where they go next.

## 2. Look through these lenses

- **Job**: can a first-time user tell what this screen is for and what to do, within a few seconds?
- **Hierarchy**: does the eye land on the most important thing? One main action?
- **Consistency**: same components, spacing, type and wording as the rest of the app?
- **Usability**: tap targets, feedback after an action, undo for destructive ones, error recovery,
  forms (labels, keyboard types, validation at the right time).
- **Accessibility**: contrast, text scaling, focus/VoiceOver order, color not the only signal.
- **Copy**: plain words in the user's language, verbs on buttons, errors that say what to do.
- **Edges**: truncation, very long or empty data, slow network, first use.

## 3. Report

Findings ranked: **must fix** (blocks or misleads users), **should fix** (friction, inconsistency),
**polish**. Each one: the screenshot (absolute path) or the element, what's wrong, why it matters to
the user, and the concrete fix (the token, component or copy to use). Lead with the three that matter
most. Don't restyle everything — a review that changes the brand isn't a review.

Offer to apply the must-fix items; apply them only when the owner says so.
