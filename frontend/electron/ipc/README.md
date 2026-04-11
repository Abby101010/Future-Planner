# frontend/electron/ipc/

Per-domain IPC handlers. Each file registers a set of `ipcMain.handle(...)`
callbacks that the renderer reaches via `window.electronAPI.invoke(channel, payload)`.

## How it's wired

`main.ts` initializes a shared context (`context.ts`), then calls
`setupIPC()` from `register.ts`, which calls each per-domain `register*Ipc()`
in sequence. By the time the BrowserWindow is created, every channel is
registered.

```ts
// register.ts
export function setupIPC(): void {
  registerStoreIpc();
  registerAiIpc();
  registerCalendarIpc();
  registerMonthlyContextIpc();
  registerModelConfigIpc();
  registerChatIpc();
  registerReminderIpc();
  registerEnvironmentIpc();
  registerMemoryIpc();
  registerEntitiesIpc();
}
```

## Files

| File | Channels |
|---|---|
| `register.ts` | Top-level orchestrator |
| `context.ts` | `IpcContext` interface + `getIpcContext()` accessor (the main process owns the globals; handlers read them via this seam) |
| `store.ts` | `store:load`, `store:save` |
| `entities.ts` | `entities:new-goal`, `entities:new-event`, `entities:new-reminder`, `entities:new-task`, ... |
| `ai.ts` | Local AI dispatch (offline/dev mode) |
| `calendar.ts` | In-app calendar event CRUD |
| `chat.ts` | Local chat session + attachment storage |
| `memory.ts` | Local memory CRUD + reflection (mirrors backend/src/routes/memory.ts) |
| `monthlyContext.ts` | Per-month intensity profiles |
| `modelConfig.ts` | Per-user Claude tier overrides |
| `reminder.ts` | Reminder CRUD |
| `environment.ts` | Browser geolocation bridge — **stays local** |

## Why the duplication with backend/

Phase 1b moved the canonical implementation of most of these to the cloud
backend. The local handlers here are still wired up so the app can run
fully offline (or in pure-local dev with no cloud). In production cloud
mode, every cloud-routed channel never reaches these handlers — the
renderer's `cloudTransport` shortcuts them.

When changing a behavior, **change the cloud handler first** and only
update the local handler if you need to preserve offline parity.
