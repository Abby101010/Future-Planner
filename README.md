# NorthStar 北极星

**AI-powered goal planning and daily productivity companion.**

Tell NorthStar where you want to go. It'll have a real conversation with you to
understand your goal, build a personalized roadmap with reasoning behind every
decision, and generate focused daily tasks that actually fit your life.

Built as an **Electron desktop app** backed by a **cloud API** so the same
account works across machines.

---

## Features

| # | Feature | Description |
|---|---------|-------------|
| 1 | **Conversational Goal Coaching** | Natural multi-turn dialogue (not a form) to clarify your goal |
| 2 | **AI Roadmap + Reasoning** | Milestones with explained reasoning for every major decision |
| 3 | **Daily Task Generation** | Cognitive-budget-aware daily plans with "why today" for each task |
| 4 | **Smart Recovery** | No-guilt missed-task handling with plan adjustment |
| 5 | **Multi-Agent AI Planning** | Specialized agents (classify, breakdown, daily-tasks, reflection, etc.) coordinated server-side |
| 6 | **Calendar Heatmap** | GitHub-style activity visualization with streak tracking |
| 7 | **Milestone Celebrations** | Screenshot-worthy moments when milestones are reached |
| 8 | **Cloud Sync** | Goals, plans, and progress sync across devices via Postgres |

## Architecture

NorthStar runs as two cooperating pieces:

```
┌──────────────────────┐         HTTPS         ┌────────────────────────┐
│  Electron desktop    │  ◄──────────────────► │  Fly.io Node service   │
│  (frontend/)         │   Bearer auth token   │  (backend/)            │
│                      │                       │                        │
│  - React UI          │                       │  - Express routes      │
│  - Local IPC for     │                       │  - Anthropic AI agents │
│    macOS calendar,   │                       │  - Cognitive budget    │
│    notifications,    │                       │                        │
│    etc.              │                       └───────────┬────────────┘
└──────────────────────┘                                   │
                                                           ▼
                                              ┌────────────────────────┐
                                              │  Supabase Postgres     │
                                              │  Every row scoped by   │
                                              │  user_id (multi-user-  │
                                              │  ready from day 1)     │
                                              └────────────────────────┘
```

| Layer | Technology |
|-------|-----------|
| Renderer | React 18 + TypeScript + Vite + Zustand |
| Desktop shell | Electron 33 (`frontend/electron/`) |
| Cloud API | Node + Express + TypeScript on Fly.io (`backend/`) |
| Database | Supabase Postgres, every table `user_id`-scoped |
| AI | Claude (Sonnet 4.6 / Haiku 4.5) via `@anthropic-ai/sdk`, server-side only |
| Auth (phase 1) | Hardcoded bearer token (`Bearer sophie`) — single user |
| Auth (phase 2) | Supabase Auth / JWT — drop-in replacement, schema already ready |
| Packaging | electron-builder (macOS, Windows, Linux) |

The renderer never holds the Anthropic API key — it lives as a Fly secret on
the backend. Every cloud-bound request goes through one transport seam
(`frontend/src/services/cloudTransport.ts`) that adds the auth header and
routes the small handful of channels listed in `CLOUD_CHANNELS`. Anything not
in that set still uses the local Electron IPC bridge (memory, jobs, chat
attachments, macOS calendar/reminders).

## Project Structure

```
NorthStar/
├── frontend/                    # Everything that ships in the .dmg
│   ├── src/                     # React renderer
│   │   ├── pages/               # Welcome / Onboarding / Dashboard / Roadmap / Settings
│   │   ├── components/          # Sidebar, Heatmap, MoodLogger, RecoveryModal, ...
│   │   ├── services/
│   │   │   ├── auth.ts          # Single source of the bearer token
│   │   │   ├── cloudTransport.ts# Cloud HTTP transport (the one place fetch lives)
│   │   │   ├── ai.ts            # AI service wrappers
│   │   │   └── memory.ts        # Local memory bridge
│   │   ├── repositories/        # Typed wrappers around IPC + cloud invoke
│   │   ├── store/useStore.ts    # Zustand store
│   │   └── types/               # TypeScript domain types
│   ├── electron/                # Electron main process
│   │   ├── main.ts              # Window, lifecycle, IPC registration
│   │   ├── preload.ts           # Context bridge
│   │   ├── ipc/                 # Local IPC handlers (device calendar, environment)
│   │   ├── ai/                  # Local AI handlers (offline/dev mode only)
│   │   ├── domain/              # cognitiveBudget.ts (duplicated from backend)
│   │   ├── db/                  # better-sqlite3 schema + queries (local cache)
│   │   └── api-server.ts        # Local Express mirror for dev
│   ├── public/                  # Static assets (icon, etc.)
│   ├── index.html               # Vite HTML shell (loads /src/main.tsx)
│   ├── package.json             # Frontend deps + electron-builder config
│   ├── vite.config.ts           # Orchestrates renderer + electron main build
│   ├── tsconfig.json            # Renderer (src/) tsconfig
│   ├── tsconfig.node.json       # Electron + vite.config tsconfig
│   └── release/                 # electron-builder output (.dmg, .zip)
│
├── backend/                     # Cloud API — deploys to Fly.io
│   ├── src/
│   │   ├── index.ts             # Express entry, route registration, healthcheck
│   │   ├── middleware/
│   │   │   ├── auth.ts          # The ONLY place req.userId is set
│   │   │   └── errorHandler.ts  # Async wrapper + JSON error envelope
│   │   ├── routes/              # store, entities, ai, calendar, reminders, ...
│   │   ├── ai/                  # Anthropic client + agent handlers (classify-goal,
│   │   │                        # daily-tasks, recovery, pace-check, home-chat, ...)
│   │   ├── db/
│   │   │   ├── pool.ts          # pg connection pool (Supabase pooler aware)
│   │   │   ├── schema.sql       # Postgres schema, every table user_id-scoped
│   │   │   └── migrate.ts       # One-shot migration runner
│   │   ├── domain/              # cognitiveBudget.ts (duplicated in frontend)
│   │   └── memory.ts, reflection.ts, model-config.ts
│   ├── prompts/                 # AI prompt design docs
│   ├── Dockerfile               # Multi-stage node:22-alpine build (context: backend/)
│   ├── fly.toml                 # Fly.io app config (region: yyz)
│   ├── package.json             # Backend deps (pg, express, @anthropic-ai/sdk)
│   └── tsconfig.json
│
└── README.md
```

> **Note on `cognitiveBudget.ts`:** intentionally duplicated into both
> `frontend/electron/domain/` and `backend/src/domain/`. The two halves of
> the system communicate via the cloud HTTP API only — they share the wire
> format, not TypeScript source. The file is small and rarely changes, so
> the duplication cost is near-zero and it cleanly enforces the API
> boundary.

## Quick Start

### Prereqs
- Node 22+
- For backend dev: a Postgres URL (Supabase free tier works) and an Anthropic API key

### Frontend (Electron desktop)

```bash
cd frontend
npm install

# Cloud mode is the default — electron:dev bakes in VITE_CLOUD_API_URL.
npm run electron:dev
```

### Backend (cloud API)

```bash
cd backend
npm install

# Local dev — point at your Supabase pooler URL
DATABASE_URL=postgresql://... \
ANTHROPIC_API_KEY=sk-ant-... \
DEV_USER_ID=sophie \
npm run dev

# Run schema migration once
npx tsx src/db/migrate.ts
```

### Build the desktop installer

```bash
cd frontend
# Builds the universal macOS .dmg with the cloud URL baked in
VITE_CLOUD_API_URL=https://northstar-api.fly.dev npm run electron:build:mac
# → frontend/release/NorthStar-<version>-universal.dmg
```

## Deployment

### Backend → Fly.io

```bash
# One-time
fly secrets set DATABASE_URL=... ANTHROPIC_API_KEY=... DEV_USER_ID=sophie -a northstar-api

# Every deploy — backend/ is its own self-contained build context now.
cd backend && fly deploy -a northstar-api
```

### Frontend → GitHub Releases

```bash
git tag v0.1.0
git push origin main --tags
```

GitHub Actions builds installers for macOS, Windows, and Linux in parallel and
attaches them to the release.

## Multi-user readiness (phase 1 → phase 2)

Phase 1 ships as a single-user system but the schema, routes, and client
transport are already shaped for multi-user. The full checklist:

- ✅ Every Postgres table has `user_id text not null` with composite PKs
- ✅ Routes never hardcode a user — always `req.userId` from middleware
- ✅ `backend/src/middleware/auth.ts` is the only place a user id is decided
- ✅ `ANTHROPIC_API_KEY` is server-side only (Fly secret)
- ✅ `frontend/src/services/auth.ts` is the only client-side token source
- ✅ Every cloud request goes through one `cloudInvoke()` that adds `Authorization: Bearer …`

Phase 2 = swap `auth.ts` middleware for JWT verification and add a login page.
No schema migration needed.

## License

MIT
