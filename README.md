## What changes

The Mac app's controls looked like web inputs: buttons, pop-ups, checkboxes, switches, text fields and segmented controls each had their own heights and borders, and no focus ring matched macOS. They are now drawn the way AppKit draws them, on one size scale, from tokens that every theme and accent already feeds.

Steps 1–4 are #525 again, on today's `main` (3.6.1 and the 53 commits since): the same five commits, replayed; only the lines `main` changed around them differ. Two commits are new: **Liquid Glass**, the macOS 26 look, on a Mac whose window blurs; and **the Mac's own menus**, an `NSMenu` for pop-up buttons, pull-downs and right-click menus in the app.

- **Drawn as AppKit draws them.** Control tokens in `styles/tokens.css` are named after the semantic colours react-native-macos's `PlatformColor` exposes (`controlColor`, `textBackgroundColor`, `controlAccentColor`, `keyboardFocusIndicatorColor`) and made from the theme's own tokens.
  - Push buttons have a hairline bezel, a soft drop, and in dark a lit top edge. Pressed shows a darker face, not a hover tint.
  - The pop-up button carries NSPopUpButton's chevrons in an accent box.
  - Checkboxes are raised and turn accent once checked. The switch track is recessed.
  - The segmented control is NSSegmentedControl's: a recessed track with the chosen segment raised.
  - Keyboard focus is a 3px accent ring outside the bezel, everywhere.
  - While the window isn't key (`data-window='idle'`), the default button, checked boxes and pop-up arrows lose the accent, as AppKit's do.
- **One size scale** (`docs/mac-controls.md`, Chinese and English):
  - **Large (28px):** the window's title row and a screen's one main action.
  - **Regular (22px, the default):** sheets, alerts, Settings and forms.
  - **Small (20px):** rows, cards, panels and the conversation.

  There is no mini size and no text under 12px, for Chinese. `Button`, `IconButton`, `Select` and `Segmented` take `size`, and `:root:lang(zh-CN)` puts PingFang SC first.
- **Moved onto the scale, in four steps** (one commit each, step 1 in two):
  1. Tokens and components; the scale written down.
  2. The title row (Large) and the right panel and dock (Small).
  3. Sheets' own controls (Regular), so no row mixes 20px and 22px controls.
  4. Lists, cards and the conversation (Small: 290 controls in 107 files), and the Overview's filter bar, which now uses the shared look.

  The composer's chips, its round send button and the stat pills keep their own shape on purpose. The doc says so.

- **Liquid Glass** (the sixth commit), only on a Mac whose window blurs (`data-transparency='full'`: not with Reduce transparency, not on a solid theme):
  - The sidebar and the right panel are panes of glass, 8px in from the window's edges, with 16px corners, a light rim and a soft drop.
  - Controls are capsules (`--control-radius-*` are 999px); a text area keeps 8px corners. A capsule's ring is a real 0.5px border, since WebKit breaks a 0.5px shadow up round the ends.
  - A track around capsules is a capsule too (New Task's priority scale had fixed 7px corners).
  - The window toolbar's icon buttons sit on glass capsules.
  - A pop-up button is its value and one chevron with no bezel, as macOS 26's settings draw it; its menu is a rounded card with the checkmark at the row's end.

  CSS only and still: nothing follows the pointer and there is no refraction (web versions draw that with an SVG displacement filter, which WebKit doesn't). The tokens are `--glass-*` in `styles/tokens.css`; each rule sits in its component's own stylesheet under `:root[data-os='mac'][data-transparency='full']`, the way the idle-window rules use `data-window`. Windows, Linux and the flat window keep the controls of steps 1–4.

- **The Mac's own menus** (the last commit), in the app on a Mac: an `NSMenu` built in `src-tauri/src/native_menu.rs` (objc2-app-kit and objc2-foundation, only the features it uses), fed by `lib/native-menu.ts`.
  - Pop-up buttons (`Select`) open with the chosen row over the button, as an `NSPopUpButton` does; a list long enough for a search field keeps the web menu.
  - Pull-downs (`ActionsDropdown`, the ••• menus, Runs On, the Overview's project filter, a task's pickers, a person's card) and right-click menus (`SpecContext`, a terminal tab, a person in the room).
  - A row keeps its name through `t()`, its hint as the line under it (macOS 14.4's subtitle), its shortcut, a checkmark, section headers, submenus, and its icon as a template image the system tints.
  - A menu that wouldn't fit where it opens moves first, so it's never squeezed into a scrolling one while the screen has room. If it can't be shown (an older shell), the web menu opens instead.
  - Browsers, Windows and Linux keep the web menus, which now open on the side they fit on (`FitContent`) and scroll without a bar only when the window is too short.

No motion is added. Every theme, accent and density carries through.

## Before / after

The pictures are a Playwright run against the demo daemon (Chromium, 1280×820), the same script on both sides: **before** is upstream `main` at 0d159d0d8, **after** is this branch. Nothing else differs. The demo's terminal text is hidden in both (it isn't a control).

Chromium on a Mac counts as a Mac whose window blurs, so the light and dark **after** pictures are Liquid Glass. The **flat window** set shows the same screens with `data-transparency='reduce'`, what `lib/prefs.ts` puts on the page with Reduce transparency (and what Windows and Linux get): the controls without the glass.

### The window: Liquid Glass

| Before (upstream `main`) | After (this PR) |
|---|---|
| ![](https://raw.githubusercontent.com/dayuer/beluga/2641d68e21bd35cd1e80017ba5668513b86c62d5/native-controls/before-light-1-window.png) | ![](https://raw.githubusercontent.com/dayuer/beluga/2641d68e21bd35cd1e80017ba5668513b86c62d5/native-controls/after-light-1-window.png) |
| ![](https://raw.githubusercontent.com/dayuer/beluga/2641d68e21bd35cd1e80017ba5668513b86c62d5/native-controls/before-dark-1-window.png) | ![](https://raw.githubusercontent.com/dayuer/beluga/2641d68e21bd35cd1e80017ba5668513b86c62d5/native-controls/after-dark-1-window.png) |

The sidebar and the panel float as glass; the toolbar's icon buttons sit on glass capsules.

### New Task (Regular)

| | Before (upstream `main`) | After (this PR) |
|---|---|---|
| Liquid Glass | ![](https://raw.githubusercontent.com/dayuer/beluga/2641d68e21bd35cd1e80017ba5668513b86c62d5/native-controls/before-light-3-new-task.png) | ![](https://raw.githubusercontent.com/dayuer/beluga/2641d68e21bd35cd1e80017ba5668513b86c62d5/native-controls/after-light-3-new-task.png) |
| Liquid Glass, dark | ![](https://raw.githubusercontent.com/dayuer/beluga/2641d68e21bd35cd1e80017ba5668513b86c62d5/native-controls/before-dark-3-new-task.png) | ![](https://raw.githubusercontent.com/dayuer/beluga/2641d68e21bd35cd1e80017ba5668513b86c62d5/native-controls/after-dark-3-new-task.png) |
| Flat window | ![](https://raw.githubusercontent.com/dayuer/beluga/2641d68e21bd35cd1e80017ba5668513b86c62d5/native-controls/before-flat-3-new-task.png) | ![](https://raw.githubusercontent.com/dayuer/beluga/2641d68e21bd35cd1e80017ba5668513b86c62d5/native-controls/after-flat-3-new-task.png) |

The priority picker is a segmented control with the chosen segment raised; Cancel and Create Task share one bezel and height. In the flat window Assignee and Agent are pop-up buttons with their chevrons in an accent box; with Liquid Glass they are the value and one chevron, and the buttons are capsules.

### Settings (Regular)

| | Before (upstream `main`) | After (this PR) |
|---|---|---|
| Liquid Glass | ![](https://raw.githubusercontent.com/dayuer/beluga/2641d68e21bd35cd1e80017ba5668513b86c62d5/native-controls/before-light-4-settings.png) | ![](https://raw.githubusercontent.com/dayuer/beluga/2641d68e21bd35cd1e80017ba5668513b86c62d5/native-controls/after-light-4-settings.png) |
| Liquid Glass, dark | ![](https://raw.githubusercontent.com/dayuer/beluga/2641d68e21bd35cd1e80017ba5668513b86c62d5/native-controls/before-dark-4-settings.png) | ![](https://raw.githubusercontent.com/dayuer/beluga/2641d68e21bd35cd1e80017ba5668513b86c62d5/native-controls/after-dark-4-settings.png) |
| Flat window | ![](https://raw.githubusercontent.com/dayuer/beluga/2641d68e21bd35cd1e80017ba5668513b86c62d5/native-controls/before-flat-4-settings.png) | ![](https://raw.githubusercontent.com/dayuer/beluga/2641d68e21bd35cd1e80017ba5668513b86c62d5/native-controls/after-flat-4-settings.png) |

### Menus

In the app on a Mac (the built app, this branch), a pop-up button opens the Mac's own menu, the chosen row over the button:

| Language | Send with |
|---|---|
| ![](https://raw.githubusercontent.com/dayuer/beluga/2641d68e21bd35cd1e80017ba5668513b86c62d5/native-controls/app-language-menu.png) | ![](https://raw.githubusercontent.com/dayuer/beluga/2641d68e21bd35cd1e80017ba5668513b86c62d5/native-controls/app-send-menu.png) |

These two are from the built app on a scratch home, whose interface language was Chinese; the Playwright pictures below are English. In the browser (and on Windows and Linux) the web menu stays:

| | Before (upstream `main`) | After (this PR) |
|---|---|---|
| Liquid Glass | ![](https://raw.githubusercontent.com/dayuer/beluga/2641d68e21bd35cd1e80017ba5668513b86c62d5/native-controls/before-light-5-popup-menu.png) | ![](https://raw.githubusercontent.com/dayuer/beluga/2641d68e21bd35cd1e80017ba5668513b86c62d5/native-controls/after-light-5-popup-menu.png) |
| Liquid Glass, dark | ![](https://raw.githubusercontent.com/dayuer/beluga/2641d68e21bd35cd1e80017ba5668513b86c62d5/native-controls/before-dark-5-popup-menu.png) | ![](https://raw.githubusercontent.com/dayuer/beluga/2641d68e21bd35cd1e80017ba5668513b86c62d5/native-controls/after-dark-5-popup-menu.png) |
| Flat window | ![](https://raw.githubusercontent.com/dayuer/beluga/2641d68e21bd35cd1e80017ba5668513b86c62d5/native-controls/before-flat-5-popup-menu.png) | ![](https://raw.githubusercontent.com/dayuer/beluga/2641d68e21bd35cd1e80017ba5668513b86c62d5/native-controls/after-flat-5-popup-menu.png) |

### Keyboard focus: Tab through New Task

| Before (upstream `main`) | After (this PR) |
|---|---|
| ![before](https://raw.githubusercontent.com/dayuer/beluga/2641d68e21bd35cd1e80017ba5668513b86c62d5/native-controls/before-focus.gif) | ![after](https://raw.githubusercontent.com/dayuer/beluga/2641d68e21bd35cd1e80017ba5668513b86c62d5/native-controls/after-focus.gif) |
| Tab moves through the sheet's controls | The same keys, with Liquid Glass; each control's ring is the 3px accent ring outside its bezel |

### The window goes to the back and comes back

| Before (upstream `main`) | After (this PR) |
|---|---|
| ![before](https://raw.githubusercontent.com/dayuer/beluga/2641d68e21bd35cd1e80017ba5668513b86c62d5/native-controls/before-idle.gif) | ![after](https://raw.githubusercontent.com/dayuer/beluga/2641d68e21bd35cd1e80017ba5668513b86c62d5/native-controls/after-idle.gif) |
| The switches stay as they are | The switches go grey while the window isn't key, as AppKit's do (in the flat window the pop-ups' arrows do too) |

The recording sets `data-window` the way `lib/window-active.ts` does when the window loses focus; the headless browser has no other window to switch to.

<details><summary>Tasks, the flat window, and stills from the recordings</summary>

| | Before | After |
|---|---|---|
| Overview, flat window | ![](https://raw.githubusercontent.com/dayuer/beluga/2641d68e21bd35cd1e80017ba5668513b86c62d5/native-controls/before-flat-1-window.png) | ![](https://raw.githubusercontent.com/dayuer/beluga/2641d68e21bd35cd1e80017ba5668513b86c62d5/native-controls/after-flat-1-window.png) |
| Tasks, light | ![](https://raw.githubusercontent.com/dayuer/beluga/2641d68e21bd35cd1e80017ba5668513b86c62d5/native-controls/before-light-2-tasks.png) | ![](https://raw.githubusercontent.com/dayuer/beluga/2641d68e21bd35cd1e80017ba5668513b86c62d5/native-controls/after-light-2-tasks.png) |
| Tasks, dark | ![](https://raw.githubusercontent.com/dayuer/beluga/2641d68e21bd35cd1e80017ba5668513b86c62d5/native-controls/before-dark-2-tasks.png) | ![](https://raw.githubusercontent.com/dayuer/beluga/2641d68e21bd35cd1e80017ba5668513b86c62d5/native-controls/after-dark-2-tasks.png) |
| Tasks, flat window | ![](https://raw.githubusercontent.com/dayuer/beluga/2641d68e21bd35cd1e80017ba5668513b86c62d5/native-controls/before-flat-2-tasks.png) | ![](https://raw.githubusercontent.com/dayuer/beluga/2641d68e21bd35cd1e80017ba5668513b86c62d5/native-controls/after-flat-2-tasks.png) |
| Focus ring, still | ![](https://raw.githubusercontent.com/dayuer/beluga/2641d68e21bd35cd1e80017ba5668513b86c62d5/native-controls/before-focus-ring.png) | ![](https://raw.githubusercontent.com/dayuer/beluga/2641d68e21bd35cd1e80017ba5668513b86c62d5/native-controls/after-focus-ring.png) |
| Settings, window not key | ![](https://raw.githubusercontent.com/dayuer/beluga/2641d68e21bd35cd1e80017ba5668513b86c62d5/native-controls/before-idle-settings.png) | ![](https://raw.githubusercontent.com/dayuer/beluga/2641d68e21bd35cd1e80017ba5668513b86c62d5/native-controls/after-idle-settings.png) |

</details>

Full-size videos (MP4): focus [before](https://raw.githubusercontent.com/dayuer/beluga/2641d68e21bd35cd1e80017ba5668513b86c62d5/native-controls/before-focus.mp4) / [after](https://raw.githubusercontent.com/dayuer/beluga/2641d68e21bd35cd1e80017ba5668513b86c62d5/native-controls/after-focus.mp4), window not key [before](https://raw.githubusercontent.com/dayuer/beluga/2641d68e21bd35cd1e80017ba5668513b86c62d5/native-controls/before-idle.mp4) / [after](https://raw.githubusercontent.com/dayuer/beluga/2641d68e21bd35cd1e80017ba5668513b86c62d5/native-controls/after-idle.mp4).

## Both clients

A Mac look only: no API, view, protocol or phone change.

- [ ] API entry (`src/ipc/api.ts`) and handler (n/a)
- [ ] Core behavior + contract test (n/a)
- [ ] Shared model/actions (n/a)
- [ ] Terminal UI (n/a)
- [x] Mac app (`packages/mac`)
- [ ] Row in `docs/parity.md` (n/a: no new action)
- [ ] Commands, palette, menu bar, help (n/a)

## Test plan

- [x] New: `tests/mac-controls.test.ts`. It holds the scale to the tokens and the doc, the title row and panels to their sizes, and every Liquid Glass rule behind its switch, a capsule's ring as a real border, and a track around capsules as a capsule.
- [x] New: `tests/mac-native-menu.test.ts` (rows, sections, shortcuts), `tests/mac-native-menu-mark.test.ts`, `tests/mac-menu-fit.test.ts` (the side a web menu opens on).
- [x] `cargo check` in `packages/mac/src-tauri`.
- [x] `npm run typecheck` at the root, in `packages/mac` and in `packages/companion`.
- [x] Full `npx vitest run` on the head commit: 725 files pass (1 skipped, as on `main`). The last commit's `Tested-on` matches its tree.
- [x] `npm run app:build` in `packages/mac` on this branch: `Beluga.app` builds and signs ad hoc. The step after it, signing the updater archive, needs the release key (`TAURI_SIGNING_PRIVATE_KEY`), which this machine doesn't have, so the DMG wasn't made.
- [x] Before/after above: the demo app, Liquid Glass light and dark and the flat window, New Task, Settings, a pop-up's menu, the Overview and Tasks.
- [x] The built app on a Mac: pop-up buttons open the Mac's own menu (above).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
