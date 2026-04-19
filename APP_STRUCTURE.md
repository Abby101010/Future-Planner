# NorthStar 北极星 — App Structure & Details

> AI-powered goal planning and daily productivity companion, delivered as an Electron desktop app backed by a cloud API.

## What It Is

NorthStar is a personal planning assistant that:
1. Has a **multi-turn conversation** with the user to clarify their goal.
2. Builds an **AI-generated hierarchical roadmap** (milestones → years → months → weeks → days → tasks) with reasoning.
3. Generates **daily task lists** that respect a cognitive budget and the user's weekly availability.
4. Adapts to missed tasks, overloaded plans, and pace drift through **specialized AI agents**.
5. Syncs across devices via a single Postgres-backed cloud API.

Entry screen: `packages/desktop/src/App.tsx` — gates on Supabase auth, then routes between welcome / onboarding / tasks / calendar / goal-plan / roadmap / news / settings.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Renderer | React 18 + TypeScript + Vite + Zustand (UI-only state) |
| Desktop shell | Electron 33 (`packages/desktop/electron/`) |
| Cloud API | Node 22 + Express 5 + TypeScript on Fly.io |
| Database | Supabase Postgres; every row is `user_id`-scoped |
| AI | Anthropic Claude (Sonnet 4.6 / Haiku 4.5) via `@anthropic-ai/sdk`, server-side only |
| Real-time | WebSocket (`/ws`) for view invalidation; SSE for AI token streams |
| Auth | Supabase JWT (bearer token) — middleware at `packages/server/src/middleware/auth.ts` |
| Packaging | electron-builder (macOS arm64 dmg/zip, Windows nsis, Linux AppImage) |
| Auto-update | electron-updater → GitHub Releases |

---

## Monorepo Layout

npm workspaces; three packages under `packages/`:

```
Future-Planner/
├── packages/
│   ├── core/          # Shared wire types, protocol kinds, domain logic, AI prompts
│   ├── server/        # Express API, Postgres, AI orchestration, WebSocket bus
│   └── desktop/       # Electron main + React renderer
├── ARCHITECTURE_UPGRADES.md # Additive AI layers (RAG, critique, queue, scheduler, tools)
├── FLOW_DIAGRAMS.md         # End-to-end feature flows
├── SYSTEM_SPEC.md           # System behaviour spec
├── REFACTORING_PLAN.md
├── README.md
├── fly.toml           # Fly.io deployment config
└── package.json       # Workspaces + top-level typecheck script
```

Root scripts (`package.json`):
- `npm run typecheck` — build all three packages
- `npm run dev:server` / `dev:desktop`
- `npm run build:server` / `build:desktop`

---

## `packages/core` — Shared Contracts

The only package both server and desktop import. Pure TypeScript; no runtime side effects for the renderer.

```
core/src/
├── protocol/
│   ├── envelope.ts          # Envelope<T>: uniform { ok, data | error } wrapper
│   └── kinds.ts             # QueryKind | CommandKind | EventKind — the wire vocabulary
├── types/
│   ├── index.ts             # UserProfile, Goal, GoalPlan*, DailyTask, DailyLog,
│   │                        # Reminder, MonthlyContext, PaceMismatch, OverloadAdvisory, …
│   ├── agents.ts            # Agent-pipeline message types
│   └── taskState.ts         # Task lifecycle state machine
├── domain/
│   ├── goalPlan.ts          # applyPlanPatch — immutable tree edits
│   ├── cognitiveBudget.ts   # Daily load calc (weight × duration)
│   ├── dailyTaskEngine.ts   # Daily picker rules
│   ├── effortClassifier.ts  # Small-vs-big task classification
│   ├── paceDetection.ts     # Plan pace vs actual pace mismatch
│   └── overloadCheck.ts     # Cross-goal capacity check
├── ai/
│   ├── prompts/             # System prompt builders (versioned)
│   ├── handlers/            # Server-only AI handler logic
│   ├── personalize.ts       # Memory-based prompt personalization
│   ├── sanitize.ts          # Strip/validate AI output
│   └── payloads.ts          # AI request/response shapes
├── model-config.ts          # heavy / medium / light tier routing
└── index.ts                 # Barrel (never exports AI handlers — server-only)
```

### Protocol (CQRS-style)

Every client/server exchange is one of three kinds, wrapped in an `Envelope<T>`:

| Kind | Example | Transport |
|------|---------|-----------|
| Query | `view:tasks`, `view:goal-plan` | `GET /view?kind=…` |
| Command | `command:toggle-task`, `command:adaptive-reschedule` | `POST /commands/…` |
| Event | `view:invalidate`, `ai:token-delta`, `reminder:triggered` | WebSocket / SSE |

Complete list: `packages/core/src/protocol/kinds.ts`.

---

## `packages/server` — Cloud API

Express app on Fly.io. Mirrors an IPC-style dispatcher over HTTP + WebSocket.

```
server/src/
├── index.ts                 # App bootstrap: CORS, JSON, auth, timezone ALS, routes, WS, job worker
├── middleware/
│   ├── auth.ts              # Bearer/JWT → req.userId (the only place user id is decided)
│   ├── requestContext.ts    # AsyncLocalStorage for per-request context
│   └── errorHandler.ts
├── routes/
│   ├── view.ts              # GET /view?kind=view:xxx → view-model resolver
│   ├── commands.ts          # POST /commands/... → command handler
│   ├── commands/            # Per-domain command handlers
│   │   ├── goals.ts
│   │   ├── tasks.ts
│   │   ├── planning.ts
│   │   ├── chat.ts
│   │   ├── calendar.ts
│   │   └── settings.ts
│   ├── ai.ts                # SSE streaming endpoint
│   ├── entities.ts          # Legacy entity CRUD
│   ├── calendar.ts, chat.ts, reminders.ts,
│   ├── memory.ts, monthlyContext.ts, modelConfig.ts
├── views/                   # Read-side CQRS resolvers
│   ├── dashboardView.ts     tasksView.ts     calendarView.ts
│   ├── roadmapView.ts       planningView.ts  settingsView.ts
│   ├── newsFeedView.ts      onboardingView.ts
│   ├── goalPlanView.ts      goalBreakdownView.ts
│   ├── _invalidation.ts     # Command → views-to-invalidate map
│   └── _mappers.ts          # DB row → view-model transforms
├── repositories/            # One per entity; every query includes user_id
│   ├── goalsRepo.ts         goalPlanRepo.ts
│   ├── dailyTasksRepo.ts    dailyLogsRepo.ts   heatmapRepo.ts
│   ├── remindersRepo.ts     chatRepo.ts        nudgesRepo.ts
│   ├── pendingTasksRepo.ts  usersRepo.ts       roadmapRepo.ts
│   ├── monthlyContextRepo.ts vacationModeRepo.ts
│   ├── behaviorProfileRepo.ts
│   ├── _context.ts / _json.ts  # Shared helpers
│   └── index.ts             # Barrel
├── ai/
│   ├── client.ts            # Anthropic SDK wrapper
│   ├── router.ts            # Routes AI calls to the right handler
│   ├── streaming.ts         # SSE framing
│   └── handlers/            # dailyTasks, goalBreakdown, recovery, paceCheck,
│                            # paceExplainer, reallocate, expandWeek,
│                            # analyzeQuickTask, newsBriefing, dailyTasksCopy
├── agents/                  # Specialized single-purpose agents
│   ├── coordinator.ts       router.ts
│   ├── gatekeeper.ts        scheduler.ts       timeEstimator.ts
│   ├── types.ts
│   └── prompts/             gatekeeper.ts, scheduler.ts, timeEstimator.ts
├── coordinators/            # Multi-agent orchestration
│   ├── effortRouter.ts      # Small task → direct; big goal → bigGoal pipeline
│   ├── bigGoalCoordinator.ts
│   ├── bigGoal/             researchAgent, personalizationAgent, projectAgentContext
│   └── dailyPlanner/        scenarios, taskRotation, memoryPackager, cantCompleteRouter
├── services/
│   ├── dailyTaskGeneration.ts
│   ├── paceDetection.ts
│   └── signalRecorder.ts    # Behavior telemetry feeding memory
├── ws/                      # WebSocket server
│   ├── server.ts            # Upgrade handler at /ws
│   ├── connections.ts       # Per-user connection registry
│   ├── events.ts            # publish() helper for invalidations
│   └── index.ts             # Barrel
├── db/
│   ├── pool.ts              # pg Pool singleton
│   └── migrate.ts           # Runs /migrations at startup
├── prompts/                 # Out-of-band prompt harness (run-prompts.ts) for iteration
├── migrations/              # 0000…0008 numbered SQL migrations, includes RLS enablement
├── memory.ts                # 3-tier memory (facts / preferences / signals)
├── reflection.ts            # Nightly reflection cycle
├── job-db.ts / job-worker.ts # Background jobs (polled worker, persisted in DB)
├── calendar.ts              # iCal integration
├── dateUtils.ts             # Timezone-aware date helpers (uses ALS for X-Timezone header)
├── environment.ts
└── database.ts
```

### Request Flow

1. Client sends `Authorization: Bearer <jwt>` + `X-Timezone: <iana>`.
2. `authMiddleware` resolves `req.userId`; timezone middleware stores the header in `AsyncLocalStorage`.
3. Reads go through `/view?kind=…` → resolver in `views/` → repositories.
4. Writes go through `/commands/…` → handler in `routes/commands/` → repositories; handler emits `view:invalidate` over WebSocket via `ws/events.ts`.
5. AI calls stream tokens over `/ai` (SSE).

### Migrations

Numbered SQL files in `packages/server/migrations/`:

- `0000` schema_migrations bootstrap
- `0001` legacy init
- `0002` entity tables
- `0003` goals metadata rename
- `0004` users + roadmap
- `0005` goal slots (now deprecated)
- `0006` enable RLS
- `0007` unify tasks + calendar
- `0008` add task source

Runner: `packages/server/src/db/migrate.ts` — executes at startup.

### Deployment

`Dockerfile` + `fly.toml` at repo root → `fly deploy` from `packages/server/`. App name: `northstar-api`. Secrets: `DATABASE_URL`, `ANTHROPIC_API_KEY`, `DEV_USER_ID`.

---

## `packages/desktop` — Electron + React

```
desktop/
├── electron/                # Electron main process
│   ├── main.ts              # BrowserWindow, app lifecycle, custom protocol
│   ├── preload.ts           # contextBridge surface
│   └── auto-updater.ts      # electron-updater wiring
├── src/
│   ├── main.tsx             # React entry
│   ├── App.tsx              # AuthProvider → AuthGuard → view router (switch-on-currentView)
│   ├── contexts/
│   │   └── AuthContext.tsx  # Supabase session state
│   ├── components/
│   │   ├── AuthGuard.tsx    # Blocks render until session exists
│   │   ├── Sidebar.tsx      # Nav between pages
│   │   ├── Chat.tsx         # Persistent side-panel chat
│   │   ├── OpportunityCostCard.tsx
│   │   ├── WeeklyAvailabilityGrid.tsx
│   │   └── ErrorBoundary.tsx
│   ├── pages/
│   │   ├── welcome/         WelcomePage
│   │   ├── auth/            LoginPage
│   │   ├── onboarding/      OnboardingPage (goal-clarification chat)
│   │   ├── tasks/           TasksPage, TaskCard, Heatmap, RecoveryModal,
│   │   │                    OverloadBanner, PaceBanner, NudgeCard,
│   │   │                    MilestoneCelebration, ReminderList, …
│   │   ├── calendar/        CalendarPage, CalendarDayDetail, EventFormModal
│   │   ├── goals/           PlanningPage (new goal flow), GoalPlanPage,
│   │   │                    GoalPlanHierarchy, GoalPlanMilestoneTimeline,
│   │   │                    GoalPlanWeekCard, AgentProgress, MonthlyContext,
│   │   │                    RichTextToolbar
│   │   ├── roadmap/         RoadmapPage
│   │   ├── news/            NewsFeedPage
│   │   ├── settings/        SettingsPage
│   │   └── dashboard/       PendingCards
│   ├── hooks/
│   │   ├── useQuery.ts      # Read view + subscribe to view:invalidate
│   │   ├── useCommand.ts    # Mutate via /commands/...
│   │   ├── useAiStream.ts   # SSE token stream
│   │   └── useReminderNotifications.ts
│   ├── services/
│   │   ├── transport.ts     # The one place fetch() lives
│   │   ├── cloudTransport.ts
│   │   ├── auth.ts          # Only client-side token source
│   │   ├── supabase.ts
│   │   ├── wsClient.ts      # Single shared WebSocket connection
│   │   ├── queryCache.ts    # In-memory view cache
│   │   ├── ai.ts            memory.ts environment.ts
│   ├── repositories/        # Thin wrappers over transport (by domain)
│   ├── store/
│   │   └── useStore.ts      # Zustand — UI-only state (currentView, language, …)
│   ├── lib/                 goalPlanHelpers.ts
│   ├── utils/               dateFormat, detectChatWidget, dispatchChatIntent, logger
│   ├── i18n/                index.tsx + locales/ (en, zh)
│   ├── styles/              global.css, tasks-shared.css
│   └── types/               electron.d.ts
├── index.html
├── vite.config.ts / vitest.config.ts
├── tsconfig*.json
├── build/                   # App icons
└── release/                 # electron-builder output (.dmg, .zip)
```

### Client Rules (per README guidance)

- **All reads** go through `useQuery("view:…")`.
- **All writes** go through `useCommand().run("command:…")`.
- **Only** `services/transport.ts` calls `fetch()`.
- **Only** `services/auth.ts` reads the token.
- Zustand holds **UI state only** — server data belongs in the view cache.

Cloud URL and Supabase keys are baked at build time via `VITE_CLOUD_API_URL` + `VITE_SUPABASE_*` (see `packages/desktop/package.json` scripts).

---

## Feature Map

| Feature | Renderer entry | Server handler |
|---------|---------------|----------------|
| Onboarding chat | `pages/onboarding/OnboardingPage.tsx` | `ai/handlers/…` + `views/onboardingView` |
| New goal / planning | `pages/goals/PlanningPage.tsx` | `coordinators/effortRouter` → `bigGoalCoordinator` or direct |
| Goal plan tree | `pages/goals/GoalPlanPage.tsx` | `views/goalPlanView`, `commands/planning` |
| Daily tasks | `pages/tasks/TasksPage.tsx` | `services/dailyTaskGeneration`, `ai/handlers/dailyTasks` |
| Adaptive reschedule | `command:adaptive-reschedule` | `commands/planning.ts` → `ai/handlers/reallocate` |
| Recovery (missed tasks) | `pages/tasks/RecoveryModal.tsx` | `ai/handlers/recovery` |
| Pace detection | `pages/tasks/PaceBanner.tsx` | `services/paceDetection`, `ai/handlers/paceExplainer` |
| Overload advisory | `pages/tasks/OverloadBanner.tsx` | `domain/overloadCheck` + `ai/handlers/reallocate` |
| Calendar heatmap | `pages/tasks/Heatmap.tsx` | `repositories/heatmapRepo` |
| Reminders | `pages/tasks/ReminderList.tsx` | `repositories/remindersRepo`, `routes/reminders.ts` |
| Quick-add via chat | `components/Chat.tsx` + `PendingCards.tsx` | `ai/handlers/analyzeQuickTask` |
| News briefing | `pages/news/NewsFeedPage.tsx` | `ai/handlers/newsBriefing` |
| 3-tier memory | — (surfaced in AI prompts) | `memory.ts`, `reflection.ts`, `services/signalRecorder` |
| Multi-device sync | Automatic | WebSocket `view:invalidate` over `/ws` |

---

## Data Model Highlights

Core domain types live in `packages/core/src/types/index.ts`:

- `UserProfile` — identity + `UserSettings` (theme, language, model overrides) + `weeklyAvailability: TimeBlock[]`.
- `Goal` — `goalType: "big" | "everyday" | "repeating"`, `scope: "small" | "big"`, hierarchical `plan: GoalPlan` or flat `flatPlan: GoalPlanSection[]`.
- `GoalPlan` — milestones + years → months → weeks → days → tasks.
- `DailyTask` — unified task + calendar event (date, scheduledTime, recurring, isVacation, source).
- `DailyLog` — per-day tasks + heatmap + yesterday recap + mood + adaptive reasoning.
- `MonthlyContext` — AI-interpreted intensity ("free"…"intense") with `capacityMultiplier` applied to cognitive budget.
- `PaceMismatch` / `OverloadAdvisory` — signals driving banners.
- `ContextualNudge` — behavior-triggered probes.

---

## Multi-User Readiness

Phase 1 is effectively single-user, but the seams are in place:
- Every table has `user_id text not null` + composite PKs.
- `middleware/auth.ts` is the **only** place a user id is decided server-side.
- `services/auth.ts` is the **only** client-side token source.
- Anthropic API key is a Fly secret; never reaches the renderer.

Phase 2 = swap `auth.ts` for real JWT verification + login page. No schema migration needed.

---

## References

- `README.md` — setup, dev, deploy commands.
- `ARCHITECTURE_UPGRADES.md` — additive AI/agent layers (RAG knowledge, critique agent, BullMQ queue, per-user scheduler, tool-use).
- `FLOW_DIAGRAMS.md` — end-to-end feature flows (renderer → transport → server → AI → persistence → WS).
- `SYSTEM_SPEC.md` — system behaviour spec.
- `REFACTORING_PLAN.md` — in-flight refactor proposal.
- `refactor/PHASE_1_REPORT.md`, `refactor/PHASE_2_DESIGN.md` — refactor progress.
- Per-folder `README.md` files in `packages/*/src/**` — each states the one architectural rule for that folder.
