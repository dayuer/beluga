# Synon Studio app (P1: web)

The customer's phone-first web app: sign in, see projects, add a request. Expo Router, one code
base; P1 builds for web only (native iOS/Android is P2).

## Local dev

```sh
# 1. The hub (packages/studio-hub), on :8787
npm run dev --prefix ../studio-hub

# 2. The app's dev server, on :8081
npm run web

# 3. The same-origin proxy, on :8790
npm run proxy        # add --dist to serve ./dist instead of the Expo dev server
```

Open <http://localhost:8790>. Put `HUB_ORIGIN=http://localhost:8790` in
`packages/studio-hub/.dev.vars` so a magic link lands on the app's `/login`.

**Why the proxy:** the hub has no CORS and its magic links are `<HUB_ORIGIN>/login#token=…`. In
development the proxy makes `/v1/*` (HTTP and WebSocket) and the app share one origin. This is a
development-only arrangement: in P2 the Worker must host the app (or route the same origin), or
the link will land on the wrong host. The hub deliberately does not enable CORS.

## Checks

```sh
npm run typecheck
npm run export       # static web build in dist/
npm run e2e          # Playwright flow, when e2e/ exists (BLG-86)
```
