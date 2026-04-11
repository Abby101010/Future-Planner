# frontend/src/store/

Zustand global store. One file: `useStore.ts`.

## What lives here

The full client-side state slice that React reads from. Sections include:

- **`user`** — profile, language, settings, model overrides
- **`goals`** — all goals + their plans + per-goal chat history
- **`tasks`** — today's tasks + history
- **`calendar`** — in-app events + cached macOS Calendar events
- **`reminders`** — active reminders
- **`chat`** — home chat sessions + active session pointer
- **`memory`** — facts, preferences, signals (mirrored from cloud)
- **`monthlyContexts`** — per-month intensity overrides
- **`pendingTasks`** — quick-task analyses in flight
- Various UI flags (sidebar collapsed, current page, ...)

## Persistence

The store is persisted via `cloudInvoke("store:save", snapshot)` (debounced)
on every mutation, and rehydrated via `cloudInvoke("store:load")` on app
launch. The cloud is the source of truth — multiple devices stay in sync
because they all read/write the same `app_store` row.

## Conventions

- **Mutations go through setter actions on the store**, never via direct
  state edits.
- **Don't put derived data in the store.** Compute it from base state in a
  selector or in the component.
- **Pages are the only consumers of the store** — components receive the
  data they need as props.
- **Don't put ephemeral UI state here.** Modal open/closed, hover state,
  scroll position, etc. belong in local component state with `useState`.
