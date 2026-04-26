-- 0014_llm_calls
--
-- Phase A of the plan-adjustment escalation work: a thin per-call ledger
-- of every Anthropic SDK invocation, populated by a Proxy wrapper around
-- the shared `getClient()` factory in src/ai/client.ts.
--
-- Why: the escalation system targets ~$0.50/user/month in AI cost. That
-- target is unverifiable without measurement. This table is the source
-- of truth for "what did this user actually spend on AI in the last N
-- days" and underpins every later cost-aware decision (classifier
-- threshold tuning, per-user rate limits, billing surfaces, etc.).
--
-- Append-only: no updates, no deletes from app code. Indexes optimized
-- for two access patterns:
--   1. "Recent calls for this user" (cost surface, settings page)
--   2. "All calls of kind X over the last 30 days" (analytics, threshold
--      recalibration)
--
-- Failure-tolerant by design: insert errors must not block the AI call
-- itself. The logger swallows + logs and returns. Losing a row is a soft
-- failure; halting an in-flight LLM call would be a hard one.

CREATE TABLE IF NOT EXISTS llm_calls (
  id              text not null,
  user_id         text not null,
  -- Coarse-grained label for which agent/handler made the call.
  -- Examples: "scheduler", "gatekeeper", "priorityAnnotator",
  -- "regen-goal-plan", "chat", "duration-estimator", "critique".
  -- Read by analytics queries to see where spend concentrates.
  kind            text not null,
  -- Anthropic model id, exactly as sent to the SDK. Used to compute
  -- cost_cents at insert time via the price table in core/domain/models.
  model           text not null,
  -- Token counts as reported by the SDK response.usage. For streaming
  -- calls, populated from the final-message event.
  input_tokens    integer not null default 0,
  output_tokens   integer not null default 0,
  cache_creation_input_tokens integer not null default 0,
  cache_read_input_tokens     integer not null default 0,
  -- Cost in USD cents (numeric, 4 decimal places — fractional cents
  -- matter at Haiku rates). Computed once at insert; never recomputed
  -- from token counts after the fact (price table changes shouldn't
  -- silently rewrite history).
  cost_cents      numeric(10, 4) not null default 0,
  -- Wall-clock time the SDK call took. Useful for spotting slow
  -- prompts and capacity planning.
  duration_ms     integer,
  -- Anthropic response.id. Helpful for support cases.
  request_id      text,
  -- Originating user-facing event. Examples: "daily-rollover",
  -- "user-refresh", "chat-message", "onboarding". Often distinct from
  -- `kind` (one trigger can fan out into multiple kinds).
  trigger         text,
  -- Free-form metadata for things that don't deserve a column yet
  -- (prompt template version, stop_reason, retry count, etc).
  payload         jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  primary key (user_id, id)
);

-- Recent calls per user — drives the cost surface and the rate limiter.
CREATE INDEX IF NOT EXISTS idx_llm_calls_user_created
  ON llm_calls (user_id, created_at desc);

-- Per-kind analytics — drives threshold recalibration and "where are we
-- spending" dashboards.
CREATE INDEX IF NOT EXISTS idx_llm_calls_kind_created
  ON llm_calls (kind, created_at desc);

-- RLS: defense-in-depth (server connects as superuser and bypasses).
ALTER TABLE llm_calls ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'llm_calls' AND policyname = 'users_own_llm_calls'
  ) THEN
    CREATE POLICY users_own_llm_calls ON llm_calls FOR ALL
      USING (auth.uid()::text = user_id)
      WITH CHECK (auth.uid()::text = user_id);
  END IF;
END $$;
