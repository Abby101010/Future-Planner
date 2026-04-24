# server/src/

All TypeScript source for the cloud API. `tsc` compiles this to
`../dist/` mirroring the directory structure.

## Layout

| Subdir / file | Role |
|---|---|
| `index.ts` | Express bootstrap — loads `.env`, mounts middleware, registers routes, exposes `/health`, starts the WS server |
| `middleware/` | `auth.ts` (sets `req.userId`) and `errorHandler.ts` (async wrapper + envelope) |
| `routes/` | `views.ts` (dispatches `view:*`), `commands.ts` (dispatches `command:*`), plus a few legacy HTTP endpoints |
| `views/` | Pure read builders — one file per `view:*` kind |
| `repositories/` | Thin SQL wrappers, one per table. The ONLY place raw pg queries live |
| `ai/` | Anthropic client + per-agent handlers (classify-goal, daily-tasks, recovery, pace-check, home-chat, etc.) |
| `ws/` | WebSocket server + `view:invalidate` broadcast bus |
| `db/` | `pool.ts`, migration loader, schema helpers |
| `domain/` | Pure helpers duplicated from `@starward/core` where server-specific shaping is needed |

## The one rule

**Reads = views, writes = commands, no SQL anywhere else.** Views return
a fully-shaped payload per screen. Commands take typed input, mutate
via a repository, and emit `view:invalidate` over the WS bus. Never
inline `pool.query()` in a route handler — go through a repository.

## What NOT to put here

- Anthropic calls outside `ai/`.
- Raw `pool.query()` outside `repositories/`.
- Routes that hardcode a user id — always read from `req.userId`.
- Response shapes that differ from `Envelope<T>` in `@starward/core`.
