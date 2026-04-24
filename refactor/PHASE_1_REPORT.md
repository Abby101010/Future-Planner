# Phase 1 Audit Report: Starward AI Architecture

> **Date**: 2026-04-16
> **Scope**: Read-only audit of AI calls, blocking paths, rule-engine candidates, coordinators, invalidation, and memory costs.
> **Priority Focus**: Token cost reduction (2.2, 2.4) and UI blocking paths (2.3).

---

## 2.1 Codebase Inventory

### Core AI Handlers (`packages/core/src/ai/handlers/`)

| File | Lines | AI Call | Model Tier | Key Exports |
|------|-------|---------|------------|-------------|
| `chat.ts` | 417 | `client.messages.create` | medium (Sonnet) | `handleUnifiedChat` |
| `homeChat.ts` | 830 | `client.messages.create` | medium (Sonnet) | `handleHomeChat` |
| `goalPlanChat.ts` | 311 | `client.messages.create` | medium (Sonnet) | `handleGoalPlanChat` |
| `classifyGoal.ts` | 73 | `client.messages.create` | light (Haiku) | `handleClassifyGoal` |
| `generateGoalPlan.ts` | 72 | `client.messages.create` | heavy (Opus) | `handleGenerateGoalPlan` |
| `goalPlanEdit.ts` | 43 | `client.messages.create` | medium (Sonnet) | `handleGoalPlanEdit` |
| `analyzeMonthlyContext.ts` | 38 | `client.messages.create` | light (Haiku) | `handleAnalyzeMonthlyContext` |
| `onboarding.ts` | 30 | `client.messages.create` | medium (Sonnet) | `handleOnboarding` |

### Core Prompts (`packages/core/src/ai/prompts/`)

| File | Lines | Prompts Exported |
|------|-------|------------------|
| `goalPlan.ts` | 586 | `GOAL_BREAKDOWN_SYSTEM`, `GOAL_PLAN_CHAT_SYSTEM`, `GOAL_PLAN_EDIT_SYSTEM`, `GENERATE_GOAL_PLAN_SYSTEM` |
| `homeChat.ts` | 284 | `HOME_CHAT_SYSTEM`, `ANALYZE_QUICK_TASK_SYSTEM` |
| `dailyTasks.ts` | 261 | `DAILY_TASKS_SYSTEM` |
| `chat.ts` | 262 | `CHAT_SYSTEM` |
| `scheduling.ts` | 142 | `REALLOCATE_SYSTEM`, `ADAPTIVE_RESCHEDULE_SYSTEM`, `RECOVERY_SYSTEM`, `PACE_CHECK_SYSTEM` |
| `analysis.ts` | 97 | `CLASSIFY_GOAL_SYSTEM`, `ANALYZE_MONTHLY_CONTEXT_SYSTEM` |
| `effortRouter.ts` | 34 | `EFFORT_ROUTER_SYSTEM` |
| `onboarding.ts` | 29 | `ONBOARDING_SYSTEM` |
| `index.ts` | 19 | Re-exports all |

### Core Utilities

| File | Lines | AI Call | Exports |
|------|-------|---------|---------|
| `personalize.ts` | 24 | No | `personalizeSystem(baseSystem, memoryContext)` — string concatenation only |
| `sanitize.ts` | 40 | No | `stripLoneSurrogates`, `sanitizeForJSON` |

### Core Domain

| File | Lines | AI Call | Exports |
|------|-------|---------|---------|
| `goalPlan.ts` | 186 | No | `applyPlanPatch` — pure immutable plan patching |
| `cognitiveBudget.ts` | 185 | No | `COGNITIVE_BUDGET`, `computeCognitiveWeight`, `enforceBudgetSnake`, `bonusTaskFits` — **fully local, no AI** |

### Server AI Layer (`packages/server/src/ai/`)

| File | Lines | AI Call | Model Tier | Exports |
|------|-------|---------|------------|---------|
| `handlers/dailyTasks.ts` | 476 | `runStreamingHandler` | medium (Sonnet) | `handleDailyTasks` |
| `handlers/analyzeQuickTask.ts` | 144 | `runStreamingHandler` | light (Haiku) | `handleAnalyzeQuickTask` |
| `handlers/reallocate.ts` | 93 | `runStreamingHandler` | heavy (Opus) | `handleReallocate` |
| `handlers/goalBreakdown.ts` | 91 | `runStreamingHandler` | heavy (Opus) | `handleGoalBreakdown` |
| `handlers/recovery.ts` | 83 | `runStreamingHandler` | light (Haiku) | `handleRecovery` |
| `handlers/paceCheck.ts` | 66 | `runStreamingHandler` | light (Haiku) | `handlePaceCheck` |
| `handlers/newsBriefing.ts` | 159 | `runStreamingHandler` | light (Haiku) | `handleNewsBriefing` |
| `router.ts` | 250 | No (dispatch) | N/A | `handleAIRequest`, `handleAIRequestDirect` |
| `client.ts` | 18 | No (factory) | N/A | `getClient` |
| `streaming.ts` | 121 | `client.messages.stream` | N/A | `runStreamingHandler` — WS streaming wrapper |

### Server Coordinators

| File | Lines | AI Call | Model Tier | Exports |
|------|-------|---------|------------|---------|
| `effortRouter.ts` | 68 | `client.messages.create` | light (Haiku) | `routeEffort` |
| `bigGoalCoordinator.ts` | 221 | No (orchestrates) | N/A | `coordinateBigGoal`, `onGoalConfirmed` |
| `bigGoal/researchAgent.ts` | 118 | `client.messages.create` | heavy (Opus) | `runResearchAgent` |
| `bigGoal/personalizationAgent.ts` | 124 | No (DB reads only) | N/A | `runPersonalizationAgent` |
| `bigGoal/projectAgentContext.ts` | 88 | No (CRUD only) | N/A | `loadProjectContext`, `saveProjectContext` |
| `dailyPlanner/scenarios.ts` | 564 | **No AI** | N/A | `routeRefresh` — fully deterministic |
| `dailyPlanner/memoryPackager.ts` | 148 | No | N/A | `packageCurrentPlan`, `evaluateCapacity` |
| `dailyPlanner/taskRotation.ts` | 270 | No | N/A | Task rotation logic |
| `dailyPlanner/cantCompleteRouter.ts` | 125 | No | N/A | Blocked task routing |

### Server Agents (`packages/server/src/agents/`)

> **Note**: This agent system already exists and is NOT mentioned in the refactoring document. It is a functioning multi-agent pipeline.

| File | Lines | AI Call | Model Tier | Exports |
|------|-------|---------|------------|---------|
| `coordinator.ts` | 186 | No (orchestrates) | N/A | `coordinateRequest` |
| `gatekeeper.ts` | 245 | `client.messages.create` | light (Haiku) | `runGatekeeper`, `runBudgetCheck` |
| `timeEstimator.ts` | 191 | `client.messages.create` | light (Haiku) | `runTimeEstimator` |
| `scheduler.ts` | 277 | `client.messages.create` | light (Haiku) | `runScheduler` |
| `router.ts` | 42 | No | N/A | `routeRequest`, `needsCoordination` |
| `types.ts` | 22 | No | N/A | Shared types |

### Server Services

| File | Lines | AI Call | Exports |
|------|-------|---------|---------|
| `dailyTaskGeneration.ts` | 498 | Indirect (via `handleAIRequest`) | `generateAndPersistDailyTasks` |
| `paceDetection.ts` | 296 | **No AI** — fully deterministic | `detectPaceMismatches`, `detectCrossGoalOverload`, `splitPlan`, `mergePlans` |
| `signalRecorder.ts` | 91 | No | Signal recording to DB |

---

## 2.2 AI Call Inventory (HIGH PRIORITY)

### Complete Call Map

| # | File:Line | Triggered By | Model | Est. Input Tokens | Output Structure | Blocks UI? | Rule Engine Candidate? |
|---|-----------|-------------|-------|-------------------|-----------------|------------|----------------------|
| 1 | `core/handlers/homeChat.ts:799` | `home-chat` command | Sonnet | ~2,000-4,000 | JSON (intents, reminders, events) | **Yes** — request/response | No (NLP required) |
| 2 | `core/handlers/chat.ts:399` | `chat` command | Sonnet | ~2,000-4,000 | JSON (structured response) | **Yes** — request/response | No (NLP required) |
| 3 | `core/handlers/goalPlanChat.ts:301` | `goal-plan-chat` cmd | Sonnet | ~3,000-6,000 (includes project ctx) | JSON (reply + optional plan edit) | **Yes** — request/response | No (conversational) |
| 4 | `core/handlers/generateGoalPlan.ts:47` | `regenerate-goal-plan` | **Opus** | ~2,000-4,000 + research | JSON (full plan tree) | **Yes** — 10-30s | No (complex planning) |
| 5 | `core/handlers/classifyGoal.ts:17` | `create-goal` flow | Haiku | ~300-500 | JSON `{scope, goalType}` | **Yes** but fast (~1s) | **Yes** — heuristic possible |
| 6 | `core/handlers/goalPlanEdit.ts:26` | `goal-plan-edit` | Sonnet | ~1,500-3,000 | JSON (edit analysis) | **Yes** | Partial |
| 7 | `core/handlers/analyzeMonthlyContext.ts:16` | `save-monthly-context` | Haiku | ~200-400 | JSON (capacity params) | **Yes** but fast | **Yes** — structured input |
| 8 | `core/handlers/onboarding.ts:21` | `onboarding` flow | Sonnet | ~500-1,000 | JSON (conversational) | **Yes** | No (conversational) |
| 9 | `server/handlers/dailyTasks.ts:318` | `daily-tasks` | **Sonnet** | **~4,000-8,000** (largest prompt) | JSON (tasks, heatmap, reasoning) | **Yes** — 5-15s | **YES** — top candidate |
| 10 | `server/handlers/goalBreakdown.ts:48` | `goal-breakdown` | **Opus** | ~2,000-4,000 | JSON (breakdown) | **Yes** — 10-20s | No |
| 11 | `server/handlers/reallocate.ts:45` | `reallocate-goal-plan` | **Opus** | ~2,000-4,000 | JSON (reallocated plan) | **Yes** — streaming but blocks | No |
| 12 | `server/handlers/recovery.ts:44` | `cant-complete-task` | Haiku | ~800-1,500 | JSON (recovery plan) | **Yes** but fast | Partial |
| 13 | `server/handlers/paceCheck.ts:29` | `pace-check` query | Haiku | ~800-1,500 | JSON (pace analysis) | **Yes** but fast | **Yes** — detection is local |
| 14 | `server/handlers/analyzeQuickTask.ts:98` | `create-pending-task` flow | Haiku | ~500-1,000 | JSON (analysis) | **Yes** but fast | Partial |
| 15 | `server/handlers/newsBriefing.ts:127` | `news-briefing` query | Haiku | ~500-1,000 | JSON (briefing) | **Yes** but fast | No |
| 16 | `server/coordinators/effortRouter.ts:38` | Big goal creation | Haiku | ~300-500 | JSON `{effort, reasoning}` | **Yes** (in chain) | **Yes** — heuristic possible |
| 17 | `server/coordinators/bigGoal/researchAgent.ts:84` | Big goal HIGH path | **Opus** | ~300-500 | JSON (research findings) | **Yes** (in chain) | No |
| 18 | `server/agents/gatekeeper.ts:158` | `daily-tasks` coordinator | Haiku | ~1,500-3,000 | JSON (filtered tasks, scores) | **Yes** (in chain) | **Partial** — budget check is local, filtering could be |
| 19 | `server/agents/timeEstimator.ts:149` | `daily-tasks` coordinator | Haiku | ~500-1,000 | JSON (time estimates) | **Yes** (in chain) | **Yes** — lookup table possible |
| 20 | `server/agents/scheduler.ts:248` | `daily-tasks` coordinator | Haiku | ~500-1,500 | JSON (schedule) | **Yes** (in chain) | **Yes** — deterministic scheduling |
| 21 | `server/routes/ai.ts:372,468,796` | Direct chat streams | Varies | Varies | Streaming text | **Yes** (streaming) | No |
| 22 | `planning.ts:220` (cmdAdaptiveReschedule) | `adaptive-reschedule` | **Opus** (reallocate tier) | ~2,000-4,000 | JSON (redistributed plan) | **Yes** — 10-30s | No |
| 23 | `server/reflection.ts:388` | Background reflection | Haiku | ~1,000-2,000 | JSON (facts) | No (background) | N/A |

### High-Cost Patterns Identified

**Pattern A: Full goal plan tree in prompt (Calls #9, #22)**
- `handleDailyTasks` receives `goalPlanSummaries` (all big goals' today-tasks) + full `breakdown` (the entire roadmap/plan JSON), + `pastLogs` (14 days), + `heatmap` (14 entries). Estimated **4,000-8,000 input tokens**.
- `cmdAdaptiveReschedule` sends all overdue tasks + all future tasks from the plan tree.

**Pattern B: Full memory injection on every call (Calls #1-15)**
- Every handler receives `memoryContext` via `personalizeSystem()`. The `buildMemoryContext` function can output **500-2,000 tokens** depending on signal count (facts + feedback timeline + behavioral insights + snooze records + duration calibrations + semantic preferences + context directive = 7 sections).
- No token budget cap on `buildMemoryContext` — it includes ALL high-confidence facts.

**Pattern C: Sonnet for structured output that Haiku could handle (Calls #6, #8)**
- `goal-plan-edit` (Sonnet): very short prompt, structured JSON output.
- `onboarding` (Sonnet): conversational but structured.

**Pattern D: Multi-AI-call user actions**
- **Daily task generation**: up to **4 AI calls** in sequence:
  1. Gatekeeper (Haiku) — filter + prioritize
  2. TimeEstimator (Haiku) — estimate durations
  3. Scheduler (Haiku) — calendar conflicts
  4. dailyTasks handler (Sonnet) — generate tasks
  - Total chain: **5-15 seconds**, **~8,000-14,000 input tokens** across all calls
- **Big goal creation (HIGH path)**: 3+ AI calls:
  1. Effort Router (Haiku) — classify
  2. Research Agent (Opus) — research
  3. Personalization Agent (DB reads, no AI)
  4. Generate Goal Plan (Opus)
  - Total chain: **15-40 seconds**, **~6,000-12,000 input tokens**
- **Adaptive reschedule**: 1 heavy call (Opus-tier streaming) — **10-30 seconds**

---

## 2.3 Sync Blocking Path Identification (HIGH PRIORITY)

### Blocking Path Analysis

Every AI-calling command blocks the HTTP response. The Electron client awaits the response before updating the UI.

| Command | Entry Point | AI Calls in Path | Est. Latency | Async Candidate? |
|---------|-------------|-----------------|--------------|------------------|
| `regenerate-goal-plan` | `cmdRegenerateGoalPlan` | 1x Opus (`generate-goal-plan`) | **10-30s** | **YES** — return pending, WS push result |
| `adaptive-reschedule` | `cmdAdaptiveReschedule` | 1x Opus (streaming) | **10-30s** | **YES** — already streams tokens, but HTTP still blocks |
| `adjust-all-overloaded-plans` | `cmdAdjustAllOverloadedPlans` | **N x Opus** (sequential per goal) | **10-30s per goal** | **CRITICAL YES** — can take minutes with multiple goals |
| `regenerate-daily-tasks` | `cmdRefreshDailyPlan` (delegates) | See `routeRefresh` scenarios below | **0-15s** | **Conditional** — see analysis |
| `refresh-daily-plan` | `cmdRefreshDailyPlan` | Same as above | **0-15s** | **Conditional** |
| `confirm-goal-plan` | `cmdConfirmGoalPlan` | **0 AI calls** — DB writes only | **<1s** | No (already fast) |

### `refresh-daily-plan` Deep Dive

`cmdRefreshDailyPlan` → `routeRefresh(date)` routes to one of three scenarios:

1. **`scenarioCollectAndSchedule`** (empty day): **0 AI calls** — deterministic collection from goal plans + pool. Already fast.
2. **`scenarioPoolIntegration`** (has tasks + has pool): **0 AI calls** — deterministic budget check + insert. Already fast.
3. **`scenarioBonusSuggest`** (has tasks, no pool): **0 AI calls** — deterministic lookup of unclaimed plan tasks. Already fast.

**Key finding**: The daily planner coordinator is **already fully deterministic**. It does NOT make AI calls. The AI-heavy path only triggers via `generateAndPersistDailyTasks`, which is called from the **view resolver** (`resolveTasksView`) when no daily log exists, or from the deprecated `cmdRegenerateDailyTasks`.

### `generateAndPersistDailyTasks` Deep Dive (the expensive path)

When triggered (typically on first page load of the day or manual regenerate):

```
1. Load goals, past logs, heatmap, reminders            ~50ms (DB)
2. Build goal plan summaries                              ~5ms (code)
3. Load memory + build context                           ~50ms (DB)
4. coordinateRequest("daily-tasks", taskStateInput)
   ├─ [parallel] gatekeeper (Haiku)                     ~2-3s
   ├─ [parallel] timeEstimator (Haiku)                  ~2-3s
   └─ [sequential] scheduler (Haiku, depends on above)  ~2-3s
   Subtotal:                                            ~4-6s
5. handleDailyTasks (Sonnet, streaming)                  ~5-10s
   Total:                                               ~9-16s
```

This path makes **4 AI calls** totaling **~8,000-14,000 input tokens**.

### Recommendations for Async Conversion

| Priority | Command | Current Latency | Proposed Pattern |
|----------|---------|----------------|-----------------|
| **P0** | `adjust-all-overloaded-plans` | N x 10-30s | Fire-and-forget + WS push per goal completed |
| **P1** | `regenerate-goal-plan` | 10-30s | Return `jobId` immediately, WS push result |
| **P1** | `adaptive-reschedule` | 10-30s | Already streams tokens — add job tracking |
| **P2** | `daily-tasks` (auto-gen on page load) | 9-16s | Return skeleton view immediately, WS push tasks when ready |

---

## 2.4 Rule Engine Migration Candidates (HIGH PRIORITY)

### Candidate 1: Daily Task Selection (TOP PRIORITY)

**Current state**: One Sonnet call (`handleDailyTasks`) does everything:
- Selects tasks from goal plans, everyday goals, repeating goals
- Applies cognitive budget constraints
- Considers monthly context, capacity, calendar
- Scores priorities, handles rotation
- Generates "why today" explanations + adaptive reasoning

**What's already deterministic** (done in code before/after AI call):
- `buildGoalPlanSummaries()` — task collection from plan trees
- `computeCapacityProfile()` — capacity budget calculation
- `computeCognitiveWeight()` — per-task weight scoring
- `enforceBudgetSnake()` — post-AI budget enforcement
- `computeGoalLastTouched()` — rotation data
- `filterTodayReminders()` — reminder filtering
- Goal plan task matching by date

**What the AI does that could be local**:
1. **Task selection from candidate pool** — can be scored deterministically by: cognitive weight, goal priority (importance), deadline pressure, rotation recency, capacity budget, category balance
2. **Priority ordering** — already partially done by gatekeeper agent
3. **Cognitive weight assignment** — `computeCognitiveWeight()` already exists

**What the AI must still do**:
1. **"Why today" copy** — natural language explanation per task
2. **Adaptive reasoning** — narrative summary of the day's plan logic
3. **Sequence optimization** — momentum-first ordering based on user behavior patterns
4. **Encouragement / yesterday recap** — motivational text

**Proposed two-step split** (per user request):
1. **Step 1 (deterministic rule engine)**: Score all candidate tasks, apply budget/capacity/rotation rules, select the final set. Output: ordered list of tasks with scores + selection reasoning codes.
2. **Step 2 (lightweight Haiku)**: Given the selected tasks (not the full tree), generate only: ordering fine-tuning based on behavior, "why today" copy, encouragement. Much shorter prompt (~1,000-2,000 tokens vs. ~4,000-8,000).

**Estimated savings**: Sonnet call replaced with Haiku call. Prompt shrinks ~60-75%. Output shrinks ~50%.

### Candidate 2: Effort Router (big/small classification)

**Current state**: Haiku call (`effortRouter.ts:38`) with ~300-500 token input, binary output (`high`/`low`).

**Already deterministic signals available**:
- `goalType` field (big/everyday/repeating) — set during creation
- `scope` field (big/small) — set by classifyGoal
- Target date span (>3 months = likely high)
- Description length/complexity
- Keyword matching ("learn", "build", "career", "project" → high; "habit", "daily", "routine" → low)

**Recommendation**: Replace with a local heuristic function that checks goalType, scope, target date span, and keyword patterns. Fall back to Haiku only when confidence is low (<0.6). **Saves ~90% of effort-router AI calls** since most goals are clearly one or the other.

### Candidate 3: Gatekeeper Agent (partial)

**Current state**: Haiku call (`gatekeeper.ts:158`) filters tasks + scores priorities.

**Already local**:
- `collectCandidates()` — extracts tasks from input
- `computeBudgetCheck()` — enforces cognitive budget with `enforceBudgetSnake()`
- `computeGoalRotation()` — recency/staleness scoring

**AI does**: priority scoring (1-10), signal classification (high/medium/low), cognitive weight assignment.

**Recommendation**: Move priority scoring to a deterministic formula: `score = deadlinePressure * 3 + rotationRecency * 2 + importanceWeight * 2 + categoryBalance * 1`. Use the AI only when scores are tied or for edge cases. **Saves the Haiku call entirely in ~70% of cases**.

### Candidate 4: Time Estimator Agent

**Current state**: Haiku call (`timeEstimator.ts:149`) estimates task duration with planning-fallacy buffer.

**Can be local**: Duration estimation from historical `taskTimings` data (already in memory). For each task category, compute `median(actualMinutes) / median(estimatedMinutes)` as a calibration factor. Apply: `adjusted = estimated * calibrationFactor + buffer`.

**Recommendation**: Replace with lookup table from `memory.taskTimings`. Fall back to Haiku only for novel task categories with <3 data points. **Saves the Haiku call in ~80% of cases** after sufficient history.

### Candidate 5: Scheduler Agent

**Current state**: Haiku call (`scheduler.ts:248`) resolves calendar conflicts and assigns time slots.

**Can be local**: The 3-tier scheduling logic is algorithmic:
1. Fixed calendar events (Tier 1) — from `getScheduleContext()`
2. Goal deep-work blocks (Tier 2) — from settings
3. Task slots (Tier 3) — fit remaining tasks into gaps

**Recommendation**: Replace with an interval-packing algorithm. No AI needed. **Saves the Haiku call entirely**.

### Candidate 6: Pace Detection

**Already local**: `paceDetection.ts` is fully deterministic — `detectPaceMismatches()` and `detectCrossGoalOverload()` use pure math (remaining tasks / days remaining / actual pace). **No migration needed**.

### Candidate 7: Cognitive Budget

**Already local**: `cognitiveBudget.ts` is fully deterministic — constants + pure functions. **No migration needed**.

### Summary Table

| Candidate | Current | Proposed | Est. Token Savings/call | Calls/day (est.) | Complexity |
|-----------|---------|----------|------------------------|------------------|------------|
| Daily Task Selection | Sonnet (~6,000 tokens) | Rule engine + Haiku (~2,000 tokens) | ~4,000 tokens | 1-3 | **M** |
| Effort Router | Haiku (~400 tokens) | Local heuristic (90%) + Haiku fallback (10%) | ~360 tokens | 0-2 | **S** |
| Gatekeeper | Haiku (~2,000 tokens) | Local scoring (70%) + Haiku fallback (30%) | ~1,400 tokens | 1-3 | **S** |
| Time Estimator | Haiku (~750 tokens) | Lookup table (80%) + Haiku fallback (20%) | ~600 tokens | 1-3 | **S** |
| Scheduler | Haiku (~1,000 tokens) | Interval packing algorithm | ~1,000 tokens | 1-3 | **M** |
| **Total daily savings** | | | **~7,360 tokens/cycle** | | |

At ~3 daily task generation cycles/day, this saves **~22,000 tokens/day** or **~660,000 tokens/month**.

---

## 2.5 Coordinator Diagnosis (Lighter Depth)

### Big Goal Coordinator Status

**Why it's not in the chat flow**: The `bigGoalCoordinator` is invoked during goal creation/planning (not during chat). It enriches the `generate-goal-plan` handler with research + personalization context. Chat flows (`home-chat`, `goal-plan-chat`) bypass it entirely:
- `home-chat` goes directly to handler (no coordination needed for intent parsing)
- `goal-plan-chat` loads `ProjectAgentContext` directly (fast path — no re-running agents)

This is by design: chat is latency-sensitive, so it uses cached context rather than re-running the coordinator pipeline.

### Daily Planner Data Dependencies

```
routeRefresh(date)
  ├─ [parallel] goals.list(), dailyLogs.list(), dailyTasks.listForDateRange(),
  │             heatmap.listRange(), reminders.listActive(), pendingTasks.listPooledForDate(),
  │             loadMemory(), users.get()
  ├─ computeCapacityProfile(memory, logs, dayOfWeek, monthlyCtx, weeklyAvailability)
  └─ Route to scenario:
       ├─ scenarioCollectAndSchedule: depends on goals, pooledTasks, goalPlan.listTasksForDateRange
       ├─ scenarioPoolIntegration: depends on pooledTasks, packageCurrentPlan
       └─ scenarioBonusSuggest: depends on goals, goalPlan.listTasksForDateRange, existingTasks
```

**Parallelizable**: All initial DB reads run in parallel (8 concurrent queries). Good.

**Sequential bottleneck**: `computeCapacityProfile` must wait for memory + logs. No optimization possible here.

**Failure handling**: Each scenario is try/catch at the top level. No retry mechanism. No partial rollback — if insertion fails mid-way through scenarioCollectAndSchedule, some tasks are inserted and some aren't. **Gap**: No transaction wrapping for multi-insert scenarios.

### Agent Coordinator Data Dependencies

```
coordinateRequest("daily-tasks", input)
  ├─ [parallel] gatekeeper(input) + timeEstimator(input)     ← independent
  └─ [sequential] scheduler(input, gatekeeper, timeEstimator)  ← depends on both
```

**Well-structured**: gatekeeper and timeEstimator run in parallel. Scheduler depends on both (needs filtered tasks + time estimates to schedule). This is correct.

**Failure handling**: If any agent fails, the coordinator catches the error, sets `state.status = "error"`, and returns the state. The caller (`generateAndPersistDailyTasks`) doesn't check for error state — it passes whatever coordinatorState it gets to the handler. **Gap**: error state is silently swallowed.

---

## 2.6 Invalidation Map

### Commands Invalidating >= 4 Views

| Command | Views Invalidated | Count |
|---------|-------------------|-------|
| `create-goal` | dashboard, roadmap, planning, goal-plan, goal-breakdown | **5** |
| `update-goal` | dashboard, roadmap, planning, goal-plan, goal-breakdown | **5** |
| `delete-goal` | dashboard, roadmap, planning, goal-plan, goal-breakdown | **5** |
| `toggle-task` | dashboard, tasks, calendar, planning, goal-plan | **5** |
| `delete-tasks-for-date` | dashboard, tasks, calendar, goal-plan | **4** |
| `update-task` | dashboard, tasks, calendar, goal-plan | **4** |
| `confirm-goal-plan` | goal-plan, dashboard, tasks, calendar | **4** |
| `regenerate-goal-plan` | goal-plan, dashboard, tasks, calendar | **4** |
| `reallocate-goal-plan` | goal-plan, dashboard, tasks, calendar | **4** |
| `adaptive-reschedule` | goal-plan, dashboard, tasks, calendar | **4** |
| `adjust-all-overloaded-plans` | goal-plan, dashboard, tasks, calendar | **4** |
| `reset-data` | **ALL 10** | **10** |

### Over-Invalidation Analysis

**`toggle-task` invalidates 5 views** including `planning` and `goal-plan`:
- `planning` and `goal-plan` are invalidated because toggling a daily task might update the goal plan tree's completion state.
- This is **justified** — when a user completes a task linked to a plan node, the goal-plan view needs to reflect the updated completion percentage.
- However, for tasks NOT linked to a goal plan (user-created tasks), invalidating `planning` and `goal-plan` is unnecessary. Could be optimized with conditional invalidation based on whether the task has a `planNodeId`.

**Goal CRUD invalidates 5 views** — justified since goals appear on dashboard, roadmap, planning, and two goal-specific views.

**Recommendation**: Add conditional invalidation for `toggle-task` — only invalidate `goal-plan` and `planning` when `task.planNodeId` is non-null. Saves 2 view refetches per non-goal task toggle. Implementation: return `_invalidateExtra` from the handler instead of using the static lookup.

---

## 2.7 Memory System Cost Audit (Lighter Depth)

### Memory Injection Size

`buildMemoryContext(memory, contextType)` produces a text block with up to 7 sections:

1. **User Preferences**: All facts with confidence >= 0.4, grouped by category. No cap.
2. **Feedback Timeline**: Max 12 entries (capped, deduped).
3. **Behavioral Patterns**: Hourly stats, day-of-week patterns, category rates, overwhelm detection. Size depends on signal count.
4. **Chronically Snoozed Tasks**: Only for daily/recovery contexts, tasks snoozed >= 3x. Usually 0-3 entries.
5. **Duration Calibration**: Only for planning/daily contexts. Actual vs estimated by category.
6. **Semantic Preferences**: Top 8 preferences by context relevance.
7. **Context Directive**: ~50-100 tokens, fixed per context type.

**Estimated memory context size**: 500-2,000 tokens depending on user history depth.

### Token Budget: None

There is **no explicit token budget** on `buildMemoryContext`. Facts grow unbounded — every reflection cycle adds more facts. Long-term users could accumulate 100+ facts, each averaging ~20 tokens, meaning the facts section alone could reach **2,000+ tokens**.

**Recommendation**: Add a token budget cap (~800 tokens) to `buildMemoryContext`. Prioritize by confidence * recency. Low-confidence or old facts should be trimmed. This is a **quick win** for reducing prompt size across all handlers.

### Behavior Profile Entries

The `behavior_profile_entries` table stores user-editable facts. These are separate from the `memory_facts` table. When a user edits their behavior profile in Settings, old explicit-source facts are wiped and replaced.

Current volume: Depends on user engagement with the Settings UI. Typically 0-20 entries per user (small).

### Double Memory Load in Daily Tasks

`handleDailyTasks` calls `loadMemory()` a **second time** (line 59) after the service layer already loaded it and built `memoryContext`. The handler uses this second load to compute `capacityProfile`. This is a **redundant DB read** — the capacity profile should be computed once in the service layer and passed to the handler.

---

## 2.8 Audit Findings & Ranked Recommendations

### Top 10 Improvements by ROI

| # | Improvement | Token Savings/month | UI Blocking Reduction | Complexity | External Contract Change? |
|---|-------------|--------------------|-----------------------|------------|--------------------------|
| **1** | **Split daily task generation into rule engine + Haiku** (Candidate 1 from 2.4) | ~360K tokens (Sonnet→Haiku, smaller prompt) | Latency drops from ~9-16s to ~3-5s (skip 3 agent calls + use shorter Haiku call) | **M** | No — same output shape |
| **2** | **Make `adjust-all-overloaded-plans` async** (fire-and-forget) | 0 (same calls) | **Eliminates N x 10-30s blocking** — user gets immediate response | **S** | No — add `jobId` to response |
| **3** | **Make `regenerate-goal-plan` async** | 0 | **Eliminates 10-30s blocking** | **S** | No — add `jobId` to response |
| **4** | **Replace scheduler agent with interval-packing algorithm** | ~90K tokens (Haiku eliminated) | ~2-3s less per daily gen | **M** | No |
| **5** | **Replace time estimator with lookup table** | ~54K tokens (Haiku eliminated 80%) | ~2-3s less per daily gen | **S** | No |
| **6** | **Replace effort router with local heuristic** | ~32K tokens (Haiku eliminated 90%) | ~1-2s less per goal creation | **S** | No |
| **7** | **Add token budget cap to `buildMemoryContext`** (~800 tokens) | ~30K-100K tokens (depends on user history) | Marginally faster prompts | **S** | No |
| **8** | **Eliminate redundant `loadMemory()` in `handleDailyTasks`** | 0 | ~50ms less (one fewer DB round-trip) | **S** | No |
| **9** | **Conditional invalidation for `toggle-task`** | 0 | Fewer view refetches for non-goal tasks | **S** | No |
| **10** | **Make `adaptive-reschedule` fully async** | 0 | **Eliminates 10-30s blocking** (already streams, but still blocks HTTP) | **S** | No — already has streaming |

### Improvement Detail

**#1 — Split daily task generation (HIGHEST ROI)**

This is the single highest-impact change. Currently, `generateAndPersistDailyTasks` runs 4 AI calls (gatekeeper + timeEstimator + scheduler + Sonnet handler) totaling ~9-16s and ~8,000-14,000 input tokens.

Proposed:
- **Step 1 (code)**: Deterministic rule engine selects + scores candidate tasks using cognitive budget, capacity profile, goal priority, rotation recency, deadline pressure. Outputs an ordered candidate list with scores and selection reasons.
- **Step 2 (Haiku)**: Given only the selected candidates (~5-8 tasks, not the full goal tree), generate: (a) behavior-aware sequencing, (b) "why today" copy per task, (c) encouragement/recap text.

This eliminates the 3 agent Haiku calls AND replaces the Sonnet call with a much shorter Haiku call. The prompt shrinks from ~6,000 tokens to ~1,500 tokens. Total latency drops from ~9-16s to ~2-4s.

**#2-3, #10 — Async conversion for heavy commands**

`adjust-all-overloaded-plans` is the worst offender — it runs `cmdAdaptiveReschedule` sequentially for each goal, each taking 10-30s. With 3 goals, this blocks the UI for 30-90 seconds.

Pattern: Command handler inserts a job record, returns `{ ok: true, jobId }` immediately. Background worker processes the job and emits `view:invalidate` + `job:complete` via WebSocket. The existing `job_queue` table (migration 0001, currently unused) and `job-db.ts` stub can be activated for this.

**#4-6 — Agent-to-rule-engine migrations**

These are independent, low-risk changes. Each replaces a Haiku call with deterministic code. The scheduler replacement (interval packing) is the most complex but most impactful. The effort router replacement is the simplest (keyword matching + field checks).

**#7 — Memory token budget**

Simple change to `buildMemoryContext`: add a `maxTokens` parameter (default 800), truncate sections by priority when exceeded. Prevents prompt bloat for power users with large signal histories.

---

### Estimated Total Monthly Savings (if all 10 implemented)

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Tokens per daily-task cycle | ~12,000 | ~3,500 | **-71%** |
| Daily-task latency | ~9-16s | ~2-4s | **-75%** |
| Opus blocking commands | 3 commands block 10-30s each | 0 blocking (all async) | **-100% UI blocking** |
| Haiku calls per daily cycle | 3 (gatekeeper + timeEstimator + scheduler) | 0-1 (fallback only) | **-80%** |
| Memory tokens per call | 500-2,000 (unbounded) | 500-800 (capped) | **-40% average** |
