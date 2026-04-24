-- 0013: Goal methodology alignment.
-- Additive columns on `goals` to land methodology-layer state that was
-- previously only available as free-form text in `knowledge-base/*.md` or
-- computed on-the-fly. This is the "skeleton" layer per the methodology:
-- weekly budget, phase, funnel, skill map, pace snapshot, rationale, and
-- an override audit log so user edits persist separately from AI output.
--
-- No template table / archetype column. Keyword-triggered template
-- invocation is handled by RAG retrieval from `knowledge_chunks` — the
-- matched methodology file carries the archetype-specific structure
-- (funnel math, T-skill map, time-rhythm phases). See goalClarifier +
-- dashboardInsightAgent.
--
-- All existing goals get empty/null defaults. Fully additive: existing
-- code keeps working, new code reads these when present.

ALTER TABLE goals
  -- Personalization state captured from the clarifier / onboarding.
  ADD COLUMN IF NOT EXISTS weekly_hours_target    NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS current_phase          TEXT,
  -- Methodology "flesh" — archetype-specific, jsonb because shape varies
  -- by goal type. Job-search goals populate funnel_metrics + skill_map;
  -- learning goals leave them empty; habits ignore them entirely.
  ADD COLUMN IF NOT EXISTS funnel_metrics         JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS skill_map              JSONB NOT NULL DEFAULT '{}',
  -- Live labor-market data (open-role count, salary range, top JD skills,
  -- hiring cadence, fetchedAt). Populated by a future web_search pass;
  -- today the stub fetcher returns {}.
  ADD COLUMN IF NOT EXISTS labor_market_data      JSONB NOT NULL DEFAULT '{}',
  -- Plan-level rationale: one-paragraph "why this plan shape". Per-task
  -- rationale lives on daily_tasks.payload.rationale + goal_plan_nodes.
  ADD COLUMN IF NOT EXISTS plan_rationale         TEXT,
  -- Pace snapshot so the FE never has to wait on on-the-fly detection.
  ADD COLUMN IF NOT EXISTS pace_tasks_per_day     NUMERIC(4,2),
  ADD COLUMN IF NOT EXISTS pace_last_computed_at  TIMESTAMPTZ,
  -- User override audit trail. Append-only jsonb array of
  -- {ts, actor, field, oldValue, newValue, reason?}. Dashboard commands
  -- write here so user edits persist separately from AI-generated state
  -- and the agent can explain why it's adjusting around the user.
  ADD COLUMN IF NOT EXISTS override_log           JSONB NOT NULL DEFAULT '[]';
