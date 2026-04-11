# frontend/

Everything that ships in the `.dmg`. Two halves:

- **`src/`** — the React renderer (the UI the user sees)
- **`electron/`** — the Electron main process (window lifecycle + the
  thin local services that can't move to the cloud)

Build tooling, `package.json`, and `vite.config.ts` all live here so the
repo root can stay limited to `frontend/` and `backend/`.

## Layout

```
frontend/
├── src/                  # React renderer (Vite)
│   ├── pages/            # One file per top-level screen
│   ├── components/       # Reusable UI components
│   ├── services/         # Cloud transport, AI wrappers, auth, memory bridge
│   ├── repositories/     # Typed wrappers around invoke (HTTP or IPC)
│   ├── store/            # Zustand global store
│   ├── styles/           # Global CSS
│   ├── types/            # Shared TypeScript domain types
│   └── i18n/             # English + Chinese locale strings
├── electron/             # Electron main process
│   ├── main.ts           # Window lifecycle, IPC registration
│   ├── preload.ts        # Context bridge to the renderer
│   ├── ipc/              # Local IPC handlers (device calendar, environment, ...)
│   ├── ai/               # Local AI handlers (offline/dev mode)
│   ├── agents/           # Multi-agent coordinator (research → schedule → reply)
│   ├── db/               # better-sqlite3 schema + queries (local cache)
│   └── domain/           # cognitiveBudget.ts (duplicated from backend)
├── public/               # Static assets (icon, etc.) — only if present
├── index.html            # Vite HTML shell (loads /src/main.tsx)
├── vite.config.ts        # Orchestrates renderer + electron main build
├── package.json          # Frontend deps + electron-builder config
├── tsconfig.json         # Renderer (src/) tsconfig
├── tsconfig.node.json    # Electron + vite.config tsconfig (separate project)
└── release/              # electron-builder output (.dmg, .zip) — gitignored
```

## Dev workflow

```bash
cd frontend
npm install
npm run electron:dev   # bakes in VITE_CLOUD_API_URL=https://northstar-api.fly.dev
```

`vite-plugin-electron/simple` (configured in `vite.config.ts`) builds
`electron/main.ts` + `electron/preload.ts` and auto-spawns Electron with
`VITE_DEV_SERVER_URL` set, all in one process group.

## Build a release `.dmg`

```bash
cd frontend
VITE_CLOUD_API_URL=https://northstar-api.fly.dev npm run electron:build:mac
# → release/NorthStar-<version>-universal.dmg
```

## Why two tsconfigs

`src/` and `electron/` run in different environments (browser vs Node) and
need different lib targets, module systems, and globals. They're declared
as **separate TypeScript projects** so `tsc` and editor type-checking can
treat them independently:

- `tsconfig.json` covers `src/` (DOM, ESNext, JSX)
- `tsconfig.node.json` covers `electron/` and `vite.config.ts` (Node, CJS)

Run both separately to typecheck the whole frontend:

```bash
npx tsc --noEmit
npx tsc -p tsconfig.node.json --noEmit
```
