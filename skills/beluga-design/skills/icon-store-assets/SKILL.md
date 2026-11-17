---
name: icon-store-assets
description: Make an app icon (iOS layered Icon Composer icon plus a flat 1024 PNG, Android adaptive icon, mini program logo, favicon), store screenshots with captions, and a simple landing page — checked by rendering every size and look. Use when the owner needs an icon, store listing images, or a page for the app.
---

# Icons and store assets

## App icon

- One idea, one shape, readable at 29 pt: no text, no screenshots, no fine detail. Two or three
  directions as quick renders first; build the one the owner picks.
- **iOS / macOS (current systems)**: an Icon Composer `.icon` package in the app's source — the
  background as the document fill, the foreground as separate transparent SVG/PNG layers, glass and
  highlights left to the system (never painted in). Render every look with Apple's `ictool` (inside
  Xcode's Icon Composer: Default, Dark, Tinted, Clear) and look at each; fix until all read well. Keep
  an opaque 1024×1024 flattened PNG in the app icon set for older systems and listings.
- **Android**: adaptive icon (foreground + background layers, 108 dp with the 66 dp safe zone) and a
  monochrome layer for themed icons.
- **WeChat mini program**: square logo, clear at small size, set in the admin console by the owner.
- **Web**: SVG favicon plus 180 px apple-touch-icon and 192/512 px PNGs in the manifest.

## Store screenshots

- Take them from the real app at the store's required device sizes (simulator/emulator), with
  realistic data — never mock what the app can't do.
- Order tells a story: the main benefit first, one idea per image. A short caption per image in each
  listing language (Chinese and English captions are written, not translated word for word).
- Generate the framed, captioned images with a script (so they can be redone after a UI change), into
  `.beluga/scratch/store/<locale>/`, at the exact pixel sizes the store asks for.
- Uploading them (`asc` for the App Store) reaches the store: only when the owner asks.

## Landing page

One page: the app's name and one-line promise, the main screenshots, three benefits, download/QR
buttons, privacy policy and contact links (stores require them). Built with the project's web stack or
plain HTML, checked at phone and desktop widths. Publishing it is the owner's call.
