# Phase 2 Design: Targeted Optimizations

> **Date**: 2026-04-16
> **Scope**: 6 targeted optimizations. No structural rewrites. All existing command/query contracts preserved.
> **Approach**: Each optimization is independent and can be implemented + tested in isolation.

---

## Overview

| # | Optimization | Complexity | Dependencies |
|---|-------------|-----------|--------------|
| 1 | Pace detection → client-side | S | None |
| 2 | Daily task generation two-step split | L | None (replaces existing pipeline) |
| 3 | WS scoped invalidation + direct state push | M | Minor frontend changes |
| 4 | Memory token budget + reflection aggregation | S | None |
| 5 | Big goal coordinator async | M | Job queue activation |
| 6 | Model tier adjustments | S | None |

**Implementation order**: 1 → 4 → 6 → 3 → 2 → 5
(Independent items first, most complex last)

---

## 1. Pace Detection Client-Side

### Current State
- `packages/server/src/services/paceDetection.ts` (296 lines) — pure math, no AI
- Functions: `detectPaceMismatches()`, `detectCrossGoalOverload()`, `splitPlan()`, `mergePlans()`
- Called from server views/commands
- Client must make a network call to get pace data

### Design

**Move to**: `packages/core/src/domain/paceDetection.ts` (shared between client and server)

Already exists at server path. The functions are pure — they take `Goal[]` + numbers and return results. No DB access, no side effects.

**Steps**:
1. Copy `detectPaceMismatches()`, `detectCrossGoalOverload()`, `splitPlan()`, `mergePlans()`, `countPlanStats()` and helper functions to `packages/core/src/domain/paceDetection.ts`
2. Export from `packages/core` barrel
3. Update `packages/server/src/services/paceDetection.ts` to re-export from core (backward compat)
4. Desktop client can now import directly from `@starward/core` and compute locally

**Interface** (unchanged):

```typescript
// packages/core/src/domain/paceDetection.ts
export function detectPaceMismatches(
  goals: Goal[],
  avgTasksCompletedPerDay: number,
  today: string,
): PaceMismatch[];

export function detectCrossGoalOverload(
  goals: Goal[],
  avgTasksCompletedPerDay: number,
  maxDailyTasks: number,
  today: string,
): OverloadAdvisory[];

export function splitPlan(plan: GoalPlan): PlanSplit;
export function mergePlans(pastPlan: GoalPlan, futurePlan: GoalPlan): GoalPlan;
```

**Risk**: None. Pure function relocation. Server re-exports maintain backward compat.

---

## 2. Daily Task Generation Two-Step Split

### Current State

`generateAndPersistDailyTasks()` runs a 4-call AI pipeline:
1. Gatekeeper (Haiku) — filter + score
2. TimeEstimator (Haiku) — estimate durations
3. Scheduler (Haiku) — calendar slots
4. `handleDailyTasks` (Sonnet) — generate tasks, reasoning, copy

Total: ~12,000 input tokens, ~9-16s latency.

### Design

Split into two phases:

#### Phase A: Deterministic Rule Engine (code only)

New file: `packages/server/src/services/dailyTaskRuleEngine.ts`

```typescript
export interface ScoredCandidate {
  /** The original task from the goal plan */
  planNodeId: string;
  goalId: string;
  goalTitle: string;
  title: string;
  description: string;
  durationMinutes: number;
  category: string;
  /** Computed scores (0-10 each) */
  scores: {
    deadlinePressure: number;    // higher = closer to deadline
    rotationRecency: number;     // higher = goal hasn't been worked on recently
    importanceWeight: number;    // from goal.importance
    capacityFit: number;         // how well it fits remaining budget
    categoryBalance: number;     // penalize over-represented categories
    totalScore: number;          // weighted sum
  };
  /** Why this task was selected (deterministic reason code) */
  selectionReason: string;
  /** Computed cognitive weight */
  cognitiveWeight: number;
  /** Computed priority tier */
  priority: "must-do" | "should-do" | "bonus";
}

export interface RuleEngineResult {
  /** Selected tasks, ordered by score (highest first) */
  selectedTasks: ScoredCandidate[];
  /** Tasks that were considered but not selected */
  droppedTasks: Array<ScoredCandidate & { dropReason: string }>;
  /** Budget summary */
  budget: {
    totalWeight: number;
    maxWeight: number;
    totalDuration: number;
    maxDuration: number;
    taskCount: number;
    maxTasks: number;
  };
}

export function selectDailyTasks(input: {
  date: string;
  goalPlanSummaries: GoalPlanSummary[];
  everydayGoals: EverydayGoalSummary[];
  repeatingGoals: RepeatingGoalSummary[];
  confirmedQuickTasks: QuickTaskSummary[];
  capacityProfile: CapacityProfile;
  goalLastTouched: Record<string, { daysSince: number }>;
  todayFreeMinutes: number;
}): RuleEngineResult;
```

**Scoring formula**:
```
deadlinePressure = clamp(0, 10, 10 * (1 - daysRemaining / totalDays))
rotationRecency = clamp(0, 10, daysSinceLastWorked / 3)
importanceWeight = { critical: 10, high: 7, medium: 5, low: 3 }
capacityFit = fits budget ? 8 : 2
categoryBalance = 8 - (2 * sameCategory count today)
totalScore = deadline*3 + rotation*2 + importance*2 + capacity*1.5 + balance*1.5
```

**Selection algorithm**:
1. Collect ALL candidates: goal plan tasks for today + everyday tasks + repeating goals
2. Pre-insert confirmed quick tasks (user-created, mandatory)
3. Score all remaining candidates
4. Sort by totalScore descending
5. Greedily select tasks that fit within cognitive budget + duration budget + task count limit
6. Ensure at least 1 task per goal (rotation guarantee) if budget allows
7. Return selected + dropped with reasons

**What this replaces**: gatekeeper agent (filter + score), time estimator agent (use `taskTimings` lookup), scheduler agent (use interval packing for calendar slots).

#### Phase B: Lightweight AI (Haiku)

Modify `handleDailyTasks` to accept pre-selected tasks and generate only:
1. **Behavior-aware sequencing**: reorder selected tasks based on user energy patterns (momentum first, hardest mid-morning, etc.)
2. **"Why today" copy**: 1 sentence per task explaining why it was selected
3. **Adaptive reasoning**: 2-3 sentence summary of the day's plan logic
4. **Encouragement / yesterday recap**: motivational text

New handler signature:

```typescript
// packages/server/src/ai/handlers/dailyTasksCopy.ts
export async function handleDailyTasksCopy(
  client: Anthropic,
  payload: {
    date: string;
    selectedTasks: ScoredCandidate[];
    capacityProfile: CapacityProfile;
    yesterdayLog: DailyLog | null;
    memoryContext: string;  // token-budgeted (see optimization #4)
  },
): Promise<{
  /** Tasks in behavior-optimized order, with whyToday + sequencing rationale */
  tasks: Array<{
    planNodeId: string;
    sequenceOrder: number;
    whyToday: string;
  }>;
  adaptiveReasoning: string;
  encouragement: string;
  yesterdayRecap: string | null;
}>;
```

**Prompt size**: ~1,000-2,000 tokens (just the 3-5 selected tasks + capacity context + brief memory). Down from ~6,000-8,000.

**Model**: Haiku (light tier). Down from Sonnet (medium tier).

#### Updated Flow

```
generateAndPersistDailyTasks()
  ├─ Load goals, logs, heatmap, reminders, memory     ~50ms (DB)
  ├─ computeCapacityProfile()                          ~1ms (code)
  ├─ selectDailyTasks() ← NEW RULE ENGINE              ~5ms (code)
  ├─ handleDailyTasksCopy() ← NEW HAIKU CALL           ~2-3s (Haiku)
  └─ Persist tasks to DB                               ~50ms (DB)
  Total: ~2-4s (down from 9-16s)
```

**Backward compatibility**: Output shape (`GeneratedResult`) unchanged. The persistence logic in `generateAndPersistDailyTasks` doesn't change. Only the middle steps change.

**Traceability**: `ScoredCandidate.scores` and `selectionReason` can be stored in the task payload for debugging ("why wasn't X selected?" → check `droppedTasks[].dropReason`).

### Migration Path

1. Implement `selectDailyTasks()` with tests
2. Implement `handleDailyTasksCopy()` 
3. Update `generateAndPersistDailyTasks()` to use new path
4. Remove `needsCoordination("daily-tasks")` branch (no more agent coordinator for daily tasks)
5. Keep old `handleDailyTasks` handler for other callers (if any) — can remove later

---

## 3. WebSocket Scoped Invalidation + Direct State Push

### Current State

Command handlers emit `view:invalidate` with a list of view kinds:
```typescript
emitViewInvalidate(userId, ["view:dashboard", "view:tasks", "view:calendar"]);
```

Client receives this and refetches ALL listed views regardless of relevance.

### Design

#### 3a. Scoped Invalidation Payload

Add optional scope to the invalidation event:

```typescript
// Updated event shape
interface ViewInvalidateEvent {
  views: QueryKind[];
  /** Optional scope — client can ignore if not relevant */
  scope?: {
    entityId?: string;     // e.g., taskId, goalId
    entityType?: string;   // "task" | "goal" | "reminder"
    date?: string;         // affected date (ISO)
    dateRange?: [string, string]; // affected date range
  };
}
```

**Server changes**: Command handlers that operate on a specific entity pass the scope:

```typescript
// In cmdToggleTask:
emitViewInvalidate(userId, views, {
  entityId: taskId,
  entityType: "task",
  date: task.date,
});
```

**Frontend changes**: `useQuery` hooks check scope before refetching:
- If scope.date is set and doesn't match the currently viewed date → skip refetch
- If scope.entityType is "task" and current view is "roadmap" → skip refetch

#### 3b. Direct State Push for High-Frequency Mutations

For `toggle-task` and `acknowledge-reminder`, push the updated state directly:

```typescript
// New WS event type
interface EntityPatchEvent {
  kind: "entity:patch";
  entityType: "task" | "reminder";
  entityId: string;
  patch: Record<string, unknown>;  // partial update
}
```

**Server changes**: After toggling a task, emit both:
1. `entity:patch` with `{ completed: true, completedAt: "..." }` (for instant local update)
2. `view:invalidate` with scope (for background consistency)

**Frontend changes**: 
- Add a `useEntityPatch` hook that listens for `entity:patch` events
- On receiving a patch, update the local query cache directly (optimistic)
- The `view:invalidate` still fires as a fallback for full consistency

**Commands to optimize**:

| Command | Scoped Invalidation | Direct State Push |
|---------|--------------------|--------------------|
| `toggle-task` | Yes (date + taskId) | Yes (completed flag) |
| `skip-task` | Yes (date + taskId) | Yes (skipped flag) |
| `acknowledge-reminder` | Yes (reminderId) | Yes (acknowledged flag) |
| `confirm-daily-tasks` | Yes (date) | No (too complex) |
| `update-task` | Yes (date + taskId) | No (full update too large) |

**Risk**: Race conditions between optimistic patch and delayed view:invalidate refetch. Mitigate: the refetch replaces the optimistic state, so the worst case is a brief flicker if the patch was wrong (which shouldn't happen for simple toggles).

---

## 4. Memory Token Budget + Reflection Aggregation

### Current State

`buildMemoryContext()` includes all high-confidence facts, up to 12 feedback timeline entries, all behavioral insights, up to 8 semantic preferences, plus a context directive. No token cap. Power users could have 2,000+ tokens of memory context.

### Design

#### 4a. Token Budget per Context Type

Add `maxTokens` parameter to `buildMemoryContext`:

```typescript
const MEMORY_TOKEN_BUDGET: Record<string, number> = {
  daily: 800,       // Daily task generation — needs capacity + patterns
  planning: 1000,   // Goal planning — needs more context
  recovery: 600,    // Recovery — needs motivation + blockers
  general: 600,     // Chat — lighter context
};

export function buildMemoryContext(
  memory: MemoryStore,
  contextType: string,
  contextTags?: string[],
  maxTokens?: number,  // NEW — override default for context type
): string;
```

**Token estimation**: Use simple heuristic: `tokens ≈ text.length / 4` (average for English text). No need for a tokenizer dependency.

**Priority ordering for truncation**:
1. Context directive (always include, ~50-100 tokens)
2. Top 5 high-confidence facts by relevance to context type (~200 tokens)
3. Top 5 feedback timeline entries (~200 tokens)
4. Top 3 behavioral insights (~150 tokens)
5. Chronically snoozed tasks (daily/recovery only, ~50 tokens)
6. Duration calibrations (planning/daily only, ~100 tokens)
7. Semantic preferences (fill remaining budget)

Each section is generated, measured, and included only if budget remains.

#### 4b. Signal Aggregation in Reflection

Modify the reflection engine to aggregate similar signals:

```typescript
// In reflection.ts — add aggregation step
function aggregateSignals(signals: BehavioralSignal[]): BehavioralSignal[] {
  // Group by type + context (e.g., "task_completed" + "category:learning")
  // If group has >= 5 entries, merge into 1 summary signal with count
  // Example: 8x "task_completed, category:learning" → 
  //          1x "task_completed, category:learning, count:8, period:14d"
}
```

**When**: Run during nightly reflection cycle (already scheduled).

**Retention policy**: Keep individual signals for 30 days, then aggregate. Keep aggregated signals indefinitely but cap at 100 per user.

**Risk**: Low. Aggregation is additive — original signals stay for 30 days. Worst case: a buggy aggregation loses some detail, but the 30-day retention of originals provides a safety net.

---

## 5. Big Goal Coordinator Async

### Current State

`cmdRegenerateGoalPlan` and `cmdAdaptiveReschedule` block the HTTP response for 10-30s. `cmdAdjustAllOverloadedPlans` blocks for N x 10-30s (sequential per goal).

`job-db.ts` is a stub (returns synthetic UUID). `job_queue` table exists in migration 0001 but is unused.

### Design

#### Job Queue Activation

Activate the existing `job_queue` table. Replace the stub in `job-db.ts` with real Postgres-backed operations:

```typescript
// packages/server/src/job-db.ts
export interface Job {
  id: string;
  type: string;
  status: "queued" | "running" | "succeeded" | "failed";
  payload: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  userId: string;
}

export async function insertJob(
  type: string,
  payload: Record<string, unknown>,
): Promise<string>;  // returns job ID

export async function claimJob(jobId: string): Promise<Job | null>;
export async function completeJob(jobId: string, result: Record<string, unknown>): Promise<void>;
export async function failJob(jobId: string, error: string): Promise<void>;
export async function getJob(jobId: string): Promise<Job | null>;
```

#### Background Worker

New file: `packages/server/src/jobs/worker.ts`

```typescript
export function startJobWorker(): void {
  // Poll job_queue every 2s for queued jobs
  // For each: claimJob → run handler → completeJob/failJob
  // On complete: emit WS view:invalidate + job:complete
}
```

**Job handlers** (new file: `packages/server/src/jobs/handlers.ts`):

```typescript
const JOB_HANDLERS: Record<string, (job: Job) => Promise<Record<string, unknown>>> = {
  "regenerate-goal-plan": async (job) => {
    // Same logic as cmdRegenerateGoalPlan but without HTTP context
    // Uses job.userId for request context
  },
  "adaptive-reschedule": async (job) => {
    // Same logic as cmdAdaptiveReschedule
  },
  "adjust-all-overloaded": async (job) => {
    // Runs per-goal reschedule sequentially, emits progress per goal
  },
};
```

#### Command Handler Changes

```typescript
// Before (blocking):
export async function cmdRegenerateGoalPlan(body): Promise<unknown> {
  const result = await runAI("generate-goal-plan", payload, "planning");
  // ... persist ...
  return { ok: true, goalId, reply };
}

// After (async):
export async function cmdRegenerateGoalPlan(body): Promise<unknown> {
  const jobId = await insertJob("regenerate-goal-plan", {
    goalId, payload, userId: getCurrentUserId()
  });
  return { ok: true, goalId, jobId, status: "queued" };
}
```

#### WS Events

```typescript
// New event kinds (add to protocol/kinds.ts)
"job:progress"   // { jobId, phase, message }
"job:complete"   // { jobId, type, result }
"job:failed"     // { jobId, type, error }
```

#### Frontend Consumption

When `cmdRegenerateGoalPlan` returns `{ jobId, status: "queued" }`:
1. UI shows a "Planning in progress..." indicator
2. Listens for `job:progress` events to show status updates
3. On `job:complete`, refetches the goal-plan view
4. On `job:failed`, shows error message

**Commands to make async**:

| Command | Current Latency | After |
|---------|----------------|-------|
| `regenerate-goal-plan` | 10-30s | Instant return + background |
| `adaptive-reschedule` | 10-30s | Instant return + background |
| `adjust-all-overloaded-plans` | N x 10-30s | Instant return + per-goal progress |

**Risk**: 
- Job worker crash mid-execution → job stays in "running" state. Mitigate: add a 5-minute timeout; jobs not completed within timeout auto-fail and can be retried.
- User closes app during job → job still completes server-side, result available on next open.

---

## 6. Model Tier Adjustments

### Current State (confirmed correct)

```
heavy:  claude-opus-4-6       → generate-goal-plan, goal-breakdown, reallocate, goal-research
medium: claude-sonnet-4-6     → daily-tasks, onboarding, goal-plan-chat, goal-plan-edit, home-chat
light:  claude-haiku-4-5      → recovery, pace-check, classify-goal, analyze-quick-task, etc.
```

### Changes (per user decision: keep Opus for heavy)

No tier default changes. One task-level reassignment:

1. After optimization #2 is implemented, `daily-tasks` moves from `medium` → `light` (Haiku), since the new `handleDailyTasksCopy` is a lightweight copywriting call.

This is a natural consequence of #2, not a separate change.

---

## Risk Summary

| Risk | Severity | Mitigation |
|------|----------|------------|
| Rule engine selects wrong tasks | Medium | Keep `droppedTasks` with scores for debugging. Compare output with old pipeline on 20+ historical inputs before switching. |
| Job worker crashes | Low | Timeout + auto-fail + retry. Existing WS streaming works as fallback. |
| Memory token truncation loses important context | Low | Priority ordering ensures high-confidence facts always included. 30-day signal retention before aggregation. |
| WS optimistic patches cause flicker | Low | `view:invalidate` refetch overwrites optimistic state. Toggle is idempotent. |
| Daily task quality drops with Haiku | Medium | A/B compare: run both old Sonnet and new Haiku paths on same input for 20 cases. If quality drops, adjust prompt or bump to Sonnet with smaller prompt. |

---

## Verification Plan

For each optimization:

1. **Pace detection**: Unit tests for `detectPaceMismatches` and `detectCrossGoalOverload` in core package. Import from both core and server — verify same results.

2. **Daily task two-step**: 
   - Unit tests for `selectDailyTasks()` with 10+ scenarios (single goal, multi-goal rotation, budget overflow, deadline pressure, category balance).
   - Integration test: compare old pipeline output vs new pipeline output on 5 historical daily-task inputs. Structural fields must match; copy text may differ.
   - Manual test: generate daily tasks in the app, verify task selection makes sense.

3. **WS invalidation**: 
   - Manual test: toggle a task on the tasks page, verify only tasks view refetches (not dashboard, calendar, etc. unless viewing them).
   - Manual test: toggle task while on dashboard — verify it doesn't trigger tasks view refetch.

4. **Memory token budget**: Unit test: create a memory store with 200+ facts, verify `buildMemoryContext` output stays under budget. Verify high-confidence facts are always included.

5. **Job queue**: 
   - Manual test: trigger `regenerate-goal-plan`, verify instant response with jobId. Verify WS push when job completes. Verify goal plan updated in DB.
   - Test job timeout: kill worker mid-job, verify job auto-fails after timeout.

6. **Model tiers**: Verified by #2 implementation — daily-tasks uses Haiku after switch.
