# @starward/desktop

Everything that ships in the `.dmg`. Two halves:

- **`src/`** — the React renderer (the UI the user sees)
- **`electron/`** — the Electron main process (a thin shell that loads
  the renderer and exposes no custom IPC — all cloud I/O goes through
  the envelope protocol now)

## Layout

```
desktop/
├── src/                 # React renderer (Vite)
│   ├── pages/           # One file per top-level screen
│   ├── components/      # Reusable UI components
│   ├── hooks/           # useQuery / useCommand / useAiStream / useWsEvent
│   ├── services/        # transport.ts (envelope) + legacy cloudTransport
│   ├── repositories/    # Legacy typed wrappers (shrinking)
│   ├── store/           # Zustand — UI state only
│   ├── lib/             # Pure helpers
│   ├── styles/          # Global CSS
│   ├── i18n/            # English + Chinese locale strings
│   └── utils/           # Small leaf utilities
├── electron/            # Electron main process
│   ├── main.ts          # Window lifecycle
│   └── preload.ts       # (empty) context bridge
├── index.html           # Vite HTML shell
├── vite.config.ts       # Renderer + electron main build
└── package.json
```

## The one architectural rule

**Reads go through `useQuery("view:*")`, writes go through
`useCommand().run("command:*")`.** The server is the source of truth
for every domain entity; the Zustand store only holds ephemeral UI
state.

## Dev workflow

```bash
npm --workspace @starward/desktop run dev
```

## Build a release `.dmg`

```bash
VITE_CLOUD_API_URL=https://starward-api.fly.dev \
  npm --workspace @starward/desktop run electron:build:mac
```
