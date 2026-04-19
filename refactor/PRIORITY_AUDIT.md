# Priority System Audit — Phase B, Step 1

Audit of priority-related signals currently produced and consumed across the agent pipeline. Required before `priorityAnnotator` is introduced, so that the new agent adds coverage instead of duplicating it.

## 1. Signals produced by `agents/gatekeeper.ts`

Gatekeeper returns a `GatekeeperResult` with four components. All four are priority-shaped in some form:

### 1.1 `priorityScores: Record<taskId, number>`
- Produced by the AI call (Haiku, `getModelForTask("gatekeeper")`) via `parseAiResponse`.
- Scale 1–10. Fallback value 5 when the API call or client is unavailable.
- Purely importance/urgency — no decomposition into cognitive-load dimensions.
- Used nowhere downstream today beyond being surfaced in the `TaskState`.

### 1.2 `filteredTasks: TriagedTask[]`
Each triaged task carries:
- `priority: number` — mirrors the score above (1–10).
- `signal: "high" | "medium" | "low"` — three-bucket discretization of priority.
- `cognitiveWeight: number` — `COGNITIVE_BUDGET.DEFAULT_WEIGHT = 3` when missing; 1–5 elsewhere via `computeCognitiveWeight(importance, duration, priority)` in `packages/core/src/domain/cognitiveBudget.ts`.
- `durationMinutes: number` — user-declared, not AI-estimated.

`cognitiveWeight` today is a **single axis** conflating novelty, System-1/System-2 load, and emotional effort. No dual-process distinction exists.

### 1.3 `budgetCheck: BudgetCheck`
- `totalWeight` — sum of `cognitiveWeight` after trimming.
- `maxWeight = COGNITIVE_BUDGET.MAX_DAILY_WEIGHT = 12` (hardcoded constant, **not per-user**).
- `overBudget: boolean` — true if weight > 12 OR count > 5.
- `tasksDropped: string[]` — ids removed by `enforceBudgetSnake` ordering by `"must-do" → "should-do" → "bonus"` then trimming the tail.

Ceiling is a single global constant. No `dailyCognitiveBudget` setting exists.

### 1.4 `goalRotation: GoalRotation`
- `goalCount` — number of big goals.
- `rotationScores: Record<goalId, number>` — `min(daysSinceLastWorked, 14) / 14`.
- `staleGoals: string[]` — big goals not touched in ≥ 3 days.
- Feeds the gatekeeper's AI prompt as "boost priority" guidance; also echoed into the final `TaskState`.
- Acts as a proxy for value-tiering (reminds the system that long-horizon goals exist), but it operates at **goal granularity**, not per-task.

## 2. Inputs consumed by `agents/scheduler.ts`

Scheduler builds a three-tier schedule in code, then calls Haiku only for conflict detection and reshuffle proposals.

### 2.1 Tier 1 — calendar blocks
- Source: `input.scheduledTasks` with a `scheduledTime` (HH:MM) string.
- No priority input whatsoever. Fixed/immovable by definition.

### 2.2 Tier 2 — goal blocks
- Source: `gatekeeper.filteredTasks` grouped by `goalId`.
- Duration per goal = `Σ (timeEstimator.adjustedMinutes + bufferMinutes)` (fallback to `task.durationMinutes`).
- **No priority or tier input on the block itself** — all goal tasks are treated equivalently within the "deep-work window" bucket. The scheduler trusts the gatekeeper's earlier drop decisions rather than re-ordering here.

### 2.3 Tier 3 — task slots
- Source: filtered tasks **without** a `goalId`.
- Same shape as Tier 2; just fills remaining time.

### 2.4 AI call
The scheduler prompt includes `priority`, `signal`, `goalId`, `goalTitle`, `category` per task — but only as *context* for the AI's conflict/reshuffle decisions. The AI never re-orders tasks within a tier; it only proposes `keep | defer | swap | drop` actions.

### 2.5 No "value tiering" in scheduler
There is no notion of `lifetime | quarter | week | day` (the Phase B framework). Tasks are grouped only by (goalId, no-goalId). A lifetime-scoped goal's subtasks and a this-week goal's subtasks look identical to the scheduler.

## 3. Priority context from `coordinators/bigGoal/`

### 3.1 `projectAgentContext.ts`
Persisted per big goal in the `conversations` table:
- `research: ResearchResult | null`
- `personalization: { avgTasksPerDay, completionRate, maxDailyWeight, overwhelmRisk, trend } | null`
- `decisions: string[]`
- `updatedAt: string`

`personalization.maxDailyWeight` is a **user-specific cognitive ceiling** produced by `personalizationAgent`, but it is only stored inside the Big Goal conversation — it is NOT threaded into the daily task gatekeeper (which still uses `COGNITIVE_BUDGET.MAX_DAILY_WEIGHT = 12`).

This is the closest existing artefact to Phase B's `dailyCognitiveBudget` and should inform the default when the new setting is null.

### 3.2 `bigGoalCoordinator.ts`
- Classifies effort (`high | low`) via `classifyEffort` / `routeEffort`.
- On high-effort: runs `runResearchAgent` + `runPersonalizationAgent` in parallel, synthesises a plan.
- Emits `memoryContext` + `capacityContext` strings used by Opus for plan generation.
- Does NOT tag tasks with `tier` or `cognitiveLoad`. Goal-level importance flows through `IMPORTANCE_PRIORITY_RULES` (see below) into task-level `priority` + base `cognitiveWeight`, but only at the `must-do | should-do | bonus` granularity.

### 3.3 `IMPORTANCE_PRIORITY_RULES` (in `packages/core/src/domain/cognitiveBudget.ts`)
Maps goal importance → default task priority + base weight:
- `critical`: must-do, weight 4, daily
- `high`:     must-do, weight 3, 5–6x/week
- `medium`:   should-do, weight 3, 3–4x/week
- `low`:      should-do, weight 2, 1–2x/week

This is closer to cognitive-load-theory (effort tier) than to value-tiering (horizon). It collapses "importance to the user" and "cognitive cost of the task" into one axis, which is exactly what Phase B wants to un-collapse.

## 4. Framework coverage gap analysis

| Phase B framework | Existing signal(s) | Overlap | Gap |
|---|---|---|---|
| **Dual-process theory** (System 1 vs System 2 → `cognitiveLoad: "high"/"medium"/"low"`) | `cognitiveWeight: 1..5`, `category` | Partial — `cognitiveWeight` reflects effort, but not *which kind* of effort. A high-weight System-1 task (e.g. repetitive deep admin) and a high-weight System-2 task (e.g. novel architecture design) look identical. | **No System-1 vs System-2 distinction** exists. Nothing informs the scheduler that System-2 work should land in high-energy blocks. |
| **Cognitive load theory** (per-task numeric cost 1–10 → `cognitiveCost`, summed against a user-configurable daily budget) | `cognitiveWeight: 1..5` + global `COGNITIVE_BUDGET.MAX_DAILY_WEIGHT = 12` + per-goal `personalization.maxDailyWeight` (stored but unused downstream) | Strong — this is essentially the "lite" version of cognitive load theory already, with a 1–5 scale. | **No per-user budget enforcement** in the daily planning pipeline. `maxDailyWeight` from personalization is stored but not threaded into gatekeeper/scheduler. Scale is 1–5 not 1–10 — not a gap if we map, but Phase B specifies 1–10. |
| **Value tiering** (lifetime / quarter / week / day) | `goalType` (`big` vs not), `goalRotation.rotationScores`, `IMPORTANCE_PRIORITY_RULES` importance tier | Weak — goal-level only, no task-level tier. Stale-goal detection is a crude proxy. | **No task-level tier field.** Scheduler cannot protect "lifetime" tasks against "day" tasks within the same tier. Critique has no way to flag "zero lifetime/quarter tasks for 3+ days". |

## 5. Interaction with existing invariants

- Every Phase B field MUST be nullable; existing tasks (pre-Phase B) must continue to schedule under current rules when all three fields are null.
- `priorityAnnotator` MUST be additive: gatekeeper keeps producing `priorityScores + budgetCheck + goalRotation`. The new agent fills a **parallel, optional** annotation channel that the scheduler consults when present.
- Scheduler's tier-1 / tier-2 / tier-3 output format is unchanged. Only the **within-tier ordering** and the **drop-to-pending pool** policy gain new inputs.
- Critique's current categories (`hallucination | overcommit | memory-violation | other`) are append-only; `priority-violation` is a new fifth category, not a rename.

## 6. Recommended additions (to be implemented in Step 2)

1. **Extend `DailyTask`** (additive) — add `cognitiveLoad`, `cognitiveCost`, `tier`. All nullable.
2. **New `user_settings.dailyCognitiveBudget: integer | null`** — default 22 when null. Rationale for 22: roughly the existing `MAX_DAILY_WEIGHT * 2` when translated from the 1–5 scale to the 1–10 scale (scheduler mapping), plus ~10% slack for the bonus task + reminders.
3. **New agent `priorityAnnotator`** — reads tasks without annotations, emits `{ cognitiveLoad, cognitiveCost, tier }`. Runs in parallel with `gatekeeper` in `coordinateRequest`. Skippable: if the agent fails, scheduler falls back to current tier-1/tier-2/tier-3 ordering by `priority`.
4. **Scheduler hard-budget check** — after building tiers, sum `cognitiveCost` of scheduled tasks; if > `dailyCognitiveBudget`, defer lowest-tier tasks (`day < week < quarter < lifetime`) to the pending pool. No change to output shape; just an additional trim pass **after** `enforceBudgetSnake`.
5. **Critique `priority-violation` category** — three new checks:
   - high `cognitiveLoad` task scheduled in a low-energy block (requires an energy-block signal — Phase B defers this to "if any scheduled start time lands before 10am or after 4pm with high load", a conservative proxy).
   - total `cognitiveCost` > `dailyCognitiveBudget`.
   - zero `tier in ("lifetime","quarter")` tasks for three consecutive days.
6. **Wire critique on `daily-tasks` handler** — currently only `generate-goal-plan` runs critique (`routes/commands/planning.ts:234`). Add a `runCritique` call at the end of the daily-tasks generation handler.

## 7. Non-goals for Phase B

- No removal or modification of `gatekeeper`'s prompt or outputs.
- No UI exposure of `cognitiveLoad | cognitiveCost | tier`.
- No migration-time backfill of existing tasks — they stay null forever.
- No change to `COGNITIVE_BUDGET` constants in `packages/core/src/domain/cognitiveBudget.ts`; the new per-user `dailyCognitiveBudget` is a separate axis.
- No change to the scheduler's tier-1/tier-2/tier-3 output format.

## 8. Files that will change in Step 2

- `packages/server/migrations/0011_priority_annotations.sql` (NEW)
- `packages/core/src/types/index.ts` — append 3 nullable fields to `DailyTask`, append 1 nullable field to `UserSettings`.
- `packages/core/src/model-config.ts` — append `"priority-annotator": "light"` route.
- `packages/server/src/repositories/dailyTasksRepo.ts` — surface 3 new columns on record + insert/update paths.
- `packages/server/src/repositories/userSettingsRepo.ts` — surface `dailyCognitiveBudget`.
- `packages/server/src/views/_mappers.ts` — thread 3 new fields through `flattenDailyTask`.
- `packages/server/src/views/settingsView.ts` — expose `dailyCognitiveBudget`.
- `packages/server/src/agents/priorityAnnotator.ts` (NEW) + `prompts/priorityAnnotator.ts` (NEW).
- `packages/server/src/agents/coordinator.ts` — add priorityAnnotator as 4th parallel agent.
- `packages/server/src/agents/scheduler.ts` — read annotations when present; trim by tier if over `dailyCognitiveBudget`.
- `packages/server/src/agents/router.ts` — add `priorityAnnotator` to the `daily-tasks` + `adaptive-reschedule` parallel groups.
- `packages/server/src/critique/prompts.ts` — append `priority-violation` to the categories enum.
- `packages/server/src/critique/agent.ts` — extend `VALID_CATEGORIES` set.
- `packages/server/src/ws/events.ts` (or wherever `CritiqueIssue` lives) — append `"priority-violation"` to the category union.
- `packages/server/src/routes/commands/tasks.ts` (or the daily-tasks handler location) — add detached `runCritique` at end of daily-tasks generation.
