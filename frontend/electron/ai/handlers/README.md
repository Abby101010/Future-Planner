# frontend/electron/ai/handlers/

One file per local AI task. Each handler exports a function that takes a
typed payload, calls the Anthropic SDK via `../client.ts`, and returns a
JSON-serializable result.

These are **only used in offline/dev mode**. In normal cloud mode the
renderer routes AI calls directly to `https://northstar-api.fly.dev/ai/*`,
which runs the line-for-line ports under `backend/src/ai/handlers/`.

## Handlers

| File | Task | Notes |
|---|---|---|
| `onboarding.ts` | Initial profile build | Reads sanitized onboarding answers |
| `classifyGoal.ts` | Classify goal type | Returns one of the three goal types |
| `goalBreakdown.ts` | Decompose a goal into milestones | |
| `generateGoalPlan.ts` | Full plan generation | Used by GoalPlanPage |
| `goalPlanChat.ts` | Plan-editing chat | Streaming-capable |
| `goalPlanEdit.ts` | Apply a plan edit | |
| `dailyTasks.ts` | Daily task generation | Imports `cognitiveBudget` from `../../domain/` |
| `homeChat.ts` | Home page chat | |
| `reallocate.ts` | Dynamic reallocation | When the user falls behind |
| `paceCheck.ts` | Pace check | |
| `recovery.ts` | Recovery suggestions | |
| `analyzeMonthlyContext.ts` | Monthly intensity profile | |
| `analyzeQuickTask.ts` | Quick task classifier | |

## Adding a handler

1. Add the canonical version under `backend/src/ai/handlers/` first.
2. Mirror it here only if offline mode needs it.
3. Register the task name in `../router.ts`.
4. Wire it into `../../ipc/ai.ts` so the IPC channel reaches it.
