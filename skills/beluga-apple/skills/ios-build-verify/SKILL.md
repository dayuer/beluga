---
name: ios-build-verify
description: Build, test and check an iOS app in its Beluga worktree — find the project and scheme, build for the simulator, run the tests, install and open the app, walk the changed flow and leave screenshots in the scratch folder. Use for any change to an iOS (or iPadOS) app before calling it done.
---

# Build, test and verify an iOS app

You work in this task's worktree on the owner's Mac, with its Xcode and simulators. A change is done
when it builds, its tests pass and you've seen the changed flow run.

## 1. Know the project (once per worktree)

- Find the workspace or project and the app's shared scheme:
  `xcodebuild -list -json` (prefer a `.xcworkspace` when there is one).
- If the project is generated (XcodeGen `project.yml`, Tuist), generate it first; a missing
  `.xcodeproj` doesn't mean the repo is broken.
- Read the Bundle ID and deployment target from the build settings
  (`xcodebuild -showBuildSettings -scheme <S> | grep -E 'PRODUCT_BUNDLE_IDENTIFIER|IPHONEOS_DEPLOYMENT_TARGET'`).
- Keep the project's own layout, build system and deployment target. Don't touch signing, the
  keychain, global settings or shell profiles; if a machine-wide change is truly needed, say why and
  ask.

## 2. Build for the simulator

```bash
xcodebuild build -scheme <S> -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath .beluga/scratch/DerivedData CODE_SIGNING_ALLOWED=NO | tail -40
```

- Fix the **first** real error in the log, then build again. Don't `clean` by habit.
- Keep build output under `.beluga/scratch/` (git-ignored), never in the repo.

## 3. Test

- Pick a simulator that exists: `xcrun simctl list devices available --json` — prefer one already
  booted, else the newest iPhone runtime.
- `xcodebuild test -scheme <S> -destination 'id=<UDID>' -only-testing:<Target>/<Case>` while
  iterating; run the whole test plan once at the end.
- On failure, read the result bundle's failure messages, not just the tail of the log.

## 4. Run it and look

```bash
xcrun simctl boot <UDID> 2>/dev/null; open -a Simulator
xcrun simctl terminate <UDID> <bundle-id> 2>/dev/null
xcrun simctl install <UDID> <path/to/App.app>
xcrun simctl launch <UDID> <bundle-id>
xcrun simctl io <UDID> screenshot .beluga/scratch/<screen>.png
```

- Walk the flow you changed, including its loading, empty, error and success states. Behind a
  sign-in? Use the test account the project documents, or ask the owner for one (never invent or
  reuse their own login).
- Save a screenshot of each screen you changed in `.beluga/scratch/` with a short name
  (`01-today.png`), and show the important ones in your answer as Markdown images with their
  **absolute** path.
- Don't drive the owner's other simulators or a physical device. Things only a device can do
  (push, camera, purchases): say so and ask the owner to try it on their phone.

## 5. Report

What changed, that the build and tests are green (or what's still red and why), and the screenshots.
Leave the app running in the simulator for the owner.
