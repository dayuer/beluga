---
name: testflight-publish
description: Put a signed build of an iOS app on TestFlight with asc and get it to testers — only when the owner asks for it. Covers the build number, archive and export, upload, groups and what to tell testers.
---

# Publish to TestFlight (only when asked)

Uploading is visible to other people and uses up a build number, so do it only when the owner asks
("put it on TestFlight", "send it to testers"). Read `asc-basics` first.

## Steps

1. **Green first.** The app builds and its tests pass (`ios-build-verify`). Commit what's shipping.
2. **Which app and group.** `asc apps list --output table` for the app's ID; `asc testflight groups list
   --app APP_ID --output table` for groups. Missing an app in App Store Connect? Creating one is the
   owner's call: ask before `asc web apps create`.
3. **Build number.** `asc builds next-build-number --app APP_ID --version <marketing version>`, and
   set it in the project for this build (agvtool or the build setting) — don't reuse one.
4. **Archive and export** with the project's own signing (Automatic signing with the owner's team, or
   what the project's CI uses). If signing fails because of certificates or profiles, stop and tell the
   owner what's missing; don't create or revoke certificates on your own.
   ```bash
   xcodebuild archive -scheme <S> -destination 'generic/platform=iOS' -archivePath .beluga/scratch/App.xcarchive
   xcodebuild -exportArchive -archivePath .beluga/scratch/App.xcarchive -exportPath .beluga/scratch/export -exportOptionsPlist <ExportOptions.plist>
   ```
5. **Upload and hand out.**
   `asc publish testflight --app APP_ID --ipa .beluga/scratch/export/<App>.ipa --group "<Group>" --wait`
   — it uploads, waits for processing and adds the build to the group.
6. **External testers** need Beta App Review: only on the owner's word, with the review contact and,
   if the app has sign-in, a demo account they give you. Add `--submit --confirm` then.

## Tell the owner

Version and build number, the group, and for testers: install TestFlight, accept the invitation,
install the build. If only the group step failed, finish that from the uploaded build instead of
uploading again.
