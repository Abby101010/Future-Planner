# Starward — System Spec for LLM Context

**Purpose.** This document is a dense, factual reference for another LLM picking up work on this codebase. Every claim cites a file path. No marketing prose. Read top to bottom once; then use as lookup.

**Audit date:** 2026-04-19.
**Root:** `/Users/sophiecao/Future-Planner/Client - Future-Planner/` (monorepo; npm workspaces).
**Mode:** This copy of the renderer is a stripped bare-HTML test harness of the production UI. Every backend surface (view/command/AI/WS/auth) is exercised through plain `<button>` / `<textarea>` / `<pre>` elements.

---

## 1. Product Summary

Starward (星程) is an AI-assisted goal-planning app. A user states a multi-year goal; a multi-agent pipeline produces a hierarchical plan (years → milestones → weeks → daily tasks). A second daily-planner pipeline materialises each day's tasks given capacity, memory, and behavioural signals. The app also tracks reminders, nudges, pace, calendar availability, monthly context, and streams AI chat.

## 2. Monorepo Layout

```
packages/core/     @starward/core     — shared types + protocol enums
packages/server/   Express 5 API       — runs on Fly.io (app: starward-api)
packages/desktop/  Electron + React    — bare-HTML test harness
```

Deploys: server changes go out via `fly deploy`. Renderer runs locally via `npm run electron:dev` against the deployed server.

## 3. Protocol Contract (authoritative: `packages/core/src/protocol/kinds.ts`)

### 3.1 QueryKind (10)

```
view:dashboard      view:tasks          view:calendar       view:roadmap
view:planning       view:settings       view:news-feed      view:onboarding
view:goal-plan      view:goal-breakdown
```

### 3.2 CommandKind (43)

```
# goals (3)
create-goal  update-goal  delete-goal

# tasks (10)
create-task  toggle-task  skip-task  delete-task  delete-tasks-for-date
update-task  reschedule-task  accept-task-proposal  cant-complete-task  add-task-to-plan

# pending tasks (3)
confirm-pending-task  reject-pending-task  create-pending-task

# reminders (4)
upsert-reminder  acknowledge-reminder  delete-reminder  delete-reminders-batch

# daily plan (5)
confirm-daily-tasks  refresh-daily-plan  regenerate-daily-tasks
generate-bonus-task  defer-overflow  undo-defer

# goal plan (6, 3 async)
confirm-goal-plan  regenerate-goal-plan*  reallocate-goal-plan
adaptive-reschedule*  adjust-all-overloaded-plans*  expand-plan-week

# reschedule flow (2)
snooze-reschedule  dismiss-reschedule

# nudges (1)
dismiss-nudge

# monthly context + vacation (3)
save-monthly-context  delete-monthly-context  set-vacation-mode

# settings + onboarding (3)
update-settings  complete-onboarding  reset-data

# chat (3)
start-chat-stream  send-chat-message  clear-home-chat

* = async via job worker; handler returns {ok, jobId, async: true}
```

### 3.3 EventKind (9)

```
ai:stream-start       ai:token-delta       ai:stream-end
agent:progress        view:invalidate      entity:patch
reminder:triggered    job:complete         job:failed
```

### 3.4 Envelope wire format

- Request header: `Authorization: Bearer <jwt>`, `X-Timezone: <IANA>`.
- View: `GET /view/:kind?args=<JSON>` → `{ ok, data }`.
- Command: `POST /commands/:kind` with JSON body → `{ ok, data? }` or `{ ok, jobId, async: true }`.
- AI: `POST /ai/:channel/stream` → SSE stream of token deltas + final payload.
- WS: `GET /ws?token=<jwt>` upgrade → JSON frames `{ event, payload, streamId? }`.

---

## 4. Server (`packages/server/src/`)

### 4.1 Entry + middleware order (`index.ts`)

```
1. cors({ origin: true, credentials: true })
2. express.json(), express.urlencoded()
3. debug logger (DEBUG=1)
4. /health (unauth)
5. authMiddleware          — verifies Supabase JWT (HS256 / ES256) → req.userId
6. timezone middleware     — reads X-Timezone into AsyncLocalStorage
7. route mounts: /view /commands /entities /ai /calendar /reminder /monthly-context /memory /model-config /chat
8. errorHandler
```

### 4.2 Views dispatch (`src/views/index.ts`)

Single `viewResolvers` table maps `QueryKind` → resolver function. All 10 wired. File for each:

| QueryKind | File |
|---|---|
| view:dashboard | `views/dashboardView.ts` |
| view:tasks | `views/tasksView.ts` |
| view:calendar | `views/calendarView.ts` (takes `args.dateFrom`, `args.dateTo`) |
| view:roadmap | `views/roadmapView.ts` |
| view:planning | `views/planningView.ts` |
| view:settings | `views/settingsView.ts` |
| view:news-feed | `views/newsFeedView.ts` (takes `args.researchTopic`) |
| view:onboarding | `views/onboardingView.ts` |
| view:goal-plan | `views/goalPlanView.ts` (takes `args.goalId`) |
| view:goal-breakdown | `views/goalBreakdownView.ts` (takes `args.goalId`) |

### 4.3 Commands dispatch (`src/routes/commands.ts`)

One large switch on `kind`. Each branch calls a `cmd*` function. Domain handlers live in `src/routes/commands/{goals,tasks,planning,calendar,settings,chat,_helpers}.ts`. All 43 wired.

**Async branches** (enqueue via `insertJob`):
- `command:regenerate-goal-plan` → job type `"regenerate-goal-plan"`
- `command:adaptive-reschedule` → job type `"adaptive-reschedule"`
- `command:adjust-all-overloaded-plans` → job type `"adjust-all-overloaded-plans"`

All other commands execute synchronously; on success the dispatcher calls `invalidate(kind, extra, scope)` which looks up `views/_invalidation.ts::commandToInvalidations` and emits `view:invalidate` over WS.

**Orphan:** `heal-all-goal-plans` is dispatched at `routes/commands.ts:241` via `as CommandKind` cast — not present in `kinds.ts` enum.

### 4.4 Invalidation map (`src/views/_invalidation.ts`)

`commandToInvalidations: Record<CommandKind, QueryKind[]>` covers all 43 commands. `reset-data` invalidates `ALL_QUERY_KINDS`. Optional `_invalidateExtra` and `_scope` fields carry date/entity-level hints forwarded to clients.

### 4.5 AI routes (`src/routes/ai.ts`)

`makeAIRoute(channel, options)` factory registers 14 channels. Channel 15 (`home-chat`) has a custom handler at `ai.ts:105-159` that persists both user and assistant messages to `chatRepo` with IDs for optimistic reconciliation.

Each route calls `runStreamingHandler(client, channel, context, handler)` from `ai/streaming.ts`:
1. `emitAiStreamStart({streamId, kind})`.
2. Run handler; forward token deltas via `emitAiTokenDelta({streamId, delta})`.
3. `emitAiStreamEnd({streamId, finishReason})`.

Each channel receives a `contextType` (`planning` / `daily` / `recovery` / `general`) which `buildMemoryContext()` consumes to shape the system prompt.

**Channel → handler → pipeline:**

| Channel | Handler file | Pipeline |
|---|---|---|
| daily-tasks | `ai/handlers/dailyTasks.ts` | `coordinateRequest` → gatekeeper + timeEstimator + scheduler |
| reallocate | `ai/handlers/reallocate.ts` | direct |
| recovery | `ai/handlers/recovery.ts` | direct + `runReflection` |
| pace-check | `ai/handlers/paceCheck.ts` | direct + `runReflection` |
| goal-breakdown | `ai/handlers/goalBreakdown.ts` | direct |
| generate-goal-plan | core handlers | `coordinateRequest` → timeEstimator + scheduler |
| goal-plan-edit | core handlers | direct (returns PlanPatch JSON) |
| goal-plan-chat | core handlers | direct + `loadProjectContext` |
| chat | core handlers | direct + plan freshness check |
| home-chat | core handlers | direct; persists to `chatRepo` |
| news-briefing | `ai/handlers/newsBriefing.ts` | direct |
| analyze-quick-task | `ai/handlers/analyzeQuickTask.ts` | direct |
| classify-goal | core handlers | direct |
| analyze-monthly-context | core handlers | direct |
| onboarding | core handlers | direct |

**Additional handlers (not streaming routes, called by services/commands):**
- `ai/handlers/expandWeek.ts` → called by `routes/commands/planning.ts`.
- `ai/handlers/paceExplainer.ts` → called by `views/goalPlanView.ts`.
- `ai/handlers/dailyTasksCopy.ts` → called by `services/dailyTaskGeneration.ts` (background jobs).

### 4.6 Multi-agent coordinators (`src/coordinators/`, `src/agents/`)

**Big Goal pipeline** (`coordinators/effortRouter.ts`, `coordinators/bigGoalCoordinator.ts`):

```
userGoal
  → effortRouter.classify()            # local ACONIC heuristic OR Haiku fallback
  → HIGH:  runResearchAgent (Opus)  ‖  runPersonalizationAgent (Haiku)
    LOW:   runPersonalizationAgent only
  → merge {research?, personalization, capacityContext}
  → (on confirm) onGoalConfirmed() saves ProjectAgentContext cache
  → generate-goal-plan channel → coordinateRequest → timeEstimator + scheduler
  → GoalPlan {years → milestones → weeks → days}
  → persist via goalPlanRepo
```

Files: `coordinators/bigGoal/{researchAgent,personalizationAgent,projectAgentContext}.ts`.

**Daily Planner pipeline** (`agents/coordinator.ts::coordinateRequest`):

```
request (daily-tasks)
  → parallel: gatekeeper (Haiku) + timeEstimator (Haiku)
    - gatekeeper returns {filteredTasks, priorityScores, budgetCheck, goalRotation}
    - timeEstimator returns {estimates, totalMinutes, exceedsDeepWorkCeiling}
  → sequential: scheduler (Opus) consumes both, produces tier enforcement
    - Tier 1: calendar blocks   Tier 2: goal blocks   Tier 3: task slots
  → enrichPayload() injects {_researchContext, _schedulingContext, _environmentContext}
  → handleDailyTasks (Sonnet) → DailyLog
  → persist daily_tasks, daily_logs, heatmap
```

Agent modules: `agents/{gatekeeper,timeEstimator,scheduler,router,coordinator}.ts` with prompts in `agents/prompts/`.

**Daily planner scenarios** (`coordinators/dailyPlanner/scenarios.ts`) — post-generation reactions:
- `pool-integration` — integrate newly confirmed pending tasks
- `bonus-suggest` — refresh with empty pool → suggest bonus
- `full-generation` — empty day → regen
- `collect-and-schedule` — cross-goal deferral

Support modules: `coordinators/dailyPlanner/{memoryPackager,cantCompleteRouter,taskRotation}.ts`.

**Agent retry:** `agents/coordinator.ts::runAgentWithRetry` records `agent_fallback` signals when an agent fails over.

### 4.7 Memory system (`src/memory.ts`, `src/reflection.ts`)

**Three tiers persisted in Postgres:**

| Table | Record | Source |
|---|---|---|
| `memory_facts` | `{category, key, value, confidence, evidence[], source}` | reflection output |
| `memory_preferences` | `{text, tags[], weight, examples[]}` | reflection output |
| `memory_signals` | `{type, context, value, timestamp}` | command handlers + agent fallback |

**Per-request load (in `routes/ai.ts`):**

```
loadMemory(userId) → MemoryStore
buildMemoryContext(memory, contextType) → string  (injected into system prompt)
enrichWithEnvironment(contextType) → string       (date, tz, settings)
```

**Reflection trigger (`runReflection`):** called from `paceCheck` + `recovery` handlers. Haiku call over recent signals → upserts facts + preferences.

**Deferred** (declared, no caller): `shouldAutoReflect()`, `generateNudges()`.

### 4.8 WebSocket (`src/ws/`)

- `ws/server.ts` — upgrades `/ws`, reads JWT from `Authorization` header or `?token=` query param, validates, registers connection.
- `ws/connections.ts` — `Map<userId, Set<WebSocket>>` with fan-out helpers.
- `ws/events.ts` — typed emitters, one per EventKind:

| Emitter | Callers |
|---|---|
| `emitAiStreamStart` / `emitAiTokenDelta` / `emitAiStreamEnd` | `ai/streaming.ts` |
| `emitAgentProgress` | 11 call sites in `agents/*` and `coordinators/*` |
| `emitViewInvalidate` | `routes/commands.ts::invalidate`, `job-worker.ts` |
| `emitEntityPatch` | `routes/commands/tasks.ts` (only `toggle-task`) |
| `emitJobComplete` / `emitJobFailed` | `job-worker.ts` |
| `emitReminderTriggered` | **none — dormant** |

**Barrel bug:** `ws/index.ts` omits re-exports for `emitJobComplete`, `emitJobFailed`, `emitEntityPatch`. Callers import directly from `ws/events.ts`.

### 4.9 Job worker (`src/job-worker.ts`, `src/job-db.ts`)

Single Postgres-backed queue (`job_queue` table). Polls every 2s. Claims atomically with `FOR UPDATE SKIP LOCKED`.

```
insertJob(userId, type, payload, maxRetries=2) → UUID
claimNextJob() → pending row → status='running'
processJob() switches on type:
  "regenerate-goal-plan"       → dynamic import cmdRegenerateGoalPlan
  "adaptive-reschedule"        → dynamic import cmdAdaptiveReschedule
  "adjust-all-overloaded-plans"→ dynamic import cmdAdjustAllOverloadedPlans
  else → throw
Runs inside runWithUserId(userId, fn).
On success:  completeJob → emitJobComplete → emitViewInvalidate(getViewsForJobType(type))
On error:    failJob (retry if retry_count < max) → emitJobFailed
```

View invalidation per job type:
- `regenerate-goal-plan` → `[view:goal-plan, view:planning, view:dashboard]`
- `adaptive-reschedule` → `[view:goal-plan, view:planning, view:tasks, view:dashboard]`
- `adjust-all-overloaded-plans` → same as adaptive-reschedule.

### 4.10 Repositories (`src/repositories/`)

All DB access is routed through repositories. Every row is scoped by `user_id`.

| Repo | Table(s) |
|---|---|
| `usersRepo` | `users` |
| `goalsRepo` | `goals` |
| `goalPlanRepo` | `goal_plan_nodes` |
| `dailyTasksRepo` | `daily_tasks` |
| `dailyLogsRepo` | `daily_logs` |
| `pendingTasksRepo` | `pending_tasks` |
| `remindersRepo` | `reminders` |
| `nudgesRepo` | `nudges` |
| `heatmapRepo` | `heatmap_entries` |
| `monthlyContextRepo` | `monthly_context` |
| `vacationModeRepo` | `vacation_mode` |
| `behaviorProfileRepo` | `behavior_profile` |
| `chatRepo` | `home_chat_messages`, goal plan chat |
| `roadmapRepo` | derived from goals |

Memory tables (`memory_facts`, `memory_preferences`, `memory_signals`) accessed directly from `memory.ts` and `services/signalRecorder.ts`.

---

## 5. Client (`packages/desktop/src/`)

Stripped to a bare-HTML test harness. Every page follows the pattern:

```tsx
export default function FooPage() {
  const { data, loading, error, refetch } = useQuery<FooView>("view:foo", args?);
  const { run } = useCommand();
  if (loading) return <p>loading…</p>;
  if (error) return <pre>error: {String(error)}</pre>;
  return (
    <section>
      <h1>view:foo</h1>
      <pre>{JSON.stringify(data, null, 2)}</pre>
      <button onClick={refetch}>refetch</button>
      <h2>commands</h2>
      {/* button or CmdForm (JSON textarea) per command */}
    </section>
  );
}
```

### 5.1 Entry chain

```
main.tsx → <App /> in React.StrictMode
  App = <AuthProvider><AuthGuard><AppShell/></AuthGuard></AuthProvider>
  AppShell:
    useQuery("view:onboarding") to pick tasks|onboarding after boot
    wsClient.connect() on mount
    <I18nProvider lang={language}>
      <Sidebar />    ← <nav><button onClick={setView(v)}>v</button>…</nav>
      <main>{<pages/> by currentView}</main>
      <Chat />       ← textarea + postSseStream → <pre> token deltas
```

`useStore` (Zustand) holds UI-only state: `currentView`, `language`, chat draft. View `currentView` formats: `"tasks"`, `"calendar"`, `"planning"`, `"roadmap"`, `"news-feed"`, `"settings"`, `"onboarding"`, `"welcome"` (boot), or `"goal-plan-<goalId>"` (decoded by `App.tsx` into `goalPlanId`).

### 5.2 Pages (each file + view + exposed commands)

| File | View kind | Exposed commands |
|---|---|---|
| `pages/auth/LoginPage.tsx` | — | Supabase `signInWithPassword`, `signUp`, `signInWithOAuth("google")` |
| `pages/onboarding/OnboardingPage.tsx` | view:onboarding | complete-onboarding, update-settings |
| `pages/tasks/TasksPage.tsx` | view:tasks | toggle-task, skip-task, delete-task, update-task, reschedule-task, create-task, delete-tasks-for-date, confirm-daily-tasks, refresh-daily-plan, regenerate-daily-tasks, generate-bonus-task, accept-task-proposal, cant-complete-task, defer-overflow, undo-defer, snooze-reschedule, dismiss-reschedule, confirm-pending-task, reject-pending-task, create-pending-task, upsert-reminder, acknowledge-reminder, delete-reminder, delete-reminders-batch, dismiss-nudge |
| `pages/calendar/CalendarPage.tsx` | view:calendar | create-task, update-task, delete-task, toggle-task |
| `pages/goals/PlanningPage.tsx` | view:planning | create-goal, update-goal, delete-goal, save-monthly-context, delete-monthly-context, set-vacation-mode, adjust-all-overloaded-plans |
| `pages/goals/GoalPlanPage.tsx` | view:goal-plan (args: goalId) | adaptive-reschedule, adjust-all-overloaded-plans, toggle-task, expand-plan-week, update-goal, confirm-goal-plan, regenerate-goal-plan, reallocate-goal-plan, regenerate-daily-tasks, add-task-to-plan |
| `pages/roadmap/RoadmapPage.tsx` | view:roadmap | — (read-only dump) |
| `pages/news/NewsFeedPage.tsx` | view:news-feed (args: researchTopic) | — |
| `pages/settings/SettingsPage.tsx` | view:settings | update-settings (two JSON textareas: settings + weeklyAvailability), reset-data |

**Missing pages (backend views that have no client harness):** `view:dashboard`, `view:goal-breakdown`. Resolvers exist server-side; add a `<pre>` dump page to exercise them.

### 5.3 Components

| File | Role |
|---|---|
| `components/AuthGuard.tsx` | `if (loading) return <p>loading…</p>; if (!session) return <LoginPage/>; else children` |
| `components/ErrorBoundary.tsx` | `getDerivedStateFromError` → `<pre>{message}</pre>` |
| `components/Sidebar.tsx` | Static `<nav>` of 7 views as `<button onClick={setView(kind)}>` |
| `components/Chat.tsx` | `<textarea>` + submit → `postSseStream("/ai/chat/stream", {userInput, context})`; renders token deltas into `<pre>`; on complete calls `dispatchChatIntent(intent, run)` for each backend intent; exposes `command:clear-home-chat` button |

### 5.4 Hooks

| Hook | Purpose |
|---|---|
| `useQuery<T>(kind, args?)` | Reads from `queryCache`; on miss fetches `/view/:kind`; subscribes to `view:invalidate` for that kind to mark stale + refetch |
| `useCommand()` | Returns `{ run(kind, args) }` which POSTs `/commands/:kind`; resolves to `{ ok, data?, jobId?, async? }` |
| `useAiStream(kind)` | Subscribes to `ai:stream-start/token-delta/stream-end` filtered by streamId |
| `useReminderNotifications(reminders)` | Polls every 30s; fires a toast-free check against scheduled times (does not listen for `reminder:triggered`) |

### 5.5 Services

| File | Role |
|---|---|
| `services/supabase.ts` | Supabase JS client init |
| `services/auth.ts` | `getAuthToken()` (async), `getAuthTokenSync()` (cached) |
| `contexts/AuthContext.tsx` | Provides `{ session, loading, signOut }` via Supabase listener |
| `services/transport.ts` | `fetchEnvelope(method, path, body?)` + `postSseStream(path, body, {onDelta, onComplete})`; attaches `Authorization: Bearer <jwt>` + `X-Timezone` |
| `services/cloudTransport.ts` | `cloudInvoke` wrapper (used where view/command need richer options) |
| `services/wsClient.ts` | Singleton WebSocket; connects with `?token=<jwt>`; heartbeat 25s; exp. backoff reconnect (1s→30s, resets after 30s stable); reconnects if `getAuthTokenSync()` differs from token-at-connect; `subscribe<K>(kind, listener)` → `Map<EventKind, Set<Listener>>` |
| `services/queryCache.ts` | In-memory `Map<QueryKind, {data, stale, listeners}>`; `invalidate(kind)` marks stale + notifies; `patchEntity(...)` for `entity:patch` fast path |
| `services/memory.ts` | Client-side memory helpers (used by chat) |
| `services/ai.ts` | Thin SSE helpers used by Chat |
| `services/environment.ts` | Timezone + now() injection |

### 5.6 WS subscriptions (who listens to what)

| Event | Client handler |
|---|---|
| `ai:stream-start` / `ai:token-delta` / `ai:stream-end` | `useAiStream` |
| `view:invalidate` | `queryCache.invalidate(kind)` → active `useQuery` refetch |
| `entity:patch` | `queryCache.patchEntity(...)` → in-place merge |
| `agent:progress` | **no listener** (would power live progress UI; removed in harness) |
| `job:complete` / `job:failed` | **no listener** (relies on paired `view:invalidate`) |
| `reminder:triggered` | **no listener** (and no server emitter either) |

### 5.7 Electron integration (`packages/desktop/electron/`)

- `main.ts` — creates BrowserWindow; registers `nsproto://` custom protocol for OAuth deep-link callback; exposes `window.electronAuth.oauthPopup(url)` via preload.
- `preload.ts` — contextBridge exposes `electronAuth`, `electronUpdater` IPC.
- `auto-updater.ts` — `electron-updater` wiring (GitHub releases).

OAuth flow: `LoginPage` calls `supabase.auth.signInWithOAuth({provider:'google'})`; main process opens external browser; deep-link back via `nsproto://auth-callback?...`; session handed to renderer.

---

## 6. Feature Inventory

Each feature row: trigger → server path → data touched → invalidation result.

### 6.1 Auth / session

| Feature | Trigger | Path | Persisted | Invalidates |
|---|---|---|---|---|
| Email/password login | LoginPage submit | Supabase Auth (no server call) | Supabase session | — |
| Signup | LoginPage mode=signup | Supabase Auth | Supabase session | — |
| Google OAuth | LoginPage button | Electron popup → deep link | Supabase session | — |
| Session hydration | AuthContext on boot | Supabase SDK | — | — |
| Sign out | SettingsPage button | Supabase Auth | session cleared | all local queryCache |
| Boot routing | AppShell effect | view:onboarding | — | — |

### 6.2 Goals + planning

| Feature | Command | Server handler | AI | Invalidates |
|---|---|---|---|---|
| Create goal | create-goal | `commands/goals.ts::cmdCreateGoal` | classify-goal / goal-breakdown (async, via chat intent) | view:planning, view:roadmap, view:dashboard |
| Update goal | update-goal | `cmdUpdateGoal` | — | view:planning, view:goal-plan, view:roadmap, view:dashboard |
| Delete goal | delete-goal | `cmdDeleteGoal` | — | view:planning, view:roadmap, view:dashboard, view:tasks |
| Confirm goal plan | confirm-goal-plan | `cmdConfirmGoalPlan` + `onGoalConfirmed()` | — | view:goal-plan, view:planning |
| Regenerate goal plan | regenerate-goal-plan (async) | job-worker → `cmdRegenerateGoalPlan` | generate-goal-plan pipeline | view:goal-plan, view:planning, view:dashboard |
| Reallocate goal plan | reallocate-goal-plan | `cmdReallocateGoalPlan` | reallocate | view:goal-plan, view:planning |
| Adaptive reschedule | adaptive-reschedule (async) | job-worker → `cmdAdaptiveReschedule` | coordinator | view:goal-plan, view:planning, view:tasks, view:dashboard |
| Adjust all overloaded | adjust-all-overloaded-plans (async) | job-worker → `cmdAdjustAllOverloadedPlans` | coordinator | same as adaptive-reschedule |
| Expand plan week | expand-plan-week | `cmdExpandPlanWeek` | expandWeek handler | view:goal-plan |
| Add task to plan | add-task-to-plan | `cmdAddTaskToPlan` | — | view:goal-plan, view:tasks |
| Save monthly context | save-monthly-context | `cmdSaveMonthlyContext` | analyze-monthly-context (streaming) | view:planning |
| Delete monthly context | delete-monthly-context | `cmdDeleteMonthlyContext` | — | view:planning |
| Vacation mode | set-vacation-mode | `cmdSetVacationMode` | — | view:planning, view:tasks, view:dashboard |

### 6.3 Daily tasks

| Feature | Command | Server handler | AI | Invalidates |
|---|---|---|---|---|
| Confirm daily tasks | confirm-daily-tasks | `cmdConfirmDailyTasks` | — | view:tasks, view:dashboard |
| Refresh daily plan | refresh-daily-plan | `cmdRefreshDailyPlan` | daily-tasks pipeline | view:tasks, view:dashboard |
| Regenerate daily tasks | regenerate-daily-tasks | `cmdRegenerateDailyTasks` | daily-tasks | view:tasks, view:dashboard |
| Generate bonus task | generate-bonus-task | `cmdGenerateBonusTask` | daily-tasks scenario | view:tasks |
| Accept task proposal | accept-task-proposal | `cmdAcceptTaskProposal` | analyze-quick-task | view:tasks |
| Create task | create-task | `cmdCreateTask` | — | view:tasks, view:calendar |
| Toggle task | toggle-task | `cmdToggleTask` (emits `entity:patch`) | — | view:tasks, view:dashboard, view:calendar |
| Skip task | skip-task | `cmdSkipTask` → signalRecorder | — | view:tasks |
| Delete task | delete-task | `cmdDeleteTask` | — | view:tasks, view:calendar |
| Delete tasks for date | delete-tasks-for-date | `cmdDeleteTasksForDate` | — | view:tasks, view:calendar |
| Update task | update-task | `cmdUpdateTask` | — | view:tasks, view:calendar |
| Reschedule task | reschedule-task | `cmdRescheduleTask` | — | view:tasks, view:calendar |
| Can't complete | cant-complete-task | `cmdCantCompleteTask` → recovery | recovery handler → `runReflection` | view:tasks |
| Defer overflow | defer-overflow | `cmdDeferOverflow` | — | view:tasks |
| Undo defer | undo-defer | `cmdUndoDefer` | — | view:tasks |
| Snooze reschedule prompt | snooze-reschedule | `cmdSnoozeReschedule` | — | view:tasks |
| Dismiss reschedule prompt | dismiss-reschedule | `cmdDismissReschedule` | — | view:tasks |
| Pace check (server-side) | — | `handlers/paceCheck.ts` | pace-check + paceExplainer → `runReflection` | view:goal-plan |

### 6.4 Pending tasks

| Feature | Command | Server handler | AI | Invalidates |
|---|---|---|---|---|
| Create pending task | create-pending-task | `cmdCreatePendingTask` | analyze-quick-task | view:tasks |
| Confirm pending task | confirm-pending-task | `cmdConfirmPendingTask` | — | view:tasks |
| Reject pending task | reject-pending-task | `cmdRejectPendingTask` | — | view:tasks |

### 6.5 Reminders

| Feature | Command | Handler | Table | Invalidates |
|---|---|---|---|---|
| Upsert reminder | upsert-reminder | `cmdUpsertReminder` | reminders | view:tasks |
| Acknowledge reminder | acknowledge-reminder | `cmdAcknowledgeReminder` | reminders | view:tasks |
| Delete reminder | delete-reminder | `cmdDeleteReminder` | reminders | view:tasks |
| Delete batch | delete-reminders-batch | `cmdDeleteRemindersBatch` | reminders | view:tasks |
| Trigger | client poll (30s) | `useReminderNotifications` checks scheduled times from `view:tasks` payload | — | — |

### 6.6 Nudges

| Feature | Command | Handler | Source |
|---|---|---|---|
| Dismiss nudge | dismiss-nudge | `cmdDismissNudge` | nudges table |

Nudge generation (`generateNudges()` in `reflection.ts`) is declared but not yet wired to a scheduler.

### 6.7 Calendar

| Feature | View / command | Path |
|---|---|---|
| Calendar view | view:calendar (args: dateFrom, dateTo) | `views/calendarView.ts` |
| Calendar-side task CRUD | create-task, update-task, delete-task, toggle-task | same handlers as TasksPage |
| External calendar data | `src/calendar.ts` + `routes/calendar.ts` | server-side calendar sync endpoint |

### 6.8 Roadmap

`view:roadmap` aggregates all goals with progress from `goalPlanRepo`. Read-only in harness.

### 6.9 News feed

`view:news-feed` with `args.researchTopic` → Anthropic `news-briefing` channel → cached to `news_briefings` table. Read-only in harness.

### 6.10 Settings

| Feature | Command | Persists | Invalidates |
|---|---|---|---|
| Update settings | update-settings | `user_settings` (language, weeklyAvailability, deepWorkHours, etc.) | view:settings, view:tasks (if availability) |
| Reset data | reset-data | truncates user rows across most tables | ALL_QUERY_KINDS |
| Complete onboarding | complete-onboarding | `users.onboarding_complete=true` | view:onboarding, view:settings |

### 6.11 Chat

| Feature | Path | Persistence |
|---|---|---|
| Home chat stream | `POST /ai/home-chat/stream` (custom handler in `routes/ai.ts`) | `home_chat_messages` (user + assistant rows with IDs) |
| Clear home chat | `command:clear-home-chat` → `cmdClearHomeChat` | truncates `home_chat_messages` for user |
| Unified chat stream | `POST /ai/chat/stream` | persists per-context (home vs goal-plan) |
| Goal-plan chat stream | `POST /ai/goal-plan-chat/stream` | persists plan changes + chat history; loads ProjectAgentContext |
| Intent dispatch | client-side `dispatchChatIntent(intent, run)` after SSE completes | fires any CommandKind the intent requests |
| Start chat stream (command) | `command:start-chat-stream` | bookkeeping only |
| Send chat message (command) | `command:send-chat-message` | persists message + triggers AI |

### 6.12 Memory + reflection

- Signals: written on every task command (completed/skipped/uncompleted) via `services/signalRecorder.ts`; also on agent fallback.
- Facts + preferences: written by `reflection.runReflection()` triggered inside `paceCheck` + `recovery` handlers (active). Nightly reflection infra partially stubbed (`shouldAutoReflect`, deferred).
- Load: every `routes/ai.ts` handler calls `loadMemory(userId)` and injects via `buildMemoryContext(contextType)` into the system prompt.

### 6.13 Onboarding

`view:onboarding` returns `{ user, onboardingComplete }`. Bare-HTML harness exposes `complete-onboarding` and `update-settings` buttons. The `onboarding` AI channel streams recommended settings from free-form input.

---

## 7. Known Gaps (DO NOT call these "bugs" without repro)

1. `reminder:triggered` event type declared in `kinds.ts` + typed emitter in `ws/events.ts`, no server caller. Client polls `view:tasks` every 30s instead.
2. `heal-all-goal-plans` handler dispatched via `as CommandKind` cast in `routes/commands.ts:241`; not in `kinds.ts`. Either add or remove.
3. `ws/index.ts` barrel missing `emitJobComplete`, `emitJobFailed`, `emitEntityPatch` re-exports. Call sites import directly from `ws/events.ts`.
4. Client does not subscribe to `job:complete`, `job:failed`, `agent:progress`. Paired `view:invalidate` still refreshes state; no completion toasts.
5. `view:dashboard`, `view:goal-breakdown` have no page in the bare-HTML harness. Resolvers exist and pass tests when called directly.
6. `shouldAutoReflect()` and `generateNudges()` declared in `reflection.ts`; no scheduler invokes them.

---

## 8. Invariants / Conventions

- Every Postgres row has `user_id`. No cross-user access paths.
- Views are pure reads; commands are writes; the two never overlap.
- Command success must emit `view:invalidate` for every affected kind (enforced via `commandToInvalidations` map).
- Async commands return `{ ok, jobId, async: true }` synchronously, then emit `job:complete` + `view:invalidate` on worker completion.
- AI handlers MUST call `loadMemory` + `enrichWithEnvironment` and inject via `buildMemoryContext(contextType)` before the first Anthropic call. Contexts: `planning` / `daily` / `recovery` / `general`.
- Every client fetch attaches `Authorization: Bearer <jwt>` and `X-Timezone: <IANA>`.
- WebSocket is the only push channel; the renderer never polls except `useReminderNotifications`.
- Renderer is a harness: no styling, no CSS imports, all state surfaced as `<pre>{JSON}</pre>`.

## 9. Data Flow Cheat Sheet

```
SYNC COMMAND:
  click → run() → POST /commands/:kind → handler → DB write
  → emitViewInvalidate(userId, affectedKinds)
  → ws frame → queryCache.invalidate → useQuery refetch
  → GET /view/:kind → render

ASYNC COMMAND:
  click → run() → POST /commands/regenerate-goal-plan → insertJob → {ok, jobId, async}
  → job-worker (2s poll) claims → cmdRegenerateGoalPlan (lazy import)
  → emitJobComplete + emitViewInvalidate → client refetch

AI STREAM:
  submit → postSseStream → /ai/:channel/stream
  → runStreamingHandler: emitAiStreamStart, emitAiTokenDelta*, emitAiStreamEnd
  → SSE 'delta' → onDelta(t) appends to <pre>
  → SSE 'complete' → onComplete(intents) → dispatchChatIntent(i, run)

ENTITY PATCH:
  toggle-task → emitEntityPatch({entityType, entityId, patch, date?})
  → queryCache.patchEntity → optimistic in-place merge (before refetch)

WS RECONNECT:
  heartbeat 25s; reconnect exp. backoff 1s→30s; resets after 30s stable
  if token rotation detected (getAuthTokenSync() !== tokenAtConnect) → reconnect
```

## 10. Key File Lookup Table

| Concept | File |
|---|---|
| Protocol enums | `packages/core/src/protocol/kinds.ts` |
| View dispatch | `packages/server/src/views/index.ts` |
| Command dispatch | `packages/server/src/routes/commands.ts` |
| Invalidation map | `packages/server/src/views/_invalidation.ts` |
| AI routes | `packages/server/src/routes/ai.ts` |
| AI streaming runtime | `packages/server/src/ai/streaming.ts` |
| Anthropic client | `packages/server/src/ai/client.ts` |
| Big goal coordinator | `packages/server/src/coordinators/bigGoalCoordinator.ts` |
| Effort router | `packages/server/src/coordinators/effortRouter.ts` |
| Daily planner coordinator | `packages/server/src/agents/coordinator.ts` |
| Daily planner scenarios | `packages/server/src/coordinators/dailyPlanner/scenarios.ts` |
| Memory | `packages/server/src/memory.ts` |
| Reflection | `packages/server/src/reflection.ts` |
| Signals | `packages/server/src/services/signalRecorder.ts` |
| Pace detection | `packages/server/src/services/paceDetection.ts` |
| Daily task generation service | `packages/server/src/services/dailyTaskGeneration.ts` |
| WS server | `packages/server/src/ws/server.ts` |
| WS emitters | `packages/server/src/ws/events.ts` |
| Job queue DB | `packages/server/src/job-db.ts` |
| Job worker | `packages/server/src/job-worker.ts` |
| Auth middleware | `packages/server/src/middleware/auth.ts` |
| Client app shell | `packages/desktop/src/App.tsx` |
| Client auth guard | `packages/desktop/src/components/AuthGuard.tsx` |
| Client query hook | `packages/desktop/src/hooks/useQuery.ts` |
| Client command hook | `packages/desktop/src/hooks/useCommand.ts` |
| Client AI stream hook | `packages/desktop/src/hooks/useAiStream.ts` |
| Client transport | `packages/desktop/src/services/transport.ts` |
| Client WS client | `packages/desktop/src/services/wsClient.ts` |
| Client query cache | `packages/desktop/src/services/queryCache.ts` |
| Client auth | `packages/desktop/src/services/auth.ts` |
| Client store | `packages/desktop/src/store/useStore.ts` |
| Client chat | `packages/desktop/src/components/Chat.tsx` |
| Client chat intent dispatch | `packages/desktop/src/utils/dispatchChatIntent.ts` |
| Electron main | `packages/desktop/electron/main.ts` |
| Electron preload | `packages/desktop/electron/preload.ts` |

## 11. Glossary

- **Envelope** — shared `{ ok, data?, error? }` wire format used by view/command responses.
- **Kind** — string union discriminating the three message families (view/command/event).
- **Scope** — optional `{ entityType, entityId, date? }` attached to an invalidation so clients can skip full refetches.
- **Coordinator** — server module orchestrating 2+ agents with parallel/sequential fan-out (big goal / daily planner).
- **Handler** — single-purpose AI function body that constructs the final Anthropic request and post-processes the result.
- **Signal** — behavioural event persisted to `memory_signals` (task completed/skipped, agent fallback, etc.); fodder for reflection.
- **Fact / Preference** — output of reflection; persisted memory injected into future prompts.
- **Tier enforcement** — scheduler output partitioning the day into Tier 1 calendar blocks, Tier 2 goal blocks, Tier 3 task slots.
- **ProjectAgentContext** — cached `{research, personalization, decisions}` snapshot saved at `confirm-goal-plan` time; reloaded on follow-up goal-plan chats.
- **Bare-HTML harness** — current renderer mode: every page is `<h1>kind</h1><pre>data</pre><button>command</button>…`. No CSS, no visual components, no i18n switching (English only).
