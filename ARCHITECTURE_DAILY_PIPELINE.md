# Daily Mutation Pipeline — Architecture

Last updated: 2026-04-26 (latest revision).

## Top-level invariant (added 2026-04-26 PM)

**Chat is conversational. The AI MUST NOT mutate state silently. Every action it proposes goes through `pending_actions` and requires explicit user confirmation via `command:accept-pending-action`.**

Default behavior since 2026-04-26: the chat handlers (`/ai/home-chat/stream`, `/ai/chat/stream`) read `STARWARD_CHAT_AUTO_DISPATCH`. When unset (default), AI-emitted intents are written to `pending_actions` instead of being returned in the SSE `done` payload. The FE has nothing to auto-dispatch; users see proposals as `proactive` nudges (body text describes the action) or — once the next release ships — as Accept/Reject cards.

Setting `STARWARD_CHAT_AUTO_DISPATCH=1` is an emergency rollback that restores the prior auto-dispatch behavior. Do not enable it as a normal operating mode.

`command:reject-pending-action` marks the row rejected without mutating state. **The chat session continues** — rejection metadata is queryable via `pendingActionsRepo.listRecentRejectionsForSession(sessionId)` so the AI's next turn can react conversationally ("Understood — what would you prefer instead?").

Watchdog: every `runStreamingHandler` call (the chokepoint for Anthropic streaming) races against a 120s timeout. On expiry, throws `chat_timeout: ...` so the SSE error path runs and the FE's `finally` clears the `streaming` flag.

---

This document defines the contract that every command handler mutating a `daily_tasks` row must follow. It exists because, prior to 2026-04-26, the post-mutation side-effect chain was scattered across handlers — each one decided independently which fire-and-forget services to dispatch — and that scatter caused real bugs (stale calendar views after skip, missing duration estimates after update, plan-tree drift after reschedule).

## The contract (one sentence)

**Every command handler that creates, updates, deletes, completes, skips, or reschedules a `daily_task` MUST dispatch `fireDailyMutationPipeline(date | dates, kind)` for the affected date(s) before returning.**

## Where it lives

`backend/src/services/dailyMutationPipeline.ts`

```ts
export type MutationKind = "create" | "update" | "toggle" | "skip" | "delete" | "reschedule" | "materialize";

export function fireDailyMutationPipeline(dates: string | string[], kind: MutationKind): void;
```

## What it dispatches today

For each affected date:

1. **`fireLightTriage(date)`** — `services/dailyTriageDispatch.ts` → `services/dailyTriage.ts:lightTriage`
   - Annotates new rows with tier / cognitiveCost / cognitiveLoad via `priorityAnnotator`
   - Re-sorts the day deterministically by (tier, cognitiveCost desc)
   - Auto-caps the active list at `COGNITIVE_BUDGET.MAX_DAILY_TASKS`, demoting overflow to bonus
   - Emits an `overwhelm` nudge if must-do shielding makes the cap unreachable
   - Emits `view:invalidate` so connected clients refetch

2. **`fireEstimateDurations(date)`** — `services/dailyEstimateDispatch.ts` → `cmdEstimateTaskDurations`
   - Filters today's tasks to ones where `estimatedDurationMinutes IS NULL`
   - Single batched LLM call to populate estimates
   - Skips entirely when every row is already estimated (no LLM cost)

Both fire-and-forget via `setImmediate`. Caller-perceived latency unchanged.

## What it deliberately does NOT include

- **`rotateNextTask`** — completion-specific (frees a slot, picks the next task by tier + bonus rules). Pipelining it would fire on every mutation including non-completions, which would burn cycles. `cmdToggleTask` keeps its own `rotateNextTask` call inline.
- **`agents/scheduler.ts:runScheduler`** — one Haiku call per dispatch is too expensive for every mutation. Add to the pipeline once either (a) the L1+ classifier wires it conditionally, or (b) the `gapFiller` deterministic path becomes the default scheduler. Token-cost decision pending Phase A telemetry.
- **Per-goal pace recompute** — `repos.goals.setPaceSnapshot` runs inside `cmdAdaptiveReschedule`. Adding it to every mutation would over-compute; pace updates on completion are already implicit in `recordTaskCompleted`.

## Cross-day mutations

Pass an array. Each date triggers an independent triage + estimate pass.

```ts
// reschedule from A → B
fireDailyMutationPipeline([originalDate, targetDate], "reschedule");
```

This is what makes both the source day (one less task) and target day (new arrival) re-triage and re-estimate without the handler tracking which downstream services need both.

## Wired call sites (audit)

| Handler | Pipeline call | Notes |
|---|---|---|
| `cmdCreateTask` | `fireDailyMutationPipeline(date, "create")` | Replaced inline triage+estimate calls. |
| `cmdToggleTask` | `fireDailyMutationPipeline(task.date, "toggle")` | In addition to `rotateNextTask` (kept inline). |
| `cmdSkipTask` | `fireDailyMutationPipeline(task.date, "skip")` | Was firing nothing downstream before. |
| `cmdDeleteTask` | `fireDailyMutationPipeline(task.date, "delete")` | Looks up task before delete to know date. |
| `cmdDeleteTasksForDate` | `fireDailyMutationPipeline(date, "delete")` | Bulk path. |
| `cmdUpdateTask` | `fireDailyMutationPipeline([oldDate, newDate?], "update")` | Cross-day if `patch.date` set. Was firing nothing. |
| `cmdRescheduleTask` | `fireDailyMutationPipeline([originalDate, targetDate], "reschedule")` | Plus `goalPlan.moveTaskToDate` for plan-tree sync. |

`materializePlanTasks` (a service, not a command handler) also dispatches the pipeline at the end — see `services/planMaterialization.ts` for the call.

## Cross-surface invalidation (separate from this pipeline)

The pipeline handles BACKGROUND side-effects. The `view:invalidate` WS event that triggers FE refetches is owned by the **route layer** (`routes/commands.ts`) which reads the `commandToInvalidations` map (`views/_invalidation.ts`) after each successful command. Do not duplicate invalidation in handlers — add the right view kinds to the map.

When adding a new command that mutates `daily_tasks`:
1. Add the entry to `commandToInvalidations` with `view:dashboard`, `view:tasks`, `view:calendar` at minimum.
2. Add `view:goal-plan` if the mutation can touch a plan node.
3. Add `view:planning` if it changes goal-level state (pace, status).

## Plan-tree sync (separate from this pipeline)

When a `daily_task` linked to a plan node changes, the corresponding `goal_plan_nodes` row must be updated:

| Mutation | Plan-tree sync | Where |
|---|---|---|
| Toggle complete | `goalPlan.patchNodePayload({completed, completedAt})` | `cmdToggleTask` lines ~116 |
| Reschedule (date change) | `goalPlan.moveTaskToDate(planNodeId, goalId, targetDate)` | `cmdRescheduleTask` lines ~980 |
| Delete | (none today — plan-tree retains the node) | — |
| Update title/desc | (none today — daily_task is the source of truth for materialized rows) | — |

This sync is **not** done by the pipeline because it requires the goal context (goalId + planNodeId) the handler already has, and because not every mutation needs it.

## Why this contract exists (the regression class)

Pre-2026-04-26 audit found:
- `cmdSkipTask` fired no triage → skipped tasks didn't free up active-list slots until the next view fetch
- `cmdUpdateTask` fired nothing → editing duration didn't re-trigger estimator validation
- `cmdRescheduleTask` updated source day's daily_tasks but didn't re-triage either day
- New handlers were one "I forgot" away from a regression of the same shape

Centralizing the dispatch makes the contract enforceable in code review: "where's your `fireDailyMutationPipeline` call?" is a single grep.

## How to extend

To add a new fire-and-forget side-effect to every task mutation (e.g., a new annotator agent), add it inside `fireDailyMutationPipeline` in `services/dailyMutationPipeline.ts`. **Do not** add it to individual handlers. The pipeline is the only place where new side-effects should land.

To add a new mutating command, follow the pattern:
1. Read the row(s) before mutating so you know the affected date(s).
2. Mutate.
3. Call `fireDailyMutationPipeline(dates, "your-mutation-kind")`.
4. If the mutation changes a plan-linked field, call the relevant `goalPlan.*` sync (see the table above).
5. Add the command's invalidations to `views/_invalidation.ts`.
6. Document the new command in `API_CONTRACT.md`.
