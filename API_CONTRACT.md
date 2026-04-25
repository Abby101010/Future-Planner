# API Contract — Future-Planner / Starward

Source-of-truth mapping: Page → Feature → Interaction → API.
Frontend runs locally (Electron/Vite). Backend runs remotely. They communicate only over HTTP (plus WebSocket for view-invalidation events).

Last audited: 2026-04-24.
Last updated: 2026-04-24 — **Goal methodology alignment (migration 0013 + planner upgrade).** ⚠ **NEW RESPONSE FIELDS — READ BEFORE BUILDING FE:** (1) `view:goal-plan` now returns flat `milestones: GoalPlanMilestone[]` alongside `plan` (FE was ported to read `data.milestones`; backend previously only nested them under `plan.milestones`). `progress` gains `paceDelta?: string`. Observable-state table updated. (2) `view:planning` goals now carry the full card-render field set FE GoalCard expects: `pace` (required; `"on-track" | "ahead" | "behind" | "paused"`; defaults to `"on-track"` until the planningView derivePace helper is replaced with a snapshot-aware reader), `paceDelta?`, `pct?`, `horizon?`, `nextMilestone?`, `nextDue?`, `openTasks?`. (3) Migration `0013_goal_methodology.sql` adds 9 columns on `goals`: `weekly_hours_target`, `current_phase`, `funnel_metrics jsonb`, `skill_map jsonb`, `labor_market_data jsonb`, `plan_rationale`, `pace_tasks_per_day`, `pace_last_computed_at`, `override_log jsonb`. Fully additive — existing goals default to empty / null. No `goal_templates` table (keyword-triggered template invocation stays in RAG retrieval from `knowledge_chunks`). (4) `GoalPlanMilestone` gains optional `rationale`. `GoalPlanTask` gains optional `rationale` + `taskType ∈ {"application"|"skill-building"|"practice"|"targeted-prep"|"other"}`. Planner prompt emits them on every new plan. Readers default to undefined / `"other"` when absent. (5) Dashboard edit commands (`update-goal-notes`, `edit-goal-title`, `edit-milestone`) now append to `goals.override_log` when the value changes. (6) `labor_market_data` is populated by a gated stub (env `STARWARD_LABOR_MARKET_ENABLED=1`) today — provider wiring lands in a follow-up session. — **NorthStar → Starward rename COMPLETE across every identifier.** Brand/display (191 files), Chinese subtitle 北极星 → 星程 (22 call sites), internal npm packages `@northstar/*` → `@starward/*` (200 imports + 3 package.json names + 1 vite alias; workspace symlinks regenerated), BullMQ queue `northstar-bg` → `starward-bg`, Fly app name `northstar-api` → `starward-api` (in `fly.toml`, `frontend/package.json` scripts, `frontend/.env.production`, `frontend/index.html` CSP, `.github/workflows/deploy-backend.yml`, backend/frontend READMEs, all architecture docs), Upstash Redis instance `northstar-redis` → `starward-redis` in docs. ⚠ **OPS BLOCKERS — read before the next deploy or Electron build:** (1) Fly app names are immutable — the deployed app is STILL named `northstar-api` in Fly. Next `fly deploy` will fail because `fly.toml` says `app = "starward-api"`. You must either (a) create a new `starward-api` Fly app, copy secrets (`fly secrets list -a northstar-api` → `fly secrets set ... -a starward-api`), deploy, swap DNS/traffic, then destroy the old app; or (b) revert `fly.toml`'s `app = "..."` line until the Fly app is recreated. (2) Same for `starward-redis` — the deployed Upstash instance is `northstar-redis`; the string change is documentation-only unless you create a new instance and rewire `REDIS_URL`. (3) Running `electron:dev` or `electron:build:*` now sets `VITE_CLOUD_API_URL=https://starward-api.fly.dev` — DNS for that host does NOT resolve yet, so the Electron app CANNOT reach the backend until the Fly app rename is complete. Earlier this session: **Tasks page contract cleanup + Calendar view extended + onboarding rebuild + time map removal.** Earlier this session: **Tasks page contract cleanup + Calendar view extended + onboarding rebuild + time map removal.** Tasks page "Image-to-todos" merged into a single "Add task" feature (text + image are two input modes on one widget, both resolve to `command:create-task`). "Active goals" pause/resume feature removed from Today — lives on Planning / Goal Plan / per-goal Dashboard instead. No backend changes for either. Earlier this session: Calendar view extended, onboarding rebuild, time map removal. `view:calendar` now returns `reminders` (filtered to the date range) and `countsByDate` (per-date task + reminder tallies) so the pending month-grid UI can render count badges and a click-a-date side view without extra queries. Drag-and-drop in day/week views maps to the existing `command:set-task-time-block` (move/resize) and `command:reschedule-task` (cross-day) — no new commands. Reminder commands now invalidate `view:calendar`. Earlier this session: **Onboarding rebuild + time map removal.** Backend-complete 7-step conversational onboarding (2 new agents, 5 new commands, new `view:onboarding` shape with step/messages/proposedGoal/firstTaskId/memoryFacts/memoryPreferences). Time map (`weeklyAvailability` / `TimeBlock`) fully removed from types, runtime, and frontend. **UI pending — see "Onboarding UI to build" under audit notes.** Prior updates: Dashboard Phases 2–6 + goalBreakdown tree (`view:goal-dashboard`, `goalClarifier` + `dashboardInsightAgent`, 5 dashboard commands, 9 methodology KB files).

---

## Section 1: Frontend pages

### One-time gated flows (not in sidebar)

    Login page (shown when no auth session)
    ├─ Feature: Email/password auth
    │   ├─ Email input                       → (no API, client-only)
    │   ├─ Password input                    → (no API, client-only)
    │   ├─ Mode dropdown (signin/signup)     → (no API, client-only)
    │   └─ Submit form                       → Supabase SDK: signInWithPassword or signUp
    ├─ Feature: Google OAuth
    │   ├─ Click "Sign in with Google"       → Supabase SDK: signInWithOAuth({provider:"google"})
    │   └─ OAuth callback (post-redirect)    → Supabase SDK: exchangeCodeForSession

    Welcome page (shown once on first launch)
    └─ (no interactions — "booting…" splash; redirects to Onboarding if new user else Tasks)

    Onboarding flow  (7 steps; backend complete; UI pending — all surfaces below need to be built)
    ├─ Feature: Onboarding state
    │   ├─ Page load                         → GET /view/onboarding  → returns {step, messages, proposedGoal, currentGoalId, firstTaskId, memoryFacts, memoryPreferences, onboardingComplete, timezone, greetingName, goalRaw}
    │   └─ Step is server-computed (welcome / discovery / goal-naming / clarification / plan-reveal / first-task / complete)
    │
    ├─ Feature: Skip onboarding (escape hatch, available on every step)
    │   └─ Click "Skip →" button (top-right of onboarding shell)
    │                                        → POST /commands/complete-onboarding  {}  → sets onboardingComplete=true on the user row; FE then navigates to `tasks`. No goal is created and no plan is generated — user arrives at an empty Today page and can use the "New goal" button from Planning whenever they want. Implemented on every step via `<SkipOnboardingButton>` in `frontend/src/pages/onboarding/OnboardingPage.tsx`.
    │
    ├─ Step 1 — Welcome
    │   ├─ Click "Get started"               → POST /commands/send-onboarding-message  {message:"hi"}  → seeds step=discovery + appends the first assistant turn to messages[]
    │   └─ Click "Skip →"                    → see "Skip onboarding" feature above
    │
    ├─ Step 2 — Sign up (via AuthGuard / LoginPage)
    │   ├─ Email+password                    → Supabase SDK: signInWithPassword / signUp
    │   └─ Google OAuth                      → Supabase SDK: signInWithOAuth
    │
    ├─ Step 3 — Discovery conversation (conversational AI intake)
    │   ├─ Type + send message               → POST /commands/send-onboarding-message  (AI writes facts/preferences/signals to memory; returns reply + shouldConclude)
    │   └─ AI reply auto-rendered from view:onboarding messages[]
    │
    ├─ Step 4 — Goal naming
    │   ├─ Auto: propose goal                → POST /commands/propose-onboarding-goal  (runs summarizer agent → proposedGoal stored on user payload)
    │   └─ Submit (confirm or edit)          → POST /commands/confirm-onboarding-goal  {title, description?, targetDate?, hoursPerWeek?, metadata?}  → creates Goal row
    │
    ├─ Step 5 — Contextual clarification
    │   └─ (reuses goalClarifier agent via the goal-plan flow — no new command needed; UI consumes the clarifier's output and records answers via command:update-goal → clarificationAnswers jsonb)
    │
    ├─ Step 6 — Plan reveal
    │   ├─ Auto: generate plan               → POST /commands/regenerate-goal-plan  (existing async job) seeded on the onboarding goalId
    │   ├─ Inline edit milestones/dates      → POST /commands/edit-milestone  (existing)
    │   └─ Click "accept plan"               → POST /commands/accept-onboarding-plan  {goalId}  → sets planConfirmed=true + status=active
    │
    └─ Step 7 — First task
        ├─ Click "yes, start"                → POST /commands/commit-first-task  {goalId, taskTitle?}  → seeds today's first task, marks onboardingComplete

    Legacy Onboarding page (still routable; superseded by the 7-step flow above)
    └─ Feature: Complete onboarding (legacy)
        ├─ Goal textarea                     → (no API, client-only)
        ├─ Click "complete"                  → POST /commands/complete-onboarding
        ├─ Settings JSON textarea            → (no API, client-only)
        └─ Click "update settings"           → POST /commands/update-settings

### Top-level pages (sidebar)

    Tasks page  (= Home / Today — landing after login; absorbs legacy Dashboard)
    ├─ Feature: Today overview
    │   ├─ Page load                         → GET /view/tasks  AND  GET /view/dashboard
    │   ├─ Click "refresh daily plan"        → POST /commands/refresh-daily-plan
    │   ├─ Click "regenerate daily tasks"    → POST /commands/regenerate-daily-tasks
    │   ├─ Click "confirm daily tasks"       → POST /commands/confirm-daily-tasks
    │   ├─ Click "generate bonus task"       → POST /commands/generate-bonus-task
    │   └─ Click "propose gap fillers"       → POST /commands/propose-gap-fillers
    ├─ Feature: Task CRUD
    │   ├─ Click "create task"               → POST /commands/create-task
    │   ├─ Click "update task"               → POST /commands/update-task
    │   ├─ Click "delete task"               → POST /commands/delete-task
    │   ├─ Click "toggle task"               → POST /commands/toggle-task
    │   ├─ Click "skip task"                 → POST /commands/skip-task
    │   ├─ Click "reschedule task"           → POST /commands/reschedule-task
    │   ├─ Click "can't complete"            → POST /commands/cant-complete-task
    │   └─ Click "delete tasks for date"     → POST /commands/delete-tasks-for-date
    ├─ Feature: Overflow / defer
    │   ├─ Click "defer overflow"            → POST /commands/defer-overflow
    │   ├─ Click "undo defer"                → POST /commands/undo-defer
    │   ├─ Click "snooze reschedule"         → POST /commands/snooze-reschedule
    │   ├─ Click "dismiss reschedule"        → POST /commands/dismiss-reschedule
    │   └─ Click "accept task proposal"      → POST /commands/accept-task-proposal
    ├─ Feature: Pending task triage
    │   ├─ Click "create pending task"       → POST /commands/create-pending-task
    │   ├─ Click "confirm" on pending        → POST /commands/confirm-pending-task
    │   └─ Click "reject" on pending         → POST /commands/reject-pending-task
    ├─ Feature: Add task  (one widget; two input modes side-by-side)
    │   ├─ Type a description + click "add"  → POST /commands/create-task
    │   ├─ Upload image (jpg/png/webp, 5MB)  → (no API, client-only file read)
    │   ├─ Click "analyze image"             → POST /commands/analyze-image  (returns extracted todos; no DB write)
    │   └─ Click "add" on extracted todo     → POST /commands/create-task  (same command as the text path)
    ├─ Feature: Reminders
    │   ├─ Click "upsert reminder"           → POST /commands/upsert-reminder
    │   ├─ Click "acknowledge" reminder      → POST /commands/acknowledge-reminder
    │   ├─ Click "delete" reminder           → POST /commands/delete-reminder
    │   └─ Click "delete reminders batch"    → POST /commands/delete-reminders-batch
    ├─ Feature: Nudges
    │   └─ Click "dismiss" nudge             → POST /commands/dismiss-nudge
    └─ Feature: Task time/priority upgrades
        ├─ Click "estimate task durations"   → POST /commands/estimate-task-durations
        ├─ Click "set task time block"       → POST /commands/set-task-time-block
        ├─ Click "set task project tag"      → POST /commands/set-task-project-tag
        └─ Click "submit priority feedback"  → POST /commands/submit-priority-feedback

    Calendar page  (current UI is a dev harness; month/week/day grid + side view are UI pending)
    ├─ Feature: Calendar overview
    │   ├─ Page load                         → GET /view/calendar?args={startDate,endDate,viewMode}
    │   └─ Click "refetch"                   → GET /view/calendar
    ├─ Feature: View mode switcher (UI pending)
    │   └─ Select month / week / day / project → GET /view/calendar with viewMode param
    ├─ Feature: Click-a-date side view (UI pending — month view)
    │   ├─ Click a date cell                 → (no API, client-only; reads view:calendar.tasks + .reminders filtered to that date)
    │   ├─ Toggle task complete              → POST /commands/toggle-task
    │   ├─ Acknowledge reminder              → POST /commands/acknowledge-reminder
    │   └─ Delete reminder                   → POST /commands/delete-reminder
    ├─ Feature: Week view (UI pending)
    │   └─ Per-day columns of scheduled tasks; reuses view:calendar with viewMode=week
    ├─ Feature: Day view drag-and-drop (UI pending)
    │   ├─ Drag block body (change start time)   → POST /commands/set-task-time-block
    │   ├─ Drag bottom edge (resize duration)    → POST /commands/set-task-time-block
    │   └─ Drag across days (week/month view)    → POST /commands/reschedule-task
    └─ Feature: Developer command runner (legacy harness)
        └─ Select kind + JSON args + run     → POST /commands/:kind  (supports: create-task, update-task, delete-task, toggle-task, set-task-time-block, set-task-project-tag, reschedule-task)

    Planning page
    ├─ Feature: All-goals overview
    │   ├─ Page load                         → GET /view/planning
    │   └─ Click "refetch"                   → GET /view/planning
    ├─ Feature: Goal lifecycle
    │   ├─ Click "pause" on goal             → POST /commands/pause-goal
    │   └─ Click "resume" on goal            → POST /commands/resume-goal
    ├─ Feature: Open goal plan
    │   └─ Click "open" on goal              → (no API, client-only nav to Goal Plan sub-page)
    └─ Feature: Developer command runner (dev escape hatch)
        └─ Select kind + JSON args + run     → POST /commands/:kind  (supports: create-goal, update-goal, delete-goal, save-monthly-context, delete-monthly-context, set-vacation-mode, adjust-all-overloaded-plans, pause-goal, resume-goal)

        Goal Plan  (per-goal sub-page; opened from Planning)
        ├─ Feature: Goal plan overview
        │   ├─ Page load (goalId from URL)   → GET /view/goal-plan?goalId=:id
        │   └─ Click "refetch"               → GET /view/goal-plan?goalId=:id
        ├─ Feature: Plan editing
        │   ├─ Submit "add task to plan"     → POST /commands/add-task-to-plan
        │   └─ Submit "expand plan week"     → POST /commands/expand-plan-week
        └─ Feature: Developer command runner (dev escape hatch)
            └─ Select kind + JSON args + run → POST /commands/:kind  (supports: adaptive-reschedule, adjust-all-overloaded-plans, toggle-task, expand-plan-week, update-goal, confirm-goal-plan, regenerate-goal-plan, reallocate-goal-plan, regenerate-daily-tasks, add-task-to-plan)

            Goal Breakdown  (per-goal sub-section of Goal Plan)
            ├─ Feature: Breakdown overview
            │   ├─ Goal ID input              → (no API, client-only)
            │   ├─ Page load (if goalId set)  → GET /view/goal-breakdown?goalId=:id
            │   └─ Click "refetch"            → GET /view/goal-breakdown?goalId=:id
            └─ Feature: Generate breakdown
                └─ Click "run breakdown"      → POST /ai/goal-breakdown  (via transport.ts)

            Dashboard  (per-goal sub-section of Goal Plan) — backend-complete; UI deferred
            ├─ Feature: Dashboard overview
            │   └─ Page load (goalId from URL)   → GET /view/goal-dashboard?goalId=:id
            ├─ Feature: Edit goal title
            │   └─ Submit new title              → POST /commands/edit-goal-title
            ├─ Feature: Edit milestone
            │   └─ Submit new title and/or date  → POST /commands/edit-milestone
            ├─ Feature: User notes
            │   └─ Save notes on blur            → POST /commands/update-goal-notes
            ├─ Feature: Reflection entries
            │   └─ Add dated reflection          → POST /commands/add-goal-reflection
            └─ Feature: Regenerate insights
                └─ Click "regenerate"            → POST /commands/regenerate-insights

    Roadmap page  (top-level; legacy global user-level timeline)
    └─ Feature: Roadmap overview
        ├─ Page load                         → GET /view/roadmap
        └─ Click "refetch"                   → GET /view/roadmap

    News Feed page  (top-level; visibility toggle in Settings)
    └─ Feature: News feed overview
        ├─ Page load (topic from store)      → GET /view/news-feed?topic=:topic
        └─ Click "refetch"                   → GET /view/news-feed

    Settings page
    ├─ Feature: Settings form
    │   ├─ Page load                         → GET /view/settings
    │   ├─ Settings JSON textarea            → (no API, client-only)
    │   ├─ Availability JSON textarea        → (no API, client-only)
    │   └─ Click "update settings"           → POST /commands/update-settings
    ├─ Feature: News Feed visibility
    │   └─ Toggle "Show News Feed"           → POST /commands/update-settings  (patches settings.enableNewsFeed)
    ├─ Feature: Sign out
    │   └─ Click "sign out"                  → Supabase SDK: signOut
    └─ Feature: Reset all data (danger zone)
        ├─ Check confirmation checkbox       → (no API, client-only)
        └─ Click "reset data"                → POST /commands/reset-data

        Memory  (sub-section of Settings)
        ├─ Feature: Load memory
        │   ├─ Click "POST /memory/load"     → POST /memory/load
        │   └─ Click "POST /memory/summary"  → POST /memory/summary
        ├─ Feature: Nudges
        │   └─ Click "POST /memory/nudges"   → POST /memory/nudges
        ├─ Feature: Behavior profile
        │   ├─ Click "POST /memory/behavior-profile"       → POST /memory/behavior-profile
        │   ├─ Profile JSON textarea         → (no API, client-only)
        │   └─ Click "POST /memory/save-behavior-profile"  → POST /memory/save-behavior-profile
        ├─ Feature: Reflection
        │   ├─ Click "POST /memory/should-reflect"  → POST /memory/should-reflect
        │   └─ Click "POST /memory/reflect"         → POST /memory/reflect
        └─ Feature: Clear memory (danger zone)
            ├─ Check confirmation checkbox    → (no API, client-only)
            └─ Click "POST /memory/clear"     → POST /memory/clear

### Global (cross-cutting, always available)

    Global
    ├─ Feature: Navigation (Sidebar)
    │   ├─ Click sidebar view button         → (no API, client-only view switch)
    │   └─ Page load                         → GET /view/settings  (to read settings.enableNewsFeed for conditional News Feed button)
    ├─ Feature: AI Chat widget  (always visible in right pane)
    │   ├─ Select channel                    → (no API, client-only)
    │   ├─ Goal ID input (for goal-plan-chat) → (no API, client-only)
    │   ├─ Message textarea                  → (no API, client-only)
    │   ├─ Send — chat-stream channel        → POST /ai/chat/stream  (SSE)
    │   ├─ Send — home-chat-stream channel   → POST /ai/home-chat/stream  (SSE)
    │   ├─ Send — goal-plan-chat channel     → POST /ai/goal-plan-chat/stream  (SSE)
    │   ├─ Click "clear home chat"           → POST /commands/clear-home-chat
    │   └─ AI intent auto-dispatch           → (no API, client-only; re-runs command if AI emits intent)
    │
    │       Chat Sessions  (floating resizable/movable window; opens when chat is clicked)
    │       ├─ Feature: Session list
    │       │   └─ Click "refresh"           → POST /chat/list-sessions
    │       ├─ Feature: Save session
    │       │   ├─ Session JSON textarea     → (no API, client-only)
    │       │   └─ Click "save"              → POST /chat/save-session
    │       └─ Feature: Delete session
    │           └─ Click "delete" on session → POST /chat/delete-session
    ├─ Feature: Auth
    │   ├─ Token refresh (automatic, periodic)→ Supabase SDK (internal)
    │   ├─ Auth gate (AuthGuard render)      → (no API, client-only)
    │   └─ Logout (button in Settings)       → Supabase SDK: signOut
    ├─ Feature: Error handling
    │   └─ Error boundary retry button       → (no API, client-only)
    ├─ Feature: Async job status
    │   └─ Poll job (when JobStatus mounts)  → GET /commands/job-status/:jobId  (every 2s until terminal)
    └─ Feature: Reminder notifications
        └─ Browser notification (polling 30s) → (no API, client-only; Electron bridge)

---

## Section 2: Backend APIs (by functional area)

### Views function (GET /view/:kind)

| Feature | API | Usage |
|---|---|---|
| Dashboard view (cross-goal) | GET /view/dashboard | No args. Returns DashboardView (today tasks, pending tasks, reminders, nudges, daily load, vacation mode, current month context). `dashboardView.ts:62`. |
| Tasks view | GET /view/tasks | Returns TasksView. `tasksView.ts`. |
| Calendar view | GET /view/calendar | Args: `{startDate?, endDate?, viewMode?}` where viewMode ∈ month/week/day/project. Returns `{rangeStart, rangeEnd, viewMode, tasks, goalPlanTasks, goals, vacationMode, reminders, countsByDate, projectAllocation?}`. `reminders` is filtered to the range; `countsByDate[YYYY-MM-DD] = {tasks, reminders}` powers month-grid badges. `calendarView.ts`. |
| Roadmap view | GET /view/roadmap | No args. Returns single legacy Roadmap. `roadmapView.ts:17`. |
| Planning view | GET /view/planning | Returns all goals + progress. Each goal in `goals[]` (and the `bigGoals` / `everydayGoals` / `repeatingGoals` splits) carries the card-render fields the FE GoalCard expects: `pace: "on-track"\|"ahead"\|"behind"\|"paused"` (always populated; defaults to `"on-track"` until Phase G persists a real snapshot), `paceDelta?: string`, `pct?: number`, `horizon?: string`, `nextMilestone?: string`, `nextDue?: string\|null`, `openTasks?: number`, plus `inFlight: { jobId, status: "pending"\|"running", startedAt } \| null` from `job_queue`. Goal cards render a "Planning…" pill in place of the pace badge when `inFlight` is non-null. `planningView.ts`. |
| Settings view | GET /view/settings | `settingsView.ts`. |
| News Feed view | GET /view/news-feed | Args: topic?. `newsFeedView.ts`. |
| Onboarding view | GET /view/onboarding | Returns `{step, messages, proposedGoal, currentGoalId, firstTaskId, memoryFacts, memoryPreferences, onboardingComplete, timezone, greetingName, goalRaw}`. Step server-computed. `onboardingView.ts`. |
| Goal Plan view | GET /view/goal-plan | Args: goalId (required). Returns `{goal, plan, milestones, planChat, progress, scheduledTasks, paceMismatch, overloadAdvisory, inFlight}`. `milestones: GoalPlanMilestone[]` is the flat convenience field FE reads (`data.milestones`) instead of drilling into `plan.milestones`; always an array, empty when no plan. `progress.paceDelta?: string` is a human-readable pace delta (e.g. "3d late") derived from `paceMismatch` — undefined when the goal is on track. `inFlight: { jobId, status: "pending"\|"running", startedAt } \| null` is non-null when a `command:regenerate-goal-plan` job is queued or running. Three observable states: **(a) no plan, no job** → `plan: null, milestones: [], inFlight: null` (show "Generate plan" CTA); **(b) generating** → `plan: null, milestones: [], inFlight: {...}` (show Planning… skeleton); **(c) ready** → `plan: {...}, milestones: [...], inFlight: null` (render milestones). A plan being regenerated is state (c) + `inFlight: {...}` — keep the existing plan visible with a "Regenerating…" badge. `goalPlanView.ts`. |
| Goal Breakdown view | GET /view/goal-breakdown | Args: goalId?. When present, filters scheduledTasks to that goal AND reconstructs full `GoalBreakdown` tree (years → months → weeks → days → tasks) from `goal_plan_nodes`. `goalBreakdownView.ts`. |
| Goal Dashboard view | GET /view/goal-dashboard | Args: goalId (required). Returns `{goal, milestones, progress, insightCards, recentActivity, aiObservations}`. Calls `dashboardInsightAgent` for RAG-driven card mix. `goalDashboardView.ts`. |

### Commands function (POST /commands/:kind)

#### Goals
| Feature | API | Usage |
|---|---|---|
| Create goal | POST /commands/create-goal | Body: `{goal: {id, title, description?, targetDate?, ...}}`. FE generates the goal id client-side (uuid); backend upserts the full Goal row. **Pure upsert — does NOT auto-generate a plan.** Callers that want a plan must fire a second `command:regenerate-goal-plan` with the same `{goalId}` after create-goal succeeds. The Goal Plan page then reads `view:goal-plan.inFlight` to show the "Planning…" state. Onboarding's `command:confirm-onboarding-goal` already chains these two internally. |
| Update goal | POST /commands/update-goal | Body: `{goal: {id, ...fields}}`. Same shape as create; backend upserts. |
| Delete goal | POST /commands/delete-goal | Body: `{goalId}`. |
| Pause goal | POST /commands/pause-goal | Body: `{goalId}`. |
| Resume goal | POST /commands/resume-goal | Body: `{goalId}`. |
| Confirm goal plan | POST /commands/confirm-goal-plan | Body: `{goalId}`. Flips `planConfirmed=true`, materializes next 14d of daily_tasks, and (0013) seeds `goals.pace_tasks_per_day` from `total plan tasks / days-to-target`. |
| Expand plan week | POST /commands/expand-plan-week | Body: `{goalId, weekId}`. |

#### Tasks
| Feature | API | Usage |
|---|---|---|
| Create task | POST /commands/create-task | Body: `{title, date?, durationMinutes?, id?, ...}` — `title` required (non-empty); `date` defaults to today; `id` auto-generated when omitted. Pure DB upsert — no AI. |
| Update task | POST /commands/update-task | Body: `{taskId, updates}`. |
| Delete task | POST /commands/delete-task | Body: `{taskId}`. |
| Toggle task complete | POST /commands/toggle-task | Body: `{taskId, completed?}`. |
| Skip task | POST /commands/skip-task | Body: `{taskId}`. |
| Reschedule task | POST /commands/reschedule-task | Body: `{taskId, newDate}`. |
| Can't complete task | POST /commands/cant-complete-task | Body: `{taskId}`. |
| Delete tasks for date | POST /commands/delete-tasks-for-date | Body: `{date}`. |
| Defer overflow | POST /commands/defer-overflow | Body: `{taskIds[]}`. |
| Undo defer | POST /commands/undo-defer | Body: `{taskIds[]}`. |
| Snooze reschedule | POST /commands/snooze-reschedule | Body: `{proposalId}`. |
| Dismiss reschedule | POST /commands/dismiss-reschedule | Body: `{proposalId}`. |
| Accept task proposal | POST /commands/accept-task-proposal | Body: `{proposalId}`. |
| Create pending task | POST /commands/create-pending-task | Body: `{userInput}`. |
| Confirm pending task | POST /commands/confirm-pending-task | Body: `{pendingTaskId}`. |
| Reject pending task | POST /commands/reject-pending-task | Body: `{pendingTaskId}`. |
| Add task to goal plan | POST /commands/add-task-to-plan | Body: `{goalId, date, title, durationMinutes?, cognitiveWeight?, force?}`. |
| Dismiss nudge | POST /commands/dismiss-nudge | Body: `{nudgeId}`. |
| Analyze image for tasks | POST /commands/analyze-image | Body: `{imageBase64, mediaType, source}`. |
| Estimate task durations | POST /commands/estimate-task-durations | Body: `{taskIds[]}`. |
| Set task time block | POST /commands/set-task-time-block | Body: `{taskId, timeBlock}`. |
| Set task project tag | POST /commands/set-task-project-tag | Body: `{taskId, tag}`. |

#### Daily planning
| Feature | API | Usage |
|---|---|---|
| Refresh daily plan | POST /commands/refresh-daily-plan | Body: `{date?}`. |
| Regenerate daily tasks | POST /commands/regenerate-daily-tasks | Body: `{date?}`. |
| Confirm daily tasks | POST /commands/confirm-daily-tasks | Body: `{date?}`. |
| Generate bonus task | POST /commands/generate-bonus-task | Body: `{date?}`. |
| Propose gap fillers | POST /commands/propose-gap-fillers | Body: `{date?}`. |
| Submit priority feedback | POST /commands/submit-priority-feedback | Body: `{feedback}`. |

#### Plan regeneration (async jobs — return jobId)
| Feature | API | Usage |
|---|---|---|
| Regenerate goal plan | POST /commands/regenerate-goal-plan | Body: `{goalId}`. Returns `{jobId, async:true}`. Side effects beyond plan replacement (0013): populates `goals.plan_rationale` (from planner output), `goals.current_phase` (from phaseResolver), `goals.labor_market_data` (from stub fetcher unless env-enabled). Planner now emits `planRationale` top-level + per-milestone `rationale` + per-task `rationale`/`taskType`. |
| Reallocate goal plan | POST /commands/reallocate-goal-plan | Body: `{goalId, adjustments}`. |
| Adaptive reschedule | POST /commands/adaptive-reschedule | Body: `{date?}`. Returns `{jobId, async:true}`. Side effect (0013): writes `goals.pace_tasks_per_day` + `pace_last_computed_at` on every run. |
| Adjust all overloaded plans | POST /commands/adjust-all-overloaded-plans | Body: `{}`. Returns `{jobId, async:true}`. |
| Heal all goal plans | POST /commands/heal-all-goal-plans | Body: `{}`. |

#### Reminders (commands)
| Feature | API | Usage |
|---|---|---|
| Upsert reminder | POST /commands/upsert-reminder | Body: `{id?, title, date?, description?, reminderTime?, repeat?, ...}` — flat. `title` is required; `id` is auto-generated server-side when omitted; `date` defaults to today; `reminderTime` defaults to `<date>T09:00:00`. Pure DB upsert — no AI. |
| Acknowledge reminder | POST /commands/acknowledge-reminder | Body: `{id}`. |
| Delete reminder | POST /commands/delete-reminder | Body: `{id}`. |
| Delete reminders batch | POST /commands/delete-reminders-batch | Body: `{ids[]}`. |

#### Settings / Onboarding
| Feature | API | Usage |
|---|---|---|
| Update settings | POST /commands/update-settings | Body: `{settings}`. |
| Set vacation mode | POST /commands/set-vacation-mode | Body: `{active, startDate?, endDate?}`. |
| Save monthly context | POST /commands/save-monthly-context | Body: `{month, description, ...}`. |
| Delete monthly context | POST /commands/delete-monthly-context | Body: `{month}`. |
| Complete onboarding | POST /commands/complete-onboarding | Body: `{goalRaw?}`. |
| Reset data (danger) | POST /commands/reset-data | Body: `{}`. Wipes user data. |

#### Chat (commands)
| Feature | API | Usage |
|---|---|---|
| Clear home chat | POST /commands/clear-home-chat | Body: `{}`. |

#### Onboarding (7-step conversational flow — backend complete, UI pending)
| Feature | API | Usage |
|---|---|---|
| Send onboarding message | POST /commands/send-onboarding-message | Body: `{message}`. Runs discovery agent (RAG-driven). Persists facts/preferences/signals into memory_* tables. Returns `{reply, shouldConclude, step, extractionsCount}`. Advances step from welcome→discovery→goal-naming. |
| Propose onboarding goal | POST /commands/propose-onboarding-goal | Body: `{}`. Runs summarizer agent over the conversation + captured memory. Persists `proposedGoal` on user payload. Returns `{proposedGoal}`. |
| Confirm onboarding goal | POST /commands/confirm-onboarding-goal | Body: `{title, description?, targetDate?, hoursPerWeek?, metadata?}`. Creates Goal row (status=planning). Sets onboardingGoalId + advances step to clarification. |
| Accept onboarding plan | POST /commands/accept-onboarding-plan | Body: `{goalId?}`. Sets planConfirmed=true + status=active on the goal. Advances step to first-task. |
| Commit first task | POST /commands/commit-first-task | Body: `{goalId?, taskTitle?}`. Picks first must-do task from the reconstructed plan (or uses supplied title), seeds as today's daily task, marks onboardingComplete=true, advances step to complete. |
| Complete onboarding (legacy) | POST /commands/complete-onboarding | Legacy bare-bones finalize; kept for the existing harness UI. The 7-step flow uses `commit-first-task` as the real finalize. |

#### Per-goal Dashboard (Phase 6)
| Feature | API | Usage |
|---|---|---|
| Update goal notes | POST /commands/update-goal-notes | Body: `{goalId, notes}`. Writes `goals.user_notes`. (0013) Appends `{field:"userNotes"}` to `goals.override_log` when notes change. |
| Edit goal title | POST /commands/edit-goal-title | Body: `{goalId, newTitle}`. Updates `goals.title`. (0013) Appends `{field:"title"}` to `goals.override_log` when title changes. |
| Edit milestone | POST /commands/edit-milestone | Body: `{milestoneId, newTitle?, newDate?}`. Updates the matching `goal_plan_nodes` row. (0013) Appends `{field:"milestone.<id>.title"}` and/or `{field:"milestone.<id>.targetDate"}` to `goals.override_log` — separate entries per changed sub-field. |
| Regenerate insights | POST /commands/regenerate-insights | Body: `{goalId}`. Force-reruns `dashboardInsightAgent` and caches cards on `goal_metadata.cachedInsightCards`. |
| Add goal reflection | POST /commands/add-goal-reflection | Body: `{goalId, reflection, timestamp?}`. Appends to `goal_metadata.reflections[]`. |

### Chat function (REST)

| Feature | API | Usage |
|---|---|---|
| List chat sessions | POST /chat/list-sessions | Returns `{data: ChatSession[]}`. |
| Save chat session | POST /chat/save-session | Body: session object. |
| Delete chat session | POST /chat/delete-session | Body: `{id}`. |

### AI function (SSE streaming)

| Feature | API | Usage |
|---|---|---|
| Chat stream (general) | POST /ai/chat/stream | Body: `{message, ...}`. SSE: `delta`, `done`. |
| Home chat stream | POST /ai/home-chat/stream | Persists messages. SSE. |
| Goal plan chat stream | POST /ai/goal-plan-chat/stream | Persists plan patches; emits `view:invalidate`. SSE. |
| Goal breakdown (direct) | POST /ai/goal-breakdown | Body: `{goalId}`. Called from GoalBreakdownPage via transport.ts. |

### Memory function

| Feature | API | Usage |
|---|---|---|
| Load memory | POST /memory/load | Returns stored memories. |
| Memory summary | POST /memory/summary | Returns short summary. |
| List nudges | POST /memory/nudges | Returns AI nudges. |
| Get behavior profile | POST /memory/behavior-profile | Returns current profile. |
| Save behavior profile | POST /memory/save-behavior-profile | Body: profile JSON. |
| Should reflect | POST /memory/should-reflect | Returns reflection trigger. |
| Reflect | POST /memory/reflect | Triggers AI reflection pass. |
| Clear memory (danger) | POST /memory/clear | Wipes all memory. |

### Global function

| Feature | API | Usage |
|---|---|---|
| Job status polling | GET /commands/job-status/:jobId | Returns `{status, result?}`. Polled every 2s by JobStatus component. |
| WebSocket (view invalidation) | WS /ws | Auth via header or `?token=`. Server → client: `{kind:"view:invalidate", payload:{viewKinds:[...]}}`. |
| Sign in (email/password) | Supabase SDK: signInWithPassword | Auth endpoint (external — Supabase). |
| Sign up | Supabase SDK: signUp | Auth endpoint (external). |
| Google OAuth | Supabase SDK: signInWithOAuth | External OAuth. |
| Exchange OAuth code | Supabase SDK: exchangeCodeForSession | Post-redirect callback. |
| Sign out | Supabase SDK: signOut | External. |

### Internal / unmapped (intentionally no direct frontend caller — backend-only by design)

Every endpoint without a FE caller has been reclassified into one of two buckets: **Internal** (this section) or **Missing FE wiring** (next section).

#### Infrastructure
| Endpoint | Reason |
|---|---|
| GET /health | Container liveness probe. |

#### AI channels — invoked by backend command handlers, not FE
| Endpoint | Invoked by |
|---|---|
| POST /ai/onboarding | Onboarding flow internally. |
| POST /ai/reallocate | `command:reallocate-goal-plan`. |
| POST /ai/recovery | Pace / recovery logic. |
| POST /ai/pace-check | Pace detection. |
| POST /ai/classify-goal | Goal creation. |
| POST /ai/generate-goal-plan | `command:regenerate-goal-plan` (async job). |
| POST /ai/goal-plan-edit | `/ai/goal-plan-chat/stream` handler. |
| POST /ai/goal-plan-chat | Non-stream variant; FE uses stream. |
| POST /ai/analyze-quick-task | Pending task analyzer. |
| POST /ai/analyze-monthly-context | `command:analyze-monthly-context`. |
| POST /ai/news-briefing | News feed generation. |
| POST /ai/image-to-todos | `command:analyze-image`. |
| POST /ai/home-chat | Non-stream variant; FE uses stream. |
| POST /ai/daily-tasks | `command:refresh-daily-plan` / `command:regenerate-daily-tasks`. |

#### Memory signal recorders — auto-recorded by backend on task mutations
| Endpoint | Purpose |
|---|---|
| POST /memory/signal | Generic signal recorder. |
| POST /memory/task-completed | On toggle-task complete. |
| POST /memory/task-snoozed | On snooze. |
| POST /memory/task-skipped | On skip. |
| POST /memory/feedback | On user feedback events. |
| POST /memory/chat-insight | On chat insights. |
| POST /memory/task-timing | On duration measurement. |

#### Entity factories — backend-authoritative creation
| Endpoint | Purpose |
|---|---|
| POST /entities/new-goal | Entity factory. |
| POST /entities/new-event | Entity factory. |
| POST /entities/new-user | Entity factory. |
| POST /entities/new-log | Entity factory. |
| POST /entities/new-chat-session | Entity factory. |
| POST /entities/new-chat-message | Entity factory. |
| POST /entities/new-behavior-entry | Entity factory. |
| POST /entities/new-confirmed-task | Entity factory (enforces cognitive budget). |

#### REST legacy — duplicates superseded by command:* dispatcher
| Endpoint | Superseded by |
|---|---|
| POST /reminder/list | `view:dashboard` / `view:tasks` read; `command:*-reminder` mutations. |
| POST /reminder/upsert | `command:upsert-reminder`. |
| POST /reminder/acknowledge | `command:acknowledge-reminder`. |
| POST /reminder/delete | `command:delete-reminder`. |
| POST /monthly-context/upsert | `command:save-monthly-context`. |
| POST /monthly-context/delete | `command:delete-monthly-context`. |

#### Developer / experimental — no user UI
| Endpoint | Reason |
|---|---|
| POST /ai-tools/chat | Tool-use pilot. |
| POST /model-config/get | Developer model-tier tooling. |
| POST /model-config/set-overrides | Developer model-tier tooling. |
| POST /calendar/schedule | Backend-internal schedule context aggregator. |
| POST /monthly-context/analyze | Invoked internally by `command:analyze-monthly-context`. |

### Missing FE wiring (backend feature exists; frontend surface not yet built)

| Endpoint | Suggested FE placement |
|---|---|
| POST /monthly-context/list | Settings page — list stored monthly contexts. |
| POST /monthly-context/get | Settings page — view a single month's context. |
| POST /chat/save-attachment | AI Chat widget — attach files to messages. |
| POST /chat/get-attachments | AI Chat widget / Chat Sessions — display message attachments. |

---

## Resolved in the 2026-04-23 update

- **Starward package rename** ✓ — `@northstar/core | server | desktop` → `@starward/core | server | desktop`. 200 imports + 3 `package.json` name fields + 1 `frontend/vite.config.ts` alias updated. `npm install` regenerated workspace symlinks (`node_modules/@starward/core → backend/core`, etc.) and rebuilt `package-lock.json`. `@northstar/core` rebuilt under its new name. Both typechecks green.
- **Starward brand + Chinese (星程)** ✓ — 191 files touched for `NorthStar → Starward` (comments, doc titles, HTML `<title>`, AI system prompts) plus 22 references `北极星 → 星程` across README, docs, prompts, frontend subtitle. `<title>Starward 星程</title>` is the canonical product name.
- **BullMQ queue renamed to `starward-bg`** ✓ — `backend/src/jobs/queue.ts:23` constant + ARCHITECTURE_UPGRADES.md doc reference updated. User confirmed the old `northstar-bg` queue was drained before the switch; in-flight jobs would otherwise be stranded in Redis. No new jobs can land in the old queue name.
- **Infra strings renamed to `starward-api` + `starward-redis`** ✓ — 15 files updated: `fly.toml` (`app = "starward-api"`), `frontend/package.json` (`electron:dev` + 3 `electron:build:*` scripts now set `VITE_CLOUD_API_URL=https://starward-api.fly.dev`), `frontend/.env.production`, `frontend/index.html` CSP (`connect-src` allow-list now `https://starward-api.fly.dev wss://starward-api.fly.dev`), `.github/workflows/deploy-backend.yml`, backend + frontend READMEs, and every architecture doc. **⚠ OPS WORK REQUIRED BEFORE NEXT DEPLOY OR ELECTRON RUN** — these are just string changes; the deployed Fly app is still called `northstar-api` and the Upstash Redis is still `northstar-redis`. Until the resources are renamed: (a) `fly deploy` will fail, (b) Electron builds cannot reach the backend (DNS for `starward-api.fly.dev` does not resolve). Ops checklist: `fly apps create starward-api --org <org>`; copy secrets via `fly secrets list -a northstar-api` then `fly secrets set ... -a starward-api`; `fly deploy` into the new app; repoint DNS; decommission `northstar-api`. For Redis: create a new `starward-redis` Upstash instance in Fly (`fly redis create`), update `REDIS_URL`, migrate data if needed, destroy old instance.
- **Tasks page contract cleanup** ✓ — Image-to-todos merged with text-based task creation into a single "Add task" feature (one widget, two input modes side-by-side; both paths end in `command:create-task`). "Active goals" pause/resume feature removed from the Today/Tasks page — keep Planning page's `Feature: Goal lifecycle` as the single owner of cross-goal pause/resume; per-goal progress lives on `view:goal-plan.progress` + `view:goal-dashboard.progress`. **Commands `command:pause-goal` / `command:resume-goal` stay; they're still used by Planning page.**
- **Active-goals dead code removed** ✓ — `activeGoals` field dropped from `DashboardView` interface, resolver filter, return payload, and repo fetch (`backend/src/views/dashboardView.ts`). Active-goals section + pause/resume buttons removed from `frontend/src/pages/dashboard/DashboardPage.tsx`. Commands untouched. Backend files that happen to use a *local variable* called `activeGoals` (`tasksView.ts`, `dailyTaskGeneration.ts`, `paceDetection.ts`, `chat.ts`, `payloads.ts`) are unrelated — they're internal filtered lists, not the UI feature — and stay.
- **Calendar view extended** ✓ — `view:calendar` returns `reminders: Reminder[]` (filtered to [rangeStart, rangeEnd]) and `countsByDate: Record<string, {tasks, reminders}>` in addition to the existing `tasks`/`goalPlanTasks`/`goals`/`vacationMode`/`projectAllocation`. Reminder commands (`upsert`, `acknowledge`, `delete`, `delete-batch`) now include `view:calendar` in their invalidation lists so the FE auto-refreshes when a reminder changes. No new commands — drag-and-drop in day/week views reuses `command:set-task-time-block` (move/resize) and `command:reschedule-task` (cross-day). UI (month grid, week view, day-view drag-and-drop, click-a-date side view) is pending — see audit notes.
- **Time map removed** ✓ — `weeklyAvailability: TimeBlock[]` fully removed from `UserProfile`, `OnboardingView`, `SettingsView`, and every backend reader (`scheduler.assignSlotsForToday` deleted; `computeCapacityProfile` no longer uses it; `personalizationAgent`, `dailyPlanner/scenarios`, `ai/handlers/dailyTasks`, `gapFiller`, `goalPlanView`, `tasksView`, `routes/entities.ts` updated). Frontend removed from `SettingsPage` (availability textarea) and `services/ai.ts`. `TimeBlock` interface deleted from core types. DB column `users.weekly_availability` is preserved (dormant — no reads/writes); safe to drop in a future migration. **Onboarding no longer asks for it.**
- **Onboarding rebuild — backend complete, UI pending** ✓ — `view:onboarding` rewritten to return 11-field shape supporting the 7-step conversational flow. New types: `OnboardingStep`, `OnboardingMessage`, `ProposedOnboardingGoal`. Two new agents: `onboardingDiscovery` (RAG-driven conversation + fact/preference/signal extraction) and `onboardingSummarizer` (proposes single goal from the conversation). Five new commands: `send-onboarding-message`, `propose-onboarding-goal`, `confirm-onboarding-goal`, `accept-onboarding-plan`, `commit-first-task`. Memory helpers `saveOnboardingFact` / `saveOnboardingPreference` / `recordOnboardingSignal` in `memory.ts` land extractions in the existing `memory_facts` / `memory_preferences` / `memory_signals` tables. Model tiers `onboarding-discovery` and `onboarding-summarizer` registered (both Sonnet/medium). Invalidation map updated for all 5 commands.
- **Sidebar cleanup** ✓ — sidebar now has 6 top-level entries (tasks, calendar, planning, roadmap, news-feed, settings). Removed: dashboard, goal-breakdown, memory, chat-sessions, onboarding. `frontend/src/components/Sidebar.tsx`.
- **view:goal-breakdown drift** ✓ — handler now respects `goalId` and filters `scheduledTasks`. `backend/src/views/goalBreakdownView.ts`.
- **view:goal-breakdown tree construction** ✓ — when `goalId` is provided, the resolver now reconstructs a full `GoalBreakdown` tree (years → months → weeks → days → tasks) from `goal_plan_nodes` via a new `planToBreakdown` mapper.
- **Non-transport fetch** ✓ — `GoalBreakdownPage` now uses `postJson()` from `services/transport.ts`.
- **News Feed visibility toggle** ✓ — checkbox in Settings → `command:update-settings` (patches `settings.enableNewsFeed`) → Sidebar reads `view:settings` and conditionally hides the News Feed entry.
- **Per-goal Dashboard — Phase 1 data model** ✓ — migration `0012_goal_dashboard.sql` adds `goal_description`, `goal_metadata`, `user_notes`, `clarification_answers` to the `goals` table. `Goal` TypeScript type extended. `goalsRepo` reads/writes the new columns.
- **Per-goal Dashboard — Phase 2 knowledge base** ✓ — 9 new methodology markdown files added to `backend/knowledge-base/`: `job-search.md`, `learning.md`, `creative-projects.md`, `habit-formation.md`, `business-goals.md`, `health-fitness.md`, `relationship-goals.md`, `clarification-patterns.md`, `milestone-design.md`. Run `npm run ingest-knowledge` from `backend/` to embed them into the `knowledge_chunks` table.
- **Per-goal Dashboard — Phase 3 goalClarifier agent** ✓ — `backend/src/agents/goalClarifier.ts` + `backend/src/agents/prompts/goalClarifier.ts`. Exports `clarifyGoal({ rawGoalText, contextHint? })` → `{ questions: ClarifyingQuestion[] }`. Uses `retrieveRelevant` via `buildMemoryContext` + Claude (`goal-clarifier` tier = medium/Sonnet). Falls back to a generic high-leverage question set if AI is unavailable.
- **Per-goal Dashboard — Phase 5 view + insight agent** ✓ — `backend/src/views/goalDashboardView.ts` registered as `view:goal-dashboard` (requires `goalId`). Returns `{ goal, milestones, progress, insightCards, recentActivity, aiObservations }`. Insight cards come from `backend/src/agents/dashboardInsightAgent.ts` (tier = light/Haiku) which retrieves methodology chunks and emits 2–5 typed cards from the fixed `InsightCard` card-type set. Cards have generic-but-valid fallbacks when AI is unavailable.
- **Per-goal Dashboard — Phase 6 commands** ✓ — 5 new commands in `backend/src/routes/commands/dashboard.ts`: `update-goal-notes`, `edit-goal-title`, `edit-milestone`, `regenerate-insights`, `add-goal-reflection`. All wired in `commands.ts` dispatcher, `commands/index.ts` barrel, and `_invalidation.ts` invalidation map (each emits `view:invalidate` for `view:goal-dashboard` and related views).
- **New core types** ✓ — `InsightCard`, `DashboardProgressData`, `AIObservation` in `backend/core/src/types/index.ts`. `QueryKind` gains `view:goal-dashboard`; `CommandKind` gains the 5 new command kinds. Model tiers `goal-clarifier` (medium) and `dashboard-insight` (light) added to `TASK_TIERS`.

## Goals table schema (post-0013 migration)

Columns on `goals` (see migrations `0002_entity_tables.sql`, `0003_goals_metadata_rename.sql`, `0005_goal_slots.sql`, `0012_goal_dashboard.sql`, `0013_goal_methodology.sql`):

| Column | Type | Default | Purpose |
|---|---|---|---|
| id, user_id | text | — | Composite PK |
| title | text | — | Goal title |
| description | text | `''` | User-provided extra context for AI |
| target_date | text | NULL | ISO date (null for habits) |
| status | text | `'pending'` | pending / planning / active / paused / completed / archived |
| priority | text | `'medium'` | low / medium / high / critical |
| goal_type | text | NULL | big / everyday / repeating (display grouping) |
| scope | text | NULL | small / big (NLP-classified) |
| is_habit | boolean | false | Ongoing habit flag |
| icon | text | NULL | User-chosen emoji |
| plan_confirmed | boolean | false | User confirmed AI plan |
| progress_percent | integer | NULL | 0–100 |
| goal_slot | text | NULL | @deprecated |
| payload | jsonb | `'{}'` | Runtime/plan bag: planChat, plan, flatPlan, scopeReasoning, repeatSchedule, suggestedTimeSlot, notes, rescheduleBannerDismissed. **Contract split:** `payload` holds plan runtime state; `goal_metadata` (below) holds dashboard-surface state. Do not merge — readers know the split. |
| goal_description | text | `''` | Raw user-stated goal text; drives RAG retrieval context. Added 0012. |
| goal_metadata | jsonb | `'{}'` | Dashboard-surface bag: cachedInsightCards, reflections[], aiObservations. Added 0012. |
| user_notes | text | `''` | Dashboard-editable user notes. Added 0012. |
| clarification_answers | jsonb | `'{}'` | Answers from goalClarifier onboarding. Added 0012. |
| **weekly_hours_target** | numeric(5,2) | NULL | **NEW (0013)** — user's committed hours/week for this goal; seeded from onboarding. Planner caps weekly task minutes at this value ±20%. |
| **current_phase** | text | NULL | **NEW (0013)** — lifecycle phase. Job-search uses `prep`/`apply`/`interview`/`decide`; generic uses `early`/`mid`/`late`/`wrap`. Resolved by `phaseResolver` from deadline distance. |
| **funnel_metrics** | jsonb | `'{}'` | **NEW (0013)** — archetype-specific funnel params. Job-search: `{applications, replies, firstRounds, finalRounds, offers, targetOffers, backSolvedWeeklyApps}`. Empty for other archetypes. |
| **skill_map** | jsonb | `'{}'` | **NEW (0013)** — T-shaped skill map: `{horizontal: [{skill, score}], vertical: [{skill, score}]}`. Planner weights skill-building on lowest-scored entries. |
| **labor_market_data** | jsonb | `'{}'` | **NEW (0013)** — live labor-market data: `{openRoleCount, salaryRange, topSkills, hiringCadence, fetchedAt}`. Populated by `fetchLaborMarketData` (gated stub today; provider wiring later). |
| **plan_rationale** | text | NULL | **NEW (0013)** — top-level "why this plan shape" paragraph emitted by the planner. Dashboard shows it when the user asks "why this plan?". |
| **pace_tasks_per_day** | numeric(4,2) | NULL | **NEW (0013)** — measured pace snapshot. Seeded by `cmdConfirmGoalPlan` from the plan; refreshed by `cmdAdaptiveReschedule` from capacity.avgTasksCompletedPerDay. |
| **pace_last_computed_at** | timestamptz | NULL | **NEW (0013)** — when `pace_tasks_per_day` was last written. |
| **override_log** | jsonb | `'[]'` | **NEW (0013)** — append-only audit trail of user edits: `[{ts, actor, field, oldValue, newValue, reason?}]`. Written by dashboard commands (`update-goal-notes`, `edit-goal-title`, `edit-milestone`) when the value changes. Planner reads this on regeneration to explain why it's adjusting around user edits. |
| created_at, updated_at | timestamptz | now() | Timestamps |

### Plan node / task jsonb additions (Phase D/E — contract only, no schema)

On `goal_plan_nodes.payload`:
- `rationale?: string` — one-sentence "why THIS checkpoint at THIS date" for milestone nodes.
- `taskType?: "application" | "skill-building" | "practice" | "targeted-prep" | "other"` — methodology taxonomy for task nodes.
- `paceExplanation?: string`, `paceSuggestions?: string[]`, `paceExplanationDate?: string` — cached pace-explainer output (existing).

On `daily_tasks.payload` (reader-side):
- Same `rationale?` and `taskType?` when materialized from a plan node. `rationale` also written by `durationEstimator` / `priorityAnnotator`.

Readers default to `"other"` for missing `taskType` and `undefined` for missing `rationale`.

## Audit notes still open

- **Calendar UI to build (month / week / day + side view)** — backend is complete; the current `CalendarPage.tsx` is a JSON-dump harness. When building:
  - **Month grid**: 6-row × 7-col date cells. Each cell reads `view:calendar.countsByDate[date]` to show a count badge (`tasks` + `reminders`). Optionally list the first 2–3 task titles from `tasks.filter(t => t.date === date)`.
  - **Click-a-date side view**: sets local `selectedDate` state; filters `tasks[]` + `reminders[]` from the same view payload (no extra fetch). Side view shows task list with toggle buttons → `command:toggle-task`, and reminder list with acknowledge/delete → `command:acknowledge-reminder` / `command:delete-reminder`.
  - **Week view**: call `view:calendar` with `viewMode=week`; render 7 day-columns, tasks sorted by `scheduledStartIso` within each.
  - **Day view drag-and-drop**: single 24-hour column with absolutely-positioned task blocks sized by `estimatedDurationMinutes`. `onDragEnd` decides which command to fire from the delta — only `top` changed → `command:set-task-time-block` with new start; only `height` changed → `command:set-task-time-block` with new duration; column changed (week view) → `command:reschedule-task` with new date.
  - **View-mode switcher**: dropdown or segmented control that re-queries with the new `viewMode`.
- **Onboarding UI to build (all 7 steps)** — backend is complete; the current `OnboardingPage.tsx` is a legacy harness that only covers the final "complete" command. When building:
  - **Step 1 (Welcome)**: single-screen brand line + "Get started" button. No API.
  - **Step 2 (Signup)**: redirect to/reuse `LoginPage` (Supabase). On success, land in step 3.
  - **Step 3 (Discovery)**: chat UI. Read messages from `view:onboarding.messages`. Submit → `command:send-onboarding-message`. Loop until `shouldConclude = true` OR step flips to `goal-naming`. Show a subtle "Step X of 5" dot indicator.
  - **Step 4 (Goal naming)**: show `view:onboarding.proposedGoal` with editable fields (title/description/targetDate/hoursPerWeek). On first entry, fire `command:propose-onboarding-goal` if no proposal exists yet. Submit → `command:confirm-onboarding-goal`.
  - **Step 5 (Clarification)**: reuse the existing `goalClarifier` agent output; record answers back via `command:update-goal` patching `clarificationAnswers`.
  - **Step 6 (Plan reveal)**: kick off `command:regenerate-goal-plan` (async job), then render the reconstructed plan narratively (years/months/weeks). Allow inline milestone edits via `command:edit-milestone`. Accept → `command:accept-onboarding-plan`.
  - **Step 7 (First task)**: show the task chosen by `command:commit-first-task` with a "Yes, start" button that triggers it. On success, deep-link to Tasks page.
  - **Target**: total flow ≤ 10 minutes. Track completion-of-first-task-in-24h as the retention KPI.
- **Per-goal Dashboard UI (Phase 4)** — intentionally deferred per user. Backend is complete. When building, a `GoalDashboardPage` would call `view:goal-dashboard?goalId=<id>` and render the six layers (overview, timeline/milestones, insight cards, notes, progress/rhythm, goal-scoped AI chat).
- **Per-goal Dashboard entry points** — the dashboard is not yet linked from anywhere in the nav (home page "Open dashboard" link, roadmap goal buttons, dynamic island). Once UI lands, add the navigation hooks.
- **Insight card ingestion latency** — new knowledge-base files must be embedded via `npm run ingest-knowledge`. This is a one-time (or per-file-change) manual step and takes ~25–30s per file due to the Voyage free-tier rate limit.
- **Dashboard `aiObservations`** — field is present in the view payload but currently seeded empty. Future pass will surface `paceMismatch` / `overloadAdvisory` from the existing pace-detection services into this array.
- **`regenerate-insights` caching** — the command persists cards to `goal_metadata.cachedInsightCards`, but `resolveGoalDashboardView` always regenerates on read. Swap to cached-read + explicit invalidation later if load warrants.
- **Legacy Roadmap** — backend has exactly one Roadmap per user (user-level, not per-goal). Marked legacy; future per-goal plans live in `goal_plan_nodes`. Retained at top-level per user decision.
- **Missing FE wiring** (4 endpoints) — see the "Missing FE wiring" section above. Decide per endpoint whether to wire or deprecate.

## Knowledge base (RAG)

Location: `backend/knowledge-base/`. Embedded into `knowledge_chunks` via `npm run ingest-knowledge` (script: `backend/scripts/ingest-knowledge.ts`; embedding provider: Voyage AI `voyage-3-large` / 1024d; cosine-distance kNN via pgvector).

| File | Purpose |
|---|---|
| goal-setting.md | SMART, Locke & Latham, OKR, goal hierarchies. |
| psychology-principles.md | Motivation, habit loop, attention, behavioral frameworks. |
| task-decomposition.md | Atomic-task rule, WBS, next-physical-action. |
| time-estimation.md | Planning-fallacy correction, buffer math, confidence. |
| job-search.md | Application funnel, T-shaped skills, compensation negotiation. |
| learning.md | Spaced repetition, deliberate practice, Bloom's taxonomy, interleaving. |
| creative-projects.md | Phase gates, MVP thinking, dependency mapping, launch mechanics. |
| habit-formation.md | Habit loop, stacking, minimum viable habit, two-day rule. |
| business-goals.md | OKRs, lean startup, traction metrics, customer development. |
| health-fitness.md | Progressive overload, recovery, sustainability, body composition. |
| relationship-goals.md | NVC, attachment theory, Gottman, vulnerability gradient. |
| clarification-patterns.md | Meta-guidance for the `goalClarifier` agent. |
| milestone-design.md | Meta-guidance for milestone generators. |

Agents that retrieve from the knowledge base:
- `durationEstimator` (existing) — time-estimation chunks.
- `priorityAnnotator` (existing) — psychology + goal-setting chunks.
- `goalClarifier` (new) — methodology + clarification-patterns chunks.
- `dashboardInsightAgent` (new) — methodology chunks relevant to the goal text.
