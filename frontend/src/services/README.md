# frontend/src/services/

The boundary layer between React and the outside world. **Every** call
that leaves the renderer process — HTTP, IPC, localStorage, geolocation —
goes through a function defined here. Pages and components never `fetch()`
directly.

## Files

| File | Role |
|---|---|
| `auth.ts` | The single source of the bearer token. Phase 1 returns the hardcoded `"sophie"` string; phase 2 will read a JWT from the macOS Keychain via `safeStorage` |
| `cloudTransport.ts` | The one place `fetch()` lives. Holds the `CLOUD_CHANNELS` set — channels in this set get routed to `https://${VITE_CLOUD_API_URL}/${channel.replace(":","/")}`; everything else falls through to the local Electron IPC bridge. Adds the `Authorization: Bearer <token>` header |
| `ai.ts` | Typed wrappers around every AI task (`classifyGoal`, `generateGoalPlan`, `homeChat`, `reallocateGoalPlan`, ...). Each wrapper goes through `submitAndWait` → `cloudInvoke`. Slice 6 made this cloud-only — there is no local-fallback queue anymore |
| `memory.ts` | Wrappers around the memory channels (`load`, `signal`, `task-completed`, `reflect`, `nudges`, `behavior-profile`, ...) |
| `jobPersistence.ts` | localStorage helpers for cross-mount jobId reattach (mostly dead code after slice 6 — kept for the GoalPlanPage cleanup path) |

## Conventions

- **Don't add a new top-level service unless the boundary is genuinely
  new.** Memory + AI + auth + cloud transport already cover everything
  the renderer needs.
- **Throw on failure with a useful message.** Pages catch and display.
- **Use `cloudInvoke<T>(channel, payload)`** instead of constructing
  `fetch` calls. The transport handles auth headers, error envelopes, and
  the IPC fallback for unmigrated channels.
