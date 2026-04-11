# backend/src/db/

Postgres connection + schema. Backed by Supabase (free tier in phase 1).

## Files

- **`pool.ts`** — exports `getPool()` and `query<T>(sql, params)`. Uses the
  Supabase **pooler** URL (port 6543) so we share connections across Fly
  machines without exhausting the upstream connection limit. Closes the
  pool gracefully via `closePool()` for the migrate script.
- **`schema.sql`** — the canonical Postgres schema. Idempotent (every
  `create table` uses `if not exists`, every `add column` uses
  `if not exists`, and altered constraints are wrapped). Re-running it is
  always safe — that's how migrations work.
- **`migrate.ts`** — one-shot runner that reads `schema.sql` and runs it
  against `DATABASE_URL`. Used both in local dev (`npm run migrate`) and
  in production (`fly ssh console -C "node dist/db/migrate.js"`).

## Multi-user-readiness

**Every table has `user_id text not null` from day 1.** Phase 1 hardcodes
`user_id = 'sophie'`; phase 2 will read it from a verified JWT. Adding the
column now is free; adding it later would require a migration + backfill
across every table.

Composite primary keys are `(user_id, id)` so per-user lookups are O(log n)
on a single B-tree index, and so two users can never collide on the same
generated UUID.

## Tables

| Table | Purpose |
|---|---|
| `app_store` | Top-level app snapshot (key/value JSON). Renderer calls `store:load` once on startup and `store:save` on every mutation |
| `calendar_events` | In-app events (separate from macOS Calendar bridge) |
| `chat_sessions` | Home chat history. `messages` is `jsonb` |
| `chat_attachments` | Attachment bytes inline as `bytea` (slice 5 — no separate object store) |
| `reminders` | One-shot or repeating reminders surfaced in the dashboard |
| `monthly_contexts` | Per-month intensity / capacity profile |
| `memory_facts` | Long-term observed facts about the user (high-confidence reflection output) |
| `memory_preferences` | Tagged preferences with EMA-blended weight |
| `memory_signals` | Short-term events (task completed/snoozed/skipped/blocker reported, ...) — feed reflection |
| `memory_snooze_records` | Per-task snooze counters used by the chronic-snooze nudge |
| `memory_task_timings` | Estimate vs actual minutes for calibration |
| `memory_meta` | Per-user reflection counters + last-reflection timestamp |
| `job_queue` | **Unused** — kept in schema for old installs but never read or written. Slice 6 deleted the local queue and pushed AI calls straight to the cloud |
