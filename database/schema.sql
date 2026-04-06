-- ══════════════════════════════════════════════════════════
--  人生规划师 (Life Planning Assistant) — Database Schema
--  PostgreSQL 17
-- ══════════════════════════════════════════════════════════

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
-- Enable vector similarity search (for RAG / knowledge base)
CREATE EXTENSION IF NOT EXISTS "vector";

-- ── ENUM types ──────────────────────────────────────────

CREATE TYPE life_stage AS ENUM (
  'student',
  'early_career',
  'mid_career',
  'senior_career',
  'career_transition',
  'retirement',
  'other'
);

CREATE TYPE plan_domain AS ENUM (
  'career',        -- 职业发展
  'finance',       -- 财务规划
  'health',        -- 健康管理
  'relationships', -- 人际关系
  'growth',        -- 个人成长
  'lifestyle',     -- 生活方式
  'family',        -- 家庭规划
  'purpose'        -- 精神追求
);

CREATE TYPE milestone_status AS ENUM (
  'pending',
  'in_progress',
  'completed',
  'skipped',
  'overdue'
);

CREATE TYPE message_role AS ENUM ('user', 'assistant', 'system');

-- ── 1. Users ────────────────────────────────────────────

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          VARCHAR(100) NOT NULL,
  age           INT,
  gender        VARCHAR(20),
  career        VARCHAR(200),
  education     VARCHAR(200),
  location      VARCHAR(200),
  life_stage    life_stage DEFAULT 'other',
  income_range  VARCHAR(50),
  interests     TEXT[],               -- array of interest tags
  values        TEXT[],               -- core values
  constraints   TEXT,                 -- time/financial/health constraints
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 2. Conversation Sessions ────────────────────────────

CREATE TABLE conversation_sessions (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_type  VARCHAR(50) NOT NULL DEFAULT 'onboarding',
                -- 'onboarding', 'planning', 'check_in', 'adjustment'
  title         VARCHAR(300),
  summary       TEXT,                 -- AI-generated session summary
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at      TIMESTAMPTZ,
  is_active     BOOLEAN DEFAULT TRUE
);

CREATE INDEX idx_sessions_user ON conversation_sessions(user_id);
CREATE INDEX idx_sessions_active ON conversation_sessions(user_id, is_active);

-- ── 3. Messages (conversation history) ──────────────────

CREATE TABLE messages (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id    UUID NOT NULL REFERENCES conversation_sessions(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role          message_role NOT NULL,
  content       TEXT NOT NULL,
  metadata      JSONB DEFAULT '{}',   -- token count, model used, etc.
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_messages_session ON messages(session_id, created_at);
CREATE INDEX idx_messages_user ON messages(user_id, created_at);

-- ── 4. Life Plans (top-level plan per domain) ───────────

CREATE TABLE life_plans (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  domain        plan_domain NOT NULL,
  title         VARCHAR(300) NOT NULL,
  description   TEXT,
  goal_summary  TEXT NOT NULL,
  target_date   DATE,
  philosophy    TEXT,                 -- AI-generated planning philosophy
  confidence    VARCHAR(20) DEFAULT 'medium',
  plan_data     JSONB DEFAULT '{}',   -- full structured plan from AI
  version       INT DEFAULT 1,
  is_active     BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_plans_user ON life_plans(user_id);
CREATE INDEX idx_plans_domain ON life_plans(user_id, domain);
CREATE UNIQUE INDEX idx_plans_active ON life_plans(user_id, domain) WHERE is_active = TRUE;

-- ── 5. Milestones ───────────────────────────────────────

CREATE TABLE milestones (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  plan_id       UUID NOT NULL REFERENCES life_plans(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title         VARCHAR(300) NOT NULL,
  description   TEXT,
  reasoning     TEXT,                 -- why this milestone matters
  done_criteria TEXT,                 -- clear completion criteria
  target_date   DATE,
  sort_order    INT DEFAULT 0,
  status        milestone_status DEFAULT 'pending',
  key_risk      TEXT,
  contingency   TEXT,
  completed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_milestones_plan ON milestones(plan_id, sort_order);
CREATE INDEX idx_milestones_user ON milestones(user_id, status);

-- ── 6. Tasks (daily / weekly actionable items) ──────────

CREATE TABLE tasks (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  milestone_id  UUID REFERENCES milestones(id) ON DELETE SET NULL,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title         VARCHAR(500) NOT NULL,
  description   TEXT,
  domain        plan_domain,
  scheduled_date DATE,
  estimated_minutes INT,
  priority      INT DEFAULT 3,        -- 1 = highest, 5 = lowest
  is_completed  BOOLEAN DEFAULT FALSE,
  completed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tasks_user_date ON tasks(user_id, scheduled_date);
CREATE INDEX idx_tasks_milestone ON tasks(milestone_id);

-- ── 7. Daily Logs (daily check-in records) ──────────────

CREATE TABLE daily_logs (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  log_date      DATE NOT NULL,
  tasks_total   INT DEFAULT 0,
  tasks_done    INT DEFAULT 0,
  completion_pct DECIMAL(5,2) DEFAULT 0,
  mood_score    INT CHECK (mood_score BETWEEN 1 AND 5),
  mood_note     TEXT,
  energy_level  INT CHECK (energy_level BETWEEN 1 AND 5),
  reflection    TEXT,                 -- user's daily reflection
  blockers      TEXT[],               -- what got in the way
  ai_feedback   JSONB DEFAULT '{}',   -- AI-generated daily feedback
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_daily_logs_unique ON daily_logs(user_id, log_date);
CREATE INDEX idx_daily_logs_user ON daily_logs(user_id, log_date DESC);

-- ── 8. Heatmap Data (GitHub-style activity tracking) ────

CREATE TABLE heatmap_entries (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entry_date    DATE NOT NULL,
  level         INT DEFAULT 0 CHECK (level BETWEEN 0 AND 4),
                -- 0=none, 1=low, 2=medium, 3=high, 4=max
  tasks_done    INT DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_heatmap_unique ON heatmap_entries(user_id, entry_date);

-- ── 9. Recovery Records (when user misses tasks) ────────

CREATE TABLE recovery_records (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  log_date      DATE NOT NULL,
  blocker_type  VARCHAR(100),         -- e.g., 'overwhelmed', 'sick', 'busy'
  blocker_detail TEXT,
  ai_response   JSONB DEFAULT '{}',   -- AI recovery/adjustment plan
  plan_adjusted BOOLEAN DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_recovery_user ON recovery_records(user_id, log_date);

-- ── 10. Knowledge Base (for RAG retrieval) ──────────────

CREATE TABLE knowledge_base (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  category      VARCHAR(100) NOT NULL, -- 'career', 'finance', 'health', etc.
  subcategory   VARCHAR(100),
  title         VARCHAR(300) NOT NULL,
  content       TEXT NOT NULL,
  source        VARCHAR(500),         -- where the info came from
  tags          TEXT[],
  embedding     vector(1536),         -- for semantic search (OpenAI dimension)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_kb_category ON knowledge_base(category);
CREATE INDEX idx_kb_tags ON knowledge_base USING GIN(tags);
-- Vector similarity index (use after you have data)
-- CREATE INDEX idx_kb_embedding ON knowledge_base USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- ── 11. Plan Adjustments (version history) ──────────────

CREATE TABLE plan_adjustments (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  plan_id       UUID NOT NULL REFERENCES life_plans(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason        TEXT,                 -- why the adjustment was made
  old_data      JSONB,                -- snapshot of previous plan
  new_data      JSONB,                -- snapshot of adjusted plan
  adjusted_by   VARCHAR(20) DEFAULT 'ai', -- 'ai' or 'user'
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_adjustments_plan ON plan_adjustments(plan_id, created_at);

-- ── 12. User Settings / Preferences ─────────────────────

CREATE TABLE user_settings (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id             UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  enable_mood_logging BOOLEAN DEFAULT FALSE,
  enable_news_feed    BOOLEAN DEFAULT FALSE,
  daily_reminder_time TIME DEFAULT '08:00',
  theme               VARCHAR(20) DEFAULT 'dark',
  language            VARCHAR(10) DEFAULT 'zh',  -- 'zh' or 'en'
  ai_model            VARCHAR(100) DEFAULT 'claude-sonnet-4-6',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Auto-update timestamps ──────────────────────────────

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated
  BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_plans_updated
  BEFORE UPDATE ON life_plans FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_milestones_updated
  BEFORE UPDATE ON milestones FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_kb_updated
  BEFORE UPDATE ON knowledge_base FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_settings_updated
  BEFORE UPDATE ON user_settings FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ══════════════════════════════════════════════════════════
--  Schema complete ✅
-- ══════════════════════════════════════════════════════════
