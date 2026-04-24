# Starward 星程

**AI-powered goal planning and daily productivity companion.**

Tell Starward where you want to go. It'll have a real conversation with you to
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

Starward runs as two cooperating pieces:

```
┌──────────────────────┐         HTTPS         ┌────────────────────────┐
│  Electron desktop    │  ◄──────────────────► │  Fly.io Node service   │
│  packages/desktop    │   Bearer auth token   │  packages/server       │
│                      │    + WebSocket        │                        │
│  - React UI          │   (view invalidates)  │  - Express routes      │
│  - useQuery /        │                       │  - Envelope protocol   │
│    useCommand        │                       │  - Anthropic AI agents │
│  - Zustand (UI only) │                       │                        │
└──────────────────────┘                       └───────────┬────────────┘
                                                           │
                                                           ▼
                                              ┌────────────────────────┐
                                              │  Supabase Postgres     │
                                              │  Every row scoped by   │
                                              │  user_id (multi-user-  │
                                              │  ready from day 1)     │
                                              └────────────────────────┘
```

Shared wire types live in `packages/core` and are imported by both the
desktop and server packages.

| Layer | Technology |
|-------|-----------|
| Renderer | React 18 + TypeScript + Vite + Zustand |
| Desktop shell | Electron 33 (`packages/desktop/electron/`) |
| Cloud API | Node + Express + TypeScript on Fly.io (`packages/server/`) |
| Database | Supabase Postgres, every table `user_id`-scoped |
| AI | Claude (Sonnet 4.6 / Haiku 4.5) via `@anthropic-ai/sdk`, server-side only |
| Auth (phase 1) | Hardcoded bearer token (`Bearer sophie`) — single user |
| Auth (phase 2) | Supabase Auth / JWT — drop-in replacement, schema already ready |
| Packaging | electron-builder (macOS, Windows, Linux) |

The renderer never holds the Anthropic API key — it lives as a Fly secret
on the server. All reads go through `useQuery("view:*")` and all writes
through `useCommand().run("command:*")`; the `transport.ts` module is the
single place `fetch()` lives. Each folder has a short README explaining
the one architectural rule in force there — start at
`packages/desktop/src/README.md` or `packages/server/src/README.md`.

## Project Structure

npm workspaces monorepo, three packages:

```
Future-Planner/
├── packages/
│   ├── core/        # Shared wire types: Envelope<T>, view/command kinds,
│   │                #   domain types (Goal, DailyTask, Reminder, ...)
│   ├── server/      # Express + Postgres. Views, commands, AI handlers,
│   │                #   WebSocket invalidation bus.
│   └── desktop/     # Electron + React renderer. Reads views, runs
│                    #   commands, subscribes to invalidations.
├── package.json     # workspaces + typecheck scripts
└── README.md
```

Every subfolder has its own README with 1-paragraph scope and one
architectural rule.

## Quick Start

### Prereqs
- Node 22+
- For backend dev: a Postgres URL (Supabase free tier works) and an Anthropic API key

### Frontend (Electron desktop)

```bash
cd packages/desktop
npm install

# Cloud mode is the default — electron:dev bakes in VITE_CLOUD_API_URL.
npm run electron:dev
```

### Backend (cloud API)

```bash
cd packages/server
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
cd packages/desktop
# Builds the universal macOS .dmg with the cloud URL baked in
VITE_CLOUD_API_URL=https://starward-api.fly.dev npm run electron:build:mac
# → packages/desktop/release/Starward-<version>-universal.dmg
```

## Deployment

### Backend → Fly.io

```bash
# One-time
fly secrets set DATABASE_URL=... ANTHROPIC_API_KEY=... DEV_USER_ID=sophie -a starward-api

# Every deploy — packages/server/ is its own self-contained build context now.
cd packages/server && fly deploy -a starward-api
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
- ✅ `packages/server/src/middleware/auth.ts` is the only place a user id is decided
- ✅ `ANTHROPIC_API_KEY` is server-side only (Fly secret)
- ✅ `packages/desktop/src/services/auth.ts` is the only client-side token source
- ✅ Every cloud request goes through one `cloudInvoke()` that adds `Authorization: Bearer …`

Phase 2 = swap `auth.ts` middleware for JWT verification and add a login page.
No schema migration needed.

## License

MIT
