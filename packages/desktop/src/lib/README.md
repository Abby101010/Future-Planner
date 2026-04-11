# desktop/src/lib/

Pure helper modules. Just `goalPlanHelpers.ts` right now —
`computeMilestoneProgress` takes a `GoalPlan` and returns the per-
milestone progress rows used by `GoalPlanPage`.

## The one rule

**Pure functions only — no React, no I/O.** If a helper needs a hook,
it belongs in `../hooks/`. If it needs to call the server, it belongs
in `../services/` (or ideally a new view).

## What NOT to put here

- React components or hooks.
- Network transport.
- Anything stateful — pure in, pure out.
