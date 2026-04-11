# frontend/src/

The React renderer. Everything the user sees in the Electron window.

## Layout

| Subdir | Role |
|---|---|
| `pages/` | One file per top-level screen (Welcome, Onboarding, Dashboard, Roadmap, Calendar, Tasks, NewsFeed, Planning, GoalPlan, Settings) |
| `components/` | Reusable UI: Sidebar, Heatmap, MoodLogger, RecoveryModal, AgentProgress, RichTextToolbar, IconPicker, MonthlyContext, ... |
| `services/` | Boundary code that talks to the outside world: `cloudTransport.ts` (HTTP), `auth.ts` (token), `ai.ts` (AI service wrappers), `memory.ts` (memory bridge), `jobPersistence.ts` (localStorage helpers) |
| `repositories/` | Typed wrappers around `invoke()` so pages don't deal with channel strings directly |
| `store/` | Zustand global store (`useStore.ts`) |
| `styles/` | Global CSS |
| `types/` | Shared TypeScript domain types (Goal, GoalPlan, Task, Reminder, MemoryStore, ...) |
| `i18n/` | English + Chinese locale strings, plus `useT()` hook |

## Top-level files

- **`main.tsx`** — Vite entry. Renders `<App />`.
- **`App.tsx`** — Router (welcome → onboarding → main). Holds the top-level
  state machine for first-launch vs returning user.

## Conventions

- **No `shared/domain` imports.** This was true after the cloud-readiness
  pass and stays true after the reorg — `cognitiveBudget.ts` lives in the
  electron side now (where it's actually used by `electron/ipc/entities.ts`).
- **No client-generated persistent IDs.** When creating an entity, the
  page calls `entitiesRepo.newGoal(...)` (or similar) and waits for the
  server to return the entity with its assigned ID before adding it to the
  store.
- **Every external call goes through `services/`.** Components and pages
  never `fetch()` directly and never read `window.electronAPI` directly —
  always go through `cloudTransport.ts` or a repository wrapper.
- **Zustand store is the only writable state.** Local component state is
  fine for UI ephemera (modal open/closed, hover) but anything persisted
  lives in `useStore.ts`.
