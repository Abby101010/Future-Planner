# frontend/electron/domain/

Pure domain logic that the Electron main process needs. Currently:

- **`cognitiveBudget.ts`** — How many "task units" a day can absorb,
  given monthly intensity context. Used by local AI handlers
  (`../ai/handlers/dailyTasks.ts`) and entity creation
  (`../ipc/entities.ts`).

## Why this is duplicated with `backend/src/domain/`

`cognitiveBudget.ts` is **intentionally duplicated** between
`backend/src/domain/cognitiveBudget.ts` and this directory. The two halves
of the app — frontend (Electron) and backend (Fly) — are connected only
via HTTP. Sharing TypeScript source across that boundary would require a
monorepo package, which we explicitly avoided in the Phase 1 cloud
migration to keep the build simple.

**Both copies must stay byte-identical.** When you change one, copy the
change into the other in the same commit. The function signatures and
behavior must match exactly, otherwise local-mode daily-task generation
will diverge from cloud-mode generation and the user will see different
plans depending on whether they're online.

## Adding a new domain file

1. Decide if it's needed in *both* main processes. If only the cloud
   needs it, put it under `backend/src/domain/` and leave this directory
   alone.
2. If both need it, create the file in `backend/src/domain/` first,
   then copy it here. Add the file name to this README's list above.
