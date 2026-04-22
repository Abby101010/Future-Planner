# Repositories (Phase 4a)

Thin, typed data-access layer for the new per-entity Postgres tables
(migration `0002_entity_tables.sql`) plus wrappers over the legacy tables
that have a clean one-to-one shape (`calendar_events`, `monthly_contexts`,
`reminders`, `chat_sessions`).

## Layering

```
routes / view resolvers / command handlers   (Task 12/13/14)
              │
              ▼
        repositories/*                        ◀── you are here
              │
              ▼
           db/pool.ts (parameterized query)
              │
              ▼
            Postgres
```

- **Routes MUST NOT** talk to `pool` directly once cutover is done.
- **Repositories MUST NOT** import anything from `routes/`.
- **No business logic** in repositories. They do CRUD and row ↔ domain-type
  mapping only. Any computation (progress roll-ups, budget checks,
  permission checks beyond user_id) belongs in a handler one layer up.

## userId comes from AsyncLocalStorage — never from the caller

Every repository function calls `requireUserId()` internally:

```ts
import { requireUserId } from "./_context";

export async function list(): Promise<Goal[]> {
  const userId = requireUserId();
  const rows = await query<GoalRow>(
    "select * from goals where user_id = $1 order by updated_at desc",
    [userId],
  );
  return rows.map(rowToGoal);
}
```

`requireUserId()` reads the current `AsyncLocalStorage` context set by
`authMiddleware` → `runWithUserId(...)` and throws
`UnauthenticatedError` (status 401) if nothing is there. Callers must
not thread `userId` through function signatures — if you're tempted to,
you're probably trying to run a repo call outside a request context, and
that is a bug you should fix at the call site.

## Security invariant: every query is user-scoped

Every SELECT / UPDATE / DELETE / INSERT in this layer MUST:

1. Use parameterized placeholders (`$1`, `$2`, …). No string interpolation
   of any value, especially not `userId`.
2. Include `user_id = $1` in the WHERE clause (SELECT/UPDATE/DELETE) or
   `user_id` in the INSERT column list.

This is load-bearing for multi-tenancy. Do not skip it on "internal"
queries — there are no internal queries here.

## Row ↔ domain-type mapping

Each repo owns a private `rowToX(r)` function that converts a
snake_case DB row into the canonical `@northstar/core` type (or a
repo-local interface when core doesn't model it yet).

Stable fields → typed columns. Variable / hierarchical / level-specific
fields → the table's `payload` jsonb column, which round-trips through
`JSON.stringify` / `parseJson` (imported from `./_json`). See
`goalsRepo.ts` (`goalToPayload` helper) for the canonical pattern.

**Convention: every entity table's jsonb column is named `payload`.** The
`goals` table was originally `metadata`; migration 0003 renames it to
match. Do not reintroduce `metadata` on new tables.

**Convention: `parseJson` is shared.** Import it from `./_json` — do not
re-inline the 10-line helper per repo.

**Return-type policy.** A repo returns the `@northstar/core` type directly
**only when the core type is 1:1 with the DB row shape** (no extra fields
the DB doesn't have, no renamed fields, no computed joins). Otherwise the
repo exports a local `*Record` interface from the same file and view
resolvers map it to whatever the client expects.

Concretely: return core if (a) every core field has a column or a
payload key, (b) the field names match after snake→camel, and (c) no
other table needs to be joined to build it. Return a local record if
any of those are false — do not try to force the core shape.

Repos and what they return:

| Repository              | Returns                                           |
| ----------------------- | ------------------------------------------------- |
| `goalsRepo`             | `Goal`                                            |
| `goalPlanRepo`          | Local `GoalPlanNode` + pure `reconstructPlan` → `GoalPlan` |
| `dailyLogsRepo`         | Local `DailyLogRecord` (no `tasks` — joined in view layer) |
| `dailyTasksRepo`        | Local `DailyTaskRecord` (has `date` + `goalId`)   |
| `pendingTasksRepo`      | Local `PendingTaskRecord`                         |
| `heatmapRepo`           | `HeatmapEntry`                                    |
| `chatRepo`              | `HomeChatMessage`, `ChatSession`, local `ConversationRecord` |
| `monthlyContextRepo`    | `MonthlyContext`                                  |
| `calendarRepo`          | `CalendarEvent`                                   |
| `remindersRepo`         | `Reminder`                                        |
| `nudgesRepo`            | Local `NudgeRecord` (maps to `ContextualNudge` in the view layer) |
| `vacationModeRepo`      | Local `VacationModeState`                         |
| `behaviorProfileRepo`   | Local `BehaviorProfileEntry`                      |

Local types are exported from the repo file so view resolvers can import
them by name.

## What repositories do NOT do

- No caching.
- No transactions that span multiple repositories. If a caller needs
  atomic cross-aggregate writes they will take a `pg.Pool` client and do
  it themselves — we have no evidence yet that we need this and YAGNI
  applies.
- No event emission / websocket broadcasts. That happens in the command
  handler layer (Task 14).
- No permission checks beyond user_id scoping.
- No route wiring. Task 13/14 will swap routes over from direct `pool`
  calls to repository calls as a separate PR.

## Conventions

- CommonJS module, relative imports, no `.js` suffix on imports (this is
  the `packages/server` package — see `tsconfig.json`).
- `delete` is a reserved word, so repos export `remove` and also re-export
  it as `delete_` for callers who want a descriptive name.
- `reconstructPlan` in `goalPlanRepo` is a PURE helper — it takes flat
  rows and returns a nested `GoalPlan`. View resolvers should call
  `listForGoal` and then `reconstructPlan` themselves; we don't bake
  the reconstruction into the repo call because it's common to want the
  flat rows for diffing / partial updates.

## Barrel usage

```ts
import * as repos from "../repositories";

const goals = await repos.goals.list();
await repos.dailyTasks.toggleCompleted(taskId);
const plan = repos.goalPlan.reconstructPlan(
  await repos.goalPlan.listForGoal(goalId),
);
```
