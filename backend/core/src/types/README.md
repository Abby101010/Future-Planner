# core/src/types/

Shared TypeScript domain types used by both desktop and server:
`Goal`, `GoalPlan`, `DailyTask`, `DailyLog`, `Reminder`, `CalendarEvent`,
`UserProfile`, `UserSettings`, `MemoryStore`, etc. Plus agent-specific
shapes in `agents.ts`.

## The one rule

**Structural types only — no classes, no behaviour.** These types
describe the wire format and the shared view layer; any methods or
computations belong in `../domain/` or the relevant package-side
helper.

## What NOT to put here

- Zod / runtime validators (pure TS types only — the server validates
  at its own boundaries, the client trusts).
- React props — those live in the component file.
- Database row types with `created_at: Date` — keep wire shapes in
  strings (ISO) so they survive JSON round-trips.
