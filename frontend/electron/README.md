# frontend/electron/

The Electron main process. Owns:

- The macOS window (lifecycle, menu, devtools)
- The IPC channels the renderer talks to
- Local services that genuinely can't move to the cloud (macOS Calendar
  bridge, browser geolocation, optional offline AI fallback)
- A local SQLite cache used as a JSON-fallback for `app_store` if the
  cloud is unreachable

## Layout

```
electron/
├── main.ts              # Window + lifecycle + IPC bootstrap
├── preload.ts           # Context bridge — exposes window.electronAPI
├── ipc/                 # Per-domain IPC handlers + the registrar
│   ├── register.ts      # setupIPC() — calls each register*Ipc() in order
│   ├── context.ts       # Shared IPC context (mainWindow, db flag, loaders)
│   ├── store.ts         # Local store:* (load/save the JSON snapshot)
│   ├── entities.ts      # Local entity creation (used in pure-offline mode)
│   ├── calendar.ts      # In-app calendar events
│   ├── memory.ts        # Local memory:* fallback
│   ├── chat.ts          # Local chat session storage
│   ├── reminder.ts      # Local reminders
│   ├── monthlyContext.ts
│   ├── modelConfig.ts
│   ├── ai.ts            # Local AI handler dispatch (offline mode only)
│   └── environment.ts   # Browser geolocation bridge — STAYS local
├── ai/                  # Local AI handlers (mirrors backend/src/ai/)
├── agents/              # Multi-agent coordinator (research → schedule → reply)
├── db/                  # better-sqlite3 schema + queries
└── domain/              # cognitiveBudget.ts (duplicated from backend)
```

## Cloud-first vs local-first

After Phase 1b every channel listed in `frontend/src/services/cloudTransport.ts`
under `CLOUD_CHANNELS` flows over HTTP to the Fly backend. Anything **not**
in that set falls through to a handler here.

Channels that intentionally stay local:
- `device:*` — macOS Calendar/Reminders via osascript
- `environment:*` — browser geolocation

Channels that **could** still hit the local handler if the cloud is
unreachable (memory, store) — but in normal cloud mode they don't.

## Why the local copy of `domain/`

The electron side's `ipc/entities.ts` and `ai/handlers/dailyTasks.ts` import
`cognitiveBudget` directly. Rather than reach across into `backend/src/`
(which would re-couple the two halves), there's a local copy in
`electron/domain/`. **Both copies must stay in sync** — they're the same
file, intentionally duplicated. See `domain/README.md`.
