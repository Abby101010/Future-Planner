# backend/

NorthStar's cloud API. Deploys to Fly.io, talks to Supabase Postgres, and
mirrors the Electron IPC surface as HTTP routes so multiple desktop installs
can sync the same user state.

## Layout

```
backend/
├── src/
│   ├── index.ts         # Express entry, route registration, /health
│   ├── middleware/      # auth (sets req.userId), errorHandler
│   ├── routes/          # store, entities, ai, calendar, reminders,
│   │                    # monthly-context, model-config, chat, memory
│   ├── ai/              # Anthropic client + per-handler agents
│   ├── db/              # pg pool, schema.sql, migrate.ts
│   ├── domain/          # cognitiveBudget.ts (duplicated from frontend)
│   ├── memory.ts        # Per-user memory store + behavior profile
│   ├── reflection.ts    # runReflection / generateNudges / shouldAutoReflect
│   └── model-config.ts  # Per-user Claude model tier overrides
├── prompts/             # AI prompt design docs (reference, not loaded)
├── Dockerfile           # Multi-stage node:22-alpine — context: backend/
├── fly.toml             # northstar-api app config (region: yyz)
└── tsconfig.json        # rootDir: src, outDir: dist
```

## Multi-user-readiness

Every table in `db/schema.sql` carries `user_id text not null`. Every route
reads `req.userId` from `middleware/auth.ts` — **no route ever hardcodes a
user ID**. Phase 1 sets `DEV_USER_ID=sophie` as a Fly secret; phase 2 swaps
the middleware body for JWT verification with no schema or route changes.

## Local dev

```bash
cd backend
npm install
DATABASE_URL=postgresql://... \
ANTHROPIC_API_KEY=sk-ant-... \
DEV_USER_ID=sophie \
npm run dev
```

`npm run dev` uses `tsx watch` for hot reload. `npm run build` runs `tsc`
which emits to `dist/` (mirroring `src/`). `npm run migrate` runs
`src/db/migrate.ts` against `DATABASE_URL`.

## Deploy

```bash
cd backend
fly deploy -a northstar-api
```

The Dockerfile uses `backend/` as its own build context, so no parent paths
are needed. After deploy, run `node dist/db/migrate.js` once via
`fly ssh console` to apply any new schema changes.
