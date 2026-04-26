-- 0017_pending_actions
--
-- Confirmation-card queue for AI-proposed mutations.
--
-- Invariant: chat is conversational. The AI MUST NOT mutate state
-- silently. Every action it proposes (reschedule task, regenerate plan,
-- acknowledge reminder, etc.) lands here as a `pending` row first. The
-- user explicitly accepts (`command:accept-pending-action`) or rejects
-- (`command:reject-pending-action`). Rejection is per-action and never
-- ends the chat session.
--
-- Server-side switch: `STARWARD_CHAT_AUTO_DISPATCH=1` is an emergency
-- opt-OUT that restores the old behavior (intents returned in SSE
-- response, FE auto-dispatches). Default is cards-required.
--
-- TTL: pending rows expire 24h after proposal. The hourly cron sweep
-- marks stale rows as `expired` so the active-pending list stays clean.

CREATE TABLE IF NOT EXISTS pending_actions (
  id                text not null,
  user_id           text not null,
  -- Underlying intent kind. Maps 1:1 to the dispatch handler that
  -- runs on accept. Examples: "reschedule-task", "regenerate-goal-plan",
  -- "acknowledge-reminder", "create-task".
  intent_kind       text not null,
  -- Args the underlying command would receive — same shape the AI
  -- would have emitted as part of the SSE intents[] array.
  intent_payload    jsonb not null default '{}'::jsonb,
  -- Human-readable description of the proposed action. Renders as the
  -- nudge body for v0.1.32 users and as the card title for the next
  -- FE release. Example: "Reschedule 'Read 朱自清《背影》' to Apr 28".
  proposed_summary  text not null default '',
  -- pending | accepted | rejected | expired
  status            text not null default 'pending',
  -- Free-text reason supplied with command:reject-pending-action.
  -- Surfaced to the AI's next turn so it can have a conversational
  -- follow-up ("Understood — what would you prefer instead?").
  rejection_reason  text,
  proposed_at       timestamptz not null default now(),
  resolved_at       timestamptz,
  expires_at        timestamptz not null default (now() + interval '24 hours'),
  -- Chat session that proposed it. Lets the next turn fetch
  -- recently-rejected actions for context, and lets the FE group
  -- cards by conversation.
  session_id        text,
  primary key (user_id, id)
);

CREATE INDEX IF NOT EXISTS idx_pending_actions_user_active
  ON pending_actions (user_id, status, proposed_at desc)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_pending_actions_expiry
  ON pending_actions (user_id, expires_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_pending_actions_session
  ON pending_actions (user_id, session_id, proposed_at desc)
  WHERE session_id IS NOT NULL;

-- RLS: defense-in-depth.
ALTER TABLE pending_actions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'pending_actions' AND policyname = 'users_own_pending_actions'
  ) THEN
    CREATE POLICY users_own_pending_actions ON pending_actions FOR ALL
      USING (auth.uid()::text = user_id)
      WITH CHECK (auth.uid()::text = user_id);
  END IF;
END $$;
