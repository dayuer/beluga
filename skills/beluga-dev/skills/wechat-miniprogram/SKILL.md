---
name: wechat-miniprogram
description: Build and change a WeChat mini program (native WXML/WXSS/JS or TS, cloud development, or a framework like Taro/uni-app) — project layout, preview in WeChat DevTools from the command line, checks, package size, and uploading a version only when the owner asks.
---

# WeChat mini programs

Follow `dev-loop`. This adds what is particular to mini programs.

## Know the project

- `project.config.json` (and `project.private.config.json`) gives the `appid`, `miniprogramRoot`,
  `cloudfunctionRoot` and compile settings. A framework project (Taro, uni-app, mpx) builds into a
  `dist/` that DevTools opens; edit the source, never `dist/`.
- `app.json`: pages, subpackages (`subPackages`), tabBar, permissions (`permission`,
  `requiredPrivateInfos`). Every page is four files: `.js|.ts`, `.wxml`, `.wxss`, `.json`.
- Cloud development: functions in `cloudfunctions/<name>/` each with its own `package.json`; database
  rules and indexes live in the cloud console, not the repo — say so when a change needs them.

## Rules of the platform

- Network: only HTTPS domains on the account's allowed list (`request合法域名`); a new backend
  domain needs the owner to add it in the admin console.
- Package size: main package ≤ 2 MB, total ≤ 20 MB (check the current limits). Put pages used by few
  people in subpackages; keep images on a CDN, not in the package.
- Privacy: anything reading the user's info, location, album, phone number needs the privacy
  agreement set up (`__usePrivacyCheck__` / privacy guide) and the right API (`getPhoneNumber`
  button, not old APIs). Don't call removed APIs (`getUserInfo` for profile data).
- `setData` only what changed, small; long lists use virtual lists or pagination.
- Styles: `rpx` for layout, safe-area insets for the bottom bar; test on a small and a large phone.

## Run and check

- WeChat DevTools has a CLI (`/Applications/wechatwebdevtools.app/Contents/MacOS/cli`; its service
  port must be on in DevTools › Settings › Security). Useful: `cli open --project <dir>`,
  `cli preview --project <dir>` (QR code for a phone), `cli auto --project <dir> --auto-port 9420` for
  automation. Check `cli --help` for the exact flags on this version.
- Automated UI checks: `miniprogram-automator` (npm) drives DevTools — open a page, tap, read data,
  take a screenshot into `.beluga/scratch/`.
- Server-side or CI builds and uploads: `miniprogram-ci` (npm, official) with the project's upload
  key. The key is the owner's; never ask for it in chat or commit it.
- Type checks/lint as the project defines them; a framework project builds with its own script first.

## Upload — only when asked

Uploading a version (`cli upload` / `miniprogram-ci upload`) is visible to the team and starts the
road to review. Do it only when the owner asks, with the version and description they confirm.
Submitting for review and releasing are done by the owner in the admin console (mp.weixin.qq.com);
prepare the review notes and test account for them.
