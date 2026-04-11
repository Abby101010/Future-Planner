# backend/src/

All TypeScript source for the cloud API. `tsc` compiles this into `../dist/`
mirroring the directory structure.

| Subdir / file | Role |
|---|---|
| `index.ts` | Express bootstrap — loads `.env`, mounts middleware, registers every route, exposes `/health`, starts listening on `PORT` |
| `middleware/` | Cross-cutting request plumbing — `auth.ts` is the only place `req.userId` is set; `errorHandler.ts` wraps async handlers and emits `{ ok, error }` envelopes |
| `routes/` | One file per IPC domain. Each file is a thin Express router whose handlers query Postgres and return the same `{ ok, ... }` shape the renderer's repositories expect |
| `ai/` | Anthropic SDK client + per-task handler functions (classify-goal, daily-tasks, recovery, pace-check, home-chat, etc.) |
| `db/` | `pool.ts` (pg connection pool), `schema.sql` (Postgres schema, every table user_id-scoped), `migrate.ts` (one-shot runner) |
| `domain/` | `cognitiveBudget.ts` — single source of truth for the cognitive-load budget rules. Duplicated into `frontend/electron/domain/` |
| `memory.ts` | Per-user memory store (facts, preferences, signals, snooze records, task timings) + behavior profile read/write |
| `reflection.ts` | Reflection pipeline — runs Haiku over recent signals to extract facts/preferences, plus the 7-rule nudge engine |
| `model-config.ts` | Per-user Claude tier overrides ("light"/"reasoning") read from `app_store` |
| `database.ts` | Misc helper queries that don't belong to a single domain (e.g. `getMonthlyContext`) |

## Conventions

- **Every query is `user_id`-scoped.** Never write a `where` clause without `user_id = $1`.
- **Response envelope is byte-identical to the IPC shape:** `{ ok: true, ... }` or `{ ok: false, error }`. The renderer's `cloudTransport` destructures these directly with no translation layer.
- **No client-generated persistent IDs.** Routes that create entities call `randomUUID()` and return the new entity with the server-assigned ID.
