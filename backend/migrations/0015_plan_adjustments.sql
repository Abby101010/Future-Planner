-- 0015_plan_adjustments
--
-- Phase B of the plan-adjustment escalation work: an audit log of every
-- decision the escalation classifier makes, regardless of which level
-- (0-3) it routes to.
--
-- One row per adjustment event. Joins to llm_calls (migration 0014)
-- via the llm_call_ids array column for end-to-end cost attribution:
-- "this user's L1 rollover on 2026-04-26 used 3 LLM calls totalling
-- 0.42 cents."
--
-- Append-only from app code. Never updated, never deleted from the
-- mutator path. (Future GC tooling may prune rows older than N months,
-- but that's a separate operational concern.)

CREATE TABLE IF NOT EXISTS plan_adjustments (
  id                text not null,
  user_id           text not null,
  -- Goal touched by this adjustment. NULL for cross-goal events
  -- (e.g. daily-task rollover that spans multiple goals).
  goal_id           text,
  -- Escalation level the classifier chose: 0=pure algo, 1=scoped AI,
  -- 2=milestone regen, 3=full plan regen.
  level             smallint not null,
  -- What the adjustment touched: a single task, a whole day, one
  -- milestone subtree, or the full plan.
  scope             text not null,
  -- Snapshot of the inputs the classifier saw when it made the
  -- decision. Lets us recompute "would the new thresholds have
  -- routed this differently?" when tuning rules later.
  classifier_input  jsonb not null default '{}'::jsonb,
  -- Human-readable rationale (e.g. "pendingReschedules=8 over L0
  -- threshold of 5"). Same shape as triage rationales.
  rationale         text not null default '',
  -- Summary of what changed: array of { kind: "moved"|"demoted"|...,
  -- nodeId, fromDate?, toDate?, ... }. Lets the future plan-history
  -- viewer render a per-event diff without reconstructing state.
  actions           jsonb not null default '[]'::jsonb,
  -- IDs of llm_calls rows attributable to this adjustment. Empty
  -- array for L0 (zero-AI) events. Joined for cost attribution.
  llm_call_ids      text[] not null default '{}'::text[],
  created_at        timestamptz not null default now(),
  primary key (user_id, id)
);

-- Recent adjustments per user — drives the eventual plan-history
-- viewer and the cost surface.
CREATE INDEX IF NOT EXISTS idx_plan_adjustments_user_created
  ON plan_adjustments (user_id, created_at desc);

-- Per-goal adjustment timeline — drives the per-goal-page history.
CREATE INDEX IF NOT EXISTS idx_plan_adjustments_goal_created
  ON plan_adjustments (goal_id, created_at desc)
  WHERE goal_id IS NOT NULL;

-- Per-level analytics — answers "what % of events landed at each level?"
-- for threshold recalibration.
CREATE INDEX IF NOT EXISTS idx_plan_adjustments_level_created
  ON plan_adjustments (level, created_at desc);

-- RLS: defense-in-depth.
ALTER TABLE plan_adjustments ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'plan_adjustments' AND policyname = 'users_own_plan_adjustments'
  ) THEN
    CREATE POLICY users_own_plan_adjustments ON plan_adjustments FOR ALL
      USING (auth.uid()::text = user_id)
      WITH CHECK (auth.uid()::text = user_id);
  END IF;
END $$;
