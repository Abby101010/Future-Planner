# desktop/src/

The React renderer — everything the user sees in the Electron window.

## Layout

| Subdir | Role |
|---|---|
| `pages/` | One file per top-level screen (Welcome, Onboarding, Dashboard, Roadmap, Calendar, Tasks, NewsFeed, Planning, GoalPlan, Settings) |
| `components/` | Reusable UI pieces (Sidebar, Heatmap, RecoveryModal, etc.) |
| `hooks/` | `useQuery`, `useCommand`, `useAiStream`, `useWsEvent` — the envelope-protocol client |
| `services/` | Boundary code: `transport.ts` (new envelope), `cloudTransport.ts` (legacy HTTP), `auth.ts`, `ai.ts`, `memory.ts`, `queryCache.ts`, `wsClient.ts` |
| `repositories/` | Legacy typed wrappers around the old channel transport — only used by the few call sites that haven't migrated to `view:*` yet |
| `store/` | Zustand store (`useStore.ts`) — **ephemeral UI state only**, see its README |
| `lib/` | Pure helpers (e.g. `goalPlanHelpers.ts`) |
| `styles/` | Global CSS variables and base styles |
| `i18n/` | English + Chinese locale strings, plus the `useT()` hook |
| `utils/` | Small leaf utilities (`logger.ts`) |

## Top-level files

- **`main.tsx`** — Vite entry. Renders `<App />`.
- **`App.tsx`** — Router (welcome → onboarding → main). Seeds language
  and initial view from `view:onboarding`.

## The one architectural rule

**The server is the source of truth.** Reads go through
`useQuery("view:*")`, mutations go through `useCommand().run("command:*")`,
and the WebSocket `view:invalidate` events trigger refetches. Domain
data never lives in the Zustand store.

## What NOT to put here

- New persistent state in `store/useStore.ts` (add a server view instead).
- Direct `fetch()` calls from components (go through `hooks/useQuery`
  or `services/transport.ts`).
- New imports of `services/cloudTransport.ts` — it's legacy and should
  shrink over time, not grow.
