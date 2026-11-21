# Synon Studio app

The customer's phone-first app: sign in, write a request, watch the plan, approve and receive
delivery. Expo Router, one codebase; it ships to iOS and Android (no web build). Screens and their
rules are in `docs/studio-app-screens.md`; the daemon and hub are in `docs/studio.md`.

## Local dev

```sh
# Local hub (wrangler on :8787), fake daemon and seeded sample data; prints the LAN URL and
# the synon:// login link for a phone on the same Wi-Fi.
npm run dev:device

# The Expo dev server (:8081); with the hub above, open the app on a simulator or a phone.
npm start          # then press i / a, or scan the QR with Expo Go
npm run ios        # a native debug build on an iOS simulator / device
npm run android    # the same on Android
```

`EXPO_PUBLIC_HUB_URL` points the app at a hub (the deep-link host, magic links and push
registration all follow it). `EXPO_PUBLIC_DEMO=1` runs against the offline demo hub in `lib/demo/`.

## Checks

```sh
npm run typecheck
npm test               # vitest
npm run check:native   # the browser-global boundary scan
npm run e2e            # Maestro on an iOS simulator: real hub + fake daemon
```

## Release

**Version and build number have one source: `app.json`.** `expo.version` is the marketing version
(`CFBundleShortVersionString` / `versionName`); `expo.ios.buildNumber` and `expo.android.versionCode`
are the build numbers. A release script reads them, and `--bump` writes the next free number back
before building, so they are never set in two places.

Icons and the splash live in `assets/` and are wired through `app.json` (`icon`, `splash`,
`android.adaptiveIcon`, the `expo-splash-screen` plugin). `npx expo prebuild` generates `ios/` and
`android/` — both are git-ignored and never edited by hand. The privacy notice is
`docs/studio-privacy.md`; the same text is in the app under Me › Account › Privacy notice.

### iOS (TestFlight)

The studio's Apple team is **L9YRXEKYN2** (Hangzhou Yaoxing Intelligent Technology Co., Ltd.),
bundle ID **com.synon.studio**, signing with that team's Apple Distribution certificate.

```sh
node scripts/build-ios.mjs check                 # tools, team, certificate, version and next number
node scripts/build-ios.mjs archive --bump        # prebuild, archive, export dist/ios/Synon-Studio-<version>-<build>.ipa
CONFIRM_UPLOAD=yes ASC_APP_ID=<id> GROUP="<group>" node scripts/build-ios.mjs upload
```

`upload` is an outward action: it uses up the build number and shows the build to testers, so the
script refuses without `CONFIRM_UPLOAD=yes`.

Signing has two modes. `IOS_SIGNING=automatic` (the default) needs an Apple account signed in under
Xcode › Settings › Accounts — then Xcode fetches the profile itself. On a build machine without that
account, install the App Store profile once and use manual signing:

```sh
asc profiles create --name "Synon Studio App Store" --profile-type IOS_APP_STORE \
  --bundle <bundle-id-id> --certificate <distribution-cert-id>
asc profiles download --id <profile-id> --output /tmp/SynonStudio.mobileprovision
asc profiles local install --path /tmp/SynonStudio.mobileprovision
IOS_SIGNING=manual node scripts/build-ios.mjs archive
```

The App ID needs the **Push Notifications** capability (`asc bundle-ids capabilities add
--bundle <id> --capability PUSH_NOTIFICATIONS`) because the app registers APNs tokens.

> Publishing to TestFlight also needs an App Store Connect **app record** for `com.synon.studio`.
> Creating one is the owner's step (Apple only exposes it in the web UI). Until it exists there is no
> `ASC_APP_ID`, and `upload` will stop and say so. The exported IPA is still valid and can be uploaded
> later with the same command.

### Android (self-signed APK)

```sh
node scripts/build-apk.mjs           # prebuild, gradle assembleRelease, check the signer, copy to dist/
node scripts/build-apk.mjs --bump    # app.json's android.versionCode +1 first, for an update build
```

The APK is `dist/Synon-Studio-<version>.apk`, named after `expo.version`, signed with **Synon
Studio's own key** — never Beluga's (`signing.json` holds its certificate fingerprint and the script
refuses anything else). The keystore is `~/.synon-release/synon-studio-android.p12` on the build Mac,
its password in the Keychain as `synon-studio-android-release`; `SYNON_STUDIO_ANDROID_KEYSTORE` and
`SYNON_STUDIO_ANDROID_KEY_PASSWORD` override both. Back it up: a phone only accepts updates signed
with the same key, so losing it means uninstall-and-reinstall everywhere.

Install on a phone that never had the app with `adb install dist/Synon-Studio-<version>.apk` (or
send the file — Android asks to allow installs from that source). The plugin in
`plugins/release-signing.js` wires the key into the generated `android/` project; without the key a
release build falls back to the debug key and the script then fails on purpose.
