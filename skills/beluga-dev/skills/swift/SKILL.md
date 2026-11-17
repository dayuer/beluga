---
name: swift
description: Write Swift and SwiftUI the way a careful Apple-platform engineer would — concurrency, state, previews, localization, packages — for iOS and macOS apps and Swift packages. Pairs with ios-build-verify (beluga-apple) for building and checking an iOS app.
---

# Swift

Follow `dev-loop`; for an iOS app, build and check with `ios-build-verify`.

## Language

- Swift concurrency: `async`/`await`, `@MainActor` for UI state, actors for shared mutable state.
  Respect the project's Swift 6 strictness settings; fix data-race warnings, don't silence them with
  `@unchecked Sendable` unless you can say why it's safe.
- Value types by default; `final class` when identity matters.
- Errors: `throws` with typed or well-named errors; no `try!` outside tests; `fatalError` only for
  true programmer errors.
- Optionals: unwrap with `guard let`; no force unwrap of data from outside.

## SwiftUI

- State: `@State` for view-local, `@Observable` models (iOS 17+) or the project's existing pattern;
  don't mix patterns in one feature.
- Small views, extracted subviews; data flows down, actions up.
- Text in `Localizable.xcstrings` with literal keys; interpolate inside the literal.
- Every screen has loading, empty and error states; Dynamic Type and dark mode work.
- A `#Preview` for new views, with mock data.
- Gate APIs newer than the deployment target with `if #available`.

## Packages and tests

- Swift Package Manager: `swift build`, `swift test` for packages. Pin versions as the project does.
- Swift Testing (`@Test`, `#expect`) or XCTest — whichever the project uses.
