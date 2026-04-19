# Agents — Input/Output Contracts

This directory holds the sub-agents invoked by `coordinator.ts` plus any
ad-hoc agents called directly from command handlers. Every agent has
**exactly one responsibility** and a strict input/output contract so the
coordinator can fan out in parallel without hidden coupling.

## Design principles (Ruflo-inspired)

1. **Single responsibility per agent** — no agent both ranks and filters,
   or both estimates and schedules. If a new concern appears, make a new
   agent, don't overload an existing one.
2. **Selective RAG per agent** — each agent that benefits from retrieved
   knowledge builds its own `retrievalQuery` from its input and calls
   `loadMemory` + `buildMemoryContext(memory, contextType, tags, retrievalQuery)`.
   Knowledge is pulled on demand, not blanket-injected. The `retrievalQuery`
   parameter wired in Phase 1 (RAG) is the plumbing that makes this cheap.
3. **Skippable agents** — on any AI or retrieval failure, an agent returns
   an empty-but-valid result. Consumers must handle missing data by falling
   back to pre-agent behaviour (e.g. scheduler keeps its tier-1/2/3 ordering
   when `priorityAnnotator.annotations` is `{}`).
4. **Parallel fan-out with explicit merge** — `coordinator.ts` groups
   agents into parallel sets and one sequential tail (the scheduler).
   Results are merged into `TaskState.agents`; no agent reads another
   agent's result except through the scheduler.

## Agent catalog

### `gatekeeper`

- **Responsibility** — signal/noise filter + priority scoring for candidate
  tasks. Also enforces the global cognitive budget ceiling
  (`COGNITIVE_BUDGET.MAX_DAILY_WEIGHT = 12`) in code.
- **Input** — `TaskStateInput`.
- **Output** — `GatekeeperResult { filteredTasks, priorityScores, budgetCheck, goalRotation }`.
- **Retrieval** — uses `input.memoryContext` already baked into the prompt;
  does not call `retrieveRelevant` itself (scope limited to filtering).
- **Model** — `getModelForTask("gatekeeper")` → `light` tier (Haiku).

### `timeEstimator`

- **Responsibility** — per-day deep-work total + buffered estimates for
  the candidate task batch. Applies a planning-fallacy buffer.
- **Input** — `TaskStateInput`.
- **Output** — `TimeEstimatorResult { estimates, totalMinutes, exceedsDeepWorkCeiling }`.
- **Retrieval** — none (historical averages from `memory_signals` only).
- **Model** — `getModelForTask("time-estimator")` → `light`.

### `scheduler`

- **Responsibility** — build tier-1/tier-2/tier-3 schedule blocks, detect
  calendar conflicts, propose reshuffles. Consumes gatekeeper + time
  estimator + priority annotator outputs.
- **Input** — `TaskStateInput`, `GatekeeperResult`, `TimeEstimatorResult`,
  optional `PriorityAnnotatorResult`.
- **Output** — `SchedulerResult { conflicts, tierEnforcement, reshuffleProposal, opportunityCost }`.
- **Retrieval** — none.
- **Model** — `getModelForTask("scheduler")` → `light`.
- **Budget enforcement (Phase B)** — when annotations are present, the
  scheduler sums `cognitiveCost` against
  `user.settings.dailyCognitiveBudget ?? 22`. If the sum exceeds the budget,
  lowest-tier tasks (`day` → `week` → `quarter` → `lifetime`) are deferred
  to the pending pool and added to `budgetCheck.tasksDropped`.

### `durationEstimator` (Phase A)

- **Responsibility** — per-task duration estimate, on-demand. Distinct
  from `timeEstimator` (which is per-batch, tuned for daily deep-work).
  The first production caller of `retrieveRelevant`.
- **Input** — `DurationEstimatorInput { tasks, contextHint? }`.
- **Output** — `DurationEstimatorOutput { estimates: { [taskId]: { minutes, confidence, rationale } } }`.
- **Retrieval** — builds a `retrievalQuery` from task titles + optional
  `contextHint` and calls
  `buildMemoryContext(memory, "daily", [], retrievalQuery)`. Retrieval is
  semantic across all indexed knowledge files (no source filter today); the
  query is tuned with time-estimation vocabulary so `time-estimation.md`
  chunks rank highest. A source-filter hook
  (`retrieveRelevant(..., { source: "time-estimation.md" })`) can be wired
  through `buildMemoryContext` if cross-file bleed shows up in practice.
- **Model** — `getModelForTask("duration-estimator")` → `light`.
- **Caller** — `command:estimate-task-durations` (Phase A command) and,
  in the future, the daily-tasks handler for tasks that arrive without
  an `estimatedDurationMinutes`.

### `priorityAnnotator` (Phase B)

- **Responsibility** — annotate each task with `cognitiveLoad` (dual-process
  theory), `cognitiveCost` (1..10 cognitive load theory), and `tier`
  (lifetime/quarter/week/day value tiering). Additive; does not overlap
  with `gatekeeper`.
- **Input** — `PriorityAnnotatorInput { tasks, contextHint? }`.
- **Output** — `PriorityAnnotatorResult { annotations: { [taskId]: { cognitiveLoad, cognitiveCost, tier, rationale } } }`.
- **Retrieval** — builds a `retrievalQuery` from task titles + goal titles
  and calls `buildMemoryContext(memory, "daily", [], retrievalQuery)`. Same
  semantic-retrieval caveat as `durationEstimator`: the query is tuned with
  dual-process / value-tiering vocabulary so `psychology-principles.md` and
  `goal-setting.md` chunks rank highest, but there is no hard source filter.
- **Model** — `getModelForTask("priority-annotator")` → `light`.
- **Skippable** — on any failure returns `{ annotations: {} }`. Scheduler
  sees an empty map and keeps its pre-Phase-B ordering.

### `critique` (Phase 2)

- **Responsibility** — advisory second-pass reviewer. Flags hallucinations,
  overcommits, memory violations, and (Phase B) priority violations.
  Never blocks or mutates the primary output.
- **Input** — `CritiqueAgentInput { handler, primaryOutput, memoryContext, payload }`.
- **Output** — `RawCritique { overallAssessment, summary, issues[] }`.
- **Retrieval** — consumes the memoryContext that the primary handler
  used, plus the payload. Does not re-retrieve on its own today; a future
  iteration can pull from all four knowledge files when `overallAssessment`
  would otherwise be `blocking`.
- **Model** — `getModelForTier("light")` (Haiku).
- **Wired on** — `generate-goal-plan` (planning.ts:234),
  `regenerate-daily-tasks` / `refresh-daily-plan` (Phase B).

## Coordinator routing (parallel fan-out)

`router.ts::routeRequest(requestType)` returns the agent plan per request
type. The `coordinator.ts` executes parallel groups concurrently and the
sequential tail (scheduler) after. No agent reaches across the graph.

| requestType              | parallel                                                | sequential  |
| ------------------------ | ------------------------------------------------------- | ----------- |
| `daily-tasks`            | gatekeeper, timeEstimator, priorityAnnotator            | scheduler   |
| `adaptive-reschedule`    | gatekeeper, timeEstimator, priorityAnnotator            | scheduler   |
| `goal-intake`            | gatekeeper                                              | scheduler   |
| `budget-check`           | gatekeeper                                              | —           |
| `generate-goal-plan`     | timeEstimator                                           | scheduler   |

## Adding a new agent — checklist

1. Create `agents/prompts/<name>.ts` — system prompt only.
2. Create `agents/<name>.ts` — exports a single `run<Name>`-style function
   with an explicit input/output interface. Make it skippable: catch errors
   at the AI call boundary and return a valid empty result.
3. Append to `SubAgentId` in `packages/core/src/types/taskState.ts`.
4. Append a result interface and add the `agents.<name>` slot on `TaskState`.
5. Append a model tier entry in `packages/core/src/model-config.ts` under
   `TASK_TIERS` (defaults to `light` unless explicitly heavy).
6. Wire a `case` arm in `coordinator.ts::runAgent`.
7. Initialise the new slot in `AgentResults` (x3 places — two initial-value
   sites plus the final merge).
8. Add the agent to the appropriate `router.ts` parallel group.
9. If the agent uses RAG, build a specific `retrievalQuery` from its input
   and call `buildMemoryContext(memory, contextType, tags, retrievalQuery)`.
10. Document the agent in this README with its responsibility, I/O, and
    retrieval strategy.
