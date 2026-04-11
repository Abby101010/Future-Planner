# frontend/electron/db/

Local `better-sqlite3` database. Lives at
`~/Library/Application Support/NorthStar/northstar.db` on macOS.

## Role after Phase 1b

In normal cloud mode this database is **mostly unused** — every channel in
`frontend/src/services/cloudTransport.ts` flows over HTTP to the Fly
backend instead. The local DB is kept around as:

1. An offline fallback for `app_store` (so the app boots if the cloud is
   unreachable)
2. The backing store for the few channels that intentionally stay local
   (device calendar bridge, environment, local-only chat sessions)
3. Dev iteration without hitting the cloud

## Files

| File | Purpose |
|---|---|
| `connection.ts` | Opens the SQLite handle, applies pragmas |
| `migrations.ts` | Idempotent schema setup. Mirrors `backend/src/db/schema.sql` for the tables that still exist locally |
| `helpers.ts` | Small query helpers (`get`, `all`, `run`) |
| `appStore.ts` | `app_store` key/value table — JSON snapshot fallback |
| `calendar.ts` | Local in-app `calendar_events` |
| `chat.ts` | Local `chat_sessions` + `chat_attachments` |
| `memory.ts` | Memory tables (facts, prefs, signals, snooze, timings, meta) |
| `monthlyContext.ts` | `monthly_contexts` table |
| `reminders.ts` | `reminders` table |
| `semanticSearch.ts` | Naive token-overlap search over memory facts |

## What was removed

`job_queue` and the local job runner were deleted in slice 6 — AI dispatch
is cloud-only now. If you see references to `job:*` channels, they should
be ripped out, not re-added.

## Keeping in sync

When you add a column to a Postgres table in `backend/src/db/schema.sql`,
add the same column here in `migrations.ts` **only if** the local copy of
that table still exists. Otherwise leave it alone — the cloud is
authoritative.
