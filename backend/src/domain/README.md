# backend/src/domain/

Domain logic that encodes NorthStar's product rules. This directory exists
on **both** sides of the system:

- `backend/src/domain/cognitiveBudget.ts` (this file)
- `frontend/electron/domain/cognitiveBudget.ts` (sibling copy)

## Why duplicated, not shared

The frontend and backend communicate **only via the cloud HTTP API**. They
agree on the wire format, not on TypeScript source. Sharing a single file
across both sides would re-introduce the coupling we removed in the
folder reorg, and the build context for `backend/Dockerfile` would have to
reach back outside `backend/` again.

`cognitiveBudget.ts` is small (~150 lines), rarely changes, and is the only
piece of logic both sides genuinely need to agree on. The duplication cost
is near-zero.

**If you change one copy, change the other.** A future test could lock
this in by hashing the two files at CI time.

## What it defines

- `COGNITIVE_BUDGET` — the daily budget object: `maxWeight: 12`,
  `maxMinutes: 180`, `maxTasks: 5`. The dashboard's progress bars use these
  three numbers as the denominator.
- `enforceBudgetSnake(tasks)` — drops tasks until the proposed list fits
  inside the budget. Used by `daily-tasks` to refuse to suggest a 6th task.
- `bonusTaskFits(tasks, candidate)` — quick predicate for "does adding this
  one task still fit?"
- `downgradeIfOverBudget(priority, currentLoad)` — used by `entities/new-task`
  to silently bump a "high" task to "medium" if today is already full.
