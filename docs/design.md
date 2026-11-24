# Design: how the screens look and read

The rules both screens keep: the Mac app (`packages/mac`, also the web) and the phone
(`packages/companion`). They sit beside the pages that hold the numbers, and don't repeat them:

- [mac-controls.md](mac-controls.md): the controls' sizes, shapes and where each size goes.
- [i18n.md](i18n.md): how the window is translated.
- [glossary.md](glossary.md): the words the screens use.
- `packages/mac/src/styles/tokens.css` and `lib/themes.ts`: the Mac's tokens and themes.
- `packages/companion/lib/theme.ts`: the phone's.

A rule here can be broken where a place reads better another way: say why in a comment beside it.
`tests/design-guards.test.ts` holds the ones a test can check, against a list of today's
exceptions that may only shrink.

## Color

- **Grey carries the layout; color means something.** Your accent for focus and selection, copper
  for Claude, and the states: green done, amber needs you, red a problem, blue info. The rest
  (sub-agent violet, worktree teal, plan pink, epic indigo, merged purple, call mint) each mark one
  kind of thing, always the same one.
- **Only tokens.** A component's style reads `var(--…)`, never a hex or an `rgba()` of its own.
  Shades come from tokens with `color-mix()` (as the controls do in `tokens.css`).
- **A color every theme repaints.** A new meaning goes into `ThemeColors` (`lib/themes.ts`) or is
  derived from one there in `tokens.css`, so Dracula, Nord and the others carry it; a token only
  `tokens.css`'s Light and Dark set stays Beluga's in every theme.
- **A small palette of its own takes the theme's colors.** ANSI output, syntax and JSON colors, a
  chart's series: from the theme's terminal colors or from the meaning tokens, not a fixed set per
  light and dark.
- **Where fixed colors belong:** a brand's own mark (`machines/brands.ts`), an image made to share
  (usage cards), the decorative scenes (onboarding, the Star sheet, fire), demo media. Nowhere else.
- **Nothing glows.** No neon, no colored glow, no gradient fade under a header (solid, with a
  hairline once scrolled). On near-black themes a fine lit edge stands in for a shadow (`lit`).

## Hierarchy

- **Weight and color, not size.** A heading is the body size or one step up; secondary text is
  `--text-2`, faint is `--text-3`. Medium weight names a surface or a group, not a sentence.
- **One main action on a surface.** One prominent button, for what this place needs next (the
  workspace toolbar picks it from the state, `layout/toolbar-actions.ts`); the rest go under ⋯ or a
  long press, in sections. Never a row of equal buttons.
- **Advanced goes behind.** Options most people never touch go in the ⋯ sheet or Settings ›
  Advanced, not on the surface.

## Danger

- **Red is for what can't be taken back, and for errors.** Delete, discard, a failed run. Not for
  "stop", "cancel" or "off".
- **Undo before asking.** What can be put back (hide, archive, remove from a list) happens at once
  with an Undo (`lib/undo-toast.tsx`); a confirmation is for what can't.

## Stability

- **Nothing moves when state changes.** A row that starts loading, finishes or fails keeps its
  size; a button's label changing doesn't shift its neighbours.
- **Loading is in place.** The thing that's loading says so where it is (a spinner in the row, a
  "Saving…" label), not a page-wide overlay.
- **Opening keeps your place.** Expanding or folding a group keeps the row you clicked where it was
  on screen.
- **Motion is short and serves a change.** `--dur-fast` / `--dur`; no decorative loops; `data-motion
  ='reduce'` and the system setting turn it off (`lib/reduced-motion.ts`).

## Building it once

- **The third copy is shared.** A piece of UI or a helper written a third time moves to a shared
  home. The ones there today:
  - controls and small parts: `components/ui.tsx` (Button, IconButton, Segmented, Badge, Dot,
    Avatar, Empty…), `components/Select.tsx`, `components/SplitButton.tsx`, `components/Alert.tsx`
  - time: `src/shared/clock.ts` (`span`, `hhmm`), `lib/window-active.ts` (`useClock`)
  - errors: `src/shared/error-text.ts` (`errorText`)
  - motion: `lib/reduced-motion.ts`
- **Plurals stay inline.** Write `` `${n} file${n === 1 ? '' : 's'}` ``, not a `plural()` helper. The
  extractor (`scripts/i18n-extract.mjs`) collects templates as they're written (`"{0} file{1}"`); a
  helper's `plural(n, 'file')` hides the words from it, so the catalog only has what someone added
  by hand: "1 file" and the sentence around a count stay English in every other language. Today's
  helpers are listed in `tests/design-guards.test.ts`, to move inline as their screens are touched.

## Words

- How text is translated: [i18n.md](i18n.md). The English in the code is the catalog's key, so
  **changing an English string means changing its key in `zh-CN.json` too** (`node
  scripts/i18n-extract.mjs --missing --locale zh-CN` lists what's missing).
- One thing, one word: [glossary.md](glossary.md).
- Plain words, no jargon: "Needs you", not "Pending action". Say what happened and what to do
  ("Not sent · Tap to retry"), not an error code.
