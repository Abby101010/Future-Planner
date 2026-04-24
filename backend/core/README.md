# @starward/core

Shared wire types and pure helpers — imported by both `@starward/server`
and `@starward/desktop`. This package is the contract between the two
halves of the system.

## What lives here

- `src/protocol/` — the envelope protocol: `Envelope<T>`, the list of
  valid `view:*` and `command:*` kinds, and their request/response types.
- `src/types/` — shared domain types (`Goal`, `DailyTask`, `Reminder`,
  `CalendarEvent`, `UserProfile`, ...) and agent payload shapes.
- `src/domain/` — pure domain helpers that both sides need to reason
  about (e.g. `cognitiveBudget.ts`).
- `src/ai/` — prompt builders, sanitizers, and personalization helpers
  that run server-side but whose output shapes the client reads.
- `src/index.ts` — the public barrel.

## The one rule

**No I/O, no React, no Express, no Postgres.** Everything in this
package must be pure: take data in, return data out. If you're importing
`fetch`, `pg`, `express`, or `react`, you're in the wrong package.

## What NOT to put here

- Network transport code (belongs in `desktop/src/services/`).
- Express route handlers (belongs in `server/src/routes/`).
- React hooks or components.
- Database access.
