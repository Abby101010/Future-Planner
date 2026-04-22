-- NorthStar — 0004_users_roadmap
--
-- Promotes `app_store.user` and `app_store.roadmap` (plus the
-- `deviceIntegrations` sub-key) out of the legacy JSON blob and into
-- proper per-entity tables, so the view/command layer can stop doing
-- read-merge-write on a JSON column and so `cmdUpdateSettings` becomes
-- atomic at the DB level.
--
-- This migration is ADDITIVE: app_store is NOT dropped. A follow-up
-- migration will remove it once no code paths read the legacy keys.
-- Safe to re-run; every DDL uses IF NOT EXISTS.

-- ── Users (one row per user) ─────────────────────────────
-- Primary key is user_id (singleton per tenant). The stable identity /
-- onboarding fields are columns; variable profile extras (age,
-- currentRole, education, location, context, timeAvailable, constraints,
-- moodBaseline, etc.) live in `payload` jsonb so we don't have to grow
-- columns every time the onboarding form changes.
--
-- Settings, weekly availability, and device integrations each have their
-- own jsonb column because they are read/written as cohesive blobs and
-- have their own update commands.
create table if not exists users (
  user_id              text not null,
  name                 text not null default '',
  goal_raw             text not null default '',
  onboarding_complete  boolean not null default false,
  settings             jsonb not null default '{}'::jsonb,
  weekly_availability  jsonb not null default '[]'::jsonb,
  device_integrations  jsonb not null default '{}'::jsonb,
  payload              jsonb not null default '{}'::jsonb,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  primary key (user_id)
);
create index if not exists idx_users_user on users(user_id);

-- ── Roadmap (one row per user) ───────────────────────────
-- Backs the legacy `Roadmap` object (migrating out of app_store.roadmap).
-- Singleton per user; the full object round-trips through `payload`
-- since the roadmap shape is hierarchical and we have no query that
-- needs indexed access to inner fields.
create table if not exists roadmap (
  user_id     text not null,
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (user_id)
);
create index if not exists idx_roadmap_user on roadmap(user_id);

-- ── Backfill from legacy app_store ──────────────────────
-- Copies existing rows out of app_store.{user,deviceIntegrations,roadmap}
-- into the new tables. Uses ON CONFLICT DO NOTHING so this is safe to
-- re-run and will NOT overwrite rows the new repos have already written.
-- After this migration runs the repo code reads from these tables only;
-- app_store is kept for one more release as a rollback parachute.

insert into users (
  user_id,
  name,
  goal_raw,
  onboarding_complete,
  settings,
  weekly_availability,
  device_integrations,
  payload
)
select
  u.user_id,
  coalesce(u.value->>'name', ''),
  coalesce(u.value->>'goalRaw', ''),
  coalesce((u.value->>'onboardingComplete')::boolean, false),
  coalesce(u.value->'settings', '{}'::jsonb),
  coalesce(u.value->'weeklyAvailability', '[]'::jsonb),
  coalesce(d.value, '{}'::jsonb),
  -- Stash every other UserProfile field (age, currentRole, education,
  -- location, context, timeAvailable, constraints, moodBaseline, etc.)
  -- in payload so no data is lost even when the typed columns grow later.
  (u.value
    - 'name'
    - 'goalRaw'
    - 'onboardingComplete'
    - 'settings'
    - 'weeklyAvailability')
from app_store u
left join app_store d
  on d.user_id = u.user_id and d.key = 'deviceIntegrations'
where u.key = 'user'
on conflict (user_id) do nothing;

insert into roadmap (user_id, payload)
select user_id, value
from app_store
where key = 'roadmap'
on conflict (user_id) do nothing;
