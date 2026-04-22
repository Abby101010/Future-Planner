# desktop/src/store/

Zustand global store. One file: `useStore.ts`.

## What lives here

**Only ephemeral UI state that doesn't belong on the server.** After
phase 7 the store holds exactly three things:

- **`currentView` / `setView`** — which top-level page is rendered
  (drives `App.tsx` routing).
- **`activeChatId` / `setActiveChatId`** — pointer into the home chat
  session list on `DashboardPage`.
- **`language` / `setLanguage`** — UI language, initially seeded from
  `view:onboarding` / `view:settings` and toggled from the settings page.

## The one rule

**Domain data does not live here.** Goals, daily logs, calendar events,
reminders, chat sessions, user profile, settings — all served by
`view:*` queries via `useQuery` and mutated via `useCommand`. The
server is the source of truth.

## What NOT to put here

- Any server-backed domain entity (goals, tasks, logs, reminders,
  events, chat messages, memory facts, monthly contexts).
- Derived data — compute it in the component or selector.
- `isLoading` / `error` flags — those belong to the relevant
  `useQuery` / `useCommand` call.
- Local modal-open / hover / scroll state — use `useState` in the
  component instead.

If you're about to add a new field here, stop and ask: could this be a
field on a server view? If yes, add it there.
