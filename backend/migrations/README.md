# server/migrations/

Numbered SQL files applied in order by `db/migrate.ts`. The numeric
prefix is the ordering and also the `version` column stored in
`schema_migrations`.

## Conventions

- Filenames are `NNNN_short_description.sql` — four-digit prefix.
- Each file must be **idempotent within a single apply** (use
  `create table if not exists`, `add column if not exists`, etc.) so
  a mid-migration crash can be safely retried.
- **Never rewrite a committed migration.** Once it's merged to main,
  add a new numbered file to alter or revert. The migration runner
  treats the committed order as the canonical timeline.
- Every table must include `user_id text not null` and a composite
  PK `(user_id, id)` — multi-tenant from day one.

## The one rule

**Every table is `user_id`-scoped.** No exceptions. Phase 1 sets
`DEV_USER_ID=sophie`; phase 2 swaps the auth middleware for JWT
verification with zero schema changes.

## What NOT to put here

- Data seeds — migrations change schema, not data. If you need
  fixtures, add a separate seed script.
- Application logic — migrations are plain SQL, no stored procedures
  or business rules.
