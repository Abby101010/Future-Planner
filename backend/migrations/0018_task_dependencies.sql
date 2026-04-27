-- Per-task prerequisites within a goal's plan tree.
--
-- Stores an array of task IDs that must be `completed` before this
-- task is considered "doable". Empty array (or NULL) means no
-- dependencies. Cross-goal deps are intentionally NOT modeled —
-- dependency resolution scopes per-goal and the daily plan composes
-- per-goal results into one global list at the merge layer.
--
-- Read side: backend/src/services/dependencyResolution.ts uses this
-- to swap blocked tasks for their unfinished prereqs during the
-- midnight L0 rollover sweep (planAdjustmentL0.ts).
--
-- Write side: AI plan generator emits dependsOn per task
-- (backend/core/src/ai/prompts/goalPlan.ts), normalizePlan validates
-- (rejects cycles, cross-goal refs, unknown ids), repos round-trip
-- the column through goalPlanRepo + dailyTasksRepo, materialization
-- copies plan-tree dependsOn onto daily_tasks.depends_on so the
-- runtime resolver doesn't have to JOIN through the plan tree.

-- daily_tasks gets a dedicated `depends_on` column (queryable JSONB)
-- because the runtime resolver hits it on every L0 sweep and we want
-- index-friendly access. goal_plan_nodes stores `dependsOn` inside
-- its existing `payload` JSONB (consistent with how priority,
-- category, completed, etc. are stored on task nodes), so no schema
-- change is needed there.

ALTER TABLE daily_tasks
  ADD COLUMN depends_on JSONB;
