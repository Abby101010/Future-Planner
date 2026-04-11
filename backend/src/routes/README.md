# backend/src/routes/

One file per IPC domain. Each file exports an Express router that's mounted
in `src/index.ts` under a path matching the original IPC channel prefix
(`store:*` → `/store`, `entities:*` → `/entities`, etc.).

| File | Mounted at | Channels |
|---|---|---|
| `store.ts` | `/store` | `load`, `save` — the full app snapshot |
| `entities.ts` | `/entities` | `new-goal`, `new-event`, `new-reminder`, `new-task`, ... (server-authoritative entity creation with cognitive-budget downgrade) |
| `ai.ts` | `/ai` | `classify-goal`, `daily-tasks`, `home-chat`, `recovery`, `pace-check`, `reallocate`, `generate-goal-plan`, ... |
| `calendar.ts` | `/calendar` | `list-events`, `create-event`, `update-event`, `delete-event`, `bulk-import` |
| `reminders.ts` | `/reminder` | `list`, `create`, `update`, `delete` |
| `monthlyContext.ts` | `/monthly-context` | `list`, `get`, `upsert`, `delete`, `analyze` |
| `modelConfig.ts` | `/model-config` | `get`, `set-overrides` |
| `chat.ts` | `/chat` | `list-sessions`, `save-session`, `delete-session`, `save-attachment`, `get-attachments` |
| `memory.ts` | `/memory` | `load`, `summary`, `clear`, `signal`, `task-completed`, `task-snoozed`, `task-skipped`, `feedback`, `chat-insight`, `task-timing`, `reflect`, `should-reflect`, `nudges`, `behavior-profile`, `save-behavior-profile` |

## Rules

1. **`user_id`-scope every query.** No `where` clause may omit `user_id = $1`.
2. **Match the IPC envelope byte-for-byte.** Each handler returns
   `{ ok: true, ... }` or `{ ok: false, error }` — same shape the renderer
   was getting from `electronAPI.invoke`.
3. **Use `asyncHandler` from middleware/errorHandler.** Never write a bare
   `async (req, res) => ...` — unhandled rejections will crash the process.
4. **Generate IDs on the server.** Routes that create rows call
   `randomUUID()` and return the new entity. The renderer never persists a
   client-generated ID.
