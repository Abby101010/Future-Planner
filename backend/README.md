# @starward/server

Starward's cloud API. Express + Postgres + Anthropic, deploys to
Fly.io, talks to Supabase Postgres, and speaks the envelope protocol
from `@starward/core`.

## Layout

```
server/
├── src/
│   ├── index.ts         # Express entry, route registration, /health, WS upgrade
│   ├── middleware/      # auth (sets req.userId), errorHandler
│   ├── routes/          # views.ts, commands.ts, auth.ts, legacy endpoints
│   ├── views/           # One file per `view:*` — pure read-only builders
│   ├── repositories/    # SQL wrappers (one per table) — the only place pg queries live
│   ├── ai/              # Anthropic client + per-agent handlers
│   ├── ws/              # WebSocket invalidation bus
│   ├── db/              # pg pool, schema helpers, migrate.ts
│   └── domain/          # Duplicated pure helpers (e.g. cognitiveBudget.ts)
├── migrations/          # Numbered .sql files, applied in order by migrate.ts
├── prompts/             # AI prompt design docs (reference, not loaded)
├── Dockerfile           # Multi-stage node:22-alpine — context: server/
└── fly.toml             # starward-api app config (region: yyz)
```

## The one architectural rule

**All reads go through `views/`, all writes go through `commands.ts`.**
Every `view:*` is a pure SQL query that builds the full response for
one client screen. Every `command:*` takes a typed input, writes to
Postgres, and broadcasts a `view:invalidate` over the WebSocket bus so
clients refetch.

## Multi-user-readiness

Every table in `src/db` carries `user_id text not null`. Every route
reads `req.userId` from `middleware/auth.ts` — no route ever
hardcodes a user ID. Phase 1 sets `DEV_USER_ID=sophie` as a Fly secret;
phase 2 swaps the middleware body for JWT verification with no schema
or route changes.

## Local dev

```bash
npm --workspace @starward/server run dev
```

`npm --workspace @starward/server run build` emits to `dist/`.
`npm --workspace @starward/server run migrate` applies any new
numbered `.sql` files in `migrations/`.

## Deploy

```bash
cd packages/server && fly deploy -a starward-api
```
