# Synon Studio hub

The Cloudflare shell for Synon Studio (docs/studio-hub.md): a Worker with D1 for accounts, one
SQLite-backed Durable Object per studio for the view cache and the action queue, and the admin page.
**All rules live in `src/net/studio/`** (handler, session, accounts, queue, views); this package only
picks the Durable Object, stores rows, merges the admin detail with online state and closes sockets.

BLG-62 chose **local `wrangler dev`** for P1: no Cloudflare account and no real `database_id` until a
later deploy.

## Local

```console
$ cd packages/studio-hub
$ npm install
$ npx wrangler d1 execute synon-studio --local --file schema.sql
$ cp .dev.vars.example .dev.vars
$ npx wrangler dev --persist-to .wrangler/state
```

`http://localhost:8787` is the hub. `.wrangler/state/` keeps D1 and every Durable Object across
restarts; delete it to start clean.

`.dev.vars` (not committed):

| Variable | What |
|---|---|
| `OPERATOR_TOKEN` | the admin page's bearer token; hash-compared in the rules |
| `MAIL_MODE` | `outbox` by default (links in D1, shown on the admin page); `console` only logs "link issued", never the token |
| `HUB_ORIGIN` | the public origin used in magic links (`http://localhost:8787` locally); required for links — with no absolute http(s) origin here, the hub refuses to issue one instead of trusting the request Host |
| `PREVIEW_SECRET` | P2 only; P1 never signs a preview link |

## Routes

See docs/studio-hub.md §6. In short:

- `GET /` admin page (BLG-61), `GET /healthz`
- `POST /v1/link` (one-time code + Ed25519 proof), `GET /v1/daemon/ws` (signed socket; BLG-65)
- `POST /v1/login`, `POST /v1/login/verify`, `POST /v1/logout`, `GET /v1/app/projects`
- `/v1/admin/*` behind `Authorization: Bearer <OPERATOR_TOKEN>`
- `/v1/app/projects/:pid/plans`, `…/plans/:ref`, `…/turns`, `…/actions`, `…/ws` (BLG-65), `…/previews/:m` (always 403)

Every studio route is resolved to a studio through D1 and forwarded to that studio's
`StudioHub` Durable Object with an internal `x-studio-auth` identity. The DO re-checks membership
and, for a daemon, the signature and replay.

## Deploy (later)

When P1 gets a public home: `wrangler login`, `wrangler d1 create synon-studio`, put the returned
`database_id` in `wrangler.toml`, `wrangler d1 execute synon-studio --remote --file schema.sql`,
`wrangler secret put OPERATOR_TOKEN`, set `HUB_ORIGIN` to the deployed URL (without it, magic links
are refused), `wrangler deploy`. Free plan: D1 plus SQLite Durable Objects
(`new_sqlite_classes`), the same as `packages/mailbox`.
