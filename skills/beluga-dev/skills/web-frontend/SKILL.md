---
name: web-frontend
description: Change a web front end (React, Vue, Svelte, TypeScript; Vite, Next.js, umi; antd, Tailwind…) — run its dev server, keep types and tests green, and check the page in a real browser at phone and desktop widths before calling it done.
---

# Web front ends

Follow `dev-loop`. This adds what is particular to web UIs.

## Know the project

- Package manager from the lockfile (`package-lock.json` npm, `pnpm-lock.yaml` pnpm, `yarn.lock`,
  `bun.lockb`); install with it, never mix.
- Scripts in `package.json`: `dev`, `build`, `typecheck`/`tsc`, `lint`, `test`, `e2e`. Use them.
- Find the design system before writing UI: the component library (antd, MUI, shadcn), tokens/theme
  files, existing components. A house component beats a new one; a token beats a hex value.
- Routing, state and data fetching: follow the pattern the app already uses.

## Write it well

- TypeScript strict as configured; no `any` to silence an error.
- Every async screen has loading, empty, error and success states.
- Accessible by default: real buttons and links, labels on inputs, focus visible, contrast.
- Text the user sees goes through the app's i18n if it has one.
- Don't fetch in a render loop; memo only what's measured to be slow.

## Run and look

- Start the dev server in the background (or Beluga's preview) and open the page in a browser
  (Playwright or the browser tool). Walk the changed flow.
- Screenshot at 375 px and 1280 px wide into `.beluga/scratch/`, light and dark if the app has both.
- Watch the console for errors and the network panel for failed requests.

## Checks

`typecheck`, `lint`, unit tests for logic, and the e2e for the flow you touched if the project has one.
`build` once at the end — a dev server that works is not a build that works.
