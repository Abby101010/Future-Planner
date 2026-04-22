# desktop/electron/

The Electron main process — minimal by design. Phase 13 deleted the
SQLite cache, the local IPC handler layer, and the local AI fallback:
everything domain-related now goes through the cloud via the envelope
protocol. What's left is window lifecycle and the auto-updater.

## Files

| File | Role |
|---|---|
| `main.ts` | `BrowserWindow` creation, window lifecycle, dev vs prod URL |
| `preload.ts` | Empty context bridge — the renderer talks straight to the server over HTTP/WS |
| `auto-updater.ts` | electron-updater integration (GitHub Releases) |

## The one rule

**No domain logic.** If you're tempted to add a new IPC handler for
something like "load goals" or "toggle task", the answer is: add a
view or command on the server instead. The main process should never
know about goals, tasks, or calendar events.

## What NOT to put here

- Custom IPC channels for domain data.
- A local database cache.
- Anthropic calls.
- Business logic of any kind — only window/auto-update/lifecycle glue.
