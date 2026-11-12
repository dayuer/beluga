---
name: node-backend
description: Change a Node.js/TypeScript back end (Express, Fastify, Nest, Hono, workers) — API contracts, validation at the edge, database migrations that never lose data, tests against a real or local database, and deploys only when the owner asks.
---

# Node back ends

Follow `dev-loop`. This adds what is particular to servers.

## Know the project

- Framework, entry point, how config arrives (env vars, `.env` — read the names, never print values),
  the database and its migration tool (Prisma, Drizzle, Knex, TypeORM, plain SQL).
- How it's tested: unit tests, tests against a local database (Docker compose, a test container), API
  tests. Run them the way the project does.

## Rules

- **Validate at the edge.** Every input from outside (body, query, headers, webhooks) is checked with
  the project's validator (zod, class-validator, JSON schema) before use. Verify webhook signatures.
- **Contracts are promises.** Don't change a response's shape that clients use; add fields, version
  breaking changes. Update the OpenAPI/types the clients read.
- **Errors**: return the right status and a message a client can act on; log the cause, never secrets
  or personal data.
- **Security**: parameterized queries only, authorization on every route that touches someone's data,
  rate limits on login and public endpoints.
- **Migrations never lose data.** Add before remove; backfill in a step of its own; a destructive
  migration (drop, rename, type change) needs the owner's yes and a way back. Run migrations against a
  local/test database, never production from here.
- Long work goes to a queue or a scheduled job, not the request.

## Run and check

- Start the server locally, call the changed endpoint (curl/httpie) and show the request and
  response. Typecheck, lint, tests.
- Deploying (to a server, Cloudflare, Vercel…) reaches real users: only when the owner asks, with the
  project's own deploy command.
